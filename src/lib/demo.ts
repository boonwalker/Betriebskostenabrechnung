import type { AppData } from "./types";

/** Beispieldaten zum Ausprobieren */
export function demoData(): AppData {
  const year = new Date().getFullYear() - 1;
  return {
    version: 1,
    settings: {
      landlord: { name: "Max Mustervermieter", address: "Hauptstraße 1\n12345 Musterstadt", iban: "DE12 3456 7890 1234 5678 90" },
      anthropicApiKey: "",
    },
    properties: [
      {
        id: "demo-p1",
        name: "Lindenstraße 5",
        address: "Lindenstraße 5, 12345 Musterstadt",
        units: [
          { id: "demo-u1", name: "EG links", area: 72 },
          { id: "demo-u2", name: "EG rechts", area: 58 },
          { id: "demo-u3", name: "OG", area: 90 },
        ],
      },
    ],
    tenants: [
      { id: "demo-t1", name: "Anna Schmidt", mailingAddress: "", propertyId: "demo-p1", unitId: "demo-u1", moveIn: "2019-04-01", moveOut: null, persons: 2, monthlyPrepayment: 180 },
      { id: "demo-t2", name: "Jonas Weber", mailingAddress: "Bahnhofstraße 12\n54321 Neustadt", propertyId: "demo-p1", unitId: "demo-u2", moveIn: "2021-08-01", moveOut: `${year}-05-31`, persons: 1, monthlyPrepayment: 130 },
      { id: "demo-t3", name: "Familie Yilmaz", mailingAddress: "", propertyId: "demo-p1", unitId: "demo-u2", moveIn: `${year}-07-01`, moveOut: null, persons: 3, monthlyPrepayment: 160 },
      { id: "demo-t4", name: "Lea Becker", mailingAddress: "", propertyId: "demo-p1", unitId: "demo-u3", moveIn: "2015-01-01", moveOut: null, persons: 4, monthlyPrepayment: 240 },
    ],
    statements: [
      {
        id: "demo-s1",
        propertyId: "demo-p1",
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        createdAt: new Date().toISOString(),
        prepaymentOverrides: {},
        costs: [
          { id: "demo-c1", category: 1, label: "Grundsteuer", amount: 612.4, key: "area" },
          { id: "demo-c2", category: 2, label: "Frischwasser", amount: 1180.25, key: "persons" },
          { id: "demo-c3", category: 3, label: "Schmutz- und Niederschlagswasser", amount: 945.6, key: "persons" },
          { id: "demo-c4", category: 6, label: "Heizung und Warmwasser (Gas)", amount: 4320, key: "consumption", consumption: { "demo-u1": 31, "demo-u2": 22, "demo-u3": 47 } },
          { id: "demo-c5", category: 8, label: "Müllabfuhr", amount: 534, key: "persons" },
          { id: "demo-c6", category: 11, label: "Allgemeinstrom", amount: 168.3, key: "area" },
          { id: "demo-c7", category: 12, label: "Schornsteinfeger", amount: 96.5, key: "units" },
          { id: "demo-c8", category: 13, label: "Wohngebäudeversicherung", amount: 890, key: "area" },
          { id: "demo-c9", category: 10, label: "Gartenpflege", amount: 420, key: "area" },
        ],
      },
    ],
  };
}
