import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { BilagStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const validStatuses: BilagStatus[] = ["MANGLER_BELOEB", "BOGFOERT", "IGNORERET", "AFSTEMT"];
  const where = validStatuses.includes(status as BilagStatus)
    ? { status: status as BilagStatus }
    : undefined;

  const bilag = await prisma.bilag.findMany({
    where,
    include: {
      transaction: { include: { category: true, businessArea: true } },
      attachments: { select: { id: true, filename: true, contentType: true } },
    },
    orderBy: { receivedAt: "desc" },
  });

  return NextResponse.json(bilag);
}
