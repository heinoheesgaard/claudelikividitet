import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guessInvoiceDetails } from "@/lib/invoice-guess";

export const maxDuration = 60;

// Fetched in small pages so we always have a valid resume cursor — OCR on a
// photographed receipt is much slower than reading text out of a PDF, and
// unlike the fixed batch size before, this stops (and reports a cursor to
// continue from) before the serverless function itself would be killed.
const PAGE_SIZE = 10;
const TIME_BUDGET_MS = 45_000;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  let cursor: string | undefined = typeof body.cursor === "string" ? body.cursor : undefined;

  const startedAt = Date.now();
  let processed = 0;
  let updated = 0;
  let nextCursor: string | null = null;
  let sawFullPage = false;

  while (Date.now() - startedAt < TIME_BUDGET_MS) {
    const candidates = await prisma.bilag.findMany({
      where: { status: "MANGLER_BELOEB" },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        attachments: { select: { filename: true, contentType: true, data: true } },
      },
    });

    if (candidates.length === 0) {
      sawFullPage = false;
      break;
    }

    for (const bilag of candidates) {
      const attachments = bilag.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        data: new Uint8Array(a.data) as Uint8Array<ArrayBuffer>,
      }));
      const { guessedAmount, guessedCurrency, guessedVendor, guessedInvoiceDate } =
        await guessInvoiceDetails(attachments);
      processed += 1;
      if (guessedAmount !== null || guessedVendor !== null || guessedInvoiceDate !== null) {
        await prisma.bilag.update({
          where: { id: bilag.id },
          data: { guessedAmount, guessedCurrency, guessedVendor, guessedInvoiceDate },
        });
        updated += 1;
      }
    }

    cursor = candidates[candidates.length - 1].id;
    sawFullPage = candidates.length === PAGE_SIZE;
    if (!sawFullPage || Date.now() - startedAt >= TIME_BUDGET_MS) break;
  }

  nextCursor = sawFullPage ? (cursor ?? null) : null;

  return NextResponse.json({
    ok: true,
    processed,
    updated,
    nextCursor,
  });
}
