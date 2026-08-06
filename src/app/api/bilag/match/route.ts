import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type MatchRow = {
  bilagNumber: string;
  date: string;
  text: string;
  amount: number;
};

const STOPWORDS = new Set([
  "kontaktløs",
  "nota",
  "notanr",
  "til",
  "fra",
  "mob.pay",
  "mobpay",
  "aps",
  "a/s",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zæøå0-9.\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const rows: MatchRow[] | undefined = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Ingen rækker at afstemme." }, { status: 400 });
  }

  const dates = rows.map((r) => new Date(r.date)).filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length === 0) {
    return NextResponse.json({ error: "Ingen gyldige datoer i filen." }, { status: 400 });
  }
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  minDate.setDate(minDate.getDate() - 5);
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  maxDate.setDate(maxDate.getDate() + 30);

  const candidates = await prisma.bilag.findMany({
    where: { receivedAt: { gte: minDate, lte: maxDate } },
    select: {
      id: true,
      subject: true,
      senderEmail: true,
      snippet: true,
      attachmentNames: true,
      receivedAt: true,
      status: true,
    },
  });

  const results = rows.map((row) => {
    const rowDate = new Date(row.date);
    const words = significantWords(row.text);

    const scored = candidates
      .map((c) => {
        const dayDiff = Math.abs(
          (c.receivedAt.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (dayDiff < -5 || dayDiff > 30) return null;
        const haystack = `${c.subject} ${c.senderEmail} ${c.snippet ?? ""} ${c.attachmentNames}`
          .toLowerCase();
        const score = words.filter((w) => haystack.includes(w)).length;
        if (score === 0) return null;
        return { bilag: c, score, dayDiff };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff)
      .slice(0, 3);

    return {
      bilagNumber: row.bilagNumber,
      date: row.date,
      text: row.text,
      amount: row.amount,
      matches: scored.map((s) => ({
        bilagId: s.bilag.id,
        subject: s.bilag.subject,
        senderEmail: s.bilag.senderEmail,
        receivedAt: s.bilag.receivedAt,
        status: s.bilag.status,
        score: s.score,
      })),
    };
  });

  return NextResponse.json({ results });
}
