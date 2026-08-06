import { NextRequest, NextResponse } from "next/server";
import { syncBilagFromGmail } from "@/lib/gmail-sync";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.days) || 3, 1), 400);
  const pageToken: string | undefined = typeof body.pageToken === "string" ? body.pageToken : undefined;

  try {
    const result = await syncBilagFromGmail({ days, limit: 20, pageToken });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("bilag sync failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
