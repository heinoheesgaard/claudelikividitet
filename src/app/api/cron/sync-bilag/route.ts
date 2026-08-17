import { NextRequest, NextResponse } from "next/server";
import { syncBilagFromGmail } from "@/lib/gmail-sync";
import { prisma } from "@/lib/prisma";
import { runSyncJobBurst } from "@/lib/sync-job";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET er ikke konfigureret." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Ikke autoriseret." }, { status: 401 });
  }

  // A manual "Hent bilag nu" run normally finishes itself by chaining
  // requests to /api/bilag/sync-job/continue — this is only a safety net
  // for the rare case that chain died mid-flight (a deploy in between
  // bursts, a platform hiccup). Finish it here instead of leaving it
  // stranded until someone notices and clicks the button again.
  const stuckJob = await prisma.syncJob.findFirst({ where: { active: true } });
  if (stuckJob) {
    const status = await runSyncJobBurst(stuckJob.id);
    return NextResponse.json({ ok: true, resumedJob: status });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? "3") || 3;
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "50") || 50, 100);
  const pageToken = request.nextUrl.searchParams.get("pageToken") ?? undefined;

  try {
    const result = await syncBilagFromGmail({ days, limit, pageToken });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("sync-bilag failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
