import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), bilagId: z.string().trim().min(1) }),
  z.object({ action: z.literal("reject"), bilagId: z.string().trim().min(1) }),
  z.object({ action: z.literal("no-bilag-needed") }),
  z.object({ action: z.literal("reset") }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const posting = await prisma.bankPosting.findUnique({ where: { id } });
  if (!posting) {
    return NextResponse.json({ error: "Posteringen blev ikke fundet." }, { status: 404 });
  }

  if (parsed.data.action === "confirm") {
    const { bilagId } = parsed.data;
    const bilag = await prisma.bilag.findUnique({ where: { id: bilagId } });
    if (!bilag) {
      return NextResponse.json({ error: "Bilaget blev ikke fundet." }, { status: 404 });
    }
    try {
      const [updated] = await prisma.$transaction([
        prisma.bankPosting.update({ where: { id }, data: { status: "CONFIRMED", matchedBilagId: bilagId } }),
        prisma.bilag.update({ where: { id: bilagId }, data: { status: "AFSTEMT" } }),
      ]);
      return NextResponse.json(updated);
    } catch (error) {
      // The unique constraint on matchedBilagId is the last line of
      // defense against matching the same bilag to two postings — a race
      // between two people confirming it around the same time, say.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { error: "Dette bilag er allerede koblet til en anden postering." },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  if (parsed.data.action === "reject") {
    const rejectedBilagIds = Array.from(new Set([...posting.rejectedBilagIds, parsed.data.bilagId]));
    const updated = await prisma.bankPosting.update({ where: { id }, data: { rejectedBilagIds } });
    return NextResponse.json(updated);
  }

  if (parsed.data.action === "no-bilag-needed") {
    const updated = await prisma.bankPosting.update({
      where: { id },
      data: { status: "NO_BILAG_NEEDED", matchedBilagId: null },
    });
    return NextResponse.json(updated);
  }

  // action === "reset" — back to PENDING, undoing whatever the previous
  // decision was. A confirmed posting also un-reconciles its bilag (back to
  // MANGLER_BELOEB) rather than leaving it stranded as AFSTEMT with nothing
  // pointing at it.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (posting.matchedBilagId) {
    ops.push(
      prisma.bilag.updateMany({
        where: { id: posting.matchedBilagId, status: "AFSTEMT" },
        data: { status: "MANGLER_BELOEB" },
      }),
    );
  }
  ops.push(
    prisma.bankPosting.update({
      where: { id },
      data: { status: "PENDING", matchedBilagId: null, rejectedBilagIds: [] },
    }),
  );
  const results = await prisma.$transaction(ops);
  return NextResponse.json(results[results.length - 1]);
}
