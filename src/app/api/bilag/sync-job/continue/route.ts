import { NextRequest, NextResponse } from "next/server";
import { runSyncJobBurst } from "@/lib/sync-job";

export const maxDuration = 60;

// Called by the server itself (via `after()` in src/lib/sync-job.ts) to
// chain the next burst of an in-progress job — never by a browser, so it's
// on the public path list in src/proxy.ts and checks its own bearer secret
// instead of a session cookie, the same pattern /api/cron/sync-bilag uses.
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Ikke autoriseret." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const jobId = typeof body.jobId === "string" ? body.jobId : null;
  if (!jobId) {
    return NextResponse.json({ error: "Manglende jobId." }, { status: 400 });
  }

  const status = await runSyncJobBurst(jobId);
  return NextResponse.json(status);
}
