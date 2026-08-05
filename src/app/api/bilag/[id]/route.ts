import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bilagConfirmSchema } from "@/lib/bilag-schema";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).extend(bilagConfirmSchema.shape),
  z.object({ action: z.literal("ignore") }),
  z.object({ action: z.literal("reset") }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const bilag = await prisma.bilag.findUnique({ where: { id } });
  if (!bilag) {
    return NextResponse.json({ error: "Bilaget blev ikke fundet." }, { status: 404 });
  }

  if (parsed.data.action === "ignore") {
    const updated = await prisma.bilag.update({
      where: { id },
      data: { status: "IGNORERET" },
    });
    return NextResponse.json(updated);
  }

  if (parsed.data.action === "reset") {
    if (bilag.transactionId) {
      await prisma.transaction.delete({ where: { id: bilag.transactionId } });
    }
    const updated = await prisma.bilag.update({
      where: { id },
      data: { status: "MANGLER_BELOEB", transactionId: null },
    });
    return NextResponse.json(updated);
  }

  const { amount, date, type, description, categoryId, businessAreaId } = parsed.data;

  const transaction = await prisma.transaction.create({
    data: {
      date: date ?? bilag.receivedAt,
      amount,
      type,
      description: description ?? bilag.guessedVendor ?? bilag.subject,
      categoryId: categoryId ?? null,
      businessAreaId: businessAreaId ?? null,
      source: "BILAG",
    },
  });

  const updated = await prisma.bilag.update({
    where: { id },
    data: { status: "BOGFOERT", transactionId: transaction.id },
    include: { transaction: { include: { category: true, businessArea: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.bilag.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bilaget blev ikke fundet." }, { status: 404 });
  }
}
