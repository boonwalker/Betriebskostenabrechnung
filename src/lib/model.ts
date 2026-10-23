import type { AppData, EconomicPlan, ISODate, Property, RentPeriod, Statement, Tenant } from "./types";

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

/** Kostenpositionen des Vorjahres als Vorlage (ohne Beträge); Positionen aus einer WEG-Jahresabrechnung kommen jedes Jahr neu */
export function carryOverCosts(previous: Statement): Statement["costs"] {
  return previous.costs
    .filter((c) => !c.sourceAnnualId)
    .map((c) => ({
      ...c,
      id: uid(),
      amount: 0,
      source: undefined,
      consumption: c.key === "consumption" || c.key === "heating" ? {} : c.consumption,
      co2Cost: undefined,
      co2Kg: undefined,
      laborCost: undefined,
    }));
}

/**
 * Abrechnung eines Jahres anlegen, falls es sie noch nicht gibt – nur wenn in dem Jahr jemand gemietet hat
 * und das Jahr schon begonnen hat. Rückgabe: neuer Datenstand und die angelegte Abrechnung (oder null).
 */
export function ensureStatement(d: AppData, propertyId: string, year: number, today = new Date()): { data: AppData; created: Statement | null } {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const exists = d.statements.some((s) => s.propertyId === propertyId && s.periodStart.startsWith(String(year)));
  const rented = d.tenants.some((t) => t.propertyId === propertyId && t.moveIn <= end && (!t.moveOut || t.moveOut >= start));
  if (exists || !rented || year > today.getFullYear()) return { data: d, created: null };
  const previous = d.statements.filter((s) => s.propertyId === propertyId && s.periodStart < start).sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  const created = { ...newStatement(propertyId, start, end), costs: previous ? carryOverCosts(previous) : [] };
  return { data: { ...d, statements: [...d.statements, created] }, created };
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
    attachments: [],
    documents: [],
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
    attachments: raw.attachments ?? [],
    documents: raw.documents ?? [],
  };
}

export const PROPERTY_TYPE_LABELS: Record<Property["type"], string> = {
  mfh: "Mehrfamilienhaus",
  efh: "Ein-/Zweifamilienhaus",
  etw: "Eigentumswohnung",
};

export interface MissingItem {
  text: string;
  /** Stelle, an der die Angabe zu pflegen ist */
  href: string;
}

/** Angaben, die nur Vermögensentwicklung, Rendite und Abschreibung brauchen (beim Anlegen überspringbar) */
export function wealthMissing(p: Property): MissingItem[] {
  const out: MissingItem[] = [];
  const edit = (f: string) => `#/objekte/${p.id}/bearbeiten?f=${f}`;
  const free = (p.acquisitionType ?? "purchase") !== "purchase";
  if (!p.purchasePrice)
    out.push({ text: free ? "Verkehrswert bei Schenkung bzw. Erbschaft (für die Vermögensentwicklung)" : "Kaufpreis (für Rendite und Abschreibung)", href: edit("erwerb") });
  if (!p.purchaseDate) out.push({ text: "Erwerbsdatum (für die Vermögensentwicklung)", href: edit("erwerb") });
  if (free && !p.predecessorCost) out.push({ text: "Anschaffungskosten des Rechtsvorgängers (für die fortgeführte Abschreibung)", href: edit("erwerb") });
  if (p.loans.some((l) => !l.startDate)) out.push({ text: "Auszahlungsdatum der Darlehen (für den Tilgungsverlauf)", href: edit("finanzierung") });
  if (!p.yearBuilt) out.push({ text: "Baujahr (bestimmt den Abschreibungssatz)", href: edit("allgemein") });
  if (p.valuations.length === 0)
    out.push({
      text:
        free && p.purchasePrice > 0 && p.purchasePrice === p.propertyTaxValue
          ? "Aktueller Marktwert (bisher nur Grundsteuerwert als Untergrenze)"
          : "Aktueller Marktwert (Schätzung)",
      href: `#/objekte/${p.id}?f=wertentwicklung`,
    });
  return out;
}

/** Angaben, die für Abrechnung und Rendite noch fehlen – jeweils mit Sprungziel */
export function missingInfo(p: Property, tenants: Tenant[], plans: EconomicPlan[] = []): MissingItem[] {
  const out: MissingItem[] = wealthMissing(p);
  const edit = (f: string) => `#/objekte/${p.id}/bearbeiten?f=${f}`;
  const detail = (q: string) => `#/objekte/${p.id}?${q}`;
  if (p.units.some((u) => !u.area)) out.push({ text: "Wohnfläche aller Einheiten (Umlageschlüssel)", href: edit("wohnungen") });
  // Hausgeld kommt aus dem erfassten Wirtschaftsplan; die Handangabe ist nur der Ersatz ohne Plan
  const hasPlan = plans.some((x) => x.propertyId === p.id && x.monthlyHausgeld !== null);
  if (p.type === "etw" && !p.hausgeldMonthly && !hasPlan) out.push({ text: "Hausgeld: Wirtschaftsplan der WEG erfassen", href: detail("f=weg-unterlagen") });
  const today = new Date().toISOString().slice(0, 10);
  // Ausgezogene Mieter der letzten zwei Jahre: für die Abrechnung wird die neue Anschrift gebraucht
  const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  for (const t of tenants.filter((t) => t.propertyId === p.id && t.moveOut && t.moveOut < today && t.moveOut >= twoYearsAgo && !t.mailingAddress.trim())) {
    out.push({ text: `Neue Anschrift von ${t.name} (ausgezogen)`, href: detail(`t=${t.id}&f=anschrift`) });
  }
  for (const t of tenants.filter((t) => t.propertyId === p.id && (!t.moveOut || t.moveOut >= today))) {
    const r = rentAt(t, today);
    if (!r?.coldRent) out.push({ text: `Kaltmiete von ${t.name}`, href: detail(`t=${t.id}&f=miete`) });
    if (!r?.prepaymentOperating && !r?.prepaymentHeating) out.push({ text: `Vorauszahlungen von ${t.name}`, href: detail(`t=${t.id}&f=miete`) });
  }
  return out;
}
