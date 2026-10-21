import { daysInclusive } from "./dates";
import { rentAt } from "./model";
import type { ISODate, Property, Tenant } from "./types";

export interface ValuePoint {
  date: ISODate;
  value: number;
}

export interface PropertyMetrics {
  /** Kaufpreis + Kaufnebenkosten */
  invested: number;
  acquisitionCosts: number;
  marketValue: number;
  marketValueDate: ISODate | null;
  /** Marktwert − Einstand (Kaufpreis + Nebenkosten) */
  valueGain: number;
  valueGainPct: number | null;
  /** jährliche Wertentwicklung seit Kauf (bezogen auf den Kaufpreis) */
  appreciationPa: number | null;
  history: ValuePoint[];

  unitsTotal: number;
  unitsLet: number;
  /** aktuelle Nettokaltmiete p. a. */
  annualColdRent: number;
  /** nicht umlagefähige Bewirtschaftungskosten p. a. */
  nonAllocableCosts: number;

  loanBalance: number;
  annualInterest: number;
  annualDebtService: number;
  annualPrincipal: number;
  /** eingesetztes Eigenkapital = Einstand − Darlehensbeträge */
  equityInvested: number;
  /** Marktwert − Restschuld */
  netWorth: number;

  /** Jahreskaltmiete ÷ Kaufpreis */
  grossYield: number | null;
  /** (Jahreskaltmiete − nicht umlagefähige Kosten) ÷ Einstand */
  netYield: number | null;
  cashflowBeforeTax: number;

  depreciationRate: number;
  annualDepreciation: number;
  /** Überschuss (+) bzw. Verlust (−) aus Vermietung und Verpachtung */
  taxableResult: number;
  /** zu zahlende (+) bzw. ersparte (−) Einkommensteuer */
  taxEffect: number;
  cashflowAfterTax: number;
  /** (Cashflow nach Steuern + Tilgung) ÷ eingesetztes Eigenkapital */
  equityReturn: number | null;
}

/** Lineare Gebäude-AfA nach § 7 Abs. 4 EStG abhängig vom Jahr der Fertigstellung */
export function depreciationRate(yearBuilt: number | null): number {
  if (!yearBuilt) return 0.02;
  if (yearBuilt < 1925) return 0.025;
  if (yearBuilt >= 2023) return 0.03;
  return 0.02;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function isCurrentTenant(t: Tenant, today: ISODate) {
  return t.moveIn <= today && (!t.moveOut || t.moveOut >= today);
}

export function propertyMetrics(property: Property, allTenants: Tenant[], today: ISODate, marginalTaxRate: number): PropertyMetrics {
  const acquisitionCosts = property.transferTax + property.notaryCosts + property.brokerFee;
  const invested = property.purchasePrice + acquisitionCosts;

  const valuations = [...property.valuations].sort((a, b) => a.date.localeCompare(b.date));
  const latest = valuations[valuations.length - 1];
  const marketValue = latest?.value ?? property.purchasePrice;
  const history: ValuePoint[] = [
    ...(property.purchaseDate && property.purchasePrice ? [{ date: property.purchaseDate, value: property.purchasePrice }] : []),
    ...valuations.map((v) => ({ date: v.date, value: v.value })),
  ];

  let appreciationPa: number | null = null;
  if (property.purchaseDate && latest && property.purchasePrice > 0) {
    const years = (daysInclusive(property.purchaseDate, latest.date) - 1) / 365.25;
    if (years >= 1) appreciationPa = Math.pow(marketValue / property.purchasePrice, 1 / years) - 1;
  }

  const current = allTenants.filter((t) => t.propertyId === property.id && isCurrentTenant(t, today));
  // Nettokaltmiete inkl. Zuschlägen (z. B. Stellplatz) – Mieteinnahmen ohne Betriebskosten
  const annualColdRent = current.reduce((a, t) => {
    const r = rentAt(t, today);
    return a + ((r?.coldRent ?? 0) + (r?.surcharge ?? 0)) * 12;
  }, 0);
  const unitsLet = new Set(current.map((t) => t.unitId)).size;

  const reserve = property.hausgeldReserveMonthly * 12;
  const deductibleRunning =
    property.hausgeldManagementMonthly * 12 + property.maintenanceAnnual + property.managementAnnual + property.otherCostsAnnual;
  const nonAllocableCosts = deductibleRunning + reserve;

  const loanBalance = property.loans.reduce((a, l) => a + l.balance, 0);
  const annualInterest = property.loans.reduce((a, l) => a + (l.balance * l.interestRate) / 100, 0);
  const annualDebtService = property.loans.reduce((a, l) => a + l.monthlyPayment * 12, 0);
  const annualPrincipal = Math.max(0, annualDebtService - annualInterest);
  const equityInvested = Math.max(0, invested - property.loans.reduce((a, l) => a + l.principal, 0));

  const cashflowBeforeTax = annualColdRent - nonAllocableCosts - annualDebtService;

  const rate = depreciationRate(property.yearBuilt);
  // Kaufnebenkosten werden anteilig dem Gebäude zugerechnet; Grund und Boden ist nicht abschreibbar
  const annualDepreciation = invested * (1 - property.landShare / 100) * rate;
  // Die Zuführung zur Erhaltungsrücklage ist erst bei Verwendung abziehbar (BFH IX R 19/19)
  const taxableResult = annualColdRent - deductibleRunning - annualInterest - annualDepreciation;
  const taxEffect = (taxableResult * marginalTaxRate) / 100;
  const cashflowAfterTax = cashflowBeforeTax - taxEffect;

  return {
    invested,
    acquisitionCosts,
    marketValue,
    marketValueDate: latest?.date ?? property.purchaseDate,
    valueGain: marketValue - invested,
    valueGainPct: ratio(marketValue - invested, invested),
    appreciationPa,
    history,
    unitsTotal: property.units.length,
    unitsLet,
    annualColdRent,
    nonAllocableCosts,
    loanBalance,
    annualInterest,
    annualDebtService,
    annualPrincipal,
    equityInvested,
    netWorth: marketValue - loanBalance,
    grossYield: ratio(annualColdRent, property.purchasePrice),
    netYield: ratio(annualColdRent - nonAllocableCosts, invested),
    cashflowBeforeTax,
    depreciationRate: rate,
    annualDepreciation,
    taxableResult,
    taxEffect,
    cashflowAfterTax,
    equityReturn: ratio(cashflowAfterTax + annualPrincipal, equityInvested),
  };
}

export interface PortfolioMetrics {
  marketValue: number;
  invested: number;
  valueGain: number;
  valueGainPct: number | null;
  loanBalance: number;
  netWorth: number;
  annualColdRent: number;
  cashflowBeforeTax: number;
  cashflowAfterTax: number;
  grossYield: number | null;
  /** Fremdkapitalquote: Restschuld ÷ Marktwert */
  loanToValue: number | null;
}

export function portfolioMetrics(all: PropertyMetrics[], purchasePriceTotal: number): PortfolioMetrics {
  const sum = (f: (m: PropertyMetrics) => number) => all.reduce((a, m) => a + f(m), 0);
  const marketValue = sum((m) => m.marketValue);
  const invested = sum((m) => m.invested);
  const loanBalance = sum((m) => m.loanBalance);
  const annualColdRent = sum((m) => m.annualColdRent);
  return {
    marketValue,
    invested,
    valueGain: marketValue - invested,
    valueGainPct: ratio(marketValue - invested, invested),
    loanBalance,
    netWorth: marketValue - loanBalance,
    annualColdRent,
    cashflowBeforeTax: sum((m) => m.cashflowBeforeTax),
    cashflowAfterTax: sum((m) => m.cashflowAfterTax),
    grossYield: ratio(annualColdRent, purchasePriceTotal),
    loanToValue: ratio(loanBalance, marketValue),
  };
}
