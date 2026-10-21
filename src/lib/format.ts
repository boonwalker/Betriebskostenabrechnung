const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export const formatEUR = (n: number) => eur.format(n);
export const formatNum = (n: number) => num.format(n);

/** Parst deutsche und englische Zahlenschreibweise ("1.234,56" oder "1234.56") */
export function parseNumber(s: string): number {
  const t = s.trim().replace(/\s|€/g, "");
  if (!t) return 0;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}
