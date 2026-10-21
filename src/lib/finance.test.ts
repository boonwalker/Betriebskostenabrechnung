import { describe, expect, it } from "vitest";
import { depreciationRate, portfolioMetrics, propertyMetrics } from "./finance";
import { migrate, newProperty } from "./model";
import type { Property, Tenant } from "./types";

const property: Property = {
  ...newProperty(),
  id: "p1",
  units: [
    { id: "u1", name: "A", area: 60 },
    { id: "u2", name: "B", area: 40 },
  ],
  yearBuilt: 1990,
  purchaseDate: "2020-01-01",
  purchasePrice: 300_000,
  transferTax: 15_000,
  notaryCosts: 5_000,
  brokerFee: 0,
  landShare: 25,
  loans: [{ id: "l", lender: "Bank", principal: 250_000, balance: 200_000, interestRate: 3, monthlyPayment: 1_000, fixedUntil: null }],
  valuations: [{ id: "v", date: "2025-01-01", value: 360_000, note: "" }],
  maintenanceAnnual: 1_200,
  managementAnnual: 300,
};

const tenant: Tenant = {
  id: "t",
  name: "T",
  mailingAddress: "",
  propertyId: "p1",
  unitId: "u1",
  moveIn: "2020-02-01",
  moveOut: null,
  persons: 2,
  deposit: 0,
  rentHistory: [
    { id: "r1", validFrom: "2020-02-01", coldRent: 600, prepaymentOperating: 150, prepaymentHeating: 80 },
    { id: "r2", validFrom: "2024-01-01", coldRent: 650, prepaymentOperating: 150, prepaymentHeating: 80 },
  ],
};

describe("depreciationRate", () => {
  it("richtet sich nach dem Baujahr", () => {
    expect(depreciationRate(1900)).toBe(0.025);
    expect(depreciationRate(1990)).toBe(0.02);
    expect(depreciationRate(2024)).toBe(0.03);
  });
});

describe("propertyMetrics", () => {
  const m = propertyMetrics(property, [tenant], "2026-06-01", 40);

  it("berechnet Einstand, Wertentwicklung und Eigenkapital", () => {
    expect(m.invested).toBe(320_000);
    expect(m.marketValue).toBe(360_000);
    expect(m.valueGain).toBe(40_000);
    expect(m.netWorth).toBe(160_000);
    expect(m.equityInvested).toBe(70_000);
    expect(m.appreciationPa).toBeCloseTo(Math.pow(1.2, 1 / 5) - 1, 3);
    expect(m.history).toHaveLength(2);
  });

  it("berechnet Mietrendite und Cashflow aus der aktuellen Kaltmiete", () => {
    expect(m.annualColdRent).toBe(7_800);
    expect(m.unitsLet).toBe(1);
    expect(m.grossYield).toBeCloseTo(0.026);
    expect(m.nonAllocableCosts).toBe(1_500);
    expect(m.annualInterest).toBe(6_000);
    expect(m.annualPrincipal).toBe(6_000);
    expect(m.cashflowBeforeTax).toBe(7_800 - 1_500 - 12_000);
  });

  it("schätzt das steuerliche Ergebnis mit AfA", () => {
    // AfA: 320.000 × 75 % × 2 % = 4.800
    expect(m.annualDepreciation).toBe(4_800);
    expect(m.taxableResult).toBe(7_800 - 1_500 - 6_000 - 4_800);
    expect(m.taxEffect).toBeCloseTo(-4_500 * 0.4);
    expect(m.cashflowAfterTax).toBeCloseTo(-5_700 + 1_800);
  });

  it("zieht die Erhaltungsrücklage nicht als Werbungskosten ab", () => {
    const etw = propertyMetrics({ ...property, hausgeldReserveMonthly: 100, hausgeldManagementMonthly: 30 }, [tenant], "2026-06-01", 40);
    expect(etw.nonAllocableCosts).toBe(1_500 + 1_200 + 360);
    expect(etw.taxableResult).toBe(m.taxableResult - 360);
  });
});

describe("portfolioMetrics", () => {
  it("summiert alle Objekte", () => {
    const m = propertyMetrics(property, [tenant], "2026-06-01", 40);
    const p = portfolioMetrics([m, m], 600_000);
    expect(p.marketValue).toBe(720_000);
    expect(p.loanBalance).toBe(400_000);
    expect(p.loanToValue).toBeCloseTo(400 / 720);
  });
});

describe("migrate", () => {
  it("übernimmt Daten der ersten Version", () => {
    const data = migrate({
      version: 1,
      properties: [{ id: "p", name: "X", address: "", units: [] }],
      tenants: [{ id: "t", name: "T", mailingAddress: "", propertyId: "p", unitId: "u", moveIn: "2020-01-01", moveOut: null, persons: 1, monthlyPrepayment: 120 }],
      statements: [],
      settings: { landlord: { name: "L", address: "", iban: "" }, anthropicApiKey: "k" },
    });
    expect(data.version).toBe(2);
    expect(data.properties[0].loans).toEqual([]);
    expect(data.tenants[0].rentHistory[0]).toMatchObject({ validFrom: "2020-01-01", prepaymentOperating: 120 });
    expect(data.settings.marginalTaxRate).toBe(35);
    expect(data.settings.anthropicApiKey).toBe("k");
  });
});
