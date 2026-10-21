import { describe, expect, it } from "vitest";
import { propertyMetrics } from "./finance";
import { emptyData, newProperty } from "./model";
import type { AppData, Property, Tenant } from "./types";
import { valueAt, wealthSeries } from "./wealth";

const etw: Property = {
  ...newProperty(),
  id: "p",
  type: "etw",
  units: [{ id: "u", name: "WE 1", area: 50 }],
  acquisitionType: "purchase",
  purchaseDate: "2024-01-01",
  purchasePrice: 200_000,
  notaryCosts: 4_000,
  transferTax: 10_000,
  // 0 % Zins: die Restschuld sinkt genau um die Rate
  loans: [{ id: "l", lender: "Bank", principal: 120_000, balance: 0, interestRate: 0, monthlyPayment: 1_000, fixedUntil: null, startDate: "2024-01-01" }],
  hausgeldMonthly: 200,
  valuations: [{ id: "v", date: "2025-01-01", value: 212_000, note: "" }],
};
const tenant: Tenant = {
  id: "t",
  name: "Mieter",
  mailingAddress: "",
  propertyId: "p",
  unitId: "u",
  moveIn: "2024-01-01",
  moveOut: null,
  persons: 1,
  deposit: 0,
  rentHistory: [{ id: "r", validFrom: "2024-01-01", coldRent: 700, surcharge: 0, prepaymentOperating: 150, prepaymentHeating: 0 }],
};
const data = (p: Property = etw): AppData => ({ ...emptyData(), properties: [p], tenants: [tenant] });

describe("Vermögensentwicklung", () => {
  it("Marktwert verläuft linear zwischen Erwerb und Bewertung", () => {
    expect(valueAt(etw, "2024-01-01")).toBe(200_000);
    expect(valueAt(etw, "2024-07-02")).toBeCloseTo(206_000, -1);
    expect(valueAt(etw, "2026-01-01")).toBe(212_000);
  });

  it("addiert monatlich Miete und Vorauszahlungen und zieht Hausgeld und Rate ab", () => {
    const s = wealthSeries(etw, data(), "2024-12-31")!;
    expect(s.points).toHaveLength(12);
    // Januar: Miete 700 + VZ 150 − Hausgeld 200, erste Rate erst im Februar
    expect(s.points[0]).toMatchObject({ date: "2024-01-31", cashflow: 650, debt: 120_000 });
    // Wert am Monatsende, linear zwischen Kauf (200.000 €) und Bewertung (212.000 € am 01.01.2025)
    expect(s.points[0].value).toBeCloseTo(200_983.61, 2);
    // ab Februar zusätzlich − 1.000 € Rate
    expect(s.points[1]).toMatchObject({ cashflow: -350, debt: 119_000 });
    // Dezember: 11 Raten gezahlt
    const dec = s.points[11];
    expect(dec.debt).toBe(109_000);
    expect(dec.cumulative).toBe(650 - 350 * 11);
    expect(dec.wealth).toBeCloseTo(dec.value - 109_000 + dec.cumulative, 2);
    // Einstand: 200.000 + 14.000 Nebenkosten − 120.000 Darlehen
    expect(s.baseline).toBe(94_000);
  });

  it("nutzt das Hausgeld aus dem Wirtschaftsplan des jeweiligen Jahres", () => {
    const withPlan: AppData = {
      ...data(),
      economicPlans: [{ kind: "plan", id: "wp", propertyId: "p", unitId: "u", year: 2024, annualHausgeld: 3000, monthlyHausgeld: 250, positions: [], documents: [], createdAt: "" }],
    };
    expect(wealthSeries(etw, withPlan, "2024-01-31")!.points[0].cashflow).toBe(600);
  });

  it("Schenkung: Einstand ist der Wert bei Schenkung, eigenes Kapital nur die Nebenkosten; AfA wird fortgeführt", () => {
    const gift: Property = {
      ...etw,
      acquisitionType: "gift",
      purchaseDate: "2025-08-01",
      purchasePrice: 180_000,
      transferTax: 0,
      notaryCosts: 1_500,
      loans: [],
      valuations: [],
      yearBuilt: 2008,
      landShare: 20,
      predecessorCost: 150_000,
      predecessorYear: 2009,
    };
    const m = propertyMetrics(gift, [tenant], "2026-06-01", 35);
    expect(m.equityInvested).toBe(1_500);
    // (150.000 + 1.500) × 80 % × 2 %
    expect(m.annualDepreciation).toBeCloseTo(2_424, 2);
    const s = wealthSeries(gift, data(gift), "2025-08-31")!;
    expect(s.baseline).toBe(181_500);
    expect(s.points).toHaveLength(1);
    expect(s.points[0]).toMatchObject({ value: 180_000, debt: 0, cashflow: 650 });
  });

  it("ohne Erwerbsdatum keine Reihe", () => {
    expect(wealthSeries({ ...etw, purchaseDate: null }, data(), "2025-01-01")).toBeNull();
  });
});
