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

// A fixed monthly charge (rent, a subscription) recurs at the exact same
// amount every month, so an exact-to-the-øre amount match can't by itself
// tell May's invoice apart from August's — but a recurring bank posting
// ("Husleje aug") and the bilag it's actually for almost always both name
// the month somewhere ("Husleje maj"). Explicit, opposite month names is
// about as hard a contradiction as an outright wrong amount.
const MONTH_INDEX: Record<string, number> = {
  januar: 1, jan: 1,
  februar: 2, feb: 2,
  marts: 3, mar: 3,
  april: 4, apr: 4,
  maj: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// Returns the first Danish month name/abbreviation found as its own word
// (not as part of a longer word — "August ApS" counts, "augusta" doesn't),
// or null if the text doesn't clearly name a month at all.
export function extractMentionedMonth(text: string): number | null {
  const words = text
    .toLowerCase()
    .replace(/[^a-zæøå\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const w of words) {
    const month = MONTH_INDEX[w];
    if (month !== undefined) return month;
  }
  return null;
}
