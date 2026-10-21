const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const num = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export const formatEUR = (n: number) => eur.format(n);
export const formatNum = (n: number) => num.format(n);

/** Parst deutsche und englische Zahlenschreibweise ("1.234,56" oder "1234.56") */
export function parseNumber(s: string): number {
  const t = s.trim().replace(/\s|€/g, "");
  if (!t) return 0;
  const normalized = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(t)
      ? t.replace(/\./g, "") // "300.000" = Tausenderpunkte
      : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("de-DE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Euro ohne Nachkommastellen, für große Beträge */
export const formatEUR0 = (n: number) => eur0.format(n);
export const formatPct = (n: number | null) => (n === null || !Number.isFinite(n) ? "–" : pct.format(n));
/** mit Vorzeichen, z. B. "+1.234 €" */
export const formatSignedEUR0 = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + eur0.format(Math.abs(n));
export const formatSignedPct = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + pct.format(Math.abs(n));
