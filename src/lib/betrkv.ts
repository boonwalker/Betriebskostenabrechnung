import type { AllocationKey } from "./types";

export interface CostCategory {
  no: number;
  label: string;
  defaultKey: AllocationKey;
}

/** Betriebskostenarten nach § 2 Betriebskostenverordnung (BetrKV) */
export const COST_CATEGORIES: CostCategory[] = [
  { no: 1, label: "Grundsteuer", defaultKey: "area" },
  { no: 2, label: "Wasserversorgung", defaultKey: "persons" },
  { no: 3, label: "Entwässerung (Abwasser, Niederschlagswasser)", defaultKey: "persons" },
  { no: 4, label: "Heizung", defaultKey: "consumption" },
  { no: 5, label: "Warmwasser", defaultKey: "consumption" },
  { no: 6, label: "Verbundene Heizungs- und Warmwasserversorgung", defaultKey: "consumption" },
  { no: 7, label: "Aufzug", defaultKey: "area" },
  { no: 8, label: "Straßenreinigung und Müllbeseitigung", defaultKey: "persons" },
  { no: 9, label: "Gebäudereinigung und Ungezieferbekämpfung", defaultKey: "area" },
  { no: 10, label: "Gartenpflege", defaultKey: "area" },
  { no: 11, label: "Beleuchtung (Allgemeinstrom)", defaultKey: "area" },
  { no: 12, label: "Schornsteinreinigung", defaultKey: "area" },
  { no: 13, label: "Sach- und Haftpflichtversicherung", defaultKey: "area" },
  { no: 14, label: "Hauswart", defaultKey: "area" },
  { no: 15, label: "Gemeinschafts-Antennenanlage / Breitbandnetz", defaultKey: "units" },
  { no: 16, label: "Einrichtungen für die Wäschepflege", defaultKey: "units" },
  { no: 17, label: "Sonstige Betriebskosten", defaultKey: "area" },
];

export function categoryLabel(no: number): string {
  return COST_CATEGORIES.find((c) => c.no === no)?.label ?? "Sonstige";
}

export const KEY_LABELS: Record<AllocationKey, string> = {
  area: "Wohnfläche",
  persons: "Personen",
  units: "Wohneinheiten",
  consumption: "Verbrauch",
  direct: "Direkt zugeordnet",
};
