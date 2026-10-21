import { categoryLabel } from "./betrkv";
import { CLASSIFICATION_LABELS } from "./classify";
import { fromCents, sumCents, toCents } from "./money";
import { calcPrepayments } from "./calc";
import { daysInclusive, intersect } from "./dates";
import { agreementFor, amountByLease, tenantsInPeriod } from "./lease";
import type { CostItem, EconomicPlan, HeatingBill, LeaseAgreement, LedgerPosition, Property, Statement, Tenant, WegAnnualStatement } from "./types";
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
/** Bis zu dieser Abweichung (in Cent) gilt eine Differenz zwischen Dokumenten als Rundungsdifferenz */
const roundingCents = 5;

/** Prüft, ob der Anteil der Wohnung zur Schlüsselrechnung „Gesamt × Anteil ÷ Basis“ passt */
export function checkKeyMath(positions: LedgerPosition[]): Finding[] {
  const out: Finding[] = [];
  for (const p of positions) {
    const b = p.wegBasis;
    if (!b || !b.total || p.totalAmount === null || p.totalAmount === undefined) continue;
    const expected = Math.round((toCents(p.totalAmount) * b.share) / b.total);
    const diff = toCents(p.amount) - expected;
    if (diff === 0) continue;
    const text = `„${p.label}“: ${fmt(p.totalAmount)} × ${num(b.share)}/${num(b.total)} ${b.unit} = ${fmt(fromCents(expected))}, im Dokument ${fmt(p.amount)}`;
    out.push(
      Math.abs(diff) <= 1
        ? { level: "info", text: `${text} (Rundungsdifferenz).`, positionId: p.id }
        : { level: "warning", text: `${text}. Bitte Schlüssel und Beträge prüfen.`, positionId: p.id },
    );
  }
  return out;
}

/**
 * Ist eine heizungsbezogene Position (Energie, Wartung) in der Heizkostenabrechnung enthalten?
 * true/false laut Kostenaufstellung der Heizkostenabrechnung, null = nicht feststellbar.
 */
export function includedInHeatingBill(p: LedgerPosition, heating: HeatingBill | null): boolean | null {
  const included = heating?.includedCosts ?? [];
  if (included.length === 0) return null;
  const words = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue");
  const label = words(p.label);
  const topics: [RegExp, RegExp][] = [
    [/strom|energie|brennstoff|gas|oel|fernwaerme/, /strom|energie|brennstoff|gas|oel|fernwaerme/],
    [/wartung.*(heizung|waermepumpe)|(heizung|waermepumpe)s?\s*-?wartung/, /wartung/],
    [/wohnungsstation|uebergabestation|frischwasserstation/, /station/],
    [/messdienst|ablesung|verbrauchserfassung|zaehler/, /messdienst|ablesung|erfassung|zaehler|geraetemiete/],
  ];
  for (const [mine, theirs] of topics) if (mine.test(label)) return included.some((c) => theirs.test(words(c.label)));
  return false;
}

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
  /** kurze Überschrift für Prüfpunkte */
  title?: string;
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

  // Spalte „Gesamt“ der WEG
  if (a.buildingTotal !== null && a.buildingTotal !== undefined && a.positions.every((p) => p.totalAmount !== null && p.totalAmount !== undefined)) {
    const sumTotal = sumCents(a.positions.map((p) => toCents(p.totalAmount!)));
    if (sumTotal !== toCents(a.buildingTotal)) {
      out.push({ level: "warning", text: `Gesamtkosten der WEG: Positionen ergeben ${fmt(fromCents(sumTotal))}, Abrechnung nennt ${fmt(a.buildingTotal)}.` });
    }
  }
  out.push(...checkKeyMath(a.positions));
  for (const p of a.positions) if (p.note && p.classification === "review") out.push({ level: "info", text: `„${p.label}“ laut Dokument: ${p.note}`, positionId: p.id });

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
  for (const c of components) {
    const inc = includedInHeatingBill(c, a.heating);
    if (inc === true) {
      out.push({ level: "warning", text: `„${c.label}“ ist bereits in der Heizkostenabrechnung enthalten und wird nicht zusätzlich umgelegt.`, positionId: c.id });
    } else if (inc === false) {
      out.push({
        level: "warning",
        text: `„${c.label}“ ist eine Heizungs-/Warmwasserposition außerhalb der Heizkostenabrechnung. Nach HeizkostenV gehört sie in die verbrauchsabhängige Verteilung – bitte mit der Hausverwaltung klären und selbst bewerten.`,
        positionId: c.id,
      });
    } else if (heatingTotal.length > 0 || a.heating) {
      out.push({
        level: "warning",
        text: `„${c.label}“ ist möglicherweise in den Heizkosten enthalten. Erfasse die Kostenaufstellung der Heizkostenabrechnung, um Doppelerfassung auszuschließen.`,
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
    const included = h.includedCosts ?? [];
    if (included.length > 0 && h.buildingTotal !== null) {
      const incSum = sumCents(included.map((c) => toCents(c.amount)));
      if (incSum !== toCents(h.buildingTotal)) {
        out.push({ level: "error", text: `Heizkostenabrechnung: Kostenaufstellung ergibt ${fmt(fromCents(incSum))}, Gesamtheizkosten sind ${fmt(h.buildingTotal)}.` });
      }
    }
    const totalInStatement = heatingTotal.length === 1 ? heatingTotal[0].totalAmount : null;
    if (totalInStatement !== null && totalInStatement !== undefined && h.buildingTotal !== null) {
      const diff = toCents(totalInStatement) - toCents(h.buildingTotal);
      if (diff !== 0) {
        out.push({
          level: Math.abs(diff) <= roundingCents ? "info" : "warning",
          text: `Gesamtheizkosten: Jahresabrechnung ${fmt(totalInStatement)}, Heizkostenabrechnung ${fmt(h.buildingTotal)} (Differenz ${fmt(fromCents(diff))}${Math.abs(diff) <= roundingCents ? ", Rundungsdifferenz ohne Auswirkung auf den Anteil der Wohnung" : ""}).`,
        });
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

export function checkPlan(plan: EconomicPlan): Finding[] {
  const out: Finding[] = [];
  const s = summarizePlan(plan);
  if (s.matchesAnnualHausgeld === false) out.push({ level: "error", text: `Positionen ergeben ${fmt(s.total)}, der Plan nennt ${fmt(plan.annualHausgeld!)} pro Jahr.` });
  if (s.matchesMonthlyHausgeld === false) out.push({ level: "warning", text: `${fmt(s.total)} ÷ 12 = ${fmt(s.monthly)}, der Plan nennt ${fmt(plan.monthlyHausgeld!)} pro Monat.` });
  if (plan.monthlyReserve != null && plan.monthlyCosts != null && plan.monthlyHausgeld != null) {
    const diff = toCents(plan.monthlyReserve) + toCents(plan.monthlyCosts) - toCents(plan.monthlyHausgeld);
    if (diff !== 0) {
      out.push({
        level: Math.abs(diff) <= roundingCents ? "info" : "warning",
        text: `Monatliche Aufteilung: Rücklage ${fmt(plan.monthlyReserve)} + Kosten ${fmt(plan.monthlyCosts)} = ${fmt(fromCents(toCents(plan.monthlyReserve) + toCents(plan.monthlyCosts)))}, Hausgeld laut Plan ${fmt(plan.monthlyHausgeld)}${Math.abs(diff) <= roundingCents ? " (Rundungsdifferenz im Plan)" : ""}.`,
      });
    }
  }
  out.push(...checkKeyMath(plan.positions));
  return out;
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

/* ---------- Auswertungen für Übersichten und Grafiken ---------- */

export interface BudgetUsage {
  plan: number;
  actual: number;
  /** Ist ÷ Soll */
  usage: number;
  /** Ist − Soll (negativ: unter Plan) */
  difference: number;
  differencePct: number;
}

/** Budgetauslastung der Bewirtschaftungskosten (ohne Rücklage) laut Jahresabrechnung */
export function budgetUsage(a: WegAnnualStatement): BudgetUsage | null {
  const plan = a.managementCostsPlan;
  const actual = a.managementCostsActual;
  if (plan === null || actual === null || plan <= 0) return null;
  const difference = fromCents(toCents(actual) - toCents(plan));
  return { plan, actual, usage: actual / plan, difference, differencePct: difference / plan };
}

export interface PlanSplit {
  /** laut Kennzeichnung der Verwaltung umlagefähig */
  allocable: number;
  /** Eigentümeranteil: nicht umlagefähig inkl. Rücklage und nicht gekennzeichneter Positionen */
  owner: number;
  total: number;
  allocableMonthly: number;
  ownerMonthly: number;
  allocableShare: number;
}

export function planSplit(plan: EconomicPlan): PlanSplit {
  const s = summarizePlan(plan);
  const owner = fromCents(toCents(s.total) - toCents(s.declaredAllocable));
  return {
    allocable: s.declaredAllocable,
    owner,
    total: s.total,
    allocableMonthly: fromCents(Math.round(toCents(s.declaredAllocable) / 12)),
    ownerMonthly: fromCents(Math.round(toCents(owner) / 12)),
    allocableShare: s.total > 0 ? s.declaredAllocable / s.total : 0,
  };
}

export interface YearRow {
  label: string;
  actual: number;
  plan: number;
  difference: number;
  differencePct: number | null;
  strong?: boolean;
}

export interface YearComparison {
  actualYear: number;
  planYear: number;
  rows: YearRow[];
  /** Hausgeld-Soll des Vorjahres (aus der Jahresabrechnung) gegenüber dem neuen Plan – Plan mit Plan */
  previousPlan: { year: number; total: number; next: number; difference: number; differencePct: number } | null;
}

/**
 * Ist eines Jahres (Jahresabrechnung) gegenüber dem Wirtschaftsplan eines (meist späteren) Jahres:
 * Bewirtschaftungskosten, Rücklage, Gesamt und umlagefähiger Anteil.
 */
export function compareYears(plan: EconomicPlan, actual: WegAnnualStatement): YearComparison {
  const p = summarizePlan(plan);
  const a = summarizeAnnual(actual);
  const row = (label: string, act: number, pl: number, strong?: boolean): YearRow => {
    const difference = fromCents(toCents(pl) - toCents(act));
    return { label, actual: act, plan: pl, difference, differencePct: act !== 0 ? difference / act : null, strong };
  };
  const management = actual.managementCostsActual ?? a.total;
  const rows = [
    row("Bewirtschaftungskosten ohne Rücklage", management, p.managementCosts),
    row("Zuführung zur Erhaltungsrücklage", actual.reserveContribution, p.reserve),
    row("Gesamt einschließlich Rücklage", fromCents(toCents(management) + toCents(actual.reserveContribution)), p.total, true),
    row("davon umlagefähig", a.allocable, p.declaredAllocable),
  ];
  let previousPlan: YearComparison["previousPlan"] = null;
  if (actual.managementCostsPlan !== null && actual.year === plan.year - 1) {
    const total = fromCents(toCents(actual.managementCostsPlan) + toCents(actual.reserveContribution));
    const difference = fromCents(toCents(p.total) - toCents(total));
    previousPlan = { year: actual.year, total, next: p.total, difference, differencePct: total > 0 ? difference / total : 0 };
  }
  return { actualYear: actual.year, planYear: plan.year, rows, previousPlan };
}

export interface CostDriver {
  label: string;
  amount: number;
  /** zusammengefasste kleinere Positionen */
  members?: string[];
}

/** Größte umlagefähige Positionen des Wirtschaftsplans, der Rest zusammengefasst */
export function costDrivers(plan: EconomicPlan, limit = 9): CostDriver[] {
  const items = plan.positions.filter((p) => p.declaredAllocable === true && p.amount !== 0).sort((a, b) => b.amount - a.amount);
  const top: CostDriver[] = items.slice(0, limit).map((p) => ({ label: p.label, amount: p.amount }));
  const rest = items.slice(limit);
  if (rest.length === 1) top.push({ label: rest[0].label, amount: rest[0].amount });
  else if (rest.length > 1) top.push({ label: "Übrige Positionen", amount: sumOf(rest), members: rest.map((p) => p.label) });
  return top;
}

const isHeatingLike = (p: LedgerPosition) => !!p.heating || /w(ä|ae)rmepumpe|heiz|warmwasser|wohnungsstation|brennstoff|fernw(ä|ae)rme/i.test(p.label);
const normKey = (k: string | undefined) => (k ?? "").toLowerCase().trim();

/**
 * Prüfpunkte zu einem Wirtschaftsplan: was bei der späteren Mieterabrechnung anders laufen wird
 * als im Plan, was noch zu klären ist und welche Abweichungen zum Ist auffallen.
 */
export function planCheckpoints(plan: EconomicPlan, annuals: WegAnnualStatement[]): Finding[] {
  const out: Finding[] = [];
  const mine = annuals.filter((a) => a.propertyId === plan.propertyId && a.unitId === plan.unitId);

  // Heizung im Plan nach MEA, beim Mieter nach HeizkostenV
  const heatingByMea = plan.positions.filter((p) => isHeatingLike(p) && p.amount !== 0 && /mea|miteigentum/.test(normKey(p.wegKey)));
  if (heatingByMea.length) {
    out.push({
      level: "warning",
      title: "Heizkostenverteilung prüfen",
      text: `${heatingByMea.map((p) => p.label).join(", ")} (${fmt(sumOf(heatingByMea))}) plant die Verwaltung nach MEA. Beim Mieter werden Heiz- und Warmwasserkosten nach der Heizkostenabrechnung verteilt (50–70 % nach Verbrauch, HeizkostenV) – der tatsächliche Betrag kann deutlich abweichen.`,
    });
  }

  // Von der Verwaltung als umlagefähig gekennzeichnet, aber eigene Bewertung offen
  for (const p of plan.positions.filter((p) => p.declaredAllocable === true && p.classification === "review" && p.amount !== 0)) {
    out.push({
      level: "warning",
      title: `${p.label} klassifizieren`,
      text: `${fmt(p.amount)} sind nur bei passender Kostenart und Vereinbarung im Mietvertrag umlagefähig. ${p.reason}`.trim(),
    });
  }

  // Ist-Abrechnung zum Planjahr
  const sameYear = mine.find((a) => a.year === plan.year);
  if (!sameYear) {
    out.push({
      level: "info",
      title: `Jahresabrechnung ${plan.year} ausstehend`,
      text: "Der Wirtschaftsplan liefert eine Prognose, aber keine Abrechnungswerte. Die Mieterabrechnung entsteht erst aus der Jahresabrechnung.",
    });
  }

  // Vergleich mit dem Ist: Verteilerschlüssel und auffällige Abweichungen
  const actual = sameYear ?? mine.filter((a) => a.year < plan.year).sort((a, b) => b.year - a.year)[0];
  if (actual) {
    const keys = (ps: LedgerPosition[]) => {
      // je Kostengruppe: normalisierter Schlüssel → Schreibweise im Dokument
      const m = new Map<string, { label: string; keys: Map<string, string> }>();
      for (const p of ps) {
        if (!p.wegKey || p.amount === 0) continue;
        const g = groupOf(p);
        const e = m.get(g.key) ?? { label: g.label, keys: new Map<string, string>() };
        if (!e.keys.has(normKey(p.wegKey))) e.keys.set(normKey(p.wegKey), p.wegKey.trim());
        m.set(g.key, e);
      }
      return m;
    };
    const planKeys = keys(plan.positions);
    const actualKeys = keys(actual.positions);
    for (const [k, pk] of planKeys) {
      const ak = actualKeys.get(k);
      // Heizung: bereits oben als eigener Prüfpunkt
      if (k === "heating" || !ak || [...pk.keys.keys()].some((x) => ak.keys.has(x))) continue;
      out.push({
        level: "info",
        title: `Verteilerschlüssel: ${pk.label}`,
        text: `Plan ${plan.year} nach ${[...pk.keys.values()].join(", ")}, Abrechnung ${actual.year} nach ${[...ak.keys.values()].join(", ")}. Abweichungen zwischen Plan und Ist sind hier zu erwarten.`,
      });
    }
    for (const r of comparePlanActual(plan, actual)) {
      if (r.difference === null || r.differencePct === null || r.key === "reserve") continue;
      if (Math.abs(r.differencePct) < 0.25 || Math.abs(r.difference) < 25) continue;
      out.push({
        level: "warning",
        title: `Auffällige Abweichung: ${r.label}`,
        text: `Plan ${plan.year} ${fmt(r.plan)} gegenüber Ist ${actual.year} ${fmt(r.actual!)} (${r.difference > 0 ? "+" : ""}${(r.differencePct * 100).toFixed(1).replace(".", ",")} %).`,
      });
    }
  }
  return out;
}

/* ---------- Prognose für einen Mieter ---------- */

export interface TenantForecast {
  /** erwartete umlagefähige Kosten der Wohnung im Planjahr (vereinbart, nach Vertragsschlüssel) */
  expectedYear: number;
  /** ungeklärte Positionen (Prüfung erforderlich oder nur ähnlich vereinbart) */
  uncertainYear: number;
  days: number;
  yearDays: number;
  /** zeitanteilig auf die Mietzeit im Planjahr */
  expectedShare: number;
  uncertainShare: number;
  prepayments: number;
  /** > 0: voraussichtliche Nachzahlung, < 0: voraussichtliches Guthaben */
  result: number;
}

/**
 * Prognose der Mieterabrechnung aus einem Wirtschaftsplan – nur zur Orientierung.
 * Zeitanteilige Umlage; Heizkosten fallen in Wirklichkeit nach Verbrauch an (Heizperiode).
 */
export function forecastForTenant(plan: EconomicPlan, property: Property, tenant: Tenant): TenantForecast | null {
  const unit = property.units.find((u) => u.id === plan.unitId);
  if (!unit) return null;
  const yearStart = `${plan.year}-01-01`;
  const yearEnd = `${plan.year}-12-31`;
  const range = intersect(tenant.moveIn, tenant.moveOut ?? yearEnd, yearStart, yearEnd);
  if (!range) return null;
  let expected = 0;
  let uncertain = 0;
  for (const p of plan.positions) {
    if (p.classification === "non_allocable") continue;
    const agreement = tenant.lease ? agreementFor(p.label, p.category, tenant.lease) : null;
    if (agreement?.status === "not_agreed") continue;
    const cents = toCents(amountByLease(p, tenant.lease, unit, property).amount);
    if (p.classification === "review" || agreement?.status === "partial") uncertain += cents;
    else expected += cents;
  }
  const days = daysInclusive(range.start, range.end);
  const yearDays = daysInclusive(yearStart, yearEnd);
  const prepayments = calcPrepayments(tenant, range.start, range.end).total;
  const expectedShare = Math.round((expected * days) / yearDays) / 100;
  return {
    expectedYear: fromCents(expected),
    uncertainYear: fromCents(uncertain),
    days,
    yearDays,
    expectedShare,
    uncertainShare: Math.round((uncertain * days) / yearDays) / 100,
    prepayments,
    result: fromCents(toCents(expectedShare) - toCents(prepayments)),
  };
}

/* ---------- Übernahme in die Mieterabrechnung ---------- */

/** Grund-/Verbrauchskosten Heizung und Warmwasser aus der Heizkostenabrechnung, falls eindeutig zuzuordnen */
function heatingPartsOf(h: HeatingBill): Pick<CostItem, "heatingParts"> {
  const find = (re: RegExp) => h.components.find((c) => re.test(c.label.toLowerCase()))?.amount;
  const baseHeating = find(/grund.*heiz/);
  const consumptionHeating = find(/verbrauch.*heiz/);
  const baseWater = find(/grund.*warm/);
  const consumptionWater = find(/verbrauch.*warm/);
  if ([baseHeating, consumptionHeating, baseWater, consumptionWater].some((x) => x === undefined)) return {};
  return { heatingParts: { baseHeating: baseHeating!, consumptionHeating: consumptionHeating!, baseWater: baseWater!, consumptionWater: consumptionWater! } };
}

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
export function transferToStatement(
  annual: WegAnnualStatement | EconomicPlan,
  statement: Statement,
  context?: { property: Property; tenants: Tenant[] },
): TransferResult {
  if (annual.kind !== "annual") {
    // Harte Sperre: Ein Wirtschaftsplan ist eine Prognose und nie Grundlage einer Mieterabrechnung
    throw new Error("Ein Wirtschaftsplan kann nicht in eine Mieterabrechnung übernommen werden.");
  }
  const already = new Set(statement.costs.map((c) => c.sourcePositionId).filter(Boolean));
  const hasHeatingTotal = annual.positions.some((p) => p.heating === "total") || annual.heating !== null;
  const items: CostItem[] = [];
  const skipped: TransferResult["skipped"] = [];
  // Mietverträge der Mieter dieser Wohnung im Zeitraum: vereinbarte Kostenarten und Umlagemaßstab
  const unit = context?.property.units.find((u) => u.id === annual.unitId);
  const periodTenants = context ? tenantsInPeriod(annual.unitId, statement, context.tenants) : [];
  const leases = periodTenants.map((t) => t.lease).filter((l): l is LeaseAgreement => !!l);
  const allHaveLease = periodTenants.length > 0 && leases.length === periodTenants.length;
  for (const p of annual.positions) {
    if (already.has(p.id)) skipped.push({ position: p, reason: "bereits übernommen" });
    else if (p.classification !== "allocable") skipped.push({ position: p, reason: CLASSIFICATION_LABELS[p.classification] });
    else if (!p.reviewed) skipped.push({ position: p, reason: "noch nicht geprüft" });
    else if (p.heating === "component" && includedInHeatingBill(p, annual.heating) === true)
      skipped.push({ position: p, reason: "in der Heizkostenabrechnung enthalten" });
    else if (p.heating === "component" && p.origin !== "user")
      // Heizungsbezogene Kosten nur übernehmen, wenn der Vermieter sie ausdrücklich bewertet hat
      skipped.push({
        position: p,
        reason:
          includedInHeatingBill(p, annual.heating) === false
            ? "Heizungsposition außerhalb der Heizkostenabrechnung – bitte selbst bewerten"
            : hasHeatingTotal
              ? "möglicherweise in den Heizkosten enthalten – bitte selbst bewerten"
              : "Heizungsposition – bitte selbst bewerten",
      });
    // Anteil 0 laut WEG (z. B. Einzelkosten einer anderen Wohnung) bleibt 0 – auch bei anderem Vertragsschlüssel
    else if (p.amount === 0) skipped.push({ position: p, reason: "Betrag 0" });
    else {
      const agreements = leases.map((l) => agreementFor(p.label, p.category, l));
      // Nur ausschließen, wenn die Kostenart mit keinem Mieter des Zeitraums vereinbart ist
      if (allHaveLease && agreements.every((a) => a.status === "not_agreed")) {
        skipped.push({ position: p, reason: `laut Mietvertrag nicht umlegbar: ${agreements[0].text}` });
        continue;
      }
      const partial = agreements.find((a) => a.status === "partial");
      if (partial && p.origin !== "user") {
        skipped.push({ position: p, reason: `Mietvertrag prüfen: ${partial.text}` });
        continue;
      }
      // Anteil laut WEG; zusätzlich je abweichendem Vertragsmaßstab
      const leaseAmounts: NonNullable<CostItem["leaseAmounts"]> = {};
      const notes: string[] = [p.reason];
      if (unit && context) {
        leaseAmounts.weg = amountByLease(p, null, unit, context.property);
        for (const rule of new Set(leases.map((l) => l.allocationRule))) {
          if (rule === "weg") continue;
          const r = amountByLease(p, { ...leases.find((l) => l.allocationRule === rule)! }, unit, context.property);
          leaseAmounts[rule] = { amount: r.amount, basis: r.basis };
          if (r.note) notes.push(`Mieter mit Vertragsmaßstab „Verbrauch/MEA“: ${r.note}.`);
          if (r.problem) notes.push(r.problem);
        }
      }
      const h = p.heating === "total" ? annual.heating : null;
      items.push({
        id: uid(),
        category: p.category ?? 17,
        label: p.label,
        amount: p.amount,
        key: "direct",
        directUnitId: annual.unitId,
        note: notes.join(" "),
        source: p.provenance?.document ?? `WEG-Jahresabrechnung ${annual.year}`,
        sourceAnnualId: annual.id,
        sourcePositionId: p.id,
        sourceAmount: p.amount,
        ...(p.totalAmount !== null && p.totalAmount !== undefined ? { totalAmount: p.totalAmount } : {}),
        ...(leaseAmounts.weg?.basis ? { basis: leaseAmounts.weg.basis } : {}),
        ...(Object.keys(leaseAmounts).length > 1 ? { leaseAmounts } : {}),
        ...(h ? heatingPartsOf(h) : {}),
        ...(h && h.co2Applicable && h.co2Cost && h.co2Kg ? { co2Cost: h.co2Cost, co2Kg: h.co2Kg } : {}),
      });
    }
  }
  return { items, skipped };
}

const fmt = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
const num = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n);
