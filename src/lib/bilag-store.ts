import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { guessInvoiceDetails } from "@/lib/invoice-guess";

export type NormalizedAttachment = {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
};

export type NormalizedBilag = {
  emailMessageId: string;
  emailThreadId: string;
  receivedAt: Date;
  senderEmail: string;
  subject: string;
  snippet: string | null;
  attachments: NormalizedAttachment[];
};

export async function storeBilag(input: NormalizedBilag) {
  const existing = await prisma.bilag.findUnique({
    where: { emailMessageId: input.emailMessageId },
  });
  if (existing) {
    return { bilagId: existing.id, skipped: true, attachments: 0 };
  }

  const { guessedAmount, guessedCurrency, guessedVendor, guessedInvoiceDate } =
    await guessInvoiceDetails(input.attachments);

  try {
    const bilag = await prisma.bilag.create({
      data: {
        emailMessageId: input.emailMessageId,
        emailThreadId: input.emailThreadId,
        receivedAt: input.receivedAt,
        senderEmail: input.senderEmail,
        subject: input.subject,
        attachmentNames: JSON.stringify(input.attachments.map((a) => a.filename)),
        snippet: input.snippet,
        guessedAmount,
        guessedCurrency,
        guessedVendor,
        guessedInvoiceDate,
        attachments: {
          create: input.attachments,
        },
      },
    });

    return { bilagId: bilag.id, skipped: false, attachments: input.attachments.length };
  } catch (error) {
    // A sync run that timed out waiting on this message can still finish
    // creating it in the background after we've moved on. If a later run
    // races it here, the unique constraint on emailMessageId catches it —
    // treat that as an ordinary skip instead of failing the whole sync.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const created = await prisma.bilag.findUniqueOrThrow({
        where: { emailMessageId: input.emailMessageId },
      });
      return { bilagId: created.id, skipped: true, attachments: 0 };
    }
    throw error;
  }
}
