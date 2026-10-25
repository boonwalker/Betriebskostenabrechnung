import { describe, expect, it } from "vitest";
import type { WegExtraction } from "./extract";
import { summarizeAnnual, summarizePlan } from "./weg";
import { settlementFromExtraction, annualFromExtraction, planFromExtraction } from "./wegImport";

const row = (label: string, unitAmount: number, extra: Partial<WegExtraction["positions"][number]> = {}) => ({
  label,
  unitAmount,
  totalAmount: null,
  wegKey: "MEA",
  basisTotal: null as number | null,
  basisShare: null as number | null,
  basisUnit: "",
  remark: "",
  declaredAllocable: "unknown" as const,
  isReserve: false,
  page: 2,
  rowTop: null as number | null,
  rowBottom: null as number | null,
  sourceText: label,
  confidence: 0.95,
  ...extra,
});

const ctx = { propertyId: "p", unitId: "u", documents: ["Jahresabrechnung.pdf"], fallbackYear: 2024 };

describe("Import aus der KI-Auslese", () => {
  it("baut eine Jahresabrechnung mit Herkunft und ungeprüften Positionen", () => {
    const x: WegExtraction = {
      documentKind: "annual",
      year: 2024,
      unitName: "WE 09",
      managementCostsActual: 1468.43,
      managementCostsPlan: 1579.08,
      buildingTotal: 25274.93,
      monthlyReserve: null,
      monthlyCosts: null,
      reserveContribution: null,
      annualHausgeld: null,
      monthlyHausgeld: null,
      settlement: null,
      reserveBalance: null,
      sheet: null,
      positions: [
        row("Wasser", 60.23, { totalAmount: 828.44, wegKey: "Verbrauch", basisTotal: 478.182, basisShare: 34.766, basisUnit: "cbm" }), row("Abwasser", 143.75), row("Treppenhausreinigung", 126.1), row("Allgemeinstrom", 45.53),
        row("Straßenreinigung", 4.01), row("Niederschlagswasser", 44.94), row("Gebäudeversicherung", 180.75),
        row("Haftpflichtversicherung", 3.82), row("Winterdienst", 29.36), row("Heizung und Warmwasser", 417.86, { wegKey: "HKA" }),
        row("Bankgebühren", 10.69), row("Verwaltergebühren", 361.55), row("Instandhaltung / Instandsetzung", 4.85),
        row("Wartung Dach", 34.99, { confidence: 0.6, totalAmount: 714, basisTotal: 1000, basisShare: 49, basisUnit: "MEA", remark: "Rg. v. 19.12.23 und 28.11.24 in 2025 bezahlt" }), row("Zuführung Erhaltungsrücklage", 147, { isReserve: true }),
      ],
      heating: null,
      notes: "",
    };
    const a = annualFromExtraction(x, ctx);
    expect(a.reserveContribution).toBe(147);
    expect(a.positions.some((p) => /r(ü|ue)cklage/i.test(p.label))).toBe(false);
    expect(a.positions.every((p) => !p.reviewed)).toBe(true);
    expect(a.positions[0].provenance).toEqual({ document: "Jahresabrechnung.pdf", page: 2, row: "Wasser" });
    expect(a.positions[0].wegBasis).toEqual({ total: 478.182, share: 34.766, unit: "cbm" });
    expect(a.buildingTotal).toBe(25274.93);
    const dach = a.positions.find((p) => p.label === "Wartung Dach")!;
    expect(dach.note).toContain("19.12.23");
    expect(dach.classification).toBe("review");
    const s = summarizeAnnual(a);
    expect([s.allocable, s.nonAllocable, s.review, s.total, s.matchesDeclared]).toEqual([1056.35, 377.09, 34.99, 1468.43, true]);
  });

  it("baut einen Wirtschaftsplan mit der Kennzeichnung der Verwaltung", () => {
    const x: WegExtraction = {
      documentKind: "plan",
      year: 2025,
      unitName: "WE 09",
      managementCostsActual: null,
      managementCostsPlan: null,
      buildingTotal: null,
      monthlyReserve: 18.38,
      monthlyCosts: 141.94,
      reserveContribution: null,
      annualHausgeld: 1923.76,
      monthlyHausgeld: 160.31,
      settlement: null,
      reserveBalance: null,
      sheet: null,
      positions: [row("Strom Wärmepumpe", 1228.2, { declaredAllocable: "yes" }), row("Erhaltungsrücklage", 695.56, { declaredAllocable: "no", isReserve: true })],
      heating: null,
      notes: "",
    };
    const p = planFromExtraction(x, { ...ctx, fallbackYear: 2025 });
    const s = summarizePlan(p);
    expect([s.declaredAllocable, s.declaredNonAllocable, s.matchesAnnualHausgeld, s.matchesMonthlyHausgeld]).toEqual([1228.2, 695.56, true, true]);
    expect([p.monthlyReserve, p.monthlyCosts]).toEqual([18.38, 141.94]);
  });

  it("Abrechnungsspitze: Vorzeichen aus Vorschüssen − Kostenanteil, auch wenn ein Guthaben ohne Minus gedruckt ist", () => {
    // WE 09, 2025: Kostenanteil 1.547,92 €, Soll-Vorschüsse 1.703,22 €, gedruckt „Abrechnungsspitze (Ergebnis): 155,30 €“
    expect(settlementFromExtraction({ costShare: 1547.92, advances: 1703.22, printedAmount: 155.3, direction: "unknown", dueDate: null })).toEqual({ amount: 155.3, paidOn: null, due: null });
    expect(settlementFromExtraction({ costShare: 1800, advances: 1703.22, printedAmount: 96.78, direction: "unknown", dueDate: "2026-07-01" })).toEqual({ amount: -96.78, paidOn: null, due: "2026-07-01" });
    expect(settlementFromExtraction({ costShare: null, advances: null, printedAmount: 50, direction: "due", dueDate: null })!.amount).toBe(-50);
    expect(settlementFromExtraction({ costShare: null, advances: null, printedAmount: 50, direction: "unknown", dueDate: null })).toBeNull();
  });
});
