import type { ISODate } from "./types";

const DAY_MS = 86_400_000;

export function toDay(d: ISODate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day) / DAY_MS;
}

export function fromDay(n: number): ISODate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** Anzahl Tage zwischen zwei Daten, beide inklusive */
export function daysInclusive(start: ISODate, end: ISODate): number {
  return toDay(end) - toDay(start) + 1;
}

/** Schnittmenge zweier Zeiträume oder null */
export function intersect(
  aStart: ISODate,
  aEnd: ISODate,
  bStart: ISODate,
  bEnd: ISODate,
): { start: ISODate; end: ISODate } | null {
  const s = Math.max(toDay(aStart), toDay(bStart));
  const e = Math.min(toDay(aEnd), toDay(bEnd));
  return s <= e ? { start: fromDay(s), end: fromDay(e) } : null;
}

export function addMonths(d: ISODate, months: number): ISODate {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, day)).toISOString().slice(0, 10);
}

export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}

export function todayISO(): ISODate {
  return new Date().toISOString().slice(0, 10);
}
