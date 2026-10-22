import { sumRent } from "./calc";
import { addMonths, daysInclusive, fromDay, intersect, toDay } from "./dates";
import { fromCents, toCents } from "./money";
import { municipalCharges, propertyTaxStart } from "./propertyTax";
import { releasedTenant } from "./release";
import type { AppData, ISODate, Property } from "./types";

export interface Booking {
  date: ISODate;
  label: string;
  /** Eingang (+) bzw. Ausgang (−) */
  amount: number;
  /** Kontostand nach der Buchung */
  balance: number;
}

export interface AccountLedger {
  opening: { date: ISODate; amount: number };
  bookings: Booking[];
  balance: number;
  incoming: number;
  outgoing: number;
}

/** Fälligkeiten der Grundbesitzabgaben: vierteljährlich (§ 28 GrStG) */
const QUARTER_DUE = ["02-15", "05-15", "08-15", "11-15"];

/** Vierteljahresraten wie im Bescheid: drei abgerundete Raten, Rest in der letzten */
function quarterRates(annual: number): number[] {
  const c = toCents(annual);
  const q = Math.floor(c / 4);
  return [q, q, q, c - 3 * q].map(fromCents);
}

/**
 * Soll-Kontoauszug des Mietkontos: alle Zahlungen, die laut Mietverträgen, Wirtschaftsplan, Bescheid der
 * Gemeinde, Darlehen und Entnahmen bis zum Stichtag geflossen sein müssten – zum Abgleich mit dem echten Konto.
 * Annahmen: Miete und Hausgeld zum Monatsersten, Abgaben der Gemeinde zu den gesetzlichen Quartalsterminen,
 * Kreditraten zum Monatsersten ab dem Folgemonat der Auszahlung. Bei Häusern ohne WEG sind
 * Betriebskostenvorauszahlungen und die Zahlungen an Versorger nicht erfasst.
 */
export function accountLedger(property: Property, data: AppData, until: ISODate): AccountLedger | null {
  const start = property.accountOpeningDate ?? property.purchaseDate;
  if (!start) return null;
  const openingAmount = property.accountOpeningBalance ?? 0;
  const isEtw = property.type === "etw";
  const raw: Omit<Booking, "balance">[] = [];
  const add = (date: ISODate, label: string, amount: number) => {
    if (date >= start && date <= until && Math.abs(amount) >= 0.005) raw.push({ date, label, amount: Math.round(amount * 100) / 100 });
  };

  const months: string[] = [];
  for (let m = start.slice(0, 7); m <= until.slice(0, 7); m = addMonths(m + "-01", 1).slice(0, 7)) months.push(m);

  // Mieteingänge (anteilig im Ein- und Auszugsmonat)
  for (const t of data.tenants.filter((x) => x.propertyId === property.id)) {
    for (const m of months) {
      const monthStart = `${m}-01`;
      const monthEnd = fromDay(toDay(addMonths(monthStart, 1)) - 1);
      const r = intersect(monthStart, monthEnd, t.moveIn, t.moveOut ?? "9999-12-31");
      if (!r) continue;
      const amount = sumRent(t, r.start, r.end, (x) => x.coldRent + (x.surcharge ?? 0) + (isEtw ? x.prepaymentOperating + x.prepaymentHeating : 0));
      add(r.start, `Miete ${t.name}`, amount);
    }
  }

  // Hausgeld laut Wirtschaftsplan des Jahres, sonst des letzten früheren Plans
  if (isEtw) {
    const plans = data.economicPlans.filter((p) => p.propertyId === property.id && p.monthlyHausgeld !== null);
    for (const m of months) {
      const year = Number(m.slice(0, 4));
      const known = plans.filter((p) => p.year <= year);
      const latest = known.length ? Math.max(...known.map((p) => p.year)) : null;
      const monthly = latest !== null ? known.filter((p) => p.year === latest).reduce((a, p) => a + (p.monthlyHausgeld ?? 0), 0) : property.hausgeldMonthly;
      add(`${m}-01`, "Hausgeld WEG", -monthly);
    }

    // Grundsteuer und Müll laut Bescheid als gemeinsame Quartalsrate, ab dem Jahr, ab dem du sie trägst
    const charges = municipalCharges(property);
    const total = fromCents(charges.reduce((a, c) => a + toCents(c.amount), 0));
    const label = charges.map((c) => c.label).join(" + ");
    const chargeStart = propertyTaxStart(property) ?? start;
    if (total > 0) {
      const firstYear = Number(chargeStart.slice(0, 4));
      for (let y = firstYear; y <= Number(until.slice(0, 4)); y++) {
        if (y === firstYear && chargeStart.slice(5) !== "01-01") {
          // Im Übergangsjahr geht der Bescheid an den Voreigentümer: anteilige Erstattung (Annahme: zum Jahresende)
          const yearDays = daysInclusive(`${y}-01-01`, `${y}-12-31`);
          const share = (total * daysInclusive(chargeStart, `${y}-12-31`)) / yearDays;
          add(`${y}-12-31`, `Erstattung ${label} an Voreigentümer (ab ${chargeStart.split("-").reverse().join(".")})`, -share);
          continue;
        }
        quarterRates(total).forEach((rate, i) => {
          const due = `${y}-${QUARTER_DUE[i]}`;
          if (due >= chargeStart) add(due, `${label} (${i + 1}. Rate)`, -rate);
        });
      }
    }
  }

  // Eigene laufende Kosten anteilig je Monat
  const own = property.maintenanceAnnual + property.managementAnnual + property.otherCostsAnnual;
  if (own) for (const m of months) add(`${m}-01`, "eigene Kosten (anteilig)", -own / 12);

  // Kreditraten ab dem Monat nach der Auszahlung
  for (const l of property.loans) {
    const first = l.startDate ? addMonths(l.startDate.slice(0, 7) + "-01", 1) : start;
    for (const m of months) if (`${m}-01` >= first) add(`${m}-01`, `Rate ${l.lender || "Darlehen"}`, -l.monthlyPayment);
  }

  // Entnahmen am jeweiligen Tag
  for (const w of property.withdrawals ?? []) {
    for (const m of months) {
      const monthEnd = fromDay(toDay(addMonths(`${m}-01`, 1)) - 1);
      const day = `${m}-${w.from.slice(8, 10)}`;
      const due = day > monthEnd ? monthEnd : day;
      if (due >= w.from && (!w.to || due <= w.to)) add(due, w.note || "Entnahme", -w.monthly);
    }
  }

  // Ergebnisse freigegebener Mieterabrechnungen
  for (const st of data.statements.filter((s) => s.propertyId === property.id)) {
    for (const [tenantId, rel] of Object.entries(st.releases)) {
      const r = releasedTenant(st, tenantId);
      if (!r) continue;
      add(rel.releasedAt.slice(0, 10), `${r.result.balance >= 0 ? "Nachzahlung" : "Guthaben"} ${r.result.tenant.name} ${st.periodStart.slice(0, 4)}`, r.result.balance);
    }
  }

  // Eingänge vor Ausgängen am selben Tag
  raw.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  let cents = toCents(openingAmount);
  let inc = 0;
  let out = 0;
  const bookings = raw.map((b) => {
    cents += toCents(b.amount);
    if (b.amount > 0) inc += toCents(b.amount);
    else out += toCents(b.amount);
    return { ...b, balance: fromCents(cents) };
  });
  return { opening: { date: start, amount: openingAmount }, bookings, balance: fromCents(cents), incoming: fromCents(inc), outgoing: fromCents(out) };
}
