import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runSyncJobBurst } from "@/lib/sync-job";

export const maxDuration = 60;

// Starting a new job supersedes whatever was previously in flight — running
// two Gmail syncs in parallel against the same account isn't useful and
// just doubles the API traffic.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.days) || 14, 1), 400);

  await prisma.syncJob.updateMany({ where: { active: true }, data: { active: false } });
  const job = await prisma.syncJob.create({ data: { days } });

  const status = await runSyncJobBurst(job.id);
  return NextResponse.json(status);
}
