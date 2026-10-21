import { describe, expect, it } from "vitest";
import { we09Annual2024, we09Plan2025 } from "./fixtures/we09";
import { budgetUsage, compareYears, costDrivers, planCheckpoints, planSplit } from "./weg";

describe("WE 09: Auswertungen für Übersichten", () => {
  it("Budgetauslastung 2024: Ist 1.468,43 von Soll 1.579,08 = 93,0 %, −110,65 € (−7,0 %)", () => {
    const b = budgetUsage(we09Annual2024())!;
    expect(b.usage).toBeCloseTo(0.93, 3);
    expect(b.difference).toBe(-110.65);
    expect(b.differencePct).toBeCloseTo(-0.0701, 3);
  });

  it("Wirtschaftsplan 2025: 1.228,20 € umlagefähig (102,35 €/Monat), 695,56 € Eigentümer (57,96 €/Monat)", () => {
    const s = planSplit(we09Plan2025());
    expect(s.allocable).toBe(1228.2);
    expect(s.owner).toBe(695.56);
    expect(s.allocableMonthly).toBe(102.35);
    expect(s.ownerMonthly).toBe(57.96);
    expect(s.allocableShare).toBeCloseTo(0.638, 3);
  });

  it("Ist 2024 gegenüber Plan 2025", () => {
    const c = compareYears(we09Plan2025(), we09Annual2024());
    const v = Object.fromEntries(c.rows.map((r) => [r.label, [r.actual, r.plan]]));
    expect(v["Bewirtschaftungskosten ohne Rücklage"]).toEqual([1468.43, 1703.26]);
    expect(v["Zuführung zur Erhaltungsrücklage"]).toEqual([147, 220.5]);
    expect(v["Gesamt einschließlich Rücklage"]).toEqual([1615.43, 1923.76]);
    expect(v["davon umlagefähig"]).toEqual([1056.35, 1228.2]);
    expect(c.rows[3].difference).toBe(171.85);
    // Plan mit Plan: Hausgeld-Soll 2024 1.726,08 → 2025 1.923,76 (+11,5 %)
    expect(c.previousPlan!.total).toBe(1726.08);
    expect(c.previousPlan!.differencePct).toBeCloseTo(0.1145, 3);
  });

  it("Kostentreiber: neun größte Positionen, Rest 37,49 €, Summe 1.228,20 €", () => {
    const d = costDrivers(we09Plan2025());
    expect(d[0]).toEqual({ label: "Strom Wärmepumpe", amount: 539 });
    expect(d).toHaveLength(10);
    expect(d[9].amount).toBe(37.49);
    expect(d[9].members).toContain("Wartung Dach");
    expect(Math.round(d.reduce((a, x) => a + x.amount, 0) * 100) / 100).toBe(1228.2);
  });

  it("Prüfpunkte: Heizung nach MEA, Dachwartung, Jahresabrechnung 2025 ausstehend, Schlüsselwechsel", () => {
    const titles = planCheckpoints(we09Plan2025(), [we09Annual2024()]).map((f) => f.title);
    expect(titles).toContain("Heizkostenverteilung prüfen");
    expect(titles).toContain("Wartung Dach klassifizieren");
    expect(titles).toContain("Jahresabrechnung 2025 ausstehend");
    expect(titles.some((t) => t?.startsWith("Verteilerschlüssel"))).toBe(true);
  });
});
