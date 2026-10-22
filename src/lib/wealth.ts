import { sumRent } from "./calc";
import { addMonths, daysInclusive, fromDay, intersect, toDay } from "./dates";
import { propertyMetrics } from "./finance";
import { municipalCharges, propertyTaxStart } from "./propertyTax";
import { releasedTenant } from "./release";
import type { AppData, ISODate, Loan, Property } from "./types";

export interface WealthPoint {
  /** Monatsende (bzw. heute im laufenden Monat) */
  date: ISODate;
  value: number;
  debt: number;
  /** Netto-Zufluss in diesem Monat (Miete + Vorauszahlungen − Hausgeld − eigene Kosten − Rate ± Abrechnungen) */
  cashflow: number;
  /** aufsummierter Cashflow seit Erwerb */
  cumulative: number;
  /** Entnahme vom Mietkonto in diesem Monat */
  withdrawal: number;
  /** aufsummierte Entnahmen seit Erwerb */
  withdrawn: number;
  /** Marktwert − Restschuld + aufsummierter Cashflow − Entnahmen */
  wealth: number;
}

export interface WealthSeries {
  points: WealthPoint[];
  /** Einstand: Kaufpreis bzw. Wert bei Schenkung + Erwerbsnebenkosten − Darlehen */
  baseline: number;
  current: WealthPoint;
  gain: number;
  /** Hinweis, wenn der Tilgungsplan von der eingetragenen Restschuld abweicht */
  loanDeviation: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Marktwert an einem Tag: linear zwischen Erwerb und den erfassten Bewertungen, danach konstant */
export function valueAt(property: Property, date: ISODate): number {
  const pts = [
    ...(property.purchaseDate ? [{ date: property.purchaseDate, value: property.purchasePrice }] : []),
    ...property.valuations.map((v) => ({ date: v.date, value: v.value })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length === 0) return 0;
  if (date <= pts[0].date) return pts[0].value;
  for (let i = 1; i < pts.length; i++) {
    if (date <= pts[i].date) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (toDay(date) - toDay(a.date)) / Math.max(1, toDay(b.date) - toDay(a.date));
      return a.value + (b.value - a.value) * t;
    }
  }
  return pts[pts.length - 1].value;
}

/** Tilgungsplan: Restschuld nach jedem Monat und gezahlte Rate je Monat (erste Rate im Folgemonat der Auszahlung) */
function schedule(loan: Loan, months: string[]): { debt: number[]; payment: number[] } {
  const debt: number[] = [];
  const payment: number[] = [];
  if (!loan.startDate) {
    // ohne Auszahlungsdatum: eingetragene Restschuld, Rate ab Erwerb
    for (const _ of months) {
      debt.push(loan.balance);
      payment.push(loan.monthlyPayment);
    }
    return { debt, payment };
  }
  const startMonth = loan.startDate.slice(0, 7);
  let bal = loan.principal;
  for (const m of months) {
    if (m <= startMonth) {
      debt.push(m === startMonth ? bal : 0);
      payment.push(0);
      continue;
    }
    const interest = (bal * loan.interestRate) / 1200;
    const principalPart = Math.min(Math.max(0, loan.monthlyPayment - interest), bal);
    const paid = bal > 0 ? interest + principalPart : 0;
    bal -= principalPart;
    debt.push(bal);
    payment.push(paid);
  }
  return { debt, payment };
}

/**
 * Monatliche Vermögensentwicklung eines Objekts seit dem Erwerb – wie ein Depotwert inklusive Ausschüttungen.
 * Vereinfachungen: Mieten und Hausgeld wie vereinbart bzw. geplant gezahlt; bei Häusern (keine WEG) sind
 * Betriebskosten und Vorauszahlungen durchlaufende Posten und bleiben außen vor.
 */
export function wealthSeries(property: Property, data: AppData, today: ISODate): WealthSeries | null {
  if (!property.purchaseDate || property.purchaseDate > today) return null;
  const acq = property.purchaseDate;
  const isEtw = property.type === "etw";
  const months: string[] = [];
  for (let m = acq.slice(0, 7); m <= today.slice(0, 7); m = addMonths(m + "-01", 1).slice(0, 7)) months.push(m);

  const tenants = data.tenants.filter((t) => t.propertyId === property.id);
  const loans = property.loans.map((l) => schedule(l, months));
  const ownCostsYear = property.maintenanceAnnual + property.managementAnnual + property.otherCostsAnnual;
  // Grundsteuer und Müllgebühr laut Bescheid der Gemeinde, ab dem Tag, ab dem du sie trägst
  const chargesBill = municipalCharges(property);
  const taxEstimate = chargesBill.find((c) => c.key === "tax")?.amount ?? 0;
  const wasteYear = chargesBill.find((c) => c.key === "waste")?.amount ?? 0;
  const taxStart = propertyTaxStart(property) ?? acq;
  const withdrawals = property.withdrawals ?? [];

  // Hausgeld laut Wirtschaftsplan des Jahres; ohne Plan gilt der letzte frühere Plan weiter (wie bei der WEG üblich)
  const plansWithHausgeld = data.economicPlans.filter((p) => p.propertyId === property.id && p.monthlyHausgeld !== null);
  const hausgeldMonthly = (year: number) => {
    const known = plansWithHausgeld.filter((p) => p.year <= year);
    if (!known.length) return property.hausgeldMonthly;
    const latest = Math.max(...known.map((p) => p.year));
    return known.filter((p) => p.year === latest).reduce((a, p) => a + (p.monthlyHausgeld ?? 0), 0);
  };
  const propertyTaxYear = (year: number) => {
    const st = data.statements.find((s) => s.propertyId === property.id && s.periodStart.startsWith(String(year)));
    const fromStatement = st?.costs.filter((c) => c.category === 1).reduce((a, c) => a + c.amount, 0);
    return fromStatement || taxEstimate;
  };
  // Ergebnisse freigegebener Mieterabrechnungen: Nachzahlung fließt zu, Guthaben ab (im Monat der Freigabe)
  const settlements = new Map<string, number>();
  for (const st of data.statements.filter((s) => s.propertyId === property.id)) {
    for (const [tenantId, rel] of Object.entries(st.releases)) {
      const r = releasedTenant(st, tenantId);
      if (!r) continue;
      const m = rel.releasedAt.slice(0, 7);
      settlements.set(m, (settlements.get(m) ?? 0) + r.result.balance);
    }
  }

  const points: WealthPoint[] = [];
  let cumulative = 0;
  let withdrawn = 0;
  months.forEach((m, i) => {
    const monthStart = `${m}-01`;
    const monthEnd = fromDay(toDay(addMonths(monthStart, 1)) - 1);
    const range = intersect(monthStart, monthEnd, acq, today)!;
    const share = daysInclusive(range.start, range.end) / daysInclusive(monthStart, monthEnd);
    const year = Number(m.slice(0, 4));

    let income = 0;
    for (const t of tenants) {
      const tr = intersect(range.start, range.end, t.moveIn, t.moveOut ?? "9999-12-31");
      if (!tr) continue;
      income += sumRent(t, tr.start, tr.end, (r) => r.coldRent + (r.surcharge ?? 0) + (isEtw ? r.prepaymentOperating + r.prepaymentHeating : 0));
    }
    // Grundsteuer erst ab dem Tag, ab dem du sie trägst
    const taxRange = intersect(range.start, range.end, taxStart, "9999-12-31");
    const taxShare = taxRange ? daysInclusive(taxRange.start, taxRange.end) / daysInclusive(monthStart, monthEnd) : 0;
    const costs =
      (isEtw ? hausgeldMonthly(year) * share + ((propertyTaxYear(year) + wasteYear) / 12) * taxShare : 0) +
      (ownCostsYear / 12) * share +
      loans.reduce((a, l) => a + l.payment[i], 0);
    const cashflow = round2(income - costs + (settlements.get(m) ?? 0));
    cumulative = round2(cumulative + cashflow);
    // Entnahme am Stichtag des Monats, sofern schon erfolgt
    const withdrawal = round2(
      withdrawals.reduce((a, w) => {
        const day = `${m}-${w.from.slice(8, 10)}`;
        const due = day > monthEnd ? monthEnd : day;
        return w.from <= due && (!w.to || due <= w.to) && due <= today && due >= acq ? a + w.monthly : a;
      }, 0),
    );
    withdrawn = round2(withdrawn + withdrawal);
    const date = monthEnd < today ? monthEnd : today;
    const value = round2(valueAt(property, date));
    const debt = round2(loans.reduce((a, l) => a + l.debt[i], 0));
    points.push({ date, value, debt, cashflow, cumulative, withdrawal, withdrawn, wealth: round2(value - debt + cumulative - withdrawn) });
  });

  const current = { ...points[points.length - 1] };
  // Heute gilt die eingetragene Restschuld (z. B. nach Sondertilgung), sofern vorhanden
  const entered = property.loans.reduce((a, l) => a + l.balance, 0);
  let loanDeviation: number | null = null;
  if (property.loans.length && property.loans.every((l) => l.startDate) && entered > 0) {
    loanDeviation = round2(entered - current.debt);
    current.debt = entered;
    current.wealth = round2(current.value - entered + current.cumulative - current.withdrawn);
    points[points.length - 1] = current;
  }
  const metrics = propertyMetrics(property, data.tenants, today, data.settings.marginalTaxRate);
  const baseline = round2(metrics.invested - property.loans.reduce((a, l) => a + l.principal, 0));
  return { points, baseline, current, gain: round2(current.wealth - baseline), loanDeviation: loanDeviation && Math.abs(loanDeviation) > 1 ? loanDeviation : null };
}
