import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60) || "bilag";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const bilagIds: string[] = Array.isArray(body.bilagIds) ? body.bilagIds : [];
  if (bilagIds.length === 0) {
    return NextResponse.json({ error: "Ingen bilag valgt." }, { status: 400 });
  }

  const bilagList = await prisma.bilag.findMany({
    where: { id: { in: bilagIds } },
    include: { attachments: true },
  });

  if (bilagList.length === 0) {
    return NextResponse.json({ error: "Bilag ikke fundet." }, { status: 404 });
  }

  const zip = new JSZip();
  const usedFolderNames = new Set<string>();

  for (const bilag of bilagList) {
    const dateStr = bilag.receivedAt.toISOString().slice(0, 10);
    let folderName = sanitize(`${dateStr}_${bilag.subject}`);
    let suffix = 2;
    while (usedFolderNames.has(folderName)) {
      folderName = `${sanitize(`${dateStr}_${bilag.subject}`)}_${suffix}`;
      suffix += 1;
    }
    usedFolderNames.add(folderName);

    const folder = zip.folder(folderName);
    for (const attachment of bilag.attachments) {
      folder?.file(sanitize(attachment.filename), Buffer.from(attachment.data));
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bilag.zip"`,
    },
  });
}
