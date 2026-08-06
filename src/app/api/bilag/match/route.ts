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
  "mob",
  "pay",
  "mobpay",
  "aps",
  "com",
]);

function significantWords(text: string): string[] {
  // Punctuation (including "." in domains like "gs-supply.dk") is treated as
  // a word break, so "supply" alone can still match a candidate whose text
  // only says "GS Supply" without the ".dk" suffix.
  return text
    .toLowerCase()
    .replace(/[^a-zæøå0-9\s]/g, " ")
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
  // A bilag can be submitted to revisorkurt long after the purchase date (late
  // submission), but never before it — so the search window only needs a small
  // buffer before the earliest purchase date, and can run all the way to today.
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  minDate.setDate(minDate.getDate() - 5);
  const maxDate = new Date();

  const candidates = await prisma.bilag.findMany({
    where: { receivedAt: { gte: minDate, lte: maxDate } },
    select: {
      id: true,
      subject: true,
      senderEmail: true,
      snippet: true,
      attachmentNames: true,
      receivedAt: true,
      guessedInvoiceDate: true,
      status: true,
      attachments: { select: { id: true, filename: true } },
    },
  });

  const results = rows.map((row) => {
    const rowDate = new Date(row.date);
    const words = significantWords(row.text);

    const scored = candidates
      .map((c) => {
        const daysSincePurchase = (c.receivedAt.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSincePurchase < -5) return null;

        // A close match on the invoice's own date (read from the PDF) is a much
        // stronger signal than text overlap, since the bank statement date and
        // the invoice date should be the same purchase.
        const invoiceDateDiff = c.guessedInvoiceDate
          ? Math.abs((c.guessedInvoiceDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const dateBonus = invoiceDateDiff !== null && invoiceDateDiff <= 2 ? 5 : 0;

        const haystack = `${c.subject} ${c.senderEmail} ${c.snippet ?? ""} ${c.attachmentNames}`
          .toLowerCase();
        const score = words.filter((w) => haystack.includes(w)).length + dateBonus;
        if (score === 0) return null;
        return { bilag: c, score, daysSincePurchase, hasAttachment: c.attachments.length > 0 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.hasAttachment) - Number(a.hasAttachment) ||
          a.daysSincePurchase - b.daysSincePurchase,
      )
      .slice(0, 1);

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
        guessedInvoiceDate: s.bilag.guessedInvoiceDate,
        status: s.bilag.status,
        score: s.score,
        attachments: s.bilag.attachments,
      })),
    };
  });

  return NextResponse.json({ results });
}
