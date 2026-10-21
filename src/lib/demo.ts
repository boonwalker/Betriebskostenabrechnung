import { we09Annual2024, we09Plan2025, we09PreviousTenant, we09Property, we09Tenant } from "./fixtures/we09";
import { newProperty } from "./model";
import type { AppData, RentPeriod } from "./types";

const rent = (id: string, validFrom: string, coldRent: number, prepaymentOperating: number, prepaymentHeating: number): RentPeriod => ({
  id,
  validFrom,
  coldRent,
  prepaymentOperating,
  prepaymentHeating,
});

/** Beispieldaten zum Ausprobieren */
export function demoData(): AppData {
  const year = new Date().getFullYear() - 1;
  return {
    version: 3,
    settings: {
      landlord: { name: "Max Mustervermieter", address: "Hauptstraße 1\n12345 Musterstadt", iban: "DE12 3456 7890 1234 5678 90" },
      anthropicApiKey: "",
      marginalTaxRate: 35,
    },
    properties: [
      {
        ...newProperty(),
        id: "demo-p1",
        name: "Lindenstraße 5",
        address: "Lindenstraße 5, 12345 Musterstadt",
        type: "mfh",
        acquisitionType: "purchase",
        units: [
          { id: "demo-u1", name: "EG links", area: 72 },
          { id: "demo-u2", name: "EG rechts", area: 58 },
          { id: "demo-u3", name: "OG", area: 90 },
        ],
        yearBuilt: 1972,
        purchaseDate: "2016-07-01",
        purchasePrice: 420_000,
        transferTax: 21_000,
        notaryCosts: 6_300,
        brokerFee: 14_990,
        landShare: 30,
        loans: [
          { id: "demo-l1", lender: "Sparkasse Musterstadt", principal: 360_000, balance: 241_500, interestRate: 1.65, monthlyPayment: 1_350, fixedUntil: `${year + 2}-06-30`, startDate: "2016-07-01" },
        ],
        valuations: [
          { id: "demo-v1", date: "2019-12-31", value: 470_000, note: "Bankbewertung" },
          { id: "demo-v2", date: "2022-06-30", value: 560_000, note: "Gutachten" },
          { id: "demo-v3", date: "2024-12-31", value: 525_000, note: "Vergleichsangebote" },
          { id: "demo-v4", date: `${year + 1}-06-30`, value: 540_000, note: "Immobilienportal" },
        ],
        maintenanceAnnual: 3_000,
        managementAnnual: 240,
        otherCostsAnnual: 150,
      },
      {
        ...newProperty(),
        id: "demo-p2",
        name: "ETW Am Stadtpark",
        address: "Am Stadtpark 12, 12345 Musterstadt",
        type: "etw",
        acquisitionType: "purchase",
        units: [{ id: "demo-u4", name: "3. OG rechts", area: 64 }],
        yearBuilt: 2008,
        purchaseDate: "2021-03-01",
        purchasePrice: 289_000,
        transferTax: 14_450,
        notaryCosts: 4_335,
        brokerFee: 10_315,
        landShare: 20,
        loans: [
          { id: "demo-l2", lender: "Musterbank", principal: 260_000, balance: 231_800, interestRate: 1.05, monthlyPayment: 880, fixedUntil: "2036-02-28", startDate: "2021-03-01" },
        ],
        valuations: [
          { id: "demo-v5", date: "2022-12-31", value: 305_000, note: "Immobilienportal" },
          { id: "demo-v6", date: `${year + 1}-06-30`, value: 282_000, note: "Immobilienportal" },
        ],
        hausgeldMonthly: 310,
        hausgeldManagementMonthly: 32,
        hausgeldReserveMonthly: 75,
        maintenanceAnnual: 400,
      },
    ],
    tenants: [
      {
        id: "demo-t1", name: "Anna Schmidt", mailingAddress: "", propertyId: "demo-p1", unitId: "demo-u1", moveIn: "2019-04-01", moveOut: null, persons: 2, deposit: 1_950,
        rentHistory: [rent("demo-r1", "2019-04-01", 620, 140, 70), rent("demo-r2", `${year}-04-01`, 680, 150, 80)],
      },
      {
        id: "demo-t2", name: "Jonas Weber", mailingAddress: "Bahnhofstraße 12\n54321 Neustadt", propertyId: "demo-p1", unitId: "demo-u2", moveIn: "2021-08-01", moveOut: `${year}-05-31`, persons: 1, deposit: 1_500,
        rentHistory: [rent("demo-r3", "2021-08-01", 500, 95, 55)],
      },
      {
        id: "demo-t3", name: "Familie Yilmaz", mailingAddress: "", propertyId: "demo-p1", unitId: "demo-u2", moveIn: `${year}-07-01`, moveOut: null, persons: 3, deposit: 1_740,
        rentHistory: [rent("demo-r4", `${year}-07-01`, 580, 110, 60)],
      },
      {
        id: "demo-t4", name: "Lea Becker", mailingAddress: "", propertyId: "demo-p1", unitId: "demo-u3", moveIn: "2015-01-01", moveOut: null, persons: 4, deposit: 2_100,
        rentHistory: [rent("demo-r5", "2015-01-01", 700, 160, 90), rent("demo-r6", "2023-01-01", 760, 160, 100)],
      },
      {
        id: "demo-t5", name: "Dr. Sven Krüger", mailingAddress: "", propertyId: "demo-p2", unitId: "demo-u4", moveIn: "2021-05-01", moveOut: null, persons: 1, deposit: 2_250,
        rentHistory: [rent("demo-r7", "2021-05-01", 750, 170, 60), rent("demo-r8", `${year + 1}-01-01`, 780, 185, 65)],
      },
    ],
    wegAnnuals: [],
    economicPlans: [],
    statements: [
      {
        id: "demo-s1",
        propertyId: "demo-p1",
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        createdAt: new Date().toISOString(),
        prepaymentOverrides: {},
        prepaymentsConfirmed: {},
        status: "draft",
        releases: {},
        costs: [
          { id: "demo-c1", category: 1, label: "Grundsteuer", amount: 612.4, key: "area" },
          { id: "demo-c2", category: 2, label: "Frischwasser", amount: 1180.25, key: "persons" },
          { id: "demo-c3", category: 3, label: "Schmutz- und Niederschlagswasser", amount: 945.6, key: "persons" },
          {
            id: "demo-c4", category: 6, label: "Heizung und Warmwasser (Gas)", amount: 4320, key: "heating", consumptionShare: 70,
            consumption: { "demo-u1": 31, "demo-u2": 22, "demo-u3": 47 }, co2Cost: 395.6, co2Kg: 6_120,
          },
          { id: "demo-c5", category: 8, label: "Müllabfuhr", amount: 534, key: "persons" },
          { id: "demo-c6", category: 11, label: "Allgemeinstrom", amount: 168.3, key: "area" },
          { id: "demo-c7", category: 12, label: "Schornsteinfeger", amount: 96.5, key: "units", laborCost: 72, laborKind: "craftsman" },
          { id: "demo-c8", category: 13, label: "Wohngebäudeversicherung", amount: 890, key: "area" },
          { id: "demo-c9", category: 10, label: "Gartenpflege", amount: 420, key: "area", laborCost: 380, laborKind: "service" },
        ],
      },
    ],
  };
}

/** Beispieldaten plus Testfall WE 09 – Startzustand der Vorführversion */
export function showcaseData(): AppData {
  const d = demoData();
  return {
    ...d,
    properties: [...d.properties, we09Property()],
    tenants: [...d.tenants, we09PreviousTenant(), we09Tenant()],
    wegAnnuals: [...d.wegAnnuals, we09Annual2024()],
    economicPlans: [...d.economicPlans, we09Plan2025()],
  };
}
