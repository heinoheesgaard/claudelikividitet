import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncBilagFromGmail } from "@/lib/gmail-sync";

// Vercel's own list-messages page size cap is generous, but this keeps each
// burst's Gmail API traffic modest — syncBilagFromGmail already stops
// itself well inside a single invocation's time limit regardless.
const PAGE_LIMIT = 25;

export type SyncJobStatus = {
  id: string;
  days: number;
  totalCreated: number;
  totalProcessed: number;
  active: boolean;
  error: string | null;
};

function toStatus(job: {
  id: string;
  days: number;
  totalCreated: number;
  totalProcessed: number;
  active: boolean;
  error: string | null;
}): SyncJobStatus {
  return {
    id: job.id,
    days: job.days,
    totalCreated: job.totalCreated,
    totalProcessed: job.totalProcessed,
    active: job.active,
    error: job.error,
  };
}

// Runs one bounded burst of a sync job and persists progress. If more pages
// remain, schedules the next burst to trigger itself via `after()` as a
// genuinely separate request — so it gets its own fresh serverless
// invocation and its own full time budget, rather than a browser tab
// needing to stay open and keep calling back in. Both the "start" and
// "continue" routes call this same function, so a fresh job and a resumed
// one behave identically.
export async function runSyncJobBurst(jobId: string): Promise<SyncJobStatus> {
  const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return { id: jobId, days: 0, totalCreated: 0, totalProcessed: 0, active: false, error: "Jobbet findes ikke." };
  }
  if (!job.active) {
    return toStatus(job);
  }

  try {
    const result = await syncBilagFromGmail({
      days: job.days,
      limit: PAGE_LIMIT,
      pageToken: job.pageToken ?? undefined,
    });
    const done = !result.nextPageToken;
    const updated = await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        pageToken: result.nextPageToken,
        totalCreated: { increment: result.created },
        totalProcessed: { increment: result.processed },
        active: !done,
      },
    });

    if (!done) {
      after(() => triggerNextBurst(jobId));
    }
    return toStatus(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await prisma.syncJob
      .update({ where: { id: jobId }, data: { active: false, error: message } })
      .catch(() => job);
    return toStatus(updated);
  }
}

async function triggerNextBurst(jobId: string) {
  const secret = process.env.CRON_SECRET;
  const host = process.env.VERCEL_URL;
  if (!secret || !host) {
    console.error(
      "Kan ikke fortsætte hentningen i baggrunden — VERCEL_URL eller CRON_SECRET mangler (kun tilgængeligt på Vercel).",
    );
    return;
  }
  try {
    await fetch(`https://${host}/api/bilag/sync-job/continue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ jobId }),
    });
  } catch (error) {
    console.error("Kunne ikke udløse fortsættelse af hentningen", error);
  }
}
