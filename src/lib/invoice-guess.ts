import "server-only";
import { extractText } from "unpdf";

const AMOUNT_LABEL_RE =
  /(i alt|samlet beløb|total|at betale|beløb|sum)[^\d\n]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(?:kr|dkk)?/gi;
const AMOUNT_ANY_RE = /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*(?:kr\.?|dkk)/gi;

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

export async function guessInvoiceDetails(
  attachments: { filename: string; contentType: string; data: Uint8Array<ArrayBuffer> }[],
): Promise<{ guessedAmount: number | null; guessedVendor: string | null }> {
  const pdf = attachments.find(
    (a) => a.contentType === "application/pdf" || a.filename.toLowerCase().endsWith(".pdf"),
  );
  if (!pdf) return { guessedAmount: null, guessedVendor: null };

  try {
    const { text } = await extractText(pdf.data, { mergePages: true });
    return {
      guessedAmount: guessAmountFromText(text),
      guessedVendor: guessVendorFromText(text),
    };
  } catch (error) {
    console.error("Could not extract invoice details from PDF", error);
    return { guessedAmount: null, guessedVendor: null };
  }
}
