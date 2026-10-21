import { applyRules } from "../classify";
import { newProperty, newStatement } from "../model";
import type { EconomicPlan, LedgerPosition, Property, Statement, Tenant, WegAnnualStatement } from "../types";

/**
 * Realer Testfall „WE 09“ (anonymisiert: ohne Anschrift, Verwaltung und Namen).
 * Quelle: Einzelabrechnung 2024, Heizkostenabrechnung 2024 und Wirtschaftsplan 2025 der WEG.
 * Eigentumswohnung, 11 Einheiten, 44,75 m², MEA 49/1.000, Wärmepumpe.
 */

const pos = (id: string, label: string, amount: number, year: number, declaredAllocable: boolean | null = null): LedgerPosition =>
  applyRules(
    {
      id,
      label,
      amount,
      category: null,
      classification: "review",
      reason: "",
      origin: "rule",
      reviewed: false,
      declaredAllocable,
      provenance: { document: year === 2024 ? "Einzelabrechnung 2024 WE 09" : "Wirtschaftsplan 2025 WE 09" },
    },
    year,
  );

export function we09Property(): Property {
  return {
    ...newProperty(),
    id: "we09-p",
    name: "Eigentumswohnung WE 09",
    address: "",
    type: "etw",
    units: [{ id: "we09-u", name: "WE 09", area: 44.75, mea: 49 }],
    wegManager: "Hausverwaltung",
    wegUnitsCount: 11,
    wegMeaTotal: 1000,
    wegAreaTotal: 900,
  };
}

export function we09Annual2024(): WegAnnualStatement {
  const y = 2024;
  return {
    kind: "annual",
    id: "we09-a2024",
    propertyId: "we09-p",
    unitId: "we09-u",
    year: y,
    managementCostsActual: 1468.43,
    managementCostsPlan: 1579.08,
    reserveContribution: 147.0,
    positions: [
      pos("a1", "Wasser", 60.23, y),
      pos("a2", "Abwasser", 143.75, y),
      pos("a3", "Treppenhausreinigung", 126.1, y),
      pos("a4", "Allgemeinstrom", 45.53, y),
      pos("a5", "Straßenreinigung", 4.01, y),
      pos("a6", "Niederschlagswasser", 44.94, y),
      pos("a7", "Gebäudeversicherung", 180.75, y),
      pos("a8", "Haftpflichtversicherung", 3.82, y),
      pos("a9", "Winterdienst", 29.36, y),
      pos("a10", "Heizung und Warmwasser", 417.86, y),
      pos("a11", "Bankgebühren", 10.69, y),
      pos("a12", "Verwaltergebühren", 361.55, y),
      pos("a13", "Instandhaltung / Instandsetzung", 4.85, y),
      pos("a14", "Wartung Dach", 34.99, y),
    ],
    heating: {
      heatSource: "Wärmepumpe",
      buildingTotal: 8530.11,
      unitShare: 417.86,
      baseSharePct: 30,
      areaTotal: 900,
      consumptionHeatingKwh: 1585,
      consumptionWaterKwh: 448.8,
      components: [
        { id: "h1", label: "Grundkosten Heizung", amount: 114.56 },
        { id: "h2", label: "Verbrauchskosten Heizung", amount: 226.49 },
        { id: "h3", label: "Grundkosten Warmwasser", amount: 12.68 },
        { id: "h4", label: "Verbrauchskosten Warmwasser", amount: 64.13 },
      ],
      co2Applicable: false,
      co2Cost: null,
      co2Kg: null,
    },
    documents: ["Einzelabrechnung 2024 WE 09", "Heizkostenabrechnung 2024 WE 09"],
    createdAt: "2026-10-21T00:00:00.000Z",
  };
}

export function we09Plan2025(): EconomicPlan {
  const y = 2025;
  return {
    kind: "plan",
    id: "we09-p2025",
    propertyId: "we09-p",
    unitId: "we09-u",
    year: y,
    annualHausgeld: 1923.76,
    monthlyHausgeld: 160.31,
    positions: [
      // laut Verwaltung umlagefähig
      pos("p1", "Gebäudeversicherung", 196.0, y, true),
      pos("p2", "Haftpflichtversicherung", 3.92, y, true),
      pos("p3", "Allgemeinstrom", 49.0, y, true),
      pos("p4", "Straßenreinigung", 4.17, y, true),
      pos("p5", "Frischwasser", 49.0, y, true),
      pos("p6", "Abwasser", 102.9, y, true),
      pos("p7", "Niederschlagswasser", 49.0, y, true),
      pos("p8", "Winterdienst", 41.65, y, true),
      pos("p9", "Treppenhausreinigung alle", 107.8, y, true),
      pos("p10", "Treppenhausreinigung WE 06", 0, y, true),
      pos("p11", "Wartung Dach", 19.6, y, true),
      pos("p12", "Strom Wärmepumpe", 539.0, y, true),
      pos("p13", "Wartung Heizung", 9.8, y, true),
      pos("p14", "Wartung Wohnungsstationen", 56.36, y, true),
      // laut Verwaltung nicht umlagefähig
      pos("p15", "Verwaltung", 380.0, y, false),
      pos("p16", "Erhaltungsrücklage", 220.5, y, false),
      pos("p17", "Bankspesen", 11.76, y, false),
      pos("p18", "Erhaltung / Instandhaltung", 73.5, y, false),
      pos("p19", "Sonstige Ausgaben", 9.8, y, false),
    ],
    documents: ["Wirtschaftsplan 2025 WE 09"],
    createdAt: "2026-10-21T00:00:00.000Z",
  };
}

/** Mieter mit bekannten Daten; Kaltmiete und Vorauszahlungen sind noch nicht bekannt (0) */
export function we09Tenant(): Tenant {
  return {
    id: "we09-t",
    name: "Mieter WE 09",
    mailingAddress: "",
    propertyId: "we09-p",
    unitId: "we09-u",
    moveIn: "2023-01-01",
    moveOut: null,
    persons: 1,
    deposit: 0,
    rentHistory: [{ id: "we09-r", validFrom: "2023-01-01", coldRent: 0, prepaymentOperating: 0, prepaymentHeating: 0 }],
  };
}

export function we09Statement(year: number): Statement {
  return { ...newStatement("we09-p", `${year}-01-01`, `${year}-12-31`), id: `we09-s${year}` };
}
