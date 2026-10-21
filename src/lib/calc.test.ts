import { describe, expect, it } from "vitest";
import { buildSegments, calcPrepayments, calculateStatement } from "./calc";
import type { Property, Statement, Tenant } from "./types";

const property: Property = {
  id: "p1",
  name: "Musterstraße 1",
  address: "Musterstraße 1, 12345 Musterstadt",
  units: [
    { id: "u1", name: "EG links", area: 60 },
    { id: "u2", name: "OG rechts", area: 40 },
  ],
};

function tenant(partial: Partial<Tenant> & Pick<Tenant, "id" | "unitId" | "moveIn">): Tenant {
  return {
    name: partial.id,
    mailingAddress: "",
    propertyId: "p1",
    moveOut: null,
    persons: 1,
    monthlyPrepayment: 100,
    ...partial,
  };
}

function statement(costs: Statement["costs"], overrides: Record<string, number> = {}): Statement {
  return {
    id: "s1",
    propertyId: "p1",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    costs,
    prepaymentOverrides: overrides,
    createdAt: "",
  };
}

describe("buildSegments", () => {
  it("füllt Lücken mit Leerstand", () => {
    const segs = buildSegments(
      property.units,
      [tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01", moveOut: "2025-03-31" }), tenant({ id: "b", unitId: "u1", moveIn: "2025-05-01" })],
      "2025-01-01",
      "2025-12-31",
    ).filter((s) => s.unitId === "u1");
    expect(segs.map((s) => [s.tenantId, s.start, s.end, s.days])).toEqual([
      ["a", "2025-01-01", "2025-03-31", 90],
      [null, "2025-04-01", "2025-04-30", 30],
      ["b", "2025-05-01", "2025-12-31", 245],
    ]);
  });
});

describe("calcPrepayments", () => {
  it("rechnet volle Monate", () => {
    expect(calcPrepayments(tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }), "2025-01-01", "2025-12-31")).toBe(1200);
    expect(calcPrepayments(tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }), "2025-04-01", "2025-06-30")).toBe(300);
  });
  it("rechnet angebrochene Monate tagesgenau", () => {
    // 16 von 30 Tagen im April
    expect(calcPrepayments(tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }), "2025-04-15", "2025-04-30")).toBe(53.33);
  });
});

describe("calculateStatement", () => {
  it("verteilt nach Wohnfläche und ermittelt Nachzahlung/Guthaben", () => {
    const tenants = [
      tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01", monthlyPrepayment: 100 }),
      tenant({ id: "b", unitId: "u2", moveIn: "2020-01-01", monthlyPrepayment: 100 }),
    ];
    const r = calculateStatement(statement([{ id: "c1", category: 1, label: "Grundsteuer", amount: 2000, key: "area" }]), property, tenants);
    const a = r.tenants.find((t) => t.tenant.id === "a")!;
    const b = r.tenants.find((t) => t.tenant.id === "b")!;
    expect(a.totalCosts).toBe(1200);
    expect(a.balance).toBe(0);
    expect(b.totalCosts).toBe(800);
    expect(b.balance).toBe(-400);
    expect(a.items[0].basisShare).toBe(60);
    expect(a.items[0].basisTotal).toBe(100);
    expect(r.landlordShare).toBe(0);
  });

  it("belässt Leerstandskosten beim Vermieter", () => {
    const tenants = [tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" })];
    const r = calculateStatement(
      statement([
        { id: "c1", category: 1, label: "Grundsteuer", amount: 1000, key: "area" },
        { id: "c2", category: 8, label: "Müll", amount: 300, key: "persons" },
        { id: "c3", category: 15, label: "Kabel", amount: 200, key: "units" },
      ]),
      property,
      tenants,
    );
    expect(r.tenants[0].totalCosts).toBe(600 + 150 + 100);
    expect(r.landlordShare).toBe(400 + 150 + 100);
  });

  it("verteilt nach Personen zeitanteilig", () => {
    const tenants = [
      tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01", persons: 3 }),
      tenant({ id: "b", unitId: "u2", moveIn: "2020-01-01", persons: 1 }),
    ];
    const r = calculateStatement(statement([{ id: "c1", category: 2, label: "Wasser", amount: 400, key: "persons" }]), property, tenants);
    expect(r.tenants.find((t) => t.tenant.id === "a")!.totalCosts).toBe(300);
    expect(r.tenants.find((t) => t.tenant.id === "b")!.totalCosts).toBe(100);
  });

  it("teilt Verbrauch und direkte Kosten bei Mieterwechsel nach Tagen", () => {
    const tenants = [
      tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01", moveOut: "2025-06-30" }),
      tenant({ id: "b", unitId: "u1", moveIn: "2025-07-01" }),
      tenant({ id: "c", unitId: "u2", moveIn: "2020-01-01" }),
    ];
    const r = calculateStatement(
      statement([
        { id: "h", category: 4, label: "Heizung", amount: 1000, key: "consumption", consumption: { u1: 75, u2: 25 } },
        { id: "d", category: 17, label: "Rauchmelder EG", amount: 365, key: "direct", directUnitId: "u1" },
      ]),
      property,
      tenants,
    );
    const a = r.tenants.find((t) => t.tenant.id === "a")!;
    const b = r.tenants.find((t) => t.tenant.id === "b")!;
    const c = r.tenants.find((t) => t.tenant.id === "c")!;
    expect(a.days).toBe(181);
    expect(b.days).toBe(184);
    expect(a.items.find((i) => i.costId === "h")!.amount).toBe(round(750 * 181 / 365));
    expect(b.items.find((i) => i.costId === "d")!.amount).toBe(184);
    expect(c.totalCosts).toBe(250);
    expect(a.prepayments).toBe(600);
  });

  it("verwendet tatsächlich gezahlte Vorauszahlungen, wenn angegeben", () => {
    const tenants = [tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" })];
    const r = calculateStatement(statement([], { a: 1000 }), property, tenants);
    expect(r.tenants[0].prepayments).toBe(1000);
    expect(r.tenants[0].prepaymentsCalculated).toBe(1200);
    expect(r.tenants[0].balance).toBe(-1000);
  });

  it("berechnet die Abrechnungsfrist", () => {
    const r = calculateStatement(statement([]), property, []);
    expect(r.deadline).toBe("2026-12-31");
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
