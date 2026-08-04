import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const importRowSchema = z.object({
  date: z.coerce.date(),
  amount: z.coerce.number().positive(),
  type: z.enum(["INCOME", "EXPENSE"]),
  description: z.string().trim().optional(),
  categoryName: z.string().trim().optional(),
  businessAreaName: z.string().trim().optional(),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { rows } = parsed.data;

  const categoryCache = new Map<string, string>();
  const businessAreaCache = new Map<string, string>();

  let imported = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      let categoryId: string | undefined;
      if (row.categoryName) {
        const cacheKey = `${row.categoryName}:${row.type}`;
        categoryId = categoryCache.get(cacheKey);
        if (!categoryId) {
          const category = await tx.category.upsert({
            where: { name_type: { name: row.categoryName, type: row.type } },
            update: {},
            create: { name: row.categoryName, type: row.type },
          });
          categoryId = category.id;
          categoryCache.set(cacheKey, categoryId);
        }
      }

      let businessAreaId: string | undefined;
      if (row.businessAreaName) {
        businessAreaId = businessAreaCache.get(row.businessAreaName);
        if (!businessAreaId) {
          const businessArea = await tx.businessArea.upsert({
            where: { name: row.businessAreaName },
            update: {},
            create: { name: row.businessAreaName },
          });
          businessAreaId = businessArea.id;
          businessAreaCache.set(row.businessAreaName, businessAreaId);
        }
      }

      await tx.transaction.create({
        data: {
          date: row.date,
          amount: row.amount,
          type: row.type,
          description: row.description,
          categoryId,
          businessAreaId,
          source: "IMPORT",
        },
      });
      imported += 1;
    }
  });

  return NextResponse.json({ imported });
}
