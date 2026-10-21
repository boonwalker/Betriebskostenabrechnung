/**
 * Stufenmodell für Wohngebäude nach der Anlage zum Kohlendioxidkostenaufteilungsgesetz
 * (CO2KostAufG): Je höher der CO2-Ausstoß pro m² Wohnfläche und Jahr, desto mehr der
 * CO2-Kosten trägt der Vermieter.
 */
const STAGES: { below: number; landlord: number }[] = [
  { below: 12, landlord: 0 },
  { below: 17, landlord: 10 },
  { below: 22, landlord: 20 },
  { below: 27, landlord: 30 },
  { below: 32, landlord: 40 },
  { below: 37, landlord: 50 },
  { below: 42, landlord: 60 },
  { below: 47, landlord: 70 },
  { below: 52, landlord: 80 },
  { below: Infinity, landlord: 95 },
];

export interface Co2Stage {
  stage: number;
  /** Vermieteranteil in % */
  landlordPct: number;
  /** Mieteranteil in % */
  tenantPct: number;
}

export function co2Stage(kgPerM2Year: number): Co2Stage {
  const idx = STAGES.findIndex((s) => kgPerM2Year < s.below);
  const landlordPct = STAGES[idx].landlord;
  return { stage: idx + 1, landlordPct, tenantPct: 100 - landlordPct };
}
