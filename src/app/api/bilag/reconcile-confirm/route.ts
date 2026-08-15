import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const matchedBilagIds: unknown = body?.matchedBilagIds;
  const ignoredBilagIds: unknown = body?.ignoredBilagIds;

  if (!Array.isArray(matchedBilagIds) || !Array.isArray(ignoredBilagIds)) {
    return NextResponse.json(
      { error: "matchedBilagIds og ignoredBilagIds skal begge være lister." },
      { status: 400 },
    );
  }

  // A bilag flagged as an ignore-candidate that's also someone's confirmed
  // match takes the "matched" outcome — it's clearly not junk if it was just
  // matched to a real bank posting.
  const matchedSet = new Set(matchedBilagIds.filter((id): id is string => typeof id === "string"));
  const ignoredIds = ignoredBilagIds.filter(
    (id): id is string => typeof id === "string" && !matchedSet.has(id),
  );
  const matchedIds = [...matchedSet];

  // Scoped to MANGLER_BELOEB so this step can never overwrite a bilag that
  // already has its own deliberate status (booked, previously reconciled,
  // previously ignored).
  const [afstemt, ignoreret] = await Promise.all([
    matchedIds.length > 0
      ? prisma.bilag.updateMany({
          where: { id: { in: matchedIds }, status: "MANGLER_BELOEB" },
          data: { status: "AFSTEMT" },
        })
      : Promise.resolve({ count: 0 }),
    ignoredIds.length > 0
      ? prisma.bilag.updateMany({
          where: { id: { in: ignoredIds }, status: "MANGLER_BELOEB" },
          data: { status: "IGNORERET" },
        })
      : Promise.resolve({ count: 0 }),
  ]);

  return NextResponse.json({ ok: true, afstemt: afstemt.count, ignoreret: ignoreret.count });
}
