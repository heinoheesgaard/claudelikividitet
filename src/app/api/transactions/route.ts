import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transactionInputSchema } from "@/lib/transaction-schema";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const businessAreaId = searchParams.get("businessAreaId");
  const categoryId = searchParams.get("categoryId");
  const type = searchParams.get("type");

  const where: Record<string, unknown> = {};

  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  if (businessAreaId) where.businessAreaId = businessAreaId;
  if (categoryId) where.categoryId = categoryId;
  if (type === "INCOME" || type === "EXPENSE") where.type = type;

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, businessArea: true },
    orderBy: { date: "desc" },
  });

  return NextResponse.json(transactions);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = transactionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const transaction = await prisma.transaction.create({
    data: {
      date: parsed.data.date,
      amount: parsed.data.amount,
      type: parsed.data.type,
      description: parsed.data.description,
      categoryId: parsed.data.categoryId ?? null,
      businessAreaId: parsed.data.businessAreaId ?? null,
      source: "MANUAL",
    },
    include: { category: true, businessArea: true },
  });

  return NextResponse.json(transaction, { status: 201 });
}
