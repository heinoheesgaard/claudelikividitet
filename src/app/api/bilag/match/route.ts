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
  // A bilag can be submitted to revisorkurt after the purchase date (late
  // submission), but rarely more than a few weeks after — bounding the
  // window to the statement's own period (plus a buffer) keeps the
  // candidate pool tight. Letting it run unbounded to "today" caused real
  // problems: run this tool weeks or months after the statement's own dates
  // (e.g. re-running an old period) and it pulls in every bilag received
  // since, most of them unrelated — both diluting the "unmatched, safe to
  // archive" list with irrelevant bilag, and inflating false-positive
  // matches (an unrelated bilag's amount coincidentally landing close to a
  // posting's amount, with nothing else in common).
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  minDate.setDate(minDate.getDate() - 5);
  const latestRowDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const latePlusBuffer = new Date(latestRowDate);
  latePlusBuffer.setDate(latePlusBuffer.getDate() + 30);
  const maxDate = new Date(Math.min(latePlusBuffer.getTime(), Date.now()));

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
      guessedAmount: true,
      guessedCurrency: true,
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

        // The amount is the strongest signal of all — two independent records
        // (bank statement vs. invoice PDF) agreeing on the exact same amount is
        // rarely a coincidence, even when the vendor text doesn't overlap at all.
        // Only trust it when the guessed amount is in DKK — the bank statement
        // amount always is, so a EUR/USD invoice total isn't comparable without
        // a currency conversion we don't do.
        const isComparableCurrency = c.guessedCurrency === null || c.guessedCurrency === "DKK";
        const amountDiff =
          c.guessedAmount !== null && isComparableCurrency
            ? Math.abs(c.guessedAmount - Math.abs(row.amount))
            : null;
        const amountBonus = amountDiff === null ? 0 : amountDiff <= 1 ? 20 : amountDiff <= 5 ? 8 : 0;

        const haystack = `${c.subject} ${c.senderEmail} ${c.snippet ?? ""} ${c.attachmentNames}`
          .toLowerCase();
        const score = words.filter((w) => haystack.includes(w)).length + dateBonus + amountBonus;
        // A single incidental word match (e.g. the company's own home town
        // showing up in an unrelated invoice's address) was enough to pass
        // and become "the best match" whenever the real bilag either wasn't
        // in the candidate pool or scored 0 itself — producing exactly the
        // kind of confident-but-wrong match reported (completely different
        // vendor, hundreds of kroner off). Requiring at least 2 keeps a
        // strong amount match (bonus 8 or 20) or date match (bonus 5) on
        // its own, but rules out one coincidental shared word by itself.
        if (score < 2) return null;
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
        guessedAmount: s.bilag.guessedAmount,
        guessedCurrency: s.bilag.guessedCurrency,
        status: s.bilag.status,
        score: s.score,
        attachments: s.bilag.attachments,
      })),
    };
  });

  // Bilag inside the statement's own date range that never came up as a
  // match for any row — leftover submissions (test mails, wrong forwards,
  // duplicates) that never went through the bank on this account. Only
  // offered up from MANGLER_BELOEB: a bilag someone already booked
  // (BOGFOERT) or previously reconciled/ignored has its own deliberate
  // status that this step shouldn't silently overwrite.
  const matchedIds = new Set(results.flatMap((r) => r.matches.map((m) => m.bilagId)));
  const unmatchedBilag = candidates
    .filter((c) => c.status === "MANGLER_BELOEB" && !matchedIds.has(c.id))
    .map((c) => ({
      bilagId: c.id,
      subject: c.subject,
      senderEmail: c.senderEmail,
      receivedAt: c.receivedAt,
      guessedInvoiceDate: c.guessedInvoiceDate,
      guessedAmount: c.guessedAmount,
      guessedCurrency: c.guessedCurrency,
      attachments: c.attachments,
    }));

  return NextResponse.json({ results, unmatchedBilag });
}
