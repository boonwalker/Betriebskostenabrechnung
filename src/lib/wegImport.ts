import { applyRules } from "./classify";
import type { WegExtraction } from "./extract";
import { uid } from "./model";
import type { EconomicPlan, LedgerPosition, WegAnnualStatement } from "./types";

interface Context {
  propertyId: string;
  unitId: string;
  documents: string[];
  fallbackYear: number;
}

function toPositions(x: WegExtraction, year: number, document: string): LedgerPosition[] {
  return x.positions.map((p) =>
    applyRules(
      {
        id: uid(),
        label: p.label,
        amount: p.unitAmount,
        totalAmount: p.totalAmount,
        wegKey: p.wegKey || undefined,
        wegBasis: p.basisTotal && p.basisShare !== null ? { total: p.basisTotal, share: p.basisShare, unit: p.basisUnit } : null,
        note: p.remark || undefined,
        category: null,
        classification: "review",
        reason: "",
        origin: "rule",
        // Automatisch erkannte Werte gelten erst nach Bestätigung durch den Vermieter als geprüft
        reviewed: false,
        declaredAllocable: p.declaredAllocable === "unknown" ? null : p.declaredAllocable === "yes",
        provenance: { document, page: p.page ?? undefined, row: p.sourceText || undefined, rowTop: p.rowTop ?? undefined, rowBottom: p.rowBottom ?? undefined },
        confidence: p.confidence,
      },
      year,
    ),
  );
}

/** Wandelt das Ausleseergebnis in eine WEG-Jahresabrechnung (Ist) um */
export function annualFromExtraction(x: WegExtraction, ctx: Context): WegAnnualStatement {
  const year = x.year ?? ctx.fallbackYear;
  const document = ctx.documents.join(", ");
  const all = toPositions(x, year, document);
  // Rücklage gehört zur Eigentümer-Ebene und nicht zu den Bewirtschaftungskosten
  const reservePositions = all.filter((_, i) => x.positions[i].isReserve);
  const positions = all.filter((_, i) => !x.positions[i].isReserve);
  const reserveFromPositions = reservePositions.reduce((a, p) => a + Math.round(p.amount * 100), 0) / 100;
  const h = x.heating;
  return {
    kind: "annual",
    id: uid(),
    propertyId: ctx.propertyId,
    unitId: ctx.unitId,
    year,
    managementCostsActual: x.managementCostsActual,
    managementCostsPlan: x.managementCostsPlan,
    buildingTotal: x.buildingTotal,
    reserveContribution: x.reserveContribution ?? reserveFromPositions,
    settlement: settlementFromExtraction(x.settlement),
    reserveBalance: x.reserveBalance && (x.reserveBalance.total !== null || x.reserveBalance.share !== null) ? x.reserveBalance : null,
    positions,
    heating: h
      ? {
          heatSource: h.heatSource,
          buildingTotal: h.buildingTotal,
          unitShare: h.unitShare,
          baseSharePct: h.baseSharePct,
          areaTotal: h.areaTotal,
          consumptionHeatingKwh: h.consumptionHeatingKwh,
          consumptionWaterKwh: h.consumptionWaterKwh,
          components: h.components.map((c) => ({ id: uid(), ...c })),
          includedCosts: h.includedCosts.map((c) => ({ id: uid(), ...c })),
          // CO2-Preis nur auf fossile Brennstoffe und Fernwärme, nicht auf Strom für Wärmepumpen
          co2Applicable: !!h.co2Cost || !/w(ä|ae)rmepumpe|strom/i.test(h.heatSource),
          co2Cost: h.co2Cost,
          co2Kg: h.co2Kg,
          provenance: { document, page: h.page ?? undefined },
        }
      : null,
    documents: ctx.documents,
    sheet: x.sheet
      ? {
          page: x.sheet.page,
          sum: {
            top: x.sheet.sumTop,
            bottom: x.sheet.sumBottom,
            totalLeft: x.sheet.sumTotalLeft,
            totalRight: x.sheet.sumTotalRight,
            shareLeft: x.sheet.sumShareLeft,
            shareRight: x.sheet.sumShareRight,
          },
          owner: x.sheet.ownerTop !== null && x.sheet.ownerBottom !== null ? { top: x.sheet.ownerTop, bottom: x.sheet.ownerBottom } : null,
        }
      : null,
    createdAt: new Date().toISOString(),
  };
}

/** Wandelt das Ausleseergebnis in einen Wirtschaftsplan (Prognose) um */
export function planFromExtraction(x: WegExtraction, ctx: Context): EconomicPlan {
  const year = x.year ?? ctx.fallbackYear;
  return {
    kind: "plan",
    id: uid(),
    propertyId: ctx.propertyId,
    unitId: ctx.unitId,
    year,
    annualHausgeld: x.annualHausgeld,
    monthlyHausgeld: x.monthlyHausgeld,
    monthlyReserve: x.monthlyReserve,
    monthlyCosts: x.monthlyCosts,
    positions: toPositions(x, year, ctx.documents.join(", ")),
    documents: ctx.documents,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Abrechnungsspitze aus der Einzelabrechnung. Das Vorzeichen wird aus Vorschüssen − Kostenanteil berechnet,
 * weil Verwaltungen ein Guthaben oft ohne Minus oder Wort drucken („Abrechnungsspitze: 155,30 €“).
 * + = Erstattung an dich, − = Nachzahlung an die WEG.
 */
export function settlementFromExtraction(x: WegExtraction["settlement"]): WegAnnualStatement["settlement"] {
  if (!x) return null;
  let amount: number | null = null;
  if (x.costShare !== null && x.advances !== null) amount = Math.round((x.advances - x.costShare) * 100) / 100;
  else if (x.printedAmount !== null && x.direction !== "unknown") amount = Math.abs(x.printedAmount) * (x.direction === "refund" ? 1 : -1);
  if (amount === null || Math.abs(amount) < 0.005) return null;
  const due = x.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(x.dueDate) ? x.dueDate : null;
  return { amount, paidOn: null, due };
}
