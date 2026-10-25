/**
 * Vorschlag für die Anlage V (Einkünfte aus Vermietung und Verpachtung) eines Jahres aus den erfassten Daten.
 * Zufluss-/Abflussprinzip (§ 11 EStG): Mieten und Vorauszahlungen im Jahr der Fälligkeit, Nachzahlungen und
 * Guthaben im Jahr des Zahlungseingangs, Hausgeld und Abgaben im Jahr der Zahlung.
 */
import { accountLedger } from "./account";
import { sumRent } from "./calc";
import { addMonths } from "./dates";
import { depreciationRate } from "./finance";
import { fromCents, toCents } from "./money";
import { releasedTenant } from "./release";
import type { AppData, EconomicPlan, ISODate, Property } from "./types";

export interface AnlageVLine {
  label: string;
  amount: number;
  note?: string;
}

export interface AnlageV {
  year: number;
  /** Beginn des Zeitraums, in dem dir das Objekt gehört (im Erwerbsjahr nicht der 1. Januar) */
  from: ISODate;
  income: AnlageVLine[];
  incomeTotal: number;
  costs: AnlageVLine[];
  costsTotal: number;
  /** Überschuss (+) bzw. Verlust (−) */
  result: number;
  hints: string[];
}

const sum = (lines: AnlageVLine[]) => fromCents(lines.reduce((a, l) => a + toCents(l.amount), 0));
const r2 = (n: number) => Math.round(n * 100) / 100;
const isReserve = (label: string) => /r(ü|ue)cklage/i.test(label);

/** Zuführung zur Erhaltungsrücklage je Monat laut Wirtschaftsplan des Jahres (sonst des letzten früheren) */
export function monthlyReserve(property: Property, plans: EconomicPlan[], year: number): number {
  const known = plans.filter((p) => p.propertyId === property.id && p.year <= year);
  if (!known.length) return property.hausgeldReserveMonthly;
  const latest = Math.max(...known.map((p) => p.year));
  return known
    .filter((p) => p.year === latest)
    .reduce((a, p) => a + (p.monthlyReserve ?? p.positions.filter((x) => isReserve(x.label)).reduce((b, x) => b + x.amount, 0) / 12), 0);
}

/** Zinsanteil der Raten im Jahr: Tilgungsplan ab Auszahlung aus Darlehensbetrag, Zins und Rate */
function interestInYear(property: Property, year: number, from: ISODate): { amount: number; estimated: boolean } {
  let total = 0;
  let estimated = false;
  for (const l of property.loans) {
    if (!l.startDate) {
      // ohne Auszahlungsdatum: Restschuld × Zins, anteilig für die Monate im Besitz
      const months = 12 - Number(from.slice(5, 7)) + 1;
      total += ((l.balance * l.interestRate) / 100) * (months / 12);
      estimated = true;
      continue;
    }
    let balance = l.principal;
    const firstRate = addMonths(`${l.startDate.slice(0, 7)}-01`, 1);
    for (let m = firstRate; m <= `${year}-12-01` && balance > 0; m = addMonths(m, 1)) {
      const interest = r2((balance * l.interestRate) / 100 / 12);
      balance = r2(balance - (l.monthlyPayment - interest));
      if (m >= `${year}-01-01` && m >= from) total += interest;
    }
  }
  return { amount: r2(total), estimated };
}

export function anlageV(property: Property, data: AppData, year: number): AnlageV | null {
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const owned = property.purchaseDate ?? property.accountOpeningDate;
  if (!owned || owned > yEnd) return null;
  const from = owned > yStart ? owned : yStart;
  const hints: string[] = [];

  // Einnahmen: nur deine eigenen Mietverhältnisse (nicht die des Voreigentümers)
  const tenants = data.tenants.filter((t) => t.propertyId === property.id && !t.landlord && t.moveIn <= yEnd && (!t.moveOut || t.moveOut >= from));
  const pick = (f: Parameters<typeof sumRent>[3]) => r2(tenants.reduce((a, t) => a + sumRent(t, t.moveIn > from ? t.moveIn : from, t.moveOut && t.moveOut < yEnd ? t.moveOut : yEnd, f), 0));
  const income: AnlageVLine[] = [];
  income.push({ label: "Mieteinnahmen (Nettokaltmiete)", amount: pick((r) => r.coldRent), note: tenants.map((t) => t.name).join(", ") || undefined });
  const surcharges = pick((r) => r.surcharge ?? 0);
  if (surcharges) income.push({ label: "Zuschläge (z. B. Stellplatz)", amount: surcharges });
  income.push({ label: "Umlagen: Vorauszahlungen Betriebs- und Heizkosten", amount: pick((r) => r.prepaymentOperating + r.prepaymentHeating) });

  const own = new Set(tenants.map((t) => t.id));
  let backPay = 0;
  let refunds = 0;
  for (const st of data.statements.filter((s) => s.propertyId === property.id)) {
    for (const tenantId of Object.keys(st.releases)) {
      const res = releasedTenant(st, tenantId);
      if (!res || !data.tenants.some((t) => t.id === tenantId && !t.landlord)) continue;
      const settled = st.settled?.[tenantId];
      const balance = res.result.balance;
      if (settled?.startsWith(String(year))) {
        if (balance > 0) backPay += balance;
        else refunds += balance;
      } else if (!settled && Math.abs(balance) >= 0.01 && Number(st.periodStart.slice(0, 4)) >= year - 1 && own.has(tenantId)) {
        hints.push(
          `${balance > 0 ? "Nachzahlung" : "Guthaben"} ${res.result.tenant.name} (${st.periodStart.slice(0, 4)}) ist noch nicht als ${balance > 0 ? "eingegangen" : "ausgezahlt"} abgehakt – sie zählt im Jahr der Zahlung.`,
        );
      }
    }
  }
  if (backPay) income.push({ label: "Nachzahlungen aus Betriebskostenabrechnungen", amount: r2(backPay) });
  if (refunds) income.push({ label: "ausgezahlte Guthaben aus Betriebskostenabrechnungen", amount: r2(refunds), note: "mit den Umlagen verrechnet" });

  // Werbungskosten
  const costs: AnlageVLine[] = [];
  const months = 12 - Number(from.slice(5, 7)) + 1;
  const isPurchase = (property.acquisitionType ?? "purchase") === "purchase";
  const acquisitionCosts = property.transferTax + property.notaryCosts + property.brokerFee;
  const base = isPurchase ? property.purchasePrice + acquisitionCosts : (property.predecessorCost ?? 0) + acquisitionCosts;
  const rate = depreciationRate(property.yearBuilt);
  const afa = r2(base * (1 - property.landShare / 100) * rate * (months / 12));
  if (afa)
    costs.push({
      label: "Absetzung für Abnutzung (Gebäude)",
      amount: afa,
      note: `${(rate * 100).toLocaleString("de-DE")} % von ${r2(base * (1 - property.landShare / 100)).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €${months < 12 ? `, ${months}/12 im Erwerbsjahr` : ""}${isPurchase ? "" : ", fortgeführt vom Rechtsvorgänger"}`,
    });
  else hints.push("Für die AfA fehlen Kaufpreis bzw. Anschaffungskosten oder der Bodenanteil.");

  const interest = interestInYear(property, year, from);
  if (interest.amount) costs.push({ label: "Schuldzinsen", amount: interest.amount, note: interest.estimated ? "geschätzt – Zinsbescheinigung der Bank verwenden" : "aus Tilgungsplan – mit Zinsbescheinigung der Bank abgleichen" });

  const ledger = accountLedger(property, data, yEnd);
  const inYear = (ledger?.bookings ?? []).filter((b) => b.date >= from && b.date <= yEnd);
  const out = (kind: string) => -r2(inYear.filter((b) => b.kind === kind).reduce((a, b) => a + b.amount, 0));

  if (property.type === "etw") {
    const hausgeld = out("hausgeld");
    const hausgeldMonths = inYear.filter((b) => b.kind === "hausgeld").length;
    const reserve = r2(monthlyReserve(property, data.economicPlans, year) * hausgeldMonths);
    if (hausgeld)
      costs.push({
        label: "Hausgeld an die WEG ohne Erhaltungsrücklage",
        amount: r2(hausgeld - reserve),
        note: `${hausgeldMonths} × Hausgeld ${(hausgeld / hausgeldMonths).toLocaleString("de-DE", { minimumFractionDigits: 2 })} € abzüglich Rücklage ${reserve.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`,
      });
    const settlement = out("wegSettlement");
    if (settlement) {
      const labels = inYear.filter((b) => b.kind === "wegSettlement").map((b) => b.label.replace(/ \(.*\)$/, ""));
      costs.push({
        label: settlement > 0 ? "Nachzahlung an die WEG (Abrechnungsspitze)" : "Erstattung der WEG (Abrechnungsspitze)",
        amount: settlement,
        note: `${labels.join(", ")}, gezahlt im Jahr ${year} – ${settlement > 0 ? "erhöht" : "mindert"} die Werbungskosten`,
      });
    }
    const prev = data.wegAnnuals.find((a) => a.propertyId === property.id && a.year === year - 1);
    if (prev && !prev.settlement)
      hints.push(`Abrechnungsspitze der WEG-Abrechnung ${year - 1} noch nicht erfasst – Erstattungen und Nachzahlungen zählen im Jahr der Zahlung (WEG-Abrechnung → Abrechnungsspitze).`);
    else if (prev?.settlement && !prev.settlement.paidOn)
      hints.push(`Für die Abrechnungsspitze ${year - 1} ist kein Zahltag erfasst – angenommen ist der 31.12.${year}. Weicht er ab, trage ihn bei der WEG-Abrechnung ein.`);
  }
  const municipal = out("municipal");
  if (municipal) {
    const refund = inYear.find((b) => b.kind === "municipal" && b.label.startsWith("Erstattung"));
    costs.push({ label: "Grundsteuer und Müllgebühr", amount: municipal, note: refund ? "anteilige Erstattung an den Voreigentümer" : "laut Bescheid der Gemeinde" });
  }
  const ownCosts = out("own");
  if (ownCosts) costs.push({ label: "Instandhaltung, Verwaltung, sonstige Kosten", amount: ownCosts, note: "Planwerte – durch die tatsächlichen Rechnungen des Jahres ersetzen" });

  const incomeTotal = sum(income);
  const costsTotal = sum(costs);
  return { year, from, income, incomeTotal, costs, costsTotal, result: fromCents(toCents(incomeTotal) - toCents(costsTotal)), hints };
}

/** Jahre, für die eine Anlage V in Frage kommt: ab Erwerb bis zum Vorjahr bzw. laufenden Jahr */
export function anlageVYears(property: Property, today: ISODate): number[] {
  const owned = property.purchaseDate ?? property.accountOpeningDate;
  if (!owned) return [];
  const out: number[] = [];
  for (let y = Number(today.slice(0, 4)); y >= Number(owned.slice(0, 4)); y--) out.push(y);
  return out;
}
