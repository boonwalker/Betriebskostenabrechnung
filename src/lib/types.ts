/** ISO-Datum im Format YYYY-MM-DD */
export type ISODate = string;

export interface Unit {
  id: string;
  name: string;
  /** Wohnfläche in m² */
  area: number;
}

/** mfh = Mehrfamilienhaus, efh = Ein-/Zweifamilienhaus, etw = Eigentumswohnung (WEG) */
export type PropertyType = "mfh" | "efh" | "etw";

export interface Loan {
  id: string;
  lender: string;
  /** ursprünglicher Darlehensbetrag */
  principal: number;
  /** aktuelle Restschuld */
  balance: number;
  /** Sollzins in % p. a. */
  interestRate: number;
  /** monatliche Rate (Zins + Tilgung) */
  monthlyPayment: number;
  fixedUntil: ISODate | null;
}

export interface Valuation {
  id: string;
  date: ISODate;
  value: number;
  note: string;
}

export interface Property {
  id: string;
  name: string;
  address: string;
  type: PropertyType;
  units: Unit[];
  /** Baujahr (Fertigstellung) – bestimmt den AfA-Satz */
  yearBuilt: number | null;
  purchaseDate: ISODate | null;
  purchasePrice: number;
  /** Grunderwerbsteuer, Notar und Grundbuch, Makler */
  transferTax: number;
  notaryCosts: number;
  brokerFee: number;
  /** Anteil des Grund und Bodens am Kaufpreis in % (nicht abschreibbar) */
  landShare: number;
  loans: Loan[];
  /** Verkehrswertschätzungen im Zeitverlauf */
  valuations: Valuation[];
  /** ETW: monatliches Hausgeld an die WEG gesamt */
  hausgeldMonthly: number;
  /** ETW: darin Verwaltervergütung (nicht umlagefähig, steuerlich abziehbar) */
  hausgeldManagementMonthly: number;
  /** ETW: darin Zuführung zur Erhaltungsrücklage (nicht umlagefähig, steuerlich erst bei Verwendung abziehbar) */
  hausgeldReserveMonthly: number;
  /** eigene Instandhaltung / Reparaturen p. a. (Plan- oder Erfahrungswert) */
  maintenanceAnnual: number;
  /** Verwaltung p. a. (Hausverwaltung, Kontoführung …), soweit nicht im Hausgeld */
  managementAnnual: number;
  /** sonstige nicht umlagefähige Kosten p. a. */
  otherCostsAnnual: number;
}

/** Mietstand ab einem Stichtag (Mietvertrag, Mieterhöhung, Anpassung der Vorauszahlung) */
export interface RentPeriod {
  id: string;
  validFrom: ISODate;
  /** Nettokaltmiete je Monat */
  coldRent: number;
  /** Vorauszahlung Betriebskosten (ohne Heizung) je Monat */
  prepaymentOperating: number;
  /** Vorauszahlung Heiz- und Warmwasserkosten je Monat */
  prepaymentHeating: number;
}

export interface Tenant {
  id: string;
  name: string;
  /** Anschrift für die Abrechnung; leer = Anschrift der Wohnung */
  mailingAddress: string;
  propertyId: string;
  unitId: string;
  moveIn: ISODate;
  /** leer = Mietverhältnis läuft noch */
  moveOut: ISODate | null;
  persons: number;
  deposit: number;
  rentHistory: RentPeriod[];
}

/**
 * Umlageschlüssel:
 * - area: nach Wohnfläche (§ 556a BGB Regelfall)
 * - persons: nach Personenzahl
 * - units: nach Wohneinheiten (gleiche Teile)
 * - consumption: nach erfasstem Verbrauch je Einheit
 * - heating: Heiz-/Warmwasserkosten nach HeizkostenV (Grundkosten nach Fläche, Rest nach Verbrauch)
 * - direct: direkt einer Einheit zugeordnet
 */
export type AllocationKey = "area" | "persons" | "units" | "consumption" | "heating" | "direct";

/** § 35a EStG: haushaltsnahe Dienstleistung (Abs. 2) oder Handwerkerleistung (Abs. 3) */
export type Section35aKind = "service" | "craftsman";

export interface CostItem {
  id: string;
  /** Nummer der Kostenart nach § 2 BetrKV */
  category: number;
  label: string;
  /** Gesamtbetrag (brutto) der Position für den Abrechnungszeitraum, nur umlagefähige Kosten */
  amount: number;
  key: AllocationKey;
  /** bei key = "direct" */
  directUnitId?: string;
  /** bei key = "consumption" / "heating": Verbrauch je Einheit */
  consumption?: Record<string, number>;
  /** bei key = "heating": Verbrauchsanteil in % (HeizkostenV: 50–70) */
  consumptionShare?: number;
  /** im Betrag enthaltene CO2-Kosten (BEHG) – nur Heizung/Warmwasser */
  co2Cost?: number;
  /** CO2-Ausstoß des Gebäudes im Abrechnungszeitraum in kg (laut Brennstoffrechnung) */
  co2Kg?: number;
  /** im Betrag enthaltene Arbeits-/Lohnkosten nach § 35a EStG */
  laborCost?: number;
  laborKind?: Section35aKind;
  note?: string;
  /** Dateiname des Belegs, aus dem die Position übernommen wurde */
  source?: string;
}

export interface Statement {
  id: string;
  propertyId: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  costs: CostItem[];
  /** tatsächlich geleistete Vorauszahlungen je Mieter (überschreibt die Berechnung) */
  prepaymentOverrides: Record<string, number>;
  createdAt: string;
}

export interface Landlord {
  name: string;
  address: string;
  iban: string;
}

export interface Settings {
  landlord: Landlord;
  anthropicApiKey: string;
  /** persönlicher Grenzsteuersatz in % (inkl. Soli/KiSt) für die Renditeberechnung nach Steuern */
  marginalTaxRate: number;
}

export interface AppData {
  version: 2;
  properties: Property[];
  tenants: Tenant[];
  statements: Statement[];
  settings: Settings;
}
