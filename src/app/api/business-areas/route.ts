import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const businessAreas = await prisma.businessArea.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(businessAreas);
}

const createSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const businessArea = await prisma.businessArea.create({
      data: parsed.data,
    });
    return NextResponse.json(businessArea, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Et forretningsområde med det navn findes allerede." },
      { status: 409 },
    );
  }
}
