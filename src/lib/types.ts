/** ISO-Datum im Format YYYY-MM-DD */
export type ISODate = string;

export interface Unit {
  id: string;
  name: string;
  /** Wohnfläche in m² */
  area: number;
  /** Miteigentumsanteil (Zähler, z. B. 49 bei 49/1.000) – nur Wohnungseigentum */
  mea?: number;
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
  /** WEG-Daten (nur Eigentumswohnung): Hausverwaltung, Anzahl Einheiten, Gesamt-MEA (Nenner), Gesamtwohnfläche */
  wegManager: string;
  wegUnitsCount: number | null;
  wegMeaTotal: number | null;
  wegAreaTotal: number | null;
  /** Grundsteuerwert laut Feststellungsbescheid des Finanzamts */
  propertyTaxValue?: number | null;
  /** Hebesatz der Gemeinde in % (Grundsteuer B, ggf. für Wohngrundstücke) */
  propertyTaxRate?: number | null;
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
  /** Zuschläge je Monat, z. B. Stellplatz (Teil der Miete, keine Betriebskosten) */
  surcharge?: number;
}

/** Umlagemaßstab laut Mietvertrag */
export type LeaseAllocationRule =
  /** Schlüssel der WEG (§ 556a Abs. 3 BGB, wenn nichts anderes vereinbart) */
  | "weg"
  /** Verbrauch, soweit erfasst, im Übrigen Miteigentumsanteile */
  | "consumption_mea";

/** Betriebskostenvereinbarung des Mietvertrags */
export interface LeaseAgreement {
  /** Fundstelle, z. B. „Mietvertrag vom 10.07.2025, § 3 und § 6“ */
  reference: string;
  /** vereinbarte Kostenarten nach § 2 Nr. 1–16 BetrKV */
  agreedCategories: number[];
  /** namentlich vereinbarte sonstige Betriebskosten (§ 2 Nr. 17 BetrKV) */
  otherCosts: string[];
  allocationRule: LeaseAllocationRule;
  /** Grundsteuer in Höhe des individuellen Bescheids für die Wohnung */
  propertyTaxIndividual: boolean;
  /** Fälligkeit von Nachzahlung/Guthaben */
  paymentTerm: "30days" | "endOfNextMonth";
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
  /** Betriebskostenvereinbarung; null = noch nicht erfasst */
  lease?: LeaseAgreement | null;
  /** Vermieter dieses Mietverhältnisses, falls abweichend von den Einstellungen (z. B. Voreigentümer) */
  landlord?: Landlord | null;
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
  /** Herkunft aus einer WEG-Jahresabrechnung (nie aus einem Wirtschaftsplan) */
  sourceAnnualId?: string;
  sourcePositionId?: string;
  /** Anteil der Wohnung laut WEG-Abrechnung bei Übernahme (zur Erkennung späterer Änderungen) */
  sourceAmount?: number;
  /** Gesamtkosten und Schlüsselbasis, nach denen der Betrag ermittelt wurde (für das Anschreiben) */
  totalAmount?: number;
  basis?: { total: number; share: number; unit: string; label: string };
  /**
   * Anteil der Wohnung je Umlagemaßstab, wenn Mietverträge im Zeitraum verschiedene Maßstäbe
   * vereinbaren. Jeder Mieter trägt seinen Anteil nach seinem Vertrag; die Differenz zum
   * Anteil laut WEG (amount) trägt der Vermieter.
   */
  leaseAmounts?: Partial<Record<LeaseAllocationRule, { amount: number; basis?: { total: number; share: number; unit: string; label: string } }>>;
  /** Bestandteile der Heizkostenabrechnung der Wohnung – für die Aufteilung beim Nutzerwechsel (§ 9b HeizkostenV) */
  heatingParts?: { baseHeating: number; consumptionHeating: number; baseWater: number; consumptionWater: number };
}

export interface Statement {
  id: string;
  propertyId: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  costs: CostItem[];
  /** tatsächlich geleistete Vorauszahlungen je Mieter (überschreibt die Berechnung) */
  prepaymentOverrides: Record<string, number>;
  /** Vermieter hat die Vorauszahlungen des Mieters anhand der Zahlungseingänge bestätigt */
  prepaymentsConfirmed: Record<string, boolean>;
  /** Verbrauch je Mieter laut Zwischenablesung beim Nutzerwechsel (kWh bzw. Einheiten) */
  interimReadings?: Record<string, { heating: number | null; water: number | null }>;
  status: "draft" | "released";
  /** eingefrorener Stand bei Freigabe – spätere Änderungen an Daten ändern ihn nicht */
  release: StatementRelease | null;
  createdAt: string;
}

export interface StatementRelease {
  releasedAt: string;
  /** Prüfsumme der Eingangsdaten zum Zeitpunkt der Freigabe */
  fingerprint: string;
  /** JSON des Berechnungsergebnisses (StatementResult) */
  resultJson: string;
}

/* ---------- WEG-Ebene: Jahresabrechnung (Ist) und Wirtschaftsplan (Plan) ---------- */

/** Bewertung einer Kostenposition für die Mieterabrechnung */
export type Classification = "allocable" | "non_allocable" | "review";

/** Wer die Bewertung getroffen hat */
export type ClassificationOrigin = "rule" | "ai" | "user";

/** Woher ein Wert stammt */
export interface Provenance {
  document: string;
  page?: number;
  /** Tabellenzeile bzw. Originaltext */
  row?: string;
}

export interface LedgerPosition {
  id: string;
  /** Bezeichnung wie im Dokument */
  label: string;
  /** Anteil der Wohnung in € */
  amount: number;
  /** Gesamtkosten der WEG in € (falls ausgewiesen) */
  totalAmount?: number | null;
  /** Verteilerschlüssel der Verwaltung, z. B. „MEA“, „Wohnfläche“, „Einheiten“, „HKA“ */
  wegKey?: string;
  /** Schlüsselbasis laut Dokument, z. B. 34,766 von 478,182 cbm oder 49 von 1.000 MEA */
  wegBasis?: { total: number; share: number; unit: string } | null;
  /** Bemerkung im Dokument, z. B. Rechnungsdaten oder Zahlungszeitpunkt */
  note?: string;
  /** Kostenart nach § 2 BetrKV (null = keine) */
  category: number | null;
  classification: Classification;
  reason: string;
  origin: ClassificationOrigin;
  /** vom Vermieter geprüft und bestätigt */
  reviewed: boolean;
  /** Kennzeichnung im Dokument selbst (z. B. Spalte „umlagefähig“ der Verwaltung), null = keine Angabe */
  declaredAllocable: boolean | null;
  /** "total" = Heizkosten laut Heizkostenabrechnung, "component" = darin enthaltene Energie-/Wartungskosten */
  heating?: "total" | "component";
  provenance?: Provenance;
  /** Sicherheit der automatischen Erkennung 0–1 */
  confidence?: number;
  /** ursprünglich ausgelesener Betrag, falls manuell korrigiert */
  extractedAmount?: number;
}

export interface HeatingComponent {
  id: string;
  label: string;
  amount: number;
}

/** Heiz- und Warmwasserkostenabrechnung des Messdienstes für die Wohnung */
export interface HeatingBill {
  heatSource: string;
  /** Gesamtheizkosten der Liegenschaft */
  buildingTotal: number | null;
  /** Anteil der Wohnung laut Abrechnung */
  unitShare: number;
  /** Grundkostenanteil in % (HeizkostenV: 30–50) */
  baseSharePct: number | null;
  areaTotal: number | null;
  consumptionHeatingKwh: number | null;
  consumptionWaterKwh: number | null;
  components: HeatingComponent[];
  /** Kosten, die laut Heizkostenabrechnung in den Gesamtheizkosten enthalten sind (z. B. Wärmestrom, Heizungswartung) */
  includedCosts?: HeatingComponent[];
  /** CO2KostAufG nur bei Brennstoffen mit CO2-Preis (Öl, Gas, Fernwärme …), nicht bei Wärmepumpen-Strom */
  co2Applicable: boolean;
  co2Cost: number | null;
  co2Kg: number | null;
  provenance?: Provenance;
}

export interface WegAnnualStatement {
  kind: "annual";
  id: string;
  propertyId: string;
  unitId: string;
  year: number;
  /** Bewirtschaftungskosten Ist laut Einzelabrechnung (ohne Rücklage) */
  managementCostsActual: number | null;
  /** Summe der Gesamtkosten der WEG laut Einzelabrechnung (Spalte „Gesamt“) */
  buildingTotal?: number | null;
  /** Bewirtschaftungskosten Soll laut Wirtschaftsplan */
  managementCostsPlan: number | null;
  /** Zuführung zur Erhaltungsrücklage – nur Eigentümer-Ebene */
  reserveContribution: number;
  positions: LedgerPosition[];
  heating: HeatingBill | null;
  documents: string[];
  createdAt: string;
}

export interface EconomicPlan {
  kind: "plan";
  id: string;
  propertyId: string;
  unitId: string;
  year: number;
  /** Hausgeld laut Plan */
  annualHausgeld: number | null;
  monthlyHausgeld: number | null;
  /** monatliche Aufteilung laut Plan: Rücklage und Kostentragung */
  monthlyReserve?: number | null;
  monthlyCosts?: number | null;
  /** Positionen inkl. Zuführung zur Erhaltungsrücklage */
  positions: LedgerPosition[];
  documents: string[];
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
  version: 3;
  properties: Property[];
  tenants: Tenant[];
  statements: Statement[];
  wegAnnuals: WegAnnualStatement[];
  economicPlans: EconomicPlan[];
  settings: Settings;
}
