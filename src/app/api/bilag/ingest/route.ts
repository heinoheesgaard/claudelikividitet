import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bilagIngestSchema } from "@/lib/bilag-schema";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = bilagIngestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  let created = 0;
  let skipped = 0;

  for (const row of parsed.data.rows) {
    const existing = await prisma.bilag.findUnique({
      where: { emailMessageId: row.emailMessageId },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.bilag.create({
      data: {
        emailMessageId: row.emailMessageId,
        emailThreadId: row.emailThreadId,
        receivedAt: row.receivedAt,
        senderEmail: row.senderEmail,
        subject: row.subject,
        attachmentNames: JSON.stringify(row.attachmentNames),
        snippet: row.snippet,
        guessedVendor: row.guessedVendor,
        guessedAmount: row.guessedAmount,
      },
    });
    created += 1;
  }

  return NextResponse.json({ created, skipped });
}
