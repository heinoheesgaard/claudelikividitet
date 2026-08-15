// Two bank/accounting export formats need parsing here:
//  1. e-conomic's own account-posting export (xlsx, has a header row with a
//     "Bilag" column) — the original, still-supported format.
//  2. A raw bank export with no header row at all: Dato;Tekst;Beløb;Valuta[;info],
//     semicolon-delimited if CSV, or the same column order in an xlsx. This is
//     what the bank itself gives you, well before anything is booked into
//     e-conomic or assigned a Bilag number — so rows here get a synthetic,
//     per-row running number instead of a real accounting reference.
export type ParsedBankRow = {
  bilagNumber: string;
  date: string; // yyyy-mm-dd
  text: string;
  amount: number;
};

// "1.234,56" -> 1234.56 ; "-53.329,78" -> -53329.78 ; "233,20" -> 233.2
function parseDanishAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".");
  return Number(cleaned);
}

// "06-07-2026" or "06.07.2026" -> Date. Danish bank exports use DD-MM-YYYY.
function parseDanishDateString(raw: string): Date | null {
  const match = /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRawBankCsvText(text: string): ParsedBankRow[] {
  const withoutBom = text.replace(/^﻿/, "");
  const lines = withoutBom.split(/\r?\n/).filter((line) => line.trim().length > 0);

  const rows: ParsedBankRow[] = [];
  lines.forEach((line, i) => {
    const cols = line.split(";");
    if (cols.length < 3) return;
    const date = parseDanishDateString(cols[0]);
    if (!date) return;
    const amount = parseDanishAmount(cols[2] ?? "");
    if (!Number.isFinite(amount)) return;
    rows.push({
      bilagNumber: String(i + 1),
      date: date.toISOString().slice(0, 10),
      text: (cols[1] ?? "").trim(),
      amount,
    });
  });
  return rows;
}

export function parseRawBankXlsxRows(raw: unknown[][]): ParsedBankRow[] {
  const rows: ParsedBankRow[] = [];
  raw.forEach((r, i) => {
    if (!Array.isArray(r) || r.length < 3) return;
    const rawDate = r[0];
    const date =
      rawDate instanceof Date
        ? rawDate
        : typeof rawDate === "string"
          ? parseDanishDateString(rawDate)
          : null;
    if (!date || Number.isNaN(date.getTime())) return;

    const rawAmount = r[2];
    const amount =
      typeof rawAmount === "number" ? rawAmount : parseDanishAmount(String(rawAmount ?? ""));
    if (!Number.isFinite(amount)) return;

    rows.push({
      bilagNumber: String(i + 1),
      date: date.toISOString().slice(0, 10),
      text: String(r[1] ?? "").trim(),
      amount,
    });
  });
  return rows;
}
