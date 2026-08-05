import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { storeBilag } from "@/lib/bilag-store";

type MailjetPart = {
  Headers?: Record<string, unknown>;
  ContentRef?: string;
};

type MailjetPayload = {
  Sender?: string;
  Recipient?: string;
  From?: string;
  Subject?: string;
  Date?: string;
  Headers?: Record<string, unknown>;
  Parts?: MailjetPart[];
  "Text-part"?: string;
  "Html-part"?: string;
  [key: string]: unknown;
};

function parseMailjetDate(value: string | undefined): Date {
  if (value) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      return new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second),
        ),
      );
    }
  }
  return new Date();
}

function headerValue(headers: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!headers) return undefined;
  const found = Object.keys(headers).find((k) => k.toLowerCase() === key.toLowerCase());
  if (!found) return undefined;
  const value = headers[found];
  if (Array.isArray(value)) return String(value[0]);
  return typeof value === "string" ? value : undefined;
}

function parseFilename(contentDisposition: string | undefined): string | undefined {
  if (!contentDisposition) return undefined;
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return match ? match[1] : undefined;
}

function parseContentType(contentType: string | undefined): string {
  if (!contentType) return "application/octet-stream";
  return contentType.split(";")[0].trim();
}

export async function POST(request: NextRequest) {
  const secret = process.env.MAILJET_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "MAILJET_WEBHOOK_SECRET er ikke konfigureret på serveren." },
      { status: 500 },
    );
  }

  const token = request.nextUrl.searchParams.get("token");
  if (token !== secret) {
    return NextResponse.json({ error: "Ugyldig eller manglende token." }, { status: 401 });
  }

  const rawBody = await request.text();
  let payload: MailjetPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON." }, { status: 400 });
  }

  const messageIdHeader = headerValue(payload.Headers, "Message-Id");
  const emailMessageId =
    messageIdHeader ?? `mailjet:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;

  const senderEmail = payload.Sender ?? payload.From ?? "ukendt";
  const subject = payload.Subject ?? "";
  const receivedAt = parseMailjetDate(payload.Date);
  const snippet = (payload["Text-part"] ?? "").trim().slice(0, 500) || null;

  const attachments: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }[] =
    [];
  for (const part of payload.Parts ?? []) {
    const contentDisposition = headerValue(part.Headers, "Content-Disposition");
    const isAttachment = contentDisposition?.toLowerCase().includes("attachment");
    if (!isAttachment || !part.ContentRef) continue;

    const base64 = payload[part.ContentRef];
    if (typeof base64 !== "string") continue;

    const filename = parseFilename(contentDisposition) ?? part.ContentRef;
    const contentType = parseContentType(headerValue(part.Headers, "Content-Type"));

    attachments.push({
      filename,
      contentType,
      data: Uint8Array.from(Buffer.from(base64, "base64")) as Uint8Array<ArrayBuffer>,
    });
  }

  const result = await storeBilag({
    emailMessageId,
    emailThreadId: emailMessageId,
    receivedAt,
    senderEmail,
    subject,
    snippet,
    attachments,
  });

  return NextResponse.json({ ok: true, ...result });
}
