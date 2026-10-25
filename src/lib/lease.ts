import { categoryLabel } from "./betrkv";
import type { LeaseAgreement, LedgerPosition, Property, Statement, Tenant, Unit } from "./types";
import { toCents } from "./money";

export function defaultLease(): LeaseAgreement {
  return {
    reference: "",
    agreedCategories: Array.from({ length: 16 }, (_, i) => i + 1),
    otherCosts: [],
    allocationRule: "weg",
    propertyTaxIndividual: true,
    paymentTerm: "30days",
  };
}

export const ALLOCATION_RULE_LABELS: Record<LeaseAgreement["allocationRule"], string> = {
  weg: "Schlüssel der WEG (§ 556a Abs. 3 BGB)",
  consumption_mea: "Verbrauch, soweit erfasst, im Übrigen Miteigentumsanteile",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]/g, " ");

// Allgemeine Tätigkeitswörter sagen nichts darüber, welche Leistung vereinbart ist
const STOP = new Set(["der", "die", "das", "und", "von", "des", "alle", "kosten", "anlage", "anlagen", "jaehrliche", "pruefung", "wartung", "inspektion", "reinigung", "sonstige", "ausgaben"]);
const words = (s: string) => norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** Wortstämme, die als gleichbedeutend gelten */
const SYNONYMS: [RegExp, string][] = [
  [/winterdienst|schnee|eis/, "winter"],
  [/treppenhaus|hausreinigung|gebaeudereinigung/, "treppenhaus"],
  [/dachrinne/, "dachrinne"],
  [/blitzschutz/, "blitzschutz"],
  [/lueftung|entlueftung/, "lueftung"],
  [/trockenleitung|steigleitung/, "leitung"],
  [/elektro/, "elektro"],
  [/trinkwasser|legionell/, "trinkwasser"],
  [/rauchwarn|rauchmelder/, "rauchmelder"],
];
const concepts = (s: string) => new Set(SYNONYMS.filter(([re]) => re.test(norm(s))).map(([, c]) => c));

export type AgreementMatch = { status: "agreed" | "partial" | "not_agreed"; text: string; /** bei partial: die ähnlich lautende Leistung im Vertrag */ term?: string };

/**
 * Ist eine Kostenposition laut Mietvertrag umlegbar?
 * Nr. 1–16: Kostenart muss vereinbart sein. Nr. 17 (sonstige): nur, wenn namentlich genannt.
 */
export function agreementFor(label: string, category: number | null, lease: LeaseAgreement): AgreementMatch {
  // Sonstige Betriebskosten werden zuerst namentlich gesucht – auch wenn die Position einer Nr. 1–16 zugeordnet ist
  const c = concepts(label);
  const named = lease.otherCosts.find((o) => [...concepts(o)].some((x) => c.has(x)));
  if (category !== null && category >= 1 && category <= 16) {
    if (lease.agreedCategories.includes(category)) return { status: "agreed", text: `vereinbart (§ 2 Nr. ${category} BetrKV)` };
    if (named) return { status: "agreed", text: `als sonstige Betriebskosten vereinbart („${named}“)` };
    return { status: "not_agreed", text: `${categoryLabel(category)} (Nr. ${category}) ist im Mietvertrag nicht vereinbart` };
  }
  if (named) return { status: "agreed", text: `als sonstige Betriebskosten vereinbart („${named}“)` };
  const mine = new Set(words(label));
  const similar = lease.otherCosts.find((o) => words(o).some((w) => [...mine].some((m) => m.startsWith(w.slice(0, 4)) || w.startsWith(m.slice(0, 4)))));
  if (similar) {
    return {
      status: "partial",
      text: `vereinbart ist nur „${similar}“ – umlegbar nur, wenn die Rechnung genau diese Leistung betrifft`,
      term: similar,
    };
  }
  return { status: "not_agreed", text: "nicht als sonstige Betriebskosten im Mietvertrag genannt (§ 2 Nr. 17 BetrKV verlangt die ausdrückliche Vereinbarung)" };
}

/** Wie agreementFor, berücksichtigt aber die Bestätigung des Vermieters an der Kostenposition */
export function agreementForItem(item: { label: string; category: number | null; confirmedAgreement?: string }, lease: LeaseAgreement): AgreementMatch {
  if (item.confirmedAgreement && lease.otherCosts.includes(item.confirmedAgreement))
    return { status: "agreed", text: `als „${item.confirmedAgreement}“ bestätigt (sonstige Betriebskosten laut Mietvertrag)` };
  return agreementFor(item.label, item.category, lease);
}

const CONSUMPTION_UNITS = /cbm|m³|m3|kwh|liter|zähler|verbrauch/i;

export interface LeaseAmount {
  amount: number;
  totalAmount?: number;
  basis?: { total: number; share: number; unit: string; label: string };
  note?: string;
  /** Betrag konnte nicht nach dem Vertragsschlüssel berechnet werden */
  problem?: string;
}

/**
 * Anteil einer WEG-Position nach dem Umlagemaßstab des Mietvertrags.
 * Heizkosten folgen immer der Heizkostenabrechnung (HeizkostenV geht vor).
 */
/** Trägt der Mieter diese Kostenart laut Objekteinstellung immer mit dem Anteil laut WEG? */
export const wegShareAlways = (property: Pick<Property, "wegShareAlways">, label: string) =>
  (property.wegShareAlways ?? []).some((l) => norm(l) === norm(label));

export function amountByLease(p: LedgerPosition, lease: LeaseAgreement | null | undefined, unit: Unit, property: Property): LeaseAmount {
  const wegBasis = p.wegBasis ? { ...p.wegBasis, label: p.wegBasis.unit === "MEA" ? "MEA" : p.wegKey ?? p.wegBasis.unit } : undefined;
  const asWeg: LeaseAmount = { amount: p.amount, totalAmount: p.totalAmount ?? undefined, basis: wegBasis };
  // Anteil 0 laut WEG (z. B. Einzelkosten einer anderen Wohnung) bleibt 0
  if (!lease || lease.allocationRule === "weg" || p.heating === "total" || p.amount === 0 || wegShareAlways(property, p.label)) return asWeg;
  if (p.wegBasis && CONSUMPTION_UNITS.test(p.wegBasis.unit + " " + (p.wegKey ?? ""))) return { ...asWeg, basis: { ...p.wegBasis, label: "Verbrauch" } };
  const meaTotal = property.wegMeaTotal;
  if (p.wegBasis && p.wegBasis.unit === "MEA" && p.wegBasis.share === unit.mea && p.wegBasis.total === meaTotal) return asWeg;
  if (!unit.mea || !meaTotal || p.totalAmount === null || p.totalAmount === undefined) {
    return { ...asWeg, problem: "Für die Umlage nach Miteigentumsanteilen fehlen Gesamtkosten der WEG oder die Miteigentumsanteile." };
  }
  const amount = Math.round((toCents(p.totalAmount) * unit.mea) / meaTotal) / 100;
  return {
    amount,
    totalAmount: p.totalAmount,
    basis: { total: meaTotal, share: unit.mea, unit: "MEA", label: "MEA lt. Mietvertrag" },
    note:
      amount === p.amount
        ? undefined
        : `nach Miteigentumsanteilen laut Mietvertrag; die WEG verteilt nach „${p.wegKey ?? "eigenem Schlüssel"}“ (Anteil dort ${p.amount.toFixed(2).replace(".", ",")} €)`,
  };
}

/** Mieter der Wohnung im Abrechnungszeitraum */
export function tenantsInPeriod(unitId: string, statement: Statement, tenants: Tenant[]): Tenant[] {
  return tenants.filter((t) => t.unitId === unitId && t.moveIn <= statement.periodEnd && (!t.moveOut || t.moveOut >= statement.periodStart));
}
