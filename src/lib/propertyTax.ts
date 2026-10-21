import type { Property } from "./types";

/** Steuermesszahl für Wohngrundstücke nach § 15 Abs. 1 Nr. 2 Buchst. a GrStG (Bundesmodell): 0,31 ‰ */
export const RESIDENTIAL_TAX_BASE_RATE = 0.00031;

/**
 * Geschätzte jährliche Grundsteuer: Grundsteuerwert × Steuermesszahl = Messbetrag (auf Cent abgerundet),
 * Messbetrag × Hebesatz. Nur zur Plausibilitätsprüfung – maßgeblich ist der Bescheid der Gemeinde.
 */
/** Grundsteuer pro Jahr: Betrag laut Bescheid, sonst die Schätzung */
export function propertyTaxPerYear(p: Pick<Property, "propertyTaxValue" | "propertyTaxRate" | "propertyTaxAnnual">): number | null {
  return p.propertyTaxAnnual || estimatePropertyTax(p)?.tax || null;
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
