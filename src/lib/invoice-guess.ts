import "server-only";
import { extractText } from "unpdf";

// A classic Danish invoice's totals section reads, in this order:
//   Beløb ekskl. moms (subtotal)  ->  Moms 25% (VAT, almost always a flat
//   25% rate in Denmark)  ->  I alt / Total / At betale (grand total incl.
//   VAT — this is the only figure that will ever show up on a bank
//   statement, so it's the only one worth guessing).
// Strongest-first: labels that specifically mean "this is the final,
// payable amount" beat generic ones like bare "total", which also shows up
// in "Total moms" or "Subtotal" headings.
const STRONG_LABELS = [
  "i alt at betale",
  "beløb at betale",
  "at betale",
  "betalingsbeløb",
  "til betaling",
  "i alt",
  "totalbeløb",
  "total beløb",
  "samlet beløb",
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

// Matches a money amount, but reports (via group 2) whether it's actually a
// percentage ("25,00 %") so callers can exclude VAT rates.
const LINE_AMOUNT_RE = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(\s*%)?/g;

function extractLineAmounts(line: string): number[] {
  const amounts: number[] = [];
  for (const m of line.matchAll(LINE_AMOUNT_RE)) {
    if (m[2]) continue; // a percentage, e.g. a VAT rate — not a money amount
    const amount = parseDanishAmount(m[1]);
    if (Number.isFinite(amount) && amount > 0) amounts.push(amount);
  }
  return amounts;
}

function findLabeledAmounts(text: string, labels: string[]): number[] {
  // \b boundaries stop "total" from matching inside "subtotal", or "beløb"
  // inside "nettobeløb".
  const labelPattern = new RegExp(
    `\\b(${labels.map((l) => l.replace(/\s+/g, "\\s+")).join("|")})\\b`,
    "i",
  );

  const lines = text.split("\n");
  const amounts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelMatch = labelPattern.exec(line);
    if (!labelMatch) continue;

    // Only check right around this specific label — a table header row can
    // legitimately list "Moms" and "MomsBeløb" as *other* columns next to
    // "Total beløb", and that shouldn't disqualify the total column.
    const localStart = Math.max(0, labelMatch.index - 10);
    const localEnd = labelMatch.index + labelMatch[0].length + 10;
    const localContext = line.slice(localStart, localEnd).toLowerCase();
    // Skip VAT lines ("moms", "heraf moms") and subtotals ("ekskl. moms",
    // "excl. vat") — only the VAT-inclusive grand total should count.
    if (localContext.includes("moms") || /eks(kl)?\.?\s*moms|excl/.test(localContext)) continue;

    // Same-line form: "I alt   1.250,00" or "I alt: 1.250,00 kr".
    const afterLabel = line.slice(labelMatch.index + labelMatch[0].length);
    const sameLineAmounts = extractLineAmounts(afterLabel);
    if (sameLineAmounts.length > 0) {
      amounts.push(sameLineAmounts[sameLineAmounts.length - 1]);
      continue;
    }

    // Table form: the label is a column header ("Vare beløb  Moms  ...
    // Total beløb") with no number of its own — the values sit on the row
    // below, in the same left-to-right column order, so "Total beløb"
    // being the last header means its value is the last amount on that row.
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      const rowAmounts = extractLineAmounts(lines[j]);
      if (rowAmounts.length > 0) {
        amounts.push(rowAmounts[rowAmounts.length - 1]);
        break;
      }
    }
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
