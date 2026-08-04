export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, "").replace(/kr\.?/i, "");
  if (!trimmed) return null;

  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  let normalized = trimmed;

  if (hasComma && hasDot) {
    const lastComma = trimmed.lastIndexOf(",");
    const lastDot = trimmed.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = trimmed.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (hasComma) {
    normalized = trimmed.replace(",", ".");
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
