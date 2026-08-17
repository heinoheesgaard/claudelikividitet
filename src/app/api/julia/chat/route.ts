import { NextRequest } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getAnthropicClient } from "@/lib/anthropic";
import { resolveAttachmentBytes } from "@/lib/blob-storage";
import { formatDKK, formatDate } from "@/lib/format";

export const maxDuration = 60;

// Anthropic's vision/document support — anything else (e.g. a stray .txt
// attachment) is skipped and just noted by filename in the metadata block
// instead of sent as a content block.
const SUPPORTED_MEDIA_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Keeps a request's payload and cost bounded — this is the "start small"
// scope (analyze a hand-picked set of bilag, not the whole archive), not an
// open-ended chat over everything.
const MAX_BILAG = 15;

const chatSchema = z.object({
  bilagIds: z.array(z.string()).min(1).max(MAX_BILAG),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

const SYSTEM_PROMPT = `Du er Julia, den AI-drevne revisor og finansielle rådgiver indbygget i dette bogføringssystem for en dansk enkeltmandsvirksomhed/mindre selskab. Du har indgående viden om:

- Dansk bogføringslov, herunder de 5 års opbevaringspligt for bilag.
- Danske momsregler, herunder omvendt betalingspligt ("reverse charge") ved køb af varer/ydelser fra udlandet.
- Regnskabsforståelse på resultatopgørelse-niveau (indtægter, udgifter, forretningsområder, periodisering).

Din opgave er at analysere de konkrete bilag brugeren har valgt ud og hjælpe med at forstå sammenhænge, som simple regler ikke kan — f.eks. en udbetaling hvor flere fakturaer og et depositum er trukket fra i én samlet postering, eller uklare/selvmodsigende beløb på tværs af flere dokumenter. Du kan se de faktiske PDF'er/billeder af bilagene, ikke kun deres OCR-gæt, så stol på det du selv kan læse i dokumenterne frem for på systemets automatiske gæt, hvis de er uenige.

Vigtigt om din rolle:
- Du er rådgivende, IKKE udførende. Du bogfører, afstemmer eller ændrer aldrig noget selv i systemet — det gør brugeren manuelt ved at klikke i grænsefladen efter din forklaring.
- Vær konkret: henvis til faktiske beløb, datoer og bilagsnavne fra det du kan se, i stedet for at tale i generelle vendinger.
- Hvis noget er uklart eller tvetydigt, sig det klart frem for at gætte skråsikkert.
- Svar altid på dansk, kortfattet og i almindeligt sprog — brugeren er ikke revisoruddannet.`;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Ugyldig forespørgsel." }, { status: 400 });
  }
  const { bilagIds, messages } = parsed.data;
  if (messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Sidste besked skal være fra brugeren." }, { status: 400 });
  }

  const bilagList = await prisma.bilag.findMany({
    where: { id: { in: bilagIds } },
    include: {
      attachments: true,
      bankPosting: true,
    },
    orderBy: { receivedAt: "asc" },
  });
  if (bilagList.length === 0) {
    return Response.json({ error: "Ingen af de valgte bilag blev fundet." }, { status: 404 });
  }

  type DocBlock =
    | Anthropic.Messages.TextBlockParam
    | Anthropic.Messages.ImageBlockParam
    | Anthropic.Messages.DocumentBlockParam;
  const documentBlocks: DocBlock[] = [];
  for (const bilag of bilagList) {
    const metaLines = [
      `--- Bilag: "${bilag.guessedVendor ?? bilag.subject}" ---`,
      `Modtaget: ${formatDate(bilag.receivedAt.toISOString())} · Fra: ${bilag.senderEmail}`,
      `Emne: "${bilag.subject}"`,
      bilag.guessedInvoiceDate
        ? `Gættet fakturadato: ${formatDate(bilag.guessedInvoiceDate.toISOString())}`
        : null,
      bilag.guessedAmount != null
        ? `Gættet beløb: ${formatDKK(bilag.guessedAmount)}${
            bilag.guessedCurrency && bilag.guessedCurrency !== "DKK" ? ` ${bilag.guessedCurrency}` : ""
          }`
        : null,
      `Status: ${bilag.status}`,
      bilag.bankPosting
        ? `Matchet mod bankpostering: ${formatDate(bilag.bankPosting.date.toISOString())} · "${bilag.bankPosting.text}" · ${formatDKK(bilag.bankPosting.amount)}`
        : "Ikke matchet mod nogen bankpostering endnu.",
    ].filter((l): l is string => l !== null);
    documentBlocks.push({ type: "text", text: metaLines.join("\n") });

    for (const attachment of bilag.attachments) {
      if (!SUPPORTED_MEDIA_TYPES.has(attachment.contentType)) {
        documentBlocks.push({
          type: "text",
          text: `(Vedhæftning "${attachment.filename}" kunne ikke vises — filtype ${attachment.contentType} understøttes ikke.)`,
        });
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await resolveAttachmentBytes(attachment);
      } catch {
        documentBlocks.push({
          type: "text",
          text: `(Vedhæftning "${attachment.filename}" kunne ikke hentes.)`,
        });
        continue;
      }
      // ~25MB base64-encoded is a generous, well-inside-limits ceiling for a
      // single invoice/receipt file — anything bigger is almost certainly
      // not a normal bilag and would just bloat the request.
      if (bytes.byteLength > 20 * 1024 * 1024) {
        documentBlocks.push({
          type: "text",
          text: `(Vedhæftning "${attachment.filename}" er for stor til at vise.)`,
        });
        continue;
      }
      const data = bytes.toString("base64");
      if (attachment.contentType === "application/pdf") {
        documentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        });
      } else {
        documentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data,
          },
        });
      }
    }
  }

  // Cache the whole (potentially large, always-reused-verbatim-for-this-
  // conversation) document block prefix so a multi-turn chat only pays full
  // price for it once.
  if (documentBlocks.length > 0) {
    documentBlocks[documentBlocks.length - 1].cache_control = { type: "ephemeral" };
  }

  const anthropicMessages: Anthropic.Messages.MessageParam[] = messages.map((m, i) => {
    if (i === 0) {
      return {
        role: "user",
        content: [...documentBlocks, { type: "text", text: m.content }],
      };
    }
    return { role: m.role, content: m.content };
  });

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Julia er ikke sat op." },
      { status: 503 },
    );
  }

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: anthropicMessages,
  });

  const encoder = new TextEncoder();
  const body_ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `\n\n[Julia stødte på en fejl: ${error instanceof Error ? error.message : "ukendt fejl"}]`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body_, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
