import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const attachment = await prisma.bilagAttachment.findUnique({ where: { id } });
  if (!attachment) {
    return NextResponse.json({ error: "Vedhæftningen blev ikke fundet." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Disposition": `inline; filename="${attachment.filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
