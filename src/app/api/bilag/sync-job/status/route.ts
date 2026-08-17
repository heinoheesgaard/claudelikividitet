import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// The active job if there is one, otherwise the most recently finished one
// — lets the button show live progress (or the last run's result) even
// after a page reload, since the job itself runs independently of whoever's
// watching.
export async function GET() {
  const job = await prisma.syncJob.findFirst({
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });
  if (!job) {
    return NextResponse.json({ job: null });
  }
  return NextResponse.json({
    job: {
      id: job.id,
      days: job.days,
      totalCreated: job.totalCreated,
      totalProcessed: job.totalProcessed,
      active: job.active,
      error: job.error,
    },
  });
}
