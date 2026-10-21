import { describe, expect, it } from "vitest";
import { buildSegments, calcPrepayments, calculateStatement } from "./calc";
import { newProperty } from "./model";
import type { Property, Statement, Tenant } from "./types";

const property: Property = {
  ...newProperty(),
  id: "p1",
  name: "Musterstraße 1",
  address: "Musterstraße 1, 12345 Musterstadt",
  units: [
    { id: "u1", name: "EG links", area: 60 },
    { id: "u2", name: "OG rechts", area: 40 },
  ],
};

function tenant(
  partial: Partial<Tenant> & Pick<Tenant, "id" | "unitId" | "moveIn"> & { monthlyPrepayment?: number },
): Tenant {
  const { monthlyPrepayment = 100, ...rest } = partial;
  return {
    name: partial.id,
    mailingAddress: "",
    propertyId: "p1",
    moveOut: null,
    persons: 1,
    deposit: 0,
    rentHistory: [{ id: "r", validFrom: partial.moveIn, coldRent: 500, prepaymentOperating: monthlyPrepayment, prepaymentHeating: 0 }],
    ...rest,
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
    expect(calcPrepayments(tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }), "2025-01-01", "2025-12-31").total).toBe(1200);
    expect(calcPrepayments(tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }), "2025-04-01", "2025-06-30").total).toBe(300);
  });
  it("rechnet angebrochene Monate tagesgenau", () => {
    // 16 von 30 Tagen im April
    expect(calcPrepayments(tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }), "2025-04-15", "2025-04-30").total).toBe(53.33);
  });
  it("berücksichtigt Anpassungen im Mietverlauf", () => {
    const t = tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" });
    t.rentHistory = [
      { id: "r1", validFrom: "2020-01-01", coldRent: 500, prepaymentOperating: 100, prepaymentHeating: 50 },
      { id: "r2", validFrom: "2025-07-01", coldRent: 520, prepaymentOperating: 120, prepaymentHeating: 60 },
    ];
    expect(calcPrepayments(t, "2025-01-01", "2025-12-31")).toEqual({ operating: 1320, heating: 660, total: 1980 });
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
    expect(r.tenants[0].prepaymentsCalculated.total).toBe(1200);
    expect(r.tenants[0].balance).toBe(-1000);
  });

  it("berechnet die Abrechnungsfrist", () => {
    const r = calculateStatement(statement([]), property, []);
    expect(r.deadline).toBe("2026-12-31");
  });
});

describe("Heizkosten, CO2 und § 35a", () => {
  const tenants = [
    tenant({ id: "a", unitId: "u1", moveIn: "2020-01-01" }),
    tenant({ id: "b", unitId: "u2", moveIn: "2020-01-01" }),
  ];

  it("verteilt Heizkosten nach HeizkostenV in Grund- und Verbrauchskosten", () => {
    const r = calculateStatement(
      statement([{ id: "h", category: 6, label: "Heizung", amount: 1000, key: "heating", consumptionShare: 70, consumption: { u1: 20, u2: 80 } }]),
      property,
      tenants,
    );
    const a = r.tenants.find((t) => t.tenant.id === "a")!;
    // Grundkosten 300 € nach Fläche (60 %) = 180 €, Verbrauch 700 € nach 20 % = 140 €
    expect(a.items.map((i) => i.amount)).toEqual([180, 140]);
    expect(a.totalCosts).toBe(320);
  });

  it("begrenzt den Verbrauchsanteil auf 50–70 %", () => {
    const r = calculateStatement(
      statement([{ id: "h", category: 6, label: "Heizung", amount: 1000, key: "heating", consumptionShare: 90, consumption: { u1: 0, u2: 100 } }]),
      property,
      tenants,
    );
    expect(r.tenants.find((t) => t.tenant.id === "a")!.totalCosts).toBe(180);
  });

  it("zieht den Vermieteranteil an den CO2-Kosten nach Stufenmodell ab", () => {
    // 3.000 kg / 100 m² = 30 kg/m² → Stufe 5: Vermieter 40 %
    const r = calculateStatement(
      statement([{ id: "h", category: 6, label: "Heizung", amount: 1000, key: "area", co2Cost: 200, co2Kg: 3000 }]),
      property,
      tenants,
    );
    expect(r.co2[0]).toMatchObject({ stage: 5, landlordPct: 40, landlordAmount: 80 });
    expect(r.landlordShare).toBe(80);
    const a = r.tenants.find((t) => t.tenant.id === "a")!;
    expect(a.totalCosts).toBe(552);
    expect(a.items[0].co2Amount).toBe(72);
  });

  it("weist Arbeitskosten nach § 35a anteilig aus", () => {
    const r = calculateStatement(
      statement([
        { id: "g", category: 10, label: "Gartenpflege", amount: 500, key: "area", laborCost: 400, laborKind: "service" },
        { id: "w", category: 17, label: "Wartung", amount: 100, key: "units", laborCost: 80, laborKind: "craftsman" },
      ]),
      property,
      tenants,
    );
    const a = r.tenants.find((t) => t.tenant.id === "a")!;
    expect(a.labor35a).toEqual({ service: 240, craftsman: 40 });
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
