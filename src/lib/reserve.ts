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

export interface ReserveBalance {
  /** Stichtag (31.12. des Abrechnungsjahres) */
  date: ISODate;
  /** dein Anteil; ausgewiesen oder über die Miteigentumsanteile berechnet */
  share: number;
  computed: boolean;
  total: number | null;
}

export interface ReserveOverview {
  years: ReserveYear[];
  /** letzter bekannter Rücklagenstand laut Jahresabrechnung */
  balance: ReserveBalance | null;
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
  // Rücklagenstand aus der neuesten Jahresabrechnung, die ihn ausweist
  const mea = property.units.reduce((a, u) => a + (u.mea ?? 0), 0);
  let balance: ReserveBalance | null = null;
  for (const a of [...data.wegAnnuals].filter((x) => x.propertyId === property.id).sort((x, y) => y.year - x.year)) {
    const b = a.reserveBalance;
    if (!b) continue;
    const share = b.share ?? (b.total !== null && mea && property.wegMeaTotal ? r2((b.total * mea) / property.wegMeaTotal) : null);
    if (share === null) continue;
    balance = { date: `${a.year}-12-31`, share, computed: b.share === null, total: b.total };
    break;
  }
  return { years, balance, total: r2(years.reduce((a, y) => a + y.paid, 0)) };
}
