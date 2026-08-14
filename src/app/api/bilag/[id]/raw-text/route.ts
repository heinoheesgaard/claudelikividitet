import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractRawText } from "@/lib/invoice-guess";

export const maxDuration = 60;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const bilag = await prisma.bilag.findUnique({
    where: { id },
    include: { attachments: { select: { filename: true, contentType: true, data: true } } },
  });
  if (!bilag) {
    return NextResponse.json({ error: "Bilag ikke fundet." }, { status: 404 });
  }

  const attachments = bilag.attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    data: new Uint8Array(a.data) as Uint8Array<ArrayBuffer>,
  }));

  try {
    const result = await extractRawText(attachments, bilag.bodyText);
    return new NextResponse(
      `# ${bilag.subject}\n# kilde: ${result.source} (${result.filename ?? "ingen fil"})\n\n${result.text}`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
