import "server-only";
import { extractText } from "unpdf";

// Ordered strongest-first: a document can mention several "total-ish" labels
// (subtotal, VAT total, grand total) — the strong tier is only for labels
// that specifically mean "this is the final amount", so we don't need to
// pick a number out of several equally-weighted candidates.
const STRONG_LABELS = [
  "i alt",
  "totalbeløb",
  "total beløb",
  "samlet beløb",
  "beløb at betale",
  "at betale",
  "grand total",
  "amount due",
  "total amount",
  "total",
];
const WEAK_LABELS = ["beløb", "sum"];
const AMOUNT_ANY_RE = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(?:kr\.?|dkk)/gi;
const DATE_RE = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g;

function parseDanishAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function findLabeledAmounts(text: string, labels: string[]): number[] {
  // The gap between label and number is allowed to cross line breaks, since
  // PDF table layouts often put the label and its value on separate lines.
  const pattern = new RegExp(
    `(${labels.map((l) => l.replace(/\s+/g, "\\s+")).join("|")})[^\\d]{0,40}(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})`,
    "gi",
  );
  const amounts: number[] = [];
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    const precedingContext = text.slice(Math.max(0, start - 15), start).toLowerCase();
    if (precedingContext.includes("moms")) continue; // skip VAT-only subtotals
    const amount = parseDanishAmount(m[2]);
    if (Number.isFinite(amount) && amount > 0) amounts.push(amount);
  }
  return amounts;
}

function guessAmountFromText(text: string): number | null {
  // The final total is usually the last "strong" label mentioned in reading
  // order (it comes after any subtotal/VAT lines), not necessarily the
  // largest number on the page.
  const strong = findLabeledAmounts(text, STRONG_LABELS);
  if (strong.length > 0) {
    return strong[strong.length - 1];
  }

  const weak = findLabeledAmounts(text, WEAK_LABELS);
  if (weak.length > 0) {
    return Math.max(...weak);
  }

  const anyMatches = [...text.matchAll(AMOUNT_ANY_RE)]
    .map((m) => parseDanishAmount(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (anyMatches.length > 0) {
    return Math.max(...anyMatches);
  }

  return null;
}

function guessVendorFromText(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 2 && l.length <= 60);

  for (const line of lines.slice(0, 8)) {
    const isMostlyDigits = (line.match(/\d/g)?.length ?? 0) > line.length / 2;
    const looksLikeDate = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(line);
    if (!isMostlyDigits && !looksLikeDate) {
      return line;
    }
  }
  return null;
}

function guessDateFromText(text: string): Date | null {
  const matches = [...text.matchAll(DATE_RE)];
  for (const m of matches) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) continue;
    if (date.getTime() > Date.now()) continue;
    return date;
  }
  return null;
}

export async function guessInvoiceDetails(
  attachments: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<{
  guessedAmount: number | null;
  guessedVendor: string | null;
  guessedInvoiceDate: Date | null;
}> {
  const empty = { guessedAmount: null, guessedVendor: null, guessedInvoiceDate: null };
  const pdf = attachments.find(
    (a) => a.contentType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf"),
  );
  if (!pdf) return empty;

  try {
    // extractText detaches/transfers the underlying buffer it's given, so hand
    // it an independent copy — the original bytes still need to be written to
    // the database unmodified after this runs.
    const { text } = await extractText(pdf.data.slice(), { mergePages: true });
    return {
      guessedAmount: guessAmountFromText(text),
      guessedVendor: guessVendorFromText(text),
      guessedInvoiceDate: guessDateFromText(text),
    };
  } catch (error) {
    console.error("Could not extract invoice details from PDF", error);
    return empty;
  }
}
