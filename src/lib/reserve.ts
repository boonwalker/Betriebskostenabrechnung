/**
 * Erhaltungsrücklage je Jahr: was du über das Hausgeld zugeführt hast (laut Wirtschaftsplan, ab Erwerb) und
 * was die Jahresabrechnung für die Wohnung als Zuführung ausweist.
 */
import { accountLedger } from "./account";
import { monthlyReserve } from "./anlageV";
import type { AppData, ISODate, Property } from "./types";

export interface ReserveYear {
  year: number;
  /** Monate mit Hausgeld in deinem Eigentum (bis heute) */
  months: number;
  monthly: number;
  /** deine Zuführung über das Hausgeld: Monate × Monatsbetrag */
  paid: number;
  /** Zuführung laut Jahresabrechnung für das ganze Jahr (inkl. Voreigentümer); null = noch keine Abrechnung */
  annualTotal: number | null;
  /** dein zeitanteiliger Teil davon */
  annualOwn: number | null;
}

export interface ReserveOverview {
  years: ReserveYear[];
  /** Summe deiner Zuführungen seit Erwerb */
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function reserveOverview(property: Property, data: AppData, today: ISODate): ReserveOverview | null {
  if (property.type !== "etw") return null;
  const bookings = (accountLedger(property, data, today)?.bookings ?? []).filter((b) => b.kind === "hausgeld");
  if (!bookings.length) return null;
  const firstYear = Number(bookings[0].date.slice(0, 4));
  const years: ReserveYear[] = [];
  for (let year = firstYear; year <= Number(today.slice(0, 4)); year++) {
    const months = bookings.filter((b) => b.date.startsWith(String(year))).length;
    const monthly = r2(monthlyReserve(property, data.economicPlans, year));
    const annual = data.wegAnnuals.find((a) => a.propertyId === property.id && a.year === year);
    const annualTotal = annual ? annual.reserveContribution : null;
    years.push({ year, months, monthly, paid: r2(months * monthly), annualTotal, annualOwn: annualTotal === null ? null : r2((annualTotal * months) / 12) });
  }
  return { years, total: r2(years.reduce((a, y) => a + y.paid, 0)) };
}
