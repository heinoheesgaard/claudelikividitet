import "server-only";
import { extractText } from "unpdf";

const AMOUNT_LABEL_RE =
  /(i alt|samlet beløb|total|at betale|beløb|sum)[^\d\n]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(?:kr|dkk)?/gi;
const AMOUNT_ANY_RE = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(?:kr\.?|dkk)/gi;
const DATE_RE = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})\b/g;

function parseDanishAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

function guessAmountFromText(text: string): number | null {
  const labelMatches = [...text.matchAll(AMOUNT_LABEL_RE)]
    .map((m) => parseDanishAmount(m[2]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (labelMatches.length > 0) {
    return Math.max(...labelMatches);
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
