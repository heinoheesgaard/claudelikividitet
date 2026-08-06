import "server-only";
import { extractText } from "unpdf";
import type { Worker as TesseractWorker } from "tesseract.js";

// A classic Danish invoice's totals section reads, in this order:
//   Beløb ekskl. moms (subtotal)  ->  Moms 25% (VAT, almost always a flat
//   25% rate in Denmark)  ->  I alt / Total / At betale (grand total incl.
//   VAT — this is the only figure that will ever show up on a bank
//   statement, so it's the only one worth guessing).
// Foreign invoices (e.g. SaaS subscriptions billed in EUR/USD) use their own
// wording — "Amount due", "Total" — which is why both Danish and English
// labels are included here.
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
const DATE_RE = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g;

// Matches a money amount in either Danish (1.234,56) or international
// (1,234.56 / 22.50) notation, with group 2 flagging a trailing "%" so
// callers can exclude VAT rates written the same way ("25,00 %").
const LINE_AMOUNT_RE = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})(\s*%)?/g;

function parseAmount(raw: string): number {
  // Whichever separator appears last is the decimal point; the other kind
  // (if any) is a thousands separator to strip. Handles "1.234,56" (Danish),
  // "1,234.56" (international) and plain "22.50" / "22,50" alike.
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma > lastDot) {
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }
  return Number(raw.replace(/,/g, ""));
}

function detectCurrency(context: string): string | null {
  const lower = context.toLowerCase();
  if (lower.includes("€") || /\beur\b/.test(lower)) return "EUR";
  if (lower.includes("$") || /\busd\b/.test(lower)) return "USD";
  if (lower.includes("£") || /\bgbp\b/.test(lower)) return "GBP";
  if (lower.includes("kr") || /\bdkk\b/.test(lower)) return "DKK";
  return null;
}

type AmountMatch = { amount: number; currency: string | null };

function extractLineAmounts(line: string): AmountMatch[] {
  const results: AmountMatch[] = [];
  for (const m of line.matchAll(LINE_AMOUNT_RE)) {
    if (m[2]) continue; // a percentage, e.g. a VAT rate — not a money amount
    const amount = parseAmount(m[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const idx = m.index ?? 0;
    const context = line.slice(Math.max(0, idx - 6), idx + m[0].length + 6);
    results.push({ amount, currency: detectCurrency(context) });
  }
  return results;
}

function findLabeledAmounts(text: string, labels: string[]): AmountMatch[] {
  // \b boundaries stop "total" from matching inside "subtotal", or "beløb"
  // inside "nettobeløb".
  const labelPattern = new RegExp(
    `\\b(${labels.map((l) => l.replace(/\s+/g, "\\s+")).join("|")})\\b`,
    "i",
  );

  const lines = text.split("\n");
  const matches: AmountMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelMatch = labelPattern.exec(line);
    if (!labelMatch) continue;

    // Only check right around this specific label — a table header row can
    // legitimately list "Moms" and "MomsBeløb" as *other* columns next to
    // "Total beløb", and that shouldn't disqualify the total column.
    // "(inkl. moms)" / "incl. VAT" next to the label is actually a good
    // sign — it confirms this total already includes VAT — so only a
    // pre-VAT qualifier ("ekskl. moms", "excluding tax", bare "moms" with
    // no "inkl"/"incl" nearby) should disqualify a match.
    const localStart = Math.max(0, labelMatch.index - 10);
    const localEnd = labelMatch.index + labelMatch[0].length + 15;
    const localContext = line.slice(localStart, localEnd).toLowerCase();
    const mentionsMoms = localContext.includes("moms") || /\bvat\b/.test(localContext);
    const confirmsInclVat = /\bink(l)?\.?\s*(moms|vat)|\binc(l)?\.?\s*(moms|vat)/.test(localContext);
    const isPreVat =
      /eks(kl)?\.?\s*moms|excl(uding)?\.?\s*(vat|tax)|ex\.?\s*tax|before\s*tax/.test(localContext);
    if (isPreVat || (mentionsMoms && !confirmsInclVat)) {
      continue;
    }

    // Same-line form: "I alt   1.250,00" or "Amount due   €22.50".
    const afterLabel = line.slice(labelMatch.index + labelMatch[0].length);
    const sameLineAmounts = extractLineAmounts(afterLabel);
    if (sameLineAmounts.length > 0) {
      matches.push(sameLineAmounts[sameLineAmounts.length - 1]);
      continue;
    }

    // Table form: the label is a column header ("Vare beløb  Moms  ...
    // Total beløb") with no number of its own — the values sit on the row
    // below, in the same left-to-right column order, so "Total beløb"
    // being the last header means its value is the last amount on that row.
    for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
      const rowAmounts = extractLineAmounts(lines[j]);
      if (rowAmounts.length > 0) {
        matches.push(rowAmounts[rowAmounts.length - 1]);
        break;
      }
    }
  }

  return matches;
}

function guessAmountFromText(text: string): AmountMatch | null {
  // The final total is usually the last "strong" label mentioned in reading
  // order (it comes after any subtotal/VAT lines), not necessarily the
  // largest number on the page.
  const strong = findLabeledAmounts(text, STRONG_LABELS);
  if (strong.length > 0) {
    return strong[strong.length - 1];
  }

  const weak = findLabeledAmounts(text, WEAK_LABELS);
  if (weak.length > 0) {
    return weak.reduce((max, m) => (m.amount > max.amount ? m : max));
  }

  const any = extractLineAmounts(text).filter((m) => m.currency !== null);
  if (any.length > 0) {
    return any.reduce((max, m) => (m.amount > max.amount ? m : max));
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

type GuessedDetails = {
  guessedAmount: number | null;
  guessedCurrency: string | null;
  guessedVendor: string | null;
  guessedInvoiceDate: Date | null;
};

const EMPTY_GUESS: GuessedDetails = {
  guessedAmount: null,
  guessedCurrency: null,
  guessedVendor: null,
  guessedInvoiceDate: null,
};

function buildGuessFromText(text: string): GuessedDetails {
  const amountMatch = guessAmountFromText(text);
  return {
    // No currency symbol found near the number almost always means it's a
    // plain Danish invoice (kr is often implied, not spelled out in every
    // table cell) — default to DKK rather than leaving it unknown.
    guessedAmount: amountMatch?.amount ?? null,
    guessedCurrency: amountMatch ? amountMatch.currency ?? "DKK" : null,
    guessedVendor: guessVendorFromText(text),
    guessedInvoiceDate: guessDateFromText(text),
  };
}

// Reused across calls (and across warm serverless invocations) so we only
// pay Tesseract's startup + language-download cost once per instance,
// instead of once per receipt photo. Loaded dynamically so a bundling or
// startup failure in this optional dependency can never break PDF-only
// guessing, which doesn't need it at all.
let ocrWorkerPromise: Promise<TesseractWorker> | null = null;

function getOcrWorker(): Promise<TesseractWorker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker("dan+eng"),
    );
  }
  return ocrWorkerPromise;
}

async function ocrImageText(data: Uint8Array): Promise<string> {
  const worker = await getOcrWorker();
  const {
    data: { text },
  } = await worker.recognize(Buffer.from(data));
  return text;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

export async function guessInvoiceDetails(
  attachments: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<GuessedDetails> {
  const pdf = attachments.find(
    (a) => a.contentType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf"),
  );
  if (pdf) {
    try {
      // extractText detaches/transfers the underlying buffer it's given, so
      // hand it an independent copy — the original bytes still need to be
      // written to the database unmodified after this runs.
      const { text } = await extractText(pdf.data.slice(), { mergePages: true });
      return buildGuessFromText(text);
    } catch (error) {
      console.error("Could not extract invoice details from PDF", error);
      return EMPTY_GUESS;
    }
  }

  const image = attachments.find(
    (a) => a.contentType.startsWith("image/") || IMAGE_EXTENSIONS.test(a.filename),
  );
  if (image) {
    try {
      const text = await ocrImageText(image.data);
      return buildGuessFromText(text);
    } catch (error) {
      console.error("Could not OCR invoice image", error);
      return EMPTY_GUESS;
    }
  }

  return EMPTY_GUESS;
}
