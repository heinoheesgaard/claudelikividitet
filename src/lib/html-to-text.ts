// Some receipt/invoice emails (Zettle, and similar POS systems) put the
// entire receipt in the email body itself rather than as an attachment —
// there's no PDF or image to run through extractText/OCR, just HTML. This
// converts it to plain-ish text so the same label/arithmetic-based amount
// guessing used everywhere else can run on it unmodified.
const BLOCK_TAG_RE = /<\/(p|div|tr|table|li|h[1-6]|br)\s*>|<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const ENTITY_MAP: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const codePoint =
        code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return ENTITY_MAP[code.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  const withoutNonContent = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_TAG_RE, "\n");
  const withoutTags = withoutNonContent.replace(TAG_RE, " ");
  return decodeEntities(withoutTags)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
