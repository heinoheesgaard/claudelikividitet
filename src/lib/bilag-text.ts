export const STOPWORDS = new Set([
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
  // Thypisk's own home town — shows up in nearly every piece of
  // correspondence they have (their own address, a local vendor's address,
  // a delivery address), so it does nothing to distinguish one purchase
  // from another. Both spellings are needed: bank exports transliterate "ø"
  // as "oe" ("VORUPOER"), while text read off an actual invoice keeps "ø".
  "thisted",
  "vorupør",
  "vorupoer",
]);

// Punctuation (including "." in domains like "gs-supply.dk") is treated as
// a word break, so "supply" alone can still match a candidate whose text
// only says "GS Supply" without the ".dk" suffix.
export function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zæøå0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w));
}
