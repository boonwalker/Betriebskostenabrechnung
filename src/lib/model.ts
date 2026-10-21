import type { AppData, ISODate, Property, RentPeriod, Statement, Tenant } from "./types";

export const uid = () => crypto.randomUUID();

export function newProperty(): Property {
  return {
    id: uid(),
    name: "",
    address: "",
    type: "mfh",
    units: [{ id: uid(), name: "Wohnung 1", area: 0 }],
    yearBuilt: null,
    purchaseDate: null,
    purchasePrice: 0,
    transferTax: 0,
    notaryCosts: 0,
    brokerFee: 0,
    landShare: 20,
    loans: [],
    valuations: [],
    hausgeldMonthly: 0,
    hausgeldManagementMonthly: 0,
    hausgeldReserveMonthly: 0,
    maintenanceAnnual: 0,
    managementAnnual: 0,
    otherCostsAnnual: 0,
    wegManager: "",
    wegUnitsCount: null,
    wegMeaTotal: null,
    wegAreaTotal: null,
  };
}

export function newStatement(propertyId: string, periodStart: ISODate, periodEnd: ISODate): Statement {
  return {
    id: uid(),
    propertyId,
    periodStart,
    periodEnd,
    costs: [],
    prepaymentOverrides: {},
    prepaymentsConfirmed: {},
    status: "draft",
    releases: {},
    createdAt: new Date().toISOString(),
  };
}

export function newRentPeriod(validFrom: ISODate, base?: Partial<RentPeriod>): RentPeriod {
  return { coldRent: 0, prepaymentOperating: 0, prepaymentHeating: 0, ...base, id: uid(), validFrom };
}

/** Mietstand, der an einem Stichtag gilt (bzw. der erste, falls der Stichtag davor liegt) */
export function rentAt(tenant: Tenant, date: ISODate): RentPeriod | undefined {
  const sorted = [...tenant.rentHistory].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return sorted.filter((r) => r.validFrom <= date).pop() ?? sorted[0];
}

export const warmRent = (r: RentPeriod | undefined) => (r ? r.coldRent + (r.surcharge ?? 0) + r.prepaymentOperating + r.prepaymentHeating : 0);

export function emptyData(): AppData {
  return {
    version: 3,
    properties: [],
    tenants: [],
    statements: [],
    wegAnnuals: [],
    economicPlans: [],
    settings: { landlord: { name: "", address: "", iban: "" }, anthropicApiKey: "", marginalTaxRate: 35 },
  };
}

/** Bringt gespeicherte Daten älterer Versionen auf den aktuellen Stand */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrate(raw: any): AppData {
  if (!raw || !Array.isArray(raw.properties)) throw new Error("Keine gültigen Daten.");
  const base = emptyData();
  return {
    version: 3,
    settings: { ...base.settings, ...raw.settings, landlord: { ...base.settings.landlord, ...raw.settings?.landlord } },
    properties: raw.properties.map((p: Partial<Property>) => ({ ...newProperty(), ...p })),
    tenants: (raw.tenants ?? []).map((t: Tenant & { monthlyPrepayment?: number }) => {
      const { monthlyPrepayment, ...rest } = t;
      return {
        ...rest,
        deposit: rest.deposit ?? 0,
        rentHistory:
          t.rentHistory ?? [{ id: uid(), validFrom: t.moveIn, coldRent: 0, prepaymentOperating: monthlyPrepayment ?? 0, prepaymentHeating: 0 }],
      };
    }),
    statements: (raw.statements ?? []).map((st: Partial<Statement> & { release?: { releasedAt: string; resultJson: string } | null }) => {
      const { release, ...rest } = st;
      // Frühere Freigabe der ganzen Abrechnung → Freigabe je Mietverhältnis
      const releases: Statement["releases"] = { ...rest.releases };
      if (release && !rest.releases) {
        const result = JSON.parse(release.resultJson);
        for (const t of result.tenants ?? []) {
          releases[t.tenant.id] = { releasedAt: release.releasedAt, resultJson: JSON.stringify({ ...t, co2: result.co2, periodDays: result.periodDays }) };
        }
      }
      return { prepaymentsConfirmed: {}, ...rest, status: rest.status ?? "draft", releases };
    }),
    wegAnnuals: raw.wegAnnuals ?? [],
    economicPlans: raw.economicPlans ?? [],
  };
}

export const PROPERTY_TYPE_LABELS: Record<Property["type"], string> = {
  mfh: "Mehrfamilienhaus",
  efh: "Ein-/Zweifamilienhaus",
  etw: "Eigentumswohnung",
};

/** Angaben, die für Abrechnung und Rendite noch fehlen */
export function missingInfo(p: Property, tenants: Tenant[]): string[] {
  const out: string[] = [];
  const free = (p.acquisitionType ?? "purchase") !== "purchase";
  if (!p.purchasePrice) out.push(free ? "Verkehrswert bei Schenkung bzw. Erbschaft (für die Vermögensentwicklung)" : "Kaufpreis (für Rendite und Abschreibung)");
  if (!p.purchaseDate) out.push("Erwerbsdatum (für die Vermögensentwicklung)");
  if (free && !p.predecessorCost) out.push("Anschaffungskosten des Rechtsvorgängers (für die fortgeführte Abschreibung)");
  if (p.loans.some((l) => !l.startDate)) out.push("Auszahlungsdatum der Darlehen (für den Tilgungsverlauf)");
  if (!p.yearBuilt) out.push("Baujahr (bestimmt den Abschreibungssatz)");
  if (p.valuations.length === 0) out.push("Aktueller Marktwert (Schätzung)");
  if (p.units.some((u) => !u.area)) out.push("Wohnfläche aller Einheiten (Umlageschlüssel)");
  if (p.type === "etw" && !p.hausgeldMonthly) out.push("Hausgeld laut Wirtschaftsplan der WEG");
  const today = new Date().toISOString().slice(0, 10);
  for (const t of tenants.filter((t) => t.propertyId === p.id && (!t.moveOut || t.moveOut >= today))) {
    const r = rentAt(t, today);
    if (!r?.coldRent) out.push(`Kaltmiete von ${t.name}`);
    if (!r?.prepaymentOperating && !r?.prepaymentHeating) out.push(`Vorauszahlungen von ${t.name}`);
  }
  return out;
}
