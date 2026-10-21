import { addMonths, daysInclusive, fromDay, intersect, toDay } from "./dates";
import type { ISODate } from "./types";

/**
 * Gradtagzahlen in Promille je Monat (Tabelle zu § 9b Abs. 2 HeizkostenV, VDI 2067).
 * Verteilt den Heizenergieverbrauch eines Jahres auf die Monate, wenn bei einem
 * Nutzerwechsel keine Zwischenablesung möglich ist. Summe = 1.000 ‰.
 */
export const DEGREE_DAYS_PERMILLE = [170, 150, 130, 80, 40, 40 / 3, 40 / 3, 40 / 3, 30, 80, 120, 160];

/** Gradtagzahl-Promille für einen Zeitraum (angebrochene Monate tagesgenau) */
export function degreeDays(start: ISODate, end: ISODate): number {
  let sum = 0;
  let monthStart = start.slice(0, 8) + "01";
  while (toDay(monthStart) <= toDay(end)) {
    const next = addMonths(monthStart, 1);
    const monthEnd = fromDay(toDay(next) - 1);
    const overlap = intersect(monthStart, monthEnd, start, end);
    if (overlap) {
      const month = Number(monthStart.slice(5, 7)) - 1;
      sum += (DEGREE_DAYS_PERMILLE[month] * daysInclusive(overlap.start, overlap.end)) / daysInclusive(monthStart, monthEnd);
    }
    monthStart = next;
  }
  return sum;
}
