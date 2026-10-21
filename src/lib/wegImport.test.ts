import { describe, expect, it } from "vitest";
import type { WegExtraction } from "./extract";
import { summarizeAnnual, summarizePlan } from "./weg";
import { annualFromExtraction, planFromExtraction } from "./wegImport";

const row = (label: string, unitAmount: number, extra: Partial<WegExtraction["positions"][number]> = {}) => ({
  label,
  unitAmount,
  totalAmount: null,
  wegKey: "MEA",
  declaredAllocable: "unknown" as const,
  isReserve: false,
  page: 2,
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
      reserveContribution: null,
      annualHausgeld: null,
      monthlyHausgeld: null,
      positions: [
        row("Wasser", 60.23), row("Abwasser", 143.75), row("Treppenhausreinigung", 126.1), row("Allgemeinstrom", 45.53),
        row("Straßenreinigung", 4.01), row("Niederschlagswasser", 44.94), row("Gebäudeversicherung", 180.75),
        row("Haftpflichtversicherung", 3.82), row("Winterdienst", 29.36), row("Heizung und Warmwasser", 417.86, { wegKey: "HKA" }),
        row("Bankgebühren", 10.69), row("Verwaltergebühren", 361.55), row("Instandhaltung / Instandsetzung", 4.85),
        row("Wartung Dach", 34.99, { confidence: 0.6 }), row("Zuführung Erhaltungsrücklage", 147, { isReserve: true }),
      ],
      heating: null,
      notes: "",
    };
    const a = annualFromExtraction(x, ctx);
    expect(a.reserveContribution).toBe(147);
    expect(a.positions.some((p) => /r(ü|ue)cklage/i.test(p.label))).toBe(false);
    expect(a.positions.every((p) => !p.reviewed)).toBe(true);
    expect(a.positions[0].provenance).toEqual({ document: "Jahresabrechnung.pdf", page: 2, row: "Wasser" });
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
      reserveContribution: null,
      annualHausgeld: 1923.76,
      monthlyHausgeld: 160.31,
      positions: [row("Strom Wärmepumpe", 1228.2, { declaredAllocable: "yes" }), row("Erhaltungsrücklage", 695.56, { declaredAllocable: "no", isReserve: true })],
      heating: null,
      notes: "",
    };
    const p = planFromExtraction(x, { ...ctx, fallbackYear: 2025 });
    const s = summarizePlan(p);
    expect([s.declaredAllocable, s.declaredNonAllocable, s.matchesAnnualHausgeld, s.matchesMonthlyHausgeld]).toEqual([1228.2, 695.56, true, true]);
  });
});
