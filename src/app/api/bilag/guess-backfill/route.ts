import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guessInvoiceDetails } from "@/lib/invoice-guess";

export const maxDuration = 60;

// Fetched in small pages so we always have a valid resume cursor — OCR on a
// photographed receipt is much slower than reading text out of a PDF, and
// the very first OCR call on a cold serverless instance also pays a one-off
// cost to download the Tesseract language data, which alone can approach
// the function's time limit.
const PAGE_SIZE = 10;
const TIME_BUDGET_MS = 40_000;
const PER_ITEM_TIMEOUT_MS = 20_000;

// Caps how long we wait on a single bilag's guess so one slow OCR job can't
// eat the whole request — on timeout we just move on and leave it for the
// next run (the underlying call keeps running in the background, but we
// stop waiting on it).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  let cursor: string | undefined = typeof body.cursor === "string" ? body.cursor : undefined;

  const startedAt = Date.now();
  let processed = 0;
  let updated = 0;
  let lastSeenId: string | undefined = cursor;
  let exhausted = false;

  try {
    outer: while (Date.now() - startedAt < TIME_BUDGET_MS) {
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
        exhausted = true;
        break;
      }

      for (const bilag of candidates) {
        if (Date.now() - startedAt >= TIME_BUDGET_MS) {
          cursor = lastSeenId;
          break outer;
        }

        const attachments = bilag.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          data: new Uint8Array(a.data) as Uint8Array<ArrayBuffer>,
        }));
        const result = await withTimeout(guessInvoiceDetails(attachments), PER_ITEM_TIMEOUT_MS);
        processed += 1;
        lastSeenId = bilag.id;

        if (
          result &&
          (result.guessedAmount !== null ||
            result.guessedVendor !== null ||
            result.guessedInvoiceDate !== null)
        ) {
          await prisma.bilag.update({
            where: { id: bilag.id },
            data: {
              guessedAmount: result.guessedAmount,
              guessedCurrency: result.guessedCurrency,
              guessedVendor: result.guessedVendor,
              guessedInvoiceDate: result.guessedInvoiceDate,
            },
          });
          updated += 1;
        }
      }

      cursor = lastSeenId;
      if (candidates.length < PAGE_SIZE) {
        exhausted = true;
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      updated,
      nextCursor: exhausted ? null : (cursor ?? null),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("guess-backfill failed", error);
    return NextResponse.json(
      { ok: false, error: message, processed, updated },
      { status: 500 },
    );
  }
}
