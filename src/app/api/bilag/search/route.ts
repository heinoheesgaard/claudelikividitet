import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Deliberately searches across every status, not just the active queue —
// the whole point is finding a specific bilag from years back regardless of
// whether it's since been booked, reconciled, or archived as ignored.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const amountParam = searchParams.get("amount");

  if (!dateFrom && !dateTo && !amountParam) {
    return NextResponse.json(
      { error: "Angiv mindst en dato eller et beløb at søge på." },
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

  const where: Prisma.BilagWhereInput = {
    AND: [
      ...(dateConditions.length > 0 ? [{ OR: dateConditions }] : []),
      ...(amountCondition.length > 0 ? amountCondition : []),
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
