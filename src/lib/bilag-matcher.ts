import "server-only";
import { prisma } from "@/lib/prisma";
import { significantWords } from "@/lib/bilag-text";

export type MatchInputRow = {
  id: string;
  date: string;
  text: string;
  amount: number;
  // Bilag IDs to never suggest for this specific row — either because a
  // human already said "no" to them, or because they're already confirmed
  // against a different row and a bilag can't be matched twice.
  excludeBilagIds: Set<string>;
};

export type MatchCandidate = {
  bilagId: string;
  subject: string;
  senderEmail: string;
  receivedAt: Date;
  guessedInvoiceDate: Date | null;
  guessedAmount: number | null;
  guessedCurrency: string | null;
  status: string;
  score: number;
  attachments: { id: string; filename: string }[];
};

export type MatchedRow = {
  id: string;
  date: string;
  text: string;
  amount: number;
  match: MatchCandidate | null;
};

export type UnmatchedBilag = {
  bilagId: string;
  subject: string;
  senderEmail: string;
  receivedAt: Date;
  guessedInvoiceDate: Date | null;
  guessedAmount: number | null;
  guessedCurrency: string | null;
  attachments: { id: string; filename: string }[];
};

// Scores every candidate bilag in the archive against every posting row and
// returns the single best (accepted) match per row, if any — the same
// heuristic used throughout this session's reconciliation-matching work:
// an exact-to-the-øre amount match stands alone, anything looser needs real
// vendor-word overlap or an invoice-date match to back it up, and a known,
// clearly-wrong amount vetoes a match outright regardless of text overlap.
export async function matchRowsAgainstArchive(
  rows: MatchInputRow[],
): Promise<{ results: MatchedRow[]; unmatchedBilag: UnmatchedBilag[] }> {
  const dates = rows.map((r) => new Date(r.date)).filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length === 0) {
    return { results: rows.map((r) => ({ ...r, match: null })), unmatchedBilag: [] };
  }

  // A bilag can be submitted after the purchase date (late submission), but
  // rarely more than a few weeks after — bounding the window to the rows'
  // own period (plus a buffer) keeps the candidate pool tight and avoids
  // pulling in unrelated bilag received long before or after any of them.
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

  const results: MatchedRow[] = rows.map((row) => {
    const rowDate = new Date(row.date);
    const words = significantWords(row.text);

    const scored = candidates
      .map((c) => {
        if (row.excludeBilagIds.has(c.id)) return null;

        const daysSincePurchase = (c.receivedAt.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSincePurchase < -5) return null;

        const invoiceDateDiff = c.guessedInvoiceDate
          ? Math.abs((c.guessedInvoiceDate.getTime() - rowDate.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const dateBonus = invoiceDateDiff !== null && invoiceDateDiff <= 2 ? 5 : 0;

        const isComparableCurrency = c.guessedCurrency === null || c.guessedCurrency === "DKK";
        const amountDiff =
          c.guessedAmount !== null && isComparableCurrency
            ? Math.abs(c.guessedAmount - Math.abs(row.amount))
            : null;
        const exactAmountMatch = amountDiff !== null && amountDiff < 0.01;
        const amountBonus = amountDiff === null ? 0 : exactAmountMatch ? 20 : amountDiff <= 5 ? 8 : 0;

        const haystack = `${c.subject} ${c.senderEmail} ${c.snippet ?? ""} ${c.attachmentNames}`
          .toLowerCase();
        const textMatchCount = words.filter((w) => haystack.includes(w)).length;
        const score = textMatchCount + dateBonus + amountBonus;

        const amountKnownButWrong = amountDiff !== null && amountDiff > 5;
        const accept =
          !amountKnownButWrong &&
          (exactAmountMatch ||
            (textMatchCount >= 1 && (amountBonus > 0 || dateBonus > 0)) ||
            textMatchCount >= 2);
        if (!accept) return null;
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

    const best = scored[0] ?? null;
    return {
      id: row.id,
      date: row.date,
      text: row.text,
      amount: row.amount,
      match: best
        ? {
            bilagId: best.bilag.id,
            subject: best.bilag.subject,
            senderEmail: best.bilag.senderEmail,
            receivedAt: best.bilag.receivedAt,
            guessedInvoiceDate: best.bilag.guessedInvoiceDate,
            guessedAmount: best.bilag.guessedAmount,
            guessedCurrency: best.bilag.guessedCurrency,
            status: best.bilag.status,
            score: best.score,
            attachments: best.bilag.attachments,
          }
        : null,
    };
  });

  // Bilag inside the rows' own date range that never came up as a match for
  // any of them — leftover submissions (test mails, wrong forwards,
  // duplicates) that never went through the bank on this account. Only
  // offered up from MANGLER_BELOEB: a bilag someone already booked or
  // previously reconciled/ignored has its own deliberate status this
  // shouldn't silently override.
  const matchedIds = new Set(results.flatMap((r) => (r.match ? [r.match.bilagId] : [])));
  const unmatchedBilag: UnmatchedBilag[] = candidates
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

  return { results, unmatchedBilag };
}
