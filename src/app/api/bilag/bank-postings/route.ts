import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { matchRowsAgainstArchive, type MatchInputRow } from "@/lib/bilag-matcher";

const rowSchema = z.object({
  date: z.string().min(1),
  text: z.string().trim().default(""),
  amount: z.coerce.number(),
});
const uploadSchema = z.object({ rows: z.array(rowSchema).min(1).max(2000) });

// Uploading is additive, not a fresh start — rows are upserted into a
// persistent pool instead of only living in the browser for one session, so
// leaving the reconciliation page and coming back later doesn't mean
// re-uploading and starting over. Bank exports have no row ID of their own,
// so date+text+amount together is the dedup key: re-uploading an
// overlapping period (this week's file includes some of last week's rows
// again) just skips the ones already known.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldige posteringer." }, { status: 400 });
  }

  const dates = parsed.data.rows.map((r) => new Date(r.date));
  if (dates.some((d) => Number.isNaN(d.getTime()))) {
    return NextResponse.json({ error: "Ugyldig dato i en eller flere rækker." }, { status: 400 });
  }

  const created = await prisma.bankPosting.createMany({
    data: parsed.data.rows.map((r) => ({ date: new Date(r.date), text: r.text, amount: r.amount })),
    skipDuplicates: true,
  });

  return NextResponse.json({
    ok: true,
    created: created.count,
    skipped: parsed.data.rows.length - created.count,
  });
}

// Defaults to the pending review queue (with live-computed match
// suggestions) — the whole point of persisting postings is that this list
// reflects every posting still waiting on a decision, not just whatever was
// in the last upload. ?status=CONFIRMED / ?status=NO_BILAG_NEEDED instead
// list already-decided postings (for the "recently decided, undo?" view and
// for collecting bilag to ZIP), no live matching needed there.
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";

  if (status !== "PENDING") {
    if (status !== "CONFIRMED" && status !== "NO_BILAG_NEEDED") {
      return NextResponse.json({ error: "Ukendt status." }, { status: 400 });
    }
    const postings = await prisma.bankPosting.findMany({
      where: { status },
      orderBy: { date: "desc" },
      include: {
        matchedBilag: {
          select: {
            id: true,
            subject: true,
            guessedVendor: true,
            attachments: { select: { id: true, filename: true } },
          },
        },
      },
    });
    return NextResponse.json({ postings });
  }

  const pending = await prisma.bankPosting.findMany({
    where: { status: "PENDING" },
    orderBy: { date: "asc" },
  });
  if (pending.length === 0) {
    return NextResponse.json({ results: [], unmatchedBilag: [] });
  }

  // A bilag already confirmed against one posting can't be suggested for a
  // different one — the unique constraint on matchedBilagId would reject it
  // anyway, but filtering it out of suggestions up front avoids offering a
  // match that's just going to fail.
  const alreadyMatched = await prisma.bankPosting.findMany({
    where: { matchedBilagId: { not: null } },
    select: { matchedBilagId: true },
  });
  const alreadyMatchedIds = new Set(
    alreadyMatched.map((p) => p.matchedBilagId).filter((id): id is string => id !== null),
  );

  const rows: MatchInputRow[] = pending.map((p) => ({
    id: p.id,
    date: p.date.toISOString().slice(0, 10),
    text: p.text,
    amount: p.amount,
    excludeBilagIds: new Set([...p.rejectedBilagIds, ...alreadyMatchedIds]),
  }));

  const { results, unmatchedBilag } = await matchRowsAgainstArchive(rows);
  return NextResponse.json({ results, unmatchedBilag });
}
