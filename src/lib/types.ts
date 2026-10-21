/** ISO-Datum im Format YYYY-MM-DD */
export type ISODate = string;

export interface Unit {
  id: string;
  name: string;
  /** Wohnfläche in m² */
  area: number;
}

export interface Property {
  id: string;
  name: string;
  address: string;
  units: Unit[];
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
  /** monatliche Betriebskostenvorauszahlung in € */
  monthlyPrepayment: number;
}

/**
 * Umlageschlüssel:
 * - area: nach Wohnfläche (§ 556a BGB Regelfall)
 * - persons: nach Personenzahl
 * - units: nach Wohneinheiten (gleiche Teile)
 * - consumption: nach erfasstem Verbrauch je Einheit
 * - direct: direkt einer Einheit zugeordnet
 */
export type AllocationKey = "area" | "persons" | "units" | "consumption" | "direct";

export interface CostItem {
  id: string;
  /** Nummer der Kostenart nach § 2 BetrKV */
  category: number;
  label: string;
  /** umlagefähiger Gesamtbetrag in € für den Abrechnungszeitraum */
  amount: number;
  key: AllocationKey;
  /** bei key = "direct" */
  directUnitId?: string;
  /** bei key = "consumption": Verbrauch je Einheit */
  consumption?: Record<string, number>;
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
}

export interface AppData {
  version: 1;
  properties: Property[];
  tenants: Tenant[];
  statements: Statement[];
  settings: Settings;
}
