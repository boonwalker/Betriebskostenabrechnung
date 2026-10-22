import { applyRules } from "../classify";
import { newProperty, newStatement } from "../model";
import type { EconomicPlan, LeaseAgreement, LedgerPosition, Property, Statement, Tenant, WegAnnualStatement } from "../types";

/**
 * Realer Testfall „WE 09“ (anonymisiert: ohne Anschrift, Verwaltung und Namen).
 * Quelle: Originale der Einzelabrechnung 2024, Heizkostenabrechnung (Kontrollblatt) 2024,
 * Gesamtdarstellung 2024, Aufstellung Treppenhausreinigung 2024 und Wirtschaftsplan 2025.
 * Bezeichnungen, Gesamtbeträge und Schlüssel wie im Dokument.
 * Eigentumswohnung, 11 Einheiten, 44,75 m², MEA 49/1.000, Wärmepumpe.
 */

type Extra = Pick<LedgerPosition, "totalAmount" | "wegKey" | "wegBasis" | "note">;
const MEA = { total: 1000, share: 49, unit: "MEA" };
const WE = { total: 11, share: 1, unit: "WE" };

const pos = (id: string, label: string, amount: number, year: number, declaredAllocable: boolean | null = null, extra: Extra = {}): LedgerPosition =>
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
      provenance: { document: year === 2024 ? "Einzelabrechnung 2024 WE 09" : "Wirtschaftsplan 2025" },
      ...extra,
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
    wegManager: "",
    wegUnitsCount: 11,
    wegMeaTotal: 1000,
    wegAreaTotal: 900,
    // Schenkung der Eltern, Übergang von Nutzen und Lasten am 01.08.2025; Startwert vorerst der Grundsteuerwert
    acquisitionType: "gift",
    purchaseDate: "2025-08-01",
    purchasePrice: 112200,
    // Feststellungsbescheid vom 05.09.2025 (Zurechnung ab 01.01.2026); Hebesatz Wohngrundstücke Heinsberg ab 2026
    propertyTaxValue: 112200,
    propertyTaxRate: 559,
    // Grundbesitzabgabenbescheid 2026 der Stadt: Grundsteuer B 34,78 € × 559 % = 194,42 €, Restmüll 60 l 142,55 €
    // (zusammen 336,97 €, vierteljährlich 84,24 €). Getragen ab 01.01.2026 – 2025 ging der Bescheid an die Eltern.
    propertyTaxAnnual: 194.42,
    wasteFeeAnnual: 142.55,
    // Privatentnahme vom Mietkonto
    withdrawals: [{ id: "we09-w1", from: "2025-09-01", to: null, monthly: 300, note: "Entnahme vom Mietkonto" }],
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
    buildingTotal: 25274.93,
    positions: [
      pos("a1", "Wasser", 60.23, y, null, { totalAmount: 828.44, wegKey: "Verbrauch", wegBasis: { total: 478.182, share: 34.766, unit: "cbm" } }),
      pos("a2", "Abwassergebühren", 143.75, y, null, { totalAmount: 1960.96, wegKey: "Verbrauch", wegBasis: { total: 474.244, share: 34.766, unit: "cbm" } }),
      pos("a3", "Treppenhausreinigung", 126.1, y, null, {
        totalAmount: 2125.1,
        wegKey: "gesonderte Berechnung",
        note: "Aufteilung alle/Bestand/Neubau je MEA: 21,32 € + 104,78 € (Aufstellung Treppenhausreinigung)",
      }),
      pos("a4", "Treppenhausreinigung WE 06", 0, y, null, { totalAmount: 528, wegKey: "Einzelkosten WE 06" }),
      pos("a5", "Allgemeinstrom", 45.53, y, null, { totalAmount: 929.23, wegKey: "MEA", wegBasis: MEA }),
      pos("a6", "Straßenreinigung", 4.01, y, null, { totalAmount: 81.83, wegKey: "MEA", wegBasis: MEA }),
      pos("a7", "Niederschlagswasser", 44.94, y, null, { totalAmount: 917.24, wegKey: "MEA", wegBasis: MEA }),
      pos("a8", "Gebäudeversicherung", 180.75, y, null, { totalAmount: 3688.68, wegKey: "MEA", wegBasis: MEA }),
      pos("a9", "Haftpflichtversicherung", 3.82, y, null, { totalAmount: 78, wegKey: "MEA", wegBasis: MEA }),
      pos("a10", "Winterdienst", 29.36, y, null, { totalAmount: 599.1, wegKey: "MEA", wegBasis: MEA }),
      pos("a11", "Wartung Wohnungsstationen", 0, y, null, { totalAmount: 0, wegKey: "Wohneinheiten", wegBasis: WE }),
      pos("a12", "Wartung Dach", 34.99, y, null, {
        totalAmount: 714,
        wegKey: "MEA",
        wegBasis: MEA,
        note: "Rechnungen vom 19.12.2023 und 28.11.2024, bezahlt 2025 (Gesamtdarstellung) – betrifft zwei Leistungsjahre",
      }),
      pos("a13", "Heiz- und Warmwasserkosten", 417.86, y, null, { totalAmount: 8530.1, wegKey: "Heizkosten" }),
      pos("a14", "Bankgebühren", 10.69, y, null, { totalAmount: 218.25, wegKey: "MEA", wegBasis: MEA }),
      pos("a15", "Verwaltergebühren", 361.55, y, null, { totalAmount: 3977, wegKey: "Wohneinheiten", wegBasis: WE }),
      pos("a16", "Instandhaltung/-setzung", 4.85, y, null, { totalAmount: 99, wegKey: "MEA", wegBasis: MEA }),
    ],
    heating: {
      heatSource: "Wärmepumpe",
      buildingTotal: 8530.11,
      unitShare: 417.86,
      baseSharePct: 30,
      areaTotal: 900,
      consumptionHeatingKwh: 1585,
      consumptionWaterKwh: 448.8,
      includedCosts: [
        { id: "i1", label: "Brennstoffkosten Wärmestrom (41.785,55 kWh)", amount: 8375.41 },
        { id: "i2", label: "Heizungswartung", amount: 154.7 },
      ],
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
    monthlyReserve: 18.38,
    monthlyCosts: 141.94,
    positions: [
      // 2. Vorschüsse (umlagefähig gem. §§ 1, 2 BetrKV) laut Verwaltung
      pos("p1", "Gebäudeversicherung", 196.0, y, true, { totalAmount: 4000, wegKey: "MEA", wegBasis: MEA }),
      pos("p2", "Haftpflichtversicherung", 3.92, y, true, { totalAmount: 80, wegKey: "MEA", wegBasis: MEA }),
      pos("p3", "Allgemeinstrom", 49.0, y, true, { totalAmount: 1000, wegKey: "MEA", wegBasis: MEA }),
      pos("p4", "Straßenreinigung", 4.17, y, true, { totalAmount: 85, wegKey: "MEA", wegBasis: MEA }),
      pos("p5", "Frischwasser", 49.0, y, true, { totalAmount: 1000, wegKey: "MEA", wegBasis: MEA }),
      pos("p6", "Abwasser", 102.9, y, true, { totalAmount: 2100, wegKey: "MEA", wegBasis: MEA }),
      pos("p7", "Niederschlagswasser", 49.0, y, true, { totalAmount: 1000, wegKey: "MEA", wegBasis: MEA }),
      pos("p8", "Winterdienst", 41.65, y, true, { totalAmount: 850, wegKey: "MEA", wegBasis: MEA }),
      pos("p9", "Treppenhausreinigung alle", 107.8, y, true, { totalAmount: 2200, wegKey: "MEA", wegBasis: MEA }),
      pos("p10", "Treppenhausreinigung WE 06", 0, y, true, { totalAmount: 528, wegKey: "Einzelkosten WE 06" }),
      pos("p11", "Wartung Dach", 19.6, y, true, { totalAmount: 400, wegKey: "MEA", wegBasis: MEA }),
      pos("p12", "Strom Wärmepumpe", 539.0, y, true, { totalAmount: 11000, wegKey: "MEA", wegBasis: MEA }),
      pos("p13", "Wartung Heizung", 9.8, y, true, { totalAmount: 200, wegKey: "MEA", wegBasis: MEA }),
      pos("p14", "Wartung Wohnungsstationen", 56.36, y, true, { totalAmount: 620, wegKey: "Wohneinheiten", wegBasis: WE }),
      // 1. Vorschüsse (nicht umlagefähig) laut Verwaltung
      pos("p15", "Verwaltung", 380.0, y, false, { totalAmount: 4180, wegKey: "Wohneinheiten", wegBasis: WE }),
      pos("p16", "Zuführung zur Rücklage", 220.5, y, false, { totalAmount: 4500, wegKey: "MEA", wegBasis: MEA }),
      pos("p17", "Bankspesen", 11.76, y, false, { totalAmount: 240, wegKey: "MEA", wegBasis: MEA }),
      pos("p18", "Erhaltung/Instandhaltung", 73.5, y, false, { totalAmount: 1500, wegKey: "MEA", wegBasis: MEA }),
      pos("p19", "Sonstige Ausgaben", 9.8, y, false, { totalAmount: 200, wegKey: "MEA", wegBasis: MEA }),
    ],
    documents: ["Wirtschaftsplan 2025 WE 09"],
    createdAt: "2026-10-21T00:00:00.000Z",
  };
}

/**
 * Mieter laut Mietvertrag (Stand 10.07.2025): Beginn 01.08.2025, 1 Person, 480 € Nettokaltmiete,
 * 20 € Stellplatz, 130 € Vorauszahlung gemeinsam für Betriebs- und Heizkosten (§ 3, § 6 Mietvertrag).
 */
export function we09Tenant(): Tenant {
  return {
    id: "we09-t",
    name: "Mieter WE 09",
    mailingAddress: "",
    propertyId: "we09-p",
    unitId: "we09-u",
    moveIn: "2025-08-01",
    moveOut: null,
    persons: 1,
    deposit: 0,
    rentHistory: [{ id: "we09-r", validFrom: "2025-08-01", coldRent: 480, surcharge: 20, prepaymentOperating: 130, prepaymentHeating: 0 }],
    lease: we09Lease(),
  };
}

export function we09Lease(): LeaseAgreement {
  return {
    reference: "Mietvertrag Stand 10.07.2025, § 3 Nr. 2–3, § 6 Nr. 3–4",
    agreedCategories: Array.from({ length: 16 }, (_, i) => i + 1),
    otherCosts: [
      "Schnee- und Eisbeseitigung",
      "Dachrinnenreinigung",
      "Wartung von Blitzschutzanlagen/Steigleitungen",
      "Wartung der Be- und Entlüftungsanlagen",
      "Inspektion der Trockenleitungen",
      "Wartung der Elektroinstallationen",
      "Trinkwasserversorgung (jährliche Prüfung der Anlage)",
      "Reinigung des Treppenhauses",
    ],
    allocationRule: "consumption_mea",
    propertyTaxIndividual: true,
    paymentTerm: "endOfNextMonth",
  };
}

/**
 * Vormieterin bis 31.07.2025 (Vermieter: Vater des Eigentümers). Bekannt ist nur: Mietende 31.07.2025,
 * Kaltmiete „etwa 50 € weniger“. Vorauszahlungen, Vertrag und Vermieterdaten fehlen und werden
 * von der App abgefragt – nichts davon ist hier erfunden.
 */
export function we09PreviousTenant(): Tenant {
  return {
    id: "we09-vormieterin",
    name: "Vormieterin",
    mailingAddress: "",
    propertyId: "we09-p",
    unitId: "we09-u",
    // tatsächlicher Einzug liegt früher und ist für 2025 ohne Bedeutung
    moveIn: "2025-01-01",
    moveOut: "2025-07-31",
    persons: 1,
    deposit: 0,
    rentHistory: [{ id: "we09-vm-r", validFrom: "2025-01-01", coldRent: 430, surcharge: 0, prepaymentOperating: 0, prepaymentHeating: 0 }],
    lease: null,
    landlord: { name: "", address: "", iban: "" },
  };
}

/** Fiktiver ganzjähriger Mieter für den Probelauf mit den Ist-Daten 2024 (ohne Mietvertrag) */
export function we09TrialTenant2024(): Tenant {
  return {
    ...we09Tenant(),
    id: "we09-probe",
    name: "Probelauf-Mieter",
    moveIn: "2024-01-01",
    moveOut: "2024-12-31",
    rentHistory: [{ id: "we09-probe-r", validFrom: "2024-01-01", coldRent: 480, surcharge: 20, prepaymentOperating: 130, prepaymentHeating: 0 }],
    lease: null,
  };
}

export function we09Statement(year: number): Statement {
  return { ...newStatement("we09-p", `${year}-01-01`, `${year}-12-31`), id: `we09-s${year}` };
}
