import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { significantWords } from "@/lib/bilag-text";

// Deliberately searches across every status, not just the active queue —
// the whole point is finding a specific bilag from years back regardless of
// whether it's since been booked, reconciled, or archived as ignored.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const amountParam = searchParams.get("amount");
  const q = searchParams.get("q");

  if (!dateFrom && !dateTo && !amountParam && !q) {
    return NextResponse.json(
      { error: "Angiv mindst en dato, et beløb eller en søgetekst." },
      { status: 400 },
    );
  }

  const amount = amountParam !== null ? Number(amountParam) : null;
  if (amountParam !== null && !Number.isFinite(amount)) {
    return NextResponse.json({ error: "Ugyldigt beløb." }, { status: 400 });
  }

  const dateConditions: Prisma.BilagWhereInput[] = [];
  if (dateFrom || dateTo) {
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999Z`) : undefined;
    // A bilag can be submitted long after the purchase — match on either the
    // date it was received, or the invoice's own date read off the
    // attachment, whichever falls in range.
    dateConditions.push({ receivedAt: { gte: from, lte: to } });
    dateConditions.push({ guessedInvoiceDate: { gte: from, lte: to } });
  }

  // ±1 kr tolerance, consistent with the reconciliation matcher elsewhere.
  const amountCondition: Prisma.BilagWhereInput[] =
    amount !== null
      ? [
          {
            guessedAmount: { gte: amount - 1, lte: amount + 1 },
            OR: [{ guessedCurrency: null }, { guessedCurrency: "DKK" }],
          },
        ]
      : [];

  // Free-text search (vendor name, invoice number, anything a human would
  // recognize) is a fundamentally different tool than the date/amount
  // filters above — it lets you find a bilag Julia's own OCR guessed a
  // wrong amount or date for, or one submitted well outside a statement's
  // usual date window, neither of which the amount/date filters can reach.
  // Any one matching word is enough (OR), same spirit as the automated
  // matcher's word-overlap check, but here purely for a human to browse and
  // judge — no accept/reject heuristic involved.
  const words = q ? significantWords(q) : [];
  const textCondition: Prisma.BilagWhereInput[] =
    words.length > 0
      ? [
          {
            OR: words.flatMap((w) => [
              { subject: { contains: w, mode: "insensitive" as const } },
              { senderEmail: { contains: w, mode: "insensitive" as const } },
              { snippet: { contains: w, mode: "insensitive" as const } },
              { attachmentNames: { contains: w, mode: "insensitive" as const } },
              { guessedVendor: { contains: w, mode: "insensitive" as const } },
            ]),
          },
        ]
      : [];

  const where: Prisma.BilagWhereInput = {
    AND: [
      ...(dateConditions.length > 0 ? [{ OR: dateConditions }] : []),
      ...(amountCondition.length > 0 ? amountCondition : []),
      ...textCondition,
    ],
  };

  const results = await prisma.bilag.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 100,
    include: {
      transaction: { include: { category: true, businessArea: true } },
      attachments: { select: { id: true, filename: true, contentType: true } },
    },
  });

  return NextResponse.json(results);
}
