import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const businessAreaId = searchParams.get("businessAreaId");

  const dateFilter =
    from || to
      ? {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        }
      : undefined;

  const where: Record<string, unknown> = {};
  if (dateFilter) where.date = dateFilter;
  if (businessAreaId) where.businessAreaId = businessAreaId;

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, businessArea: true },
  });

  const incomeByCategory = new Map<string, { name: string; total: number }>();
  const expenseByCategory = new Map<string, { name: string; total: number }>();
  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of transactions) {
    const key = tx.category?.id ?? "uncategorized";
    const name = tx.category?.name ?? "Ukategoriseret";
    if (tx.type === "INCOME") {
      totalIncome += tx.amount;
      const entry = incomeByCategory.get(key) ?? { name, total: 0 };
      entry.total += tx.amount;
      incomeByCategory.set(key, entry);
    } else {
      totalExpense += tx.amount;
      const entry = expenseByCategory.get(key) ?? { name, total: 0 };
      entry.total += tx.amount;
      expenseByCategory.set(key, entry);
    }
  }

  const businessArea = businessAreaId
    ? await prisma.businessArea.findUnique({ where: { id: businessAreaId } })
    : null;

  return NextResponse.json({
    scope: {
      businessAreaId: businessAreaId ?? null,
      businessAreaName: businessArea?.name ?? null,
    },
    incomeByCategory: Array.from(incomeByCategory.values())
      .sort((a, b) => b.total - a.total)
      .map((e) => ({ ...e, total: round2(e.total) })),
    expenseByCategory: Array.from(expenseByCategory.values())
      .sort((a, b) => b.total - a.total)
      .map((e) => ({ ...e, total: round2(e.total) })),
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    profit: round2(totalIncome - totalExpense),
    transactionCount: transactions.length,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
