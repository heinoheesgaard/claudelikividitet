import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { transactionInputSchema } from "@/lib/transaction-schema";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = transactionInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const transaction = await prisma.transaction.update({
      where: { id },
      data: parsed.data,
      include: { category: true, businessArea: true },
    });
    return NextResponse.json(transaction);
  } catch {
    return NextResponse.json({ error: "Transaktionen blev ikke fundet." }, { status: 404 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.transaction.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Transaktionen blev ikke fundet." }, { status: 404 });
  }
}
