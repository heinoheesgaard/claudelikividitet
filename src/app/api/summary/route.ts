import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const dateFilter =
    from || to
      ? {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        }
      : undefined;

  const transactions = await prisma.transaction.findMany({
    where: dateFilter ? { date: dateFilter } : undefined,
    include: { category: true, businessArea: true },
  });

  const expenseByCategory = new Map<string, { name: string; total: number; count: number }>();
  const byBusinessArea = new Map<
    string,
    { name: string; income: number; expense: number }
  >();

  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of transactions) {
    if (tx.type === "EXPENSE") {
      totalExpense += tx.amount;
      const key = tx.category?.id ?? "uncategorized";
      const name = tx.category?.name ?? "Ukategoriseret";
      const entry = expenseByCategory.get(key) ?? { name, total: 0, count: 0 };
      entry.total += tx.amount;
      entry.count += 1;
      expenseByCategory.set(key, entry);
    } else {
      totalIncome += tx.amount;
    }

    const areaKey = tx.businessArea?.id ?? "unassigned";
    const areaName = tx.businessArea?.name ?? "Ikke tildelt";
    const areaEntry = byBusinessArea.get(areaKey) ?? { name: areaName, income: 0, expense: 0 };
    if (tx.type === "INCOME") {
      areaEntry.income += tx.amount;
    } else {
      areaEntry.expense += tx.amount;
    }
    byBusinessArea.set(areaKey, areaEntry);
  }

  const expensesByCategory = Array.from(expenseByCategory.values())
    .sort((a, b) => b.total - a.total)
    .map((e) => ({ ...e, total: round2(e.total) }));

  const businessAreas = Array.from(byBusinessArea.values())
    .map((e) => ({
      name: e.name,
      income: round2(e.income),
      expense: round2(e.expense),
      profit: round2(e.income - e.expense),
    }))
    .sort((a, b) => b.profit - a.profit);

  return NextResponse.json({
    totals: {
      income: round2(totalIncome),
      expense: round2(totalExpense),
      profit: round2(totalIncome - totalExpense),
    },
    expensesByCategory,
    businessAreas,
    transactionCount: transactions.length,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
