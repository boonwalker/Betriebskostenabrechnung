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
  /** Auszahlung bzw. Übernahme des Darlehens – ab dann laufen Rate und Tilgung */
  startDate?: ISODate | null;
}

/** Art des Erwerbs: bestimmt Einstand, eingesetztes Eigenkapital und Abschreibung */
export type AcquisitionType = "purchase" | "gift" | "inheritance";

/** Bescheid der Gemeinde über Grundsteuer und Müllgebühr für ein Jahr */
export interface MunicipalBill {
  id: string;
  year: number;
  propertyTax: number | null;
  wasteFee: number | null;
  note: string;
}

/** Regelmäßige Entnahme vom Mietkonto auf ein privates Konto – steuerlich ohne Bedeutung */
export interface Withdrawal {
  id: string;
  /** erste Entnahme; danach monatlich am selben Tag */
  from: ISODate;
  /** letzte Entnahme (leer: läuft weiter) */
  to: ISODate | null;
  monthly: number;
  note: string;
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
  acquisitionType?: AcquisitionType;
  /** Erwerbsdatum (Übergang von Nutzen und Lasten) */
  purchaseDate: ISODate | null;
  /** Kaufpreis bzw. bei Schenkung/Erbschaft der Verkehrswert zum Erwerbszeitpunkt */
  purchasePrice: number;
  /** Kauf: Grunderwerbsteuer; Schenkung/Erbschaft: Schenkung- bzw. Erbschaftsteuer */
  transferTax: number;
  notaryCosts: number;
  brokerFee: number;
  /** Anteil des Grund und Bodens am Kaufpreis in % (nicht abschreibbar) */
  landShare: number;
  /** Schenkung/Erbschaft: Anschaffungskosten des Rechtsvorgängers (inkl. Nebenkosten) – die AfA wird fortgeführt (§ 11d EStDV) */
  predecessorCost?: number | null;
  /** Schenkung/Erbschaft: Jahr, in dem der Rechtsvorgänger erworben hat */
  predecessorYear?: number | null;
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
  /** Kostenarten (Bezeichnung laut WEG-Abrechnung), die der Mieter immer mit dem Anteil laut WEG trägt – auch wenn sein Vertrag einen anderen Maßstab nennt */
  wegShareAlways?: string[];
  /** Grundsteuerwert laut Feststellungsbescheid des Finanzamts */
  propertyTaxValue?: number | null;
  /** Grundstücksfläche in m², bei Wohnungseigentum dein Anteil (laut Grundsteuerwertbescheid „davon Fläche“) */
  landArea?: number | null;
  /** Lage im Kataster, z. B. „Gemarkung Heinsberg, Flur 2, Flurstück 668, Grundbuch-Blatt 4376“ */
  parcel?: string;
  /** Bodenrichtwert in €/m² mit Quelle und Stand (z. B. BORIS NRW) – zur Kontrolle des Bodenanteils */
  landValuePerSqm?: number | null;
  landValueNote?: string;
  /** Hebesatz der Gemeinde in % (Grundsteuer B, ggf. für Wohngrundstücke) */
  propertyTaxRate?: number | null;
  /** Grundsteuer pro Jahr laut Bescheid der Gemeinde (maßgeblich vor der Schätzung) */
  propertyTaxAnnual?: number | null;
  /** Müllgebühr pro Jahr laut Grundbesitzabgabenbescheid, falls die Gemeinde sie dem Eigentümer berechnet */
  wasteFeeAnnual?: number | null;
  /** Grundbesitzabgabenbescheide je Jahr – haben Vorrang vor den beiden Feldern oben */
  municipalBills?: MunicipalBill[];
  /** ab wann du die Abgaben der Gemeinde trägst; leer: 1. Januar nach dem Erwerb (§ 9 GrStG) */
  propertyTaxFrom?: ISODate | null;
  /** Kontostand des Mietkontos zu Beginn (Standard: 0 € zum Erwerb) */
  accountOpeningBalance?: number | null;
  accountOpeningDate?: ISODate | null;
  /** zuletzt eingetragener echter Kontostand zum Abgleich mit dem Soll */
  accountCheck?: { date: ISODate; actual: number } | null;
  /** regelmäßige Entnahmen vom Mietkonto (Privatentnahmen) */
  withdrawals?: Withdrawal[];
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

/** Grundlagen für eine Mieterhöhung bis zur ortsüblichen Vergleichsmiete (§ 558 BGB) */
export interface RentReview {
  /** ortsübliche Vergleichsmiete netto kalt je m² (z. B. Mietspiegel-Mittelwert) */
  comparableRentPerSqm: number | null;
  /** Begründungsmittel, z. B. „Mietspiegel der Stadt Heinsberg 2025, Feld B3“ */
  source: string;
  /** Kappungsgrenze in % für drei Jahre: 20, in Gebieten mit Verordnung 15 */
  capPercent: 15 | 20;
  /** Staffel- oder Indexmiete vereinbart – dann keine Erhöhung nach § 558 */
  excluded?: boolean;
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
  /** Anrede im Anschreiben: true = du, sonst Sie */
  informal?: boolean;
  /** Angaben zur Prüfung einer Mieterhöhung nach § 558 BGB */
  rentReview?: RentReview;
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
  /** vom Vermieter anhand der Rechnung bestätigt: die Position betrifft diese im Mietvertrag genannte Leistung */
  confirmedAgreement?: string;
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
  /**
   * Zählerstände je Wohnung und Zähler an den Stichtagen des Zeitraums: Beginn, jeder Nutzerwechsel, Ende.
   * Daraus ergibt sich der Verbrauch je Mieter (bzw. Leerstand). Geht den Verbrauchswerten oben vor.
   */
  meterReadings?: Record<string, Partial<Record<MeterKind, (number | null)[]>>>;
  /** draft = nichts freigegeben, partial = einzelne Mietverhältnisse freigegeben, released = alle */
  status: "draft" | "partial" | "released";
  /** Freigaben je Mietverhältnis (Mieter-ID) – eingefrorener Stand, spätere Datenänderungen ändern ihn nicht */
  releases: Record<string, TenantRelease>;
  /** Zustellung des Anschreibens je Mieter – ab Zugang laufen Zahlungsfrist und Einwendungsfrist */
  delivery?: Record<string, Delivery>;
  /** Nachzahlung eingegangen bzw. Guthaben ausgezahlt am (je Mieter) */
  settled?: Record<string, ISODate>;
  createdAt: string;
}

/** heating = Wärmezähler/Heizkostenverteiler, water = Warmwasser, coldWater = Kaltwasser (m³) */
export type MeterKind = "heating" | "water" | "coldWater";

export type DeliveryMethod = "brief" | "einwurf" | "einschreiben" | "persoenlich" | "email";

export interface Delivery {
  /** Tag des Zugangs beim Mieter */
  date: ISODate;
  method: DeliveryMethod;
}

export interface TenantRelease {
  releasedAt: string;
  /** JSON des Ergebnisses für diesen Mieter (TenantResult) samt CO2-Angaben und Abrechnungstagen */
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
  /** ungefähre Lage der Tabellenzeile auf der Seite (0 = oben, 1 = unten) – laut Auslese */
  rowTop?: number;
  rowBottom?: number;
}

/** Lage von Summenzeile und Eigentümerblock in der fotografierten Einzelabrechnung (relativ zur Seite, laut Auslese) */
export interface SheetLayout {
  /** Seite in sourcePages (1-basiert) */
  page: number;
  sum: { top: number; bottom: number; totalLeft: number; totalRight: number; shareLeft: number; shareRight: number } | null;
  /** Kostenanteil, Vorschüsse, Abrechnungsspitze – nur für den Eigentümer */
  owner: { top: number; bottom: number } | null;
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
  /** Seiten der hochgeladenen Unterlagen – daraus lassen sich Anlagen fürs Mieterschreiben wählen */
  sourcePages?: DocPage[];
  /** Nummern (1-basiert) der Seiten in sourcePages, die zur Heizkostenabrechnung gehören – laut Auslese */
  heatingPages?: number[];
  /** Lage von Summenzeile und Eigentümerblock in der Einzelabrechnung – für die Anlage ans Mieterschreiben */
  sheet?: SheetLayout | null;
  /**
   * Abrechnungsspitze laut Einzelabrechnung: + Erstattung der WEG an dich, − Nachzahlung an die WEG;
   * paidOn = Tag der Zahlung, due = Fälligkeit laut Abrechnung (falls genannt)
   */
  settlement?: { amount: number; paidOn: ISODate | null; due?: ISODate | null } | null;
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
  /** Einladungscode für die Belegerkennung über den ImmoFriend-Proxy (statt eigenem Schlüssel) */
  inviteCode?: string;
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
  /** Belege, die dem Mieterschreiben beigefügt werden (je Objekt und Jahr) */
  attachments?: Attachment[];
  /** Belegablage: alle über den Belegeingang hochgeladenen Dokumente */
  documents?: StoredDocument[];
  settings: Settings;
}

export type DocumentKind = "weg_annual" | "weg_plan" | "heating" | "municipal" | "invoice" | "lease" | "other";

/** Ein Dokument der Belegablage – erkannt, zugeordnet und abgelegt */
export interface StoredDocument {
  id: string;
  createdAt: string;
  kind: DocumentKind;
  /** kurze Bezeichnung, z. B. „Grundbesitzabgabenbescheid Stadt Heinsberg“ */
  title: string;
  year: number | null;
  propertyId: string | null;
  pages: DocPage[];
  status: "processing" | "done" | "error";
  /** was damit geschehen ist, z. B. „WEG-Jahresabrechnung 2025 angelegt“ */
  result?: string;
  /** Sprungziel zur Stelle, an der das Dokument verwendet wird */
  link?: string;
  error?: string;
}

/** Eine gespeicherte Belegseite als Bild; die Bilddatei liegt im Seitenspeicher (siehe blobs.ts) */
export interface DocPage {
  id: string;
  blobId: string;
  width: number;
  height: number;
  /** Name der hochgeladenen Datei (bei PDFs mit Seitenzahl) */
  source: string;
}

/** Geschwärzte Fläche, relativ zur Seite (0–1); tenantId = nur im Schreiben an diesen Mieter, null = für alle */
export interface Redaction {
  id: string;
  tenantId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AttachmentKind = "wegAnnual" | "heating" | "propertyTax";

/** Waagerechter Streifen, der aus der Seite herausgeschnitten wird (z. B. nicht umlagefähige Zeilen), relativ zur Seite */
export interface PageCut {
  id: string;
  y: number;
  h: number;
}

/** Überschriebener Text, z. B. eine angepasste Summe: Fläche im Papierton, Text rechtsbündig, relativ zur Seite */
export interface TextPatch {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Schriftgröße und Grundlinie relativ zur Seitenhöhe */
  fontSize: number;
  baseline: number;
}

export interface AttachmentPage extends DocPage {
  /** dem Mieterschreiben beifügen */
  include: boolean;
  redactions: Redaction[];
  cuts?: PageCut[];
  patches?: TextPatch[];
}

/** Anlage zum Mieterschreiben: Heizkostenabrechnung oder Grundsteuer-/Abgabenbescheid eines Jahres */
export interface Attachment {
  id: string;
  propertyId: string;
  year: number;
  kind: AttachmentKind;
  pages: AttachmentPage[];
}
