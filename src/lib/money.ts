/**
 * Geldbeträge werden als Euro mit höchstens zwei Nachkommastellen gespeichert, aber
 * in ganzen Cent gerechnet. So entstehen keine Gleitkomma-Fehler, und verteilte
 * Anteile ergeben immer exakt den Gesamtbetrag.
 */
export type Cents = number;

export function toCents(euro: number): Cents {
  // toFixed glättet Darstellungsfehler wie 1.005 * 100 = 100.49999…
  return Math.round(Number((euro * 100).toFixed(6)));
}

export const fromCents = (cents: Cents): number => cents / 100;

export const sumCents = (values: Cents[]): Cents => values.reduce((a, b) => a + b, 0);

/** Summiert Euro-Beträge exakt über Cent */
export const sumEuro = (values: number[]): number => fromCents(sumCents(values.map(toCents)));

/**
 * Verteilt einen Centbetrag nach Gewichten (Verfahren der größten Reste / Hare-Niemeyer).
 * Jeder Anteil wird abgerundet; die verbleibenden Cent erhalten die Anteile mit den
 * größten Nachkommaresten. Die Summe der Ergebnisse ist exakt `total`.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (abs * w) / sumW);
  const floors = exact.map(Math.floor);
  let rest = abs - sumCents(floors);
  const order = exact
    .map((x, i) => ({ i, frac: x - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    if (weights[i] <= 0) continue;
    floors[i] += 1;
    rest -= 1;
  }
  return floors.map((c) => c * sign);
}
