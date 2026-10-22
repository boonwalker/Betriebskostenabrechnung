import type { ISODate, Property } from "./types";

/** Steuermesszahl für Wohngrundstücke nach § 15 Abs. 1 Nr. 2 Buchst. a GrStG (Bundesmodell): 0,31 ‰ */
export const RESIDENTIAL_TAX_BASE_RATE = 0.00031;

/**
 * Geschätzte jährliche Grundsteuer: Grundsteuerwert × Steuermesszahl = Messbetrag (auf Cent abgerundet),
 * Messbetrag × Hebesatz. Nur zur Plausibilitätsprüfung – maßgeblich ist der Bescheid der Gemeinde.
 */
/**
 * Ab wann der Eigentümer die Grundsteuer trägt. Steuerschuldner ist, wem das Grundstück am 1. Januar
 * zugerechnet ist (§ 9 GrStG) – bei Erwerb im Lauf des Jahres also ab dem folgenden 1. Januar,
 * sofern nichts anderes erfasst ist (z. B. interne Erstattung laut Notarvertrag).
 */
export function propertyTaxStart(p: Pick<Property, "propertyTaxFrom" | "purchaseDate">): ISODate | null {
  if (p.propertyTaxFrom) return p.propertyTaxFrom;
  if (!p.purchaseDate) return null;
  return p.purchaseDate.slice(5) === "01-01" ? p.purchaseDate : `${Number(p.purchaseDate.slice(0, 4)) + 1}-01-01`;
}

/** Grundsteuer pro Jahr: Betrag laut Bescheid, sonst die Schätzung */
export function propertyTaxPerYear(p: Pick<Property, "propertyTaxValue" | "propertyTaxRate" | "propertyTaxAnnual">): number | null {
  return p.propertyTaxAnnual || estimatePropertyTax(p)?.tax || null;
}

export interface MunicipalCharge {
  key: "tax" | "waste";
  label: string;
  /** Kostenart nach § 2 BetrKV */
  category: number;
  amount: number;
}

/** Jährliche Abgaben laut Grundbesitzabgabenbescheid, die du als Eigentümer trägst */
export function municipalCharges(p: Pick<Property, "propertyTaxValue" | "propertyTaxRate" | "propertyTaxAnnual" | "wasteFeeAnnual">): MunicipalCharge[] {
  const out: MunicipalCharge[] = [];
  const tax = propertyTaxPerYear(p);
  if (tax) out.push({ key: "tax", label: "Grundsteuer", category: 1, amount: tax });
  if (p.wasteFeeAnnual) out.push({ key: "waste", label: "Müllgebühr", category: 8, amount: p.wasteFeeAnnual });
  return out;
}

/** Hebesatz, der sich aus Bescheidbetrag und Grundsteuerwert ergibt (zur Kontrolle) */
export function impliedRate(p: Pick<Property, "propertyTaxValue" | "propertyTaxAnnual">): number | null {
  if (!p.propertyTaxValue || !p.propertyTaxAnnual) return null;
  const baseAmount = Math.floor(p.propertyTaxValue * RESIDENTIAL_TAX_BASE_RATE * 100) / 100;
  return baseAmount > 0 ? (p.propertyTaxAnnual / baseAmount) * 100 : null;
}

export function estimatePropertyTax(p: Pick<Property, "propertyTaxValue" | "propertyTaxRate">): { baseAmount: number; tax: number } | null {
  if (!p.propertyTaxValue || !p.propertyTaxRate) return null;
  const baseAmount = Math.floor(p.propertyTaxValue * RESIDENTIAL_TAX_BASE_RATE * 100) / 100;
  return { baseAmount, tax: Math.round(baseAmount * p.propertyTaxRate) / 100 };
}
