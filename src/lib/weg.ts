import { categoryLabel } from "./betrkv";
import { CLASSIFICATION_LABELS } from "./classify";
import { fromCents, sumCents, toCents } from "./money";
import type { CostItem, EconomicPlan, LedgerPosition, Statement, WegAnnualStatement } from "./types";
import { uid } from "./model";

/*
 * Drei Ebenen, die nie vermischt werden:
 *  A. WEG-Jahresabrechnung (Eigentümer ↔ Gemeinschaft, Ist)   → WegAnnualStatement
 *  B. Betriebskostenabrechnung (Vermieter ↔ Mieter)            → Statement
 *  C. Wirtschaftsplan (Prognose)                               → EconomicPlan
 * In B gelangen nur geprüfte, umlagefähige Ist-Positionen aus A.
 */

const sumOf = (ps: LedgerPosition[]) => fromCents(sumCents(ps.map((p) => toCents(p.amount))));
const tolerance = 0; // Cent – Kontrollsummen müssen exakt stimmen

export interface AnnualSummary {
  allocable: number;
  nonAllocable: number;
  review: number;
  /** Summe aller Positionen */
  total: number;
  /** Bewirtschaftungskosten laut Dokument */
  declared: number | null;
  /** total − declared */
  difference: number | null;
  matchesDeclared: boolean | null;
  /** Soll − Ist: betrifft nur das Verhältnis Eigentümer ↔ WEG, nie den Mieter */
  ownerOverUnderCoverage: number | null;
  reserveContribution: number;
  unreviewed: number;
}

export function summarizeAnnual(a: WegAnnualStatement): AnnualSummary {
  const by = (c: LedgerPosition["classification"]) => sumOf(a.positions.filter((p) => p.classification === c));
  const total = sumOf(a.positions);
  const difference = a.managementCostsActual === null ? null : fromCents(toCents(total) - toCents(a.managementCostsActual));
  return {
    allocable: by("allocable"),
    nonAllocable: by("non_allocable"),
    review: by("review"),
    total,
    declared: a.managementCostsActual,
    difference,
    matchesDeclared: difference === null ? null : Math.abs(toCents(difference)) <= tolerance,
    ownerOverUnderCoverage:
      a.managementCostsPlan === null || a.managementCostsActual === null
        ? null
        : fromCents(toCents(a.managementCostsPlan) - toCents(a.managementCostsActual)),
    reserveContribution: a.reserveContribution,
    unreviewed: a.positions.filter((p) => !p.reviewed).length,
  };
}

export interface Finding {
  level: "error" | "warning" | "info";
  text: string;
  positionId?: string;
}

/** Konsistenzprüfungen der Jahresabrechnung inkl. Heizkosten */
export function checkAnnual(a: WegAnnualStatement): Finding[] {
  const out: Finding[] = [];
  const s = summarizeAnnual(a);
  if (s.declared === null) {
    out.push({ level: "warning", text: "Die Bewirtschaftungskosten laut Abrechnung fehlen – ohne sie ist keine Kontrollsumme möglich." });
  } else if (!s.matchesDeclared) {
    out.push({
      level: "error",
      text: `Kontrollsumme stimmt nicht: Positionen ${fmt(s.total)} ≠ Bewirtschaftungskosten ${fmt(s.declared)} (Differenz ${fmt(s.difference!)}). Fehlt eine Position oder wurde ein Betrag falsch erfasst?`,
    });
  }

  // Doppelte Positionen
  const seen = new Map<string, LedgerPosition>();
  for (const p of a.positions) {
    const key = `${p.label.toLowerCase().replace(/\s+/g, " ").trim()}|${toCents(p.amount)}`;
    const dup = seen.get(key);
    if (dup && p.amount !== 0) out.push({ level: "warning", text: `„${p.label}“ ist doppelt mit demselben Betrag erfasst.`, positionId: p.id });
    seen.set(key, p);
  }

  // Heizkosten: enthaltene Energie-/Wartungskosten nicht zusätzlich umlegen
  const heatingTotal = a.positions.filter((p) => p.heating === "total");
  const components = a.positions.filter((p) => p.heating === "component" && p.amount !== 0);
  if ((heatingTotal.length > 0 || a.heating) && components.length > 0) {
    for (const c of components) {
      out.push({
        level: "warning",
        text: `„${c.label}“ ist Teil der Heizkostenabrechnung und wird nicht zusätzlich in die Mieterabrechnung übernommen.`,
        positionId: c.id,
      });
    }
  }
  if (heatingTotal.length > 1) out.push({ level: "warning", text: "Mehrere Positionen als Heizkosten-Gesamtbetrag erfasst – bitte Doppelerfassung prüfen." });

  if (a.heating) {
    const h = a.heating;
    if (h.components.length > 0) {
      const compSum = fromCents(sumCents(h.components.map((c) => toCents(c.amount))));
      if (toCents(compSum) !== toCents(h.unitShare)) {
        out.push({ level: "error", text: `Heizkostenabrechnung: Bestandteile ergeben ${fmt(compSum)}, Anteil der Wohnung ist ${fmt(h.unitShare)}.` });
      }
    }
    const posAmount = heatingTotal.length === 1 ? heatingTotal[0].amount : null;
    if (posAmount !== null && toCents(posAmount) !== toCents(h.unitShare)) {
      out.push({
        level: "error",
        text: `Heizkosten in der Jahresabrechnung (${fmt(posAmount)}) weichen von der Heizkostenabrechnung (${fmt(h.unitShare)}) ab.`,
      });
    }
    if (h.baseSharePct !== null && (h.baseSharePct < 30 || h.baseSharePct > 50)) {
      out.push({ level: "error", text: `Grundkostenanteil ${h.baseSharePct} % liegt außerhalb von 30–50 % (§§ 7, 8 HeizkostenV).` });
    }
    if (h.co2Applicable && (h.co2Cost === null || h.co2Kg === null)) {
      out.push({ level: "warning", text: "CO2-Kosten oder CO2-Ausstoß fehlen – für die Aufteilung nach CO2KostAufG erforderlich." });
    }
  } else if (heatingTotal.length > 0) {
    out.push({ level: "info", text: "Heizkostenabrechnung des Messdienstes noch nicht erfasst – sie belegt die Heizkosten und die Verteilung nach HeizkostenV." });
  }

  const reviewOpen = a.positions.filter((p) => p.classification === "review");
  for (const p of reviewOpen) out.push({ level: "warning", text: `„${p.label}“ (${fmt(p.amount)}) muss geprüft werden: ${p.reason}`, positionId: p.id });
  if (s.unreviewed > 0) out.push({ level: "info", text: `${s.unreviewed} Position(en) noch nicht als geprüft bestätigt.` });
  return out;
}

/* ---------- Wirtschaftsplan ---------- */

export interface PlanSummary {
  /** laut Kennzeichnung der Verwaltung */
  declaredAllocable: number;
  declaredNonAllocable: number;
  undeclared: number;
  total: number;
  reserve: number;
  /** Gesamt ohne Rücklage */
  managementCosts: number;
  monthly: number;
  matchesAnnualHausgeld: boolean | null;
  matchesMonthlyHausgeld: boolean | null;
}

const isReserve = (p: LedgerPosition) => /r(ü|ue)cklage/i.test(p.label);

export function summarizePlan(plan: EconomicPlan): PlanSummary {
  const total = sumOf(plan.positions);
  const reserve = sumOf(plan.positions.filter(isReserve));
  const monthly = fromCents(Math.round(toCents(total) / 12));
  return {
    declaredAllocable: sumOf(plan.positions.filter((p) => p.declaredAllocable === true)),
    declaredNonAllocable: sumOf(plan.positions.filter((p) => p.declaredAllocable === false)),
    undeclared: sumOf(plan.positions.filter((p) => p.declaredAllocable === null)),
    total,
    reserve,
    managementCosts: fromCents(toCents(total) - toCents(reserve)),
    monthly,
    matchesAnnualHausgeld: plan.annualHausgeld === null ? null : toCents(plan.annualHausgeld) === toCents(total),
    matchesMonthlyHausgeld: plan.monthlyHausgeld === null ? null : toCents(plan.monthlyHausgeld) === toCents(monthly),
  };
}

/* ---------- Plan-Ist-Vergleich ---------- */

export interface ComparisonRow {
  key: string;
  label: string;
  plan: number;
  actual: number | null;
  difference: number | null;
  differencePct: number | null;
}

function groupOf(p: LedgerPosition): { key: string; label: string } {
  if (p.heating) return { key: "heating", label: "Heizung und Warmwasser (inkl. Energie und Wartung der Anlage)" };
  if (isReserve(p)) return { key: "reserve", label: "Erhaltungsrücklage" };
  const l = p.label.toLowerCase();
  if (/verwalt/.test(l)) return { key: "management", label: "Verwaltung" };
  if (/bank|spesen|kontof/.test(l)) return { key: "bank", label: "Bankgebühren" };
  if (/instand|erhaltung|reparatur/.test(l)) return { key: "maintenance", label: "Instandhaltung" };
  if (p.category !== null) return { key: `cat-${p.category}`, label: categoryLabel(p.category) };
  return { key: `label-${l}`, label: p.label };
}

/**
 * Vergleicht einen Wirtschaftsplan mit einer Ist-Abrechnung (typisch: Plan des Folgejahres
 * mit Ist des Vorjahres, oder Plan und Ist desselben Jahres). Reines Analysewerkzeug.
 */
export function comparePlanActual(plan: EconomicPlan, actual: WegAnnualStatement | null): ComparisonRow[] {
  const rows = new Map<string, { label: string; plan: number; actual: number }>();
  const add = (p: LedgerPosition, field: "plan" | "actual") => {
    const g = groupOf(p);
    const row = rows.get(g.key) ?? { label: g.label, plan: 0, actual: 0 };
    row[field] = fromCents(toCents(row[field]) + toCents(p.amount));
    rows.set(g.key, row);
  };
  plan.positions.forEach((p) => add(p, "plan"));
  actual?.positions.forEach((p) => add(p, "actual"));
  if (actual && actual.reserveContribution) {
    const row = rows.get("reserve") ?? { label: "Erhaltungsrücklage", plan: 0, actual: 0 };
    row.actual = fromCents(toCents(row.actual) + toCents(actual.reserveContribution));
    rows.set("reserve", row);
  }
  return [...rows.entries()]
    .map(([key, r]) => {
      const difference = actual ? fromCents(toCents(r.plan) - toCents(r.actual)) : null;
      return {
        key,
        label: r.label,
        plan: r.plan,
        actual: actual ? r.actual : null,
        difference,
        differencePct: difference !== null && r.actual !== 0 ? difference / r.actual : null,
      };
    })
    .sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0) || b.plan - a.plan);
}

/** Kurze Erklärung der größten Veränderungen */
export function explainDrivers(rows: ComparisonRow[], limit = 3): string[] {
  return rows
    .filter((r) => r.difference !== null && Math.abs(r.difference) >= 1)
    .slice(0, limit)
    .map((r) => {
      const dir = r.difference! > 0 ? "steigt" : "sinkt";
      const pct = r.differencePct !== null ? ` (${r.differencePct > 0 ? "+" : ""}${(r.differencePct * 100).toFixed(1).replace(".", ",")} %)` : "";
      return `${r.label} ${dir} um ${fmt(Math.abs(r.difference!))}${pct}.`;
    });
}

/* ---------- Übernahme in die Mieterabrechnung ---------- */

export interface TransferResult {
  items: CostItem[];
  skipped: { position: LedgerPosition; reason: string }[];
}

/**
 * Erzeugt Kostenpositionen der Mieterabrechnung aus einer WEG-Jahresabrechnung.
 * - nur umlagefähige UND geprüfte Positionen
 * - Heizungsbestandteile nicht zusätzlich zur Heizkostenabrechnung
 * - bereits übernommene Positionen werden nicht doppelt angelegt
 * - Umlage direkt auf die Wohnung: Der Anteil laut Einzelabrechnung folgt dem WEG-Schlüssel (§ 556a Abs. 3 BGB)
 */
export function transferToStatement(annual: WegAnnualStatement | EconomicPlan, statement: Statement): TransferResult {
  if (annual.kind !== "annual") {
    // Harte Sperre: Ein Wirtschaftsplan ist eine Prognose und nie Grundlage einer Mieterabrechnung
    throw new Error("Ein Wirtschaftsplan kann nicht in eine Mieterabrechnung übernommen werden.");
  }
  const already = new Set(statement.costs.map((c) => c.sourcePositionId).filter(Boolean));
  const hasHeatingTotal = annual.positions.some((p) => p.heating === "total") || annual.heating !== null;
  const items: CostItem[] = [];
  const skipped: TransferResult["skipped"] = [];
  for (const p of annual.positions) {
    if (already.has(p.id)) skipped.push({ position: p, reason: "bereits übernommen" });
    else if (p.classification !== "allocable") skipped.push({ position: p, reason: CLASSIFICATION_LABELS[p.classification] });
    else if (!p.reviewed) skipped.push({ position: p, reason: "noch nicht geprüft" });
    else if (p.heating === "component" && hasHeatingTotal) skipped.push({ position: p, reason: "in der Heizkostenabrechnung enthalten" });
    else if (p.amount === 0) skipped.push({ position: p, reason: "Betrag 0" });
    else {
      const h = p.heating === "total" ? annual.heating : null;
      items.push({
        id: uid(),
        category: p.category ?? 17,
        label: p.label,
        amount: p.amount,
        key: "direct",
        directUnitId: annual.unitId,
        note: p.reason,
        source: p.provenance?.document ?? `WEG-Jahresabrechnung ${annual.year}`,
        sourceAnnualId: annual.id,
        sourcePositionId: p.id,
        ...(h && h.co2Applicable && h.co2Cost && h.co2Kg ? { co2Cost: h.co2Cost, co2Kg: h.co2Kg } : {}),
      });
    }
  }
  return { items, skipped };
}

const fmt = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
