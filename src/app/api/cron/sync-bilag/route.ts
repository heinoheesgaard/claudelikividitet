import { NextRequest, NextResponse } from "next/server";
import { syncBilagFromGmail } from "@/lib/gmail-sync";

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
