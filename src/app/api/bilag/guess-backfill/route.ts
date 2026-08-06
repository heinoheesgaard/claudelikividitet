import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guessInvoiceDetails } from "@/lib/invoice-guess";

export const maxDuration = 60;

const BATCH_SIZE = 15;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const cursor: string | undefined = typeof body.cursor === "string" ? body.cursor : undefined;

  const candidates = await prisma.bilag.findMany({
    where: { guessedAmount: null, status: "MANGLER_BELOEB" },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      attachments: { select: { filename: true, contentType: true, data: true } },
    },
  });

  let updated = 0;
  for (const bilag of candidates) {
    const attachments = bilag.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      data: new Uint8Array(a.data) as Uint8Array<ArrayBuffer>,
    }));
    const { guessedAmount, guessedVendor, guessedInvoiceDate } = await guessInvoiceDetails(
      attachments,
    );
    if (guessedAmount !== null || guessedVendor !== null || guessedInvoiceDate !== null) {
      await prisma.bilag.update({
        where: { id: bilag.id },
        data: { guessedAmount, guessedVendor, guessedInvoiceDate },
      });
      updated += 1;
    }
  }

  const nextCursor = candidates.length === BATCH_SIZE ? candidates[candidates.length - 1].id : null;

  return NextResponse.json({
    ok: true,
    processed: candidates.length,
    updated,
    nextCursor,
  });
}
