import type { Segment } from "./calc";
import type { MeterKind, Statement } from "./types";

export const METER_LABELS: Record<MeterKind, string> = {
  heating: "Heizung (Wärmezähler/Heizkostenverteiler)",
  water: "Warmwasser",
  coldWater: "Kaltwasser (m³)",
};

/** Stichtage einer Wohnung: Beginn des ersten Abschnitts, Beginn jedes weiteren Abschnitts, Ende des letzten */
export function meterDates(unitSegs: Segment[]): string[] {
  if (unitSegs.length === 0) return [];
  return [...unitSegs.map((s) => s.start), unitSegs[unitSegs.length - 1].end];
}

/**
 * Verbrauch je Abschnitt einer Wohnung für einen Zähler: aus Zählerständen an den Stichtagen,
 * sonst aus den Verbrauchswerten je Mieter. null, wenn nicht für jeden Abschnitt ein Wert vorliegt.
 */
export function segmentConsumption(statement: Statement, unitId: string, unitSegs: Segment[], meter: MeterKind): number[] | null {
  const values = statement.meterReadings?.[unitId]?.[meter];
  if (values && values.length === unitSegs.length + 1 && values.every((v) => v !== null && v !== undefined)) {
    const diffs = unitSegs.map((_, i) => (values[i + 1] as number) - (values[i] as number));
    // Zählerstände müssen steigen; sonst Tippfehler oder Zählertausch – dann nicht verwenden
    if (diffs.every((d) => d >= 0) && diffs.some((d) => d > 0)) return diffs;
    return null;
  }
  if (meter === "coldWater") return null;
  const readings = statement.interimReadings ?? {};
  // Verbrauchswerte je Mieter: nur, wenn für jeden Abschnitt ein Mieter mit Wert > 0 vorliegt
  if (unitSegs.every((sg) => sg.tenantId && (readings[sg.tenantId]?.[meter] ?? 0) > 0)) {
    return unitSegs.map((sg) => readings[sg.tenantId!]![meter]!);
  }
  return null;
}
