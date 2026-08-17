import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { guessInvoiceDetails } from "@/lib/invoice-guess";
import { uploadAttachmentToBlob } from "@/lib/blob-storage";

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
  bodyText: string | null;
  attachments: NormalizedAttachment[];
};

export async function storeBilag(input: NormalizedBilag) {
  const existing = await prisma.bilag.findUnique({
    where: { emailMessageId: input.emailMessageId },
  });
  if (existing) {
    return { bilagId: existing.id, skipped: true, attachments: 0 };
  }

  const { guessedAmount, guessedCurrency, guessedVendor, guessedCvr, guessedInvoiceDate } =
    await guessInvoiceDetails(input.attachments, input.bodyText);

  // Uploaded to Blob storage up front, outside the Bilag.create() call —
  // storing the raw bytes in Postgres instead is what blew through Neon's
  // free-tier monthly network transfer allowance (every read AND write sent
  // the full file through the database connection).
  const attachmentsWithBlob = await Promise.all(
    input.attachments.map(async (a) => ({
      filename: a.filename,
      contentType: a.contentType,
      blobPathname: await uploadAttachmentToBlob(a.filename, a.data, a.contentType),
    })),
  );

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
        bodyText: input.bodyText,
        guessedAmount,
        guessedCurrency,
        guessedVendor,
        guessedCvr,
        guessedInvoiceDate,
        attachments: {
          create: attachmentsWithBlob,
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
