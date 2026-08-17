// One-time maintenance script: moves attachments stored before the
// Blob-storage migration (raw bytes in Postgres) into Vercel Blob, the same
// place every new attachment already goes. Only touches rows that still
// have `data` and no `blobPathname` yet, so it's safe to re-run — anything
// already migrated is skipped.
//
// Needs Vercel Blob credentials available locally: run `vercel link` once,
// then `vercel env pull` before each run (its OIDC token expires after a
// while), then:
//
//   npx tsx prisma/backfill-attachment-blobs.ts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { put } from "@vercel/blob";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const attachments = await prisma.bilagAttachment.findMany({
    where: { blobPathname: null, data: { not: null } },
    select: { id: true, filename: true, contentType: true, data: true },
  });

  console.log(`${attachments.length} vedhæftninger mangler at blive flyttet til Blob.`);

  let done = 0;
  for (const a of attachments) {
    if (!a.data) continue;
    const blob = await put(`bilag-attachments/${a.filename}`, Buffer.from(a.data), {
      access: "private",
      contentType: a.contentType,
      addRandomSuffix: true,
    });
    // Only clear `data` once the upload has actually succeeded — the file
    // is never without a copy somewhere in between.
    await prisma.bilagAttachment.update({
      where: { id: a.id },
      data: { blobPathname: blob.pathname, data: null },
    });
    done += 1;
    console.log(`[${done}/${attachments.length}] ${a.filename} -> ${blob.pathname}`);
  }

  console.log("Færdig.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
