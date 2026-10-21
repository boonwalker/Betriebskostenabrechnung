import { categoryLabel } from "./betrkv";
import { co2Stage } from "./co2";
import { addMonths, daysInclusive, fromDay, intersect, toDay } from "./dates";
import type { CostItem, ISODate, Property, Section35aKind, Statement, Tenant, Unit } from "./types";

/** Belegungsabschnitt einer Einheit: ein Mieter oder Leerstand (tenantId = null) */
export interface Segment {
  unitId: string;
  tenantId: string | null;
  start: ISODate;
  end: ISODate;
  days: number;
  persons: number;
}

/** Schlüssel, nach dem eine (ggf. aufgeteilte) Position tatsächlich verteilt wird */
export type DistributionKey = "area" | "persons" | "units" | "consumption" | "direct";

export interface ItemShare {
  costId: string;
  category: number;
  label: string;
  key: DistributionKey;
  /** auf die Nutzer verteilter Betrag der Position */
  total: number;
  /** Gesamtbasis des Schlüssels, z. B. 250 m² */
  basisTotal: number;
  /** Anteil an der Basis, zeitanteilig, z. B. 75 m² */
  basisShare: number;
  amount: number;
  /** Anteil an den Arbeitskosten nach § 35a EStG */
  laborAmount: number;
  laborKind?: Section35aKind;
  /** Anteil an den CO2-Kosten (Mieteranteil) */
  co2Amount: number;
}

export interface Co2Result {
  costId: string;
  label: string;
  co2Cost: number;
  co2Kg: number;
  kgPerM2Year: number;
  stage: number;
  landlordPct: number;
  /** vom Vermieter zu tragen, nicht umgelegt */
  landlordAmount: number;
}

export interface Prepayments {
  operating: number;
  heating: number;
  total: number;
}

export interface TenantResult {
  tenant: Tenant;
  unit: Unit;
  start: ISODate;
  end: ISODate;
  days: number;
  items: ItemShare[];
  totalCosts: number;
  /** maßgebliche Vorauszahlungen (ggf. tatsächlich gezahlt) */
  prepayments: number;
  /** Soll-Vorauszahlungen laut Mietverlauf */
  prepaymentsCalculated: Prepayments;
  /** > 0: Nachzahlung des Mieters, < 0: Guthaben des Mieters */
  balance: number;
  labor35a: { service: number; craftsman: number };
}

export interface VacancyResult {
  unit: Unit;
  start: ISODate;
  end: ISODate;
  days: number;
  amount: number;
}

export interface StatementResult {
  periodDays: number;
  /** Summe aller erfassten umlagefähigen Kosten */
  totalCosts: number;
  tenants: TenantResult[];
  vacancies: VacancyResult[];
  co2: Co2Result[];
  /** Kosten, die beim Vermieter verbleiben: Leerstand + Vermieteranteil CO2 */
  landlordShare: number;
  warnings: string[];
  /** Spätester Zugang der Abrechnung beim Mieter (§ 556 Abs. 3 BGB) */
  deadline: ISODate;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Zerlegt den Abrechnungszeitraum je Einheit in Mieter- und Leerstandsabschnitte */
export function buildSegments(units: Unit[], tenants: Tenant[], periodStart: ISODate, periodEnd: ISODate): Segment[] {
  const segments: Segment[] = [];
  for (const unit of units) {
    const occupied = tenants
      .filter((t) => t.unitId === unit.id)
      .map((t) => ({ t, range: intersect(t.moveIn, t.moveOut ?? periodEnd, periodStart, periodEnd) }))
      .filter((x): x is { t: Tenant; range: { start: ISODate; end: ISODate } } => x.range !== null)
      .sort((a, b) => toDay(a.range.start) - toDay(b.range.start));

    let cursor = toDay(periodStart);
    for (const { t, range } of occupied) {
      const s = toDay(range.start);
      if (s > cursor) segments.push(vacancy(unit.id, cursor, s - 1));
      segments.push({
        unitId: unit.id,
        tenantId: t.id,
        start: range.start,
        end: range.end,
        days: daysInclusive(range.start, range.end),
        persons: t.persons,
      });
      cursor = Math.max(cursor, toDay(range.end) + 1);
    }
    if (cursor <= toDay(periodEnd)) segments.push(vacancy(unit.id, cursor, toDay(periodEnd)));
  }
  return segments;
}

function vacancy(unitId: string, from: number, to: number): Segment {
  // Leerstand wird mit einer Person angesetzt, damit der Leerstandsanteil beim
  // Vermieter bleibt und nicht auf die übrigen Mieter umgelegt wird.
  return { unitId, tenantId: null, start: fromDay(from), end: fromDay(to), days: to - from + 1, persons: 1 };
}

/** Eine zu verteilende Teilposition (Heizkosten werden in Grund- und Verbrauchskosten zerlegt) */
interface Part {
  item: CostItem;
  label: string;
  key: DistributionKey;
  amount: number;
  /** Anteil dieser Teilposition an der Gesamtposition (für § 35a- und CO2-Anteile) */
  fraction: number;
}

function splitItem(item: CostItem, distributable: number): Part[] {
  const label = item.label || categoryLabel(item.category);
  if (item.key !== "heating") return [{ item, label, key: item.key, amount: distributable, fraction: 1 }];
  const share = Math.min(70, Math.max(50, item.consumptionShare ?? 70)) / 100;
  return [
    { item, label: `${label} – Grundkosten (${Math.round((1 - share) * 100)} %)`, key: "area", amount: distributable * (1 - share), fraction: 1 - share },
    { item, label: `${label} – Verbrauchskosten (${Math.round(share * 100)} %)`, key: "consumption", amount: distributable * share, fraction: share },
  ];
}

/** Gewicht eines Abschnitts in "Basis × Tage" */
function weight(part: Part, seg: Segment, unit: Unit): number {
  switch (part.key) {
    case "area":
      return unit.area * seg.days;
    case "persons":
      return seg.persons * seg.days;
    case "units":
      return seg.days;
    case "consumption":
      return (part.item.consumption?.[unit.id] ?? 0) * seg.days;
    case "direct":
      return part.item.directUnitId === unit.id ? seg.days : 0;
  }
}

/** Monatsbetrag anteilig je Kalendermonat (volle Monate = voller Betrag, sonst tagesgenau) */
function proRataMonthly(monthly: number, start: ISODate, end: ISODate): number {
  let sum = 0;
  let monthStart = start.slice(0, 8) + "01";
  while (toDay(monthStart) <= toDay(end)) {
    const nextMonth = addMonths(monthStart, 1);
    const monthEnd = fromDay(toDay(nextMonth) - 1);
    const overlap = intersect(monthStart, monthEnd, start, end);
    if (overlap) sum += (monthly * daysInclusive(overlap.start, overlap.end)) / daysInclusive(monthStart, monthEnd);
    monthStart = nextMonth;
  }
  return sum;
}

/** Summiert einen Mietbestandteil über einen Zeitraum unter Berücksichtigung des Mietverlaufs */
export function sumRent(tenant: Tenant, start: ISODate, end: ISODate, pick: (r: Tenant["rentHistory"][number]) => number): number {
  const history = [...tenant.rentHistory].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let sum = 0;
  history.forEach((r, i) => {
    // Der erste Mietstand gilt auch rückwirkend bis zum Einzug
    const from = i === 0 ? "0000-01-01" : r.validFrom;
    const to = history[i + 1] ? fromDay(toDay(history[i + 1].validFrom) - 1) : "9999-12-31";
    const range = intersect(from, to, start, end);
    if (range) sum += proRataMonthly(pick(r), range.start, range.end);
  });
  return round2(sum);
}

export function calcPrepayments(tenant: Tenant, start: ISODate, end: ISODate): Prepayments {
  const operating = sumRent(tenant, start, end, (r) => r.prepaymentOperating);
  const heating = sumRent(tenant, start, end, (r) => r.prepaymentHeating);
  return { operating, heating, total: round2(operating + heating) };
}

export function calculateStatement(statement: Statement, property: Property, allTenants: Tenant[]): StatementResult {
  const { periodStart, periodEnd } = statement;
  const periodDays = daysInclusive(periodStart, periodEnd);
  const units = property.units;
  const totalArea = units.reduce((a, u) => a + u.area, 0);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const tenants = allTenants.filter((t) => t.propertyId === property.id);
  const segments = buildSegments(units, tenants, periodStart, periodEnd);
  const warnings: string[] = [];

  if (periodDays > 366) warnings.push("Der Abrechnungszeitraum darf höchstens 12 Monate umfassen (§ 556 Abs. 3 BGB).");
  if (units.length === 0) warnings.push("Das Objekt hat noch keine Wohneinheiten.");
  for (const unit of units) {
    const occupiedDays = segments.filter((s) => s.unitId === unit.id && s.tenantId).reduce((a, s) => a + s.days, 0);
    if (occupiedDays > periodDays) warnings.push(`Überschneidende Mietverhältnisse in „${unit.name}“ – bitte Ein-/Auszugsdaten prüfen.`);
  }

  // CO2-Kostenaufteilung: Vermieteranteil vorab abziehen
  const co2: Co2Result[] = [];
  const distributable = new Map<string, number>();
  for (const item of statement.costs) {
    let amount = item.amount;
    if (item.co2Cost && item.co2Cost > 0) {
      if (!item.co2Kg || totalArea === 0) {
        warnings.push(`„${item.label}“: Für die CO2-Kostenaufteilung fehlt der CO2-Ausstoß in kg. Ohne Angabe trägt der Mieter die CO2-Kosten voll – das ist nur bei Stufe 1 korrekt.`);
      } else {
        const kgPerM2Year = (item.co2Kg / totalArea) * (365 / periodDays);
        const stage = co2Stage(kgPerM2Year);
        const landlordAmount = round2((item.co2Cost * stage.landlordPct) / 100);
        amount -= landlordAmount;
        co2.push({ costId: item.id, label: item.label, co2Cost: item.co2Cost, co2Kg: item.co2Kg, kgPerM2Year, stage: stage.stage, landlordPct: stage.landlordPct, landlordAmount });
      }
    }
    if (item.laborCost && item.laborCost > item.amount) warnings.push(`„${item.label}“: Die Arbeitskosten nach § 35a sind höher als der Betrag.`);
    distributable.set(item.id, amount);
  }

  const shares = new Map<Segment, ItemShare[]>(segments.map((s) => [s, []]));
  for (const item of statement.costs) {
    const itemDistributable = distributable.get(item.id)!;
    const landlordCo2 = co2.find((c) => c.costId === item.id)?.landlordAmount ?? 0;
    const tenantCo2 = (item.co2Cost ?? 0) - landlordCo2;
    if (item.key === "heating" && Object.values(item.consumption ?? {}).every((v) => !v)) {
      warnings.push(`„${item.label}“: Für die Heizkostenverteilung fehlen die Verbrauchswerte der Einheiten (§ 7 HeizkostenV).`);
    }
    for (const part of splitItem(item, itemDistributable)) {
      const weights = segments.map((s) => weight(part, s, unitById.get(s.unitId)!));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      if (totalWeight === 0) {
        if (part.amount !== 0) warnings.push(`„${part.label}“ kann nicht verteilt werden (Verteilungsbasis ist 0).`);
        continue;
      }
      segments.forEach((seg, i) => {
        const ratio = weights[i] / totalWeight;
        shares.get(seg)!.push({
          costId: item.id,
          category: item.category,
          label: part.label,
          key: part.key,
          total: part.amount,
          basisTotal: totalWeight / periodDays,
          basisShare: weights[i] / periodDays,
          amount: part.amount * ratio,
          laborAmount: (item.laborCost ?? 0) * part.fraction * ratio,
          laborKind: item.laborKind,
          co2Amount: tenantCo2 * part.fraction * ratio,
        });
      });
    }
  }

  const tenantResults: TenantResult[] = [];
  const vacancies: VacancyResult[] = [];
  for (const seg of segments) {
    const raw = shares.get(seg)!;
    const items = raw.map((s) => ({ ...s, amount: round2(s.amount), laborAmount: round2(s.laborAmount), co2Amount: round2(s.co2Amount) }));
    const totalCosts = round2(items.reduce((a, s) => a + s.amount, 0));
    const unit = unitById.get(seg.unitId)!;
    if (!seg.tenantId) {
      vacancies.push({ unit, start: seg.start, end: seg.end, days: seg.days, amount: totalCosts });
      continue;
    }
    const tenant = tenants.find((t) => t.id === seg.tenantId)!;
    const prepaymentsCalculated = calcPrepayments(tenant, seg.start, seg.end);
    const prepayments = statement.prepaymentOverrides[tenant.id] ?? prepaymentsCalculated.total;
    const labor = (kind: Section35aKind) => round2(raw.filter((s) => s.laborKind === kind).reduce((a, s) => a + s.laborAmount, 0));
    tenantResults.push({
      tenant,
      unit,
      start: seg.start,
      end: seg.end,
      days: seg.days,
      items: items.filter((i) => i.amount !== 0 || i.basisShare !== 0),
      totalCosts,
      prepayments,
      prepaymentsCalculated,
      balance: round2(totalCosts - prepayments),
      labor35a: { service: labor("service"), craftsman: labor("craftsman") },
    });
  }

  const vacancyTotal = vacancies.reduce((a, v) => a + v.amount, 0);
  const co2Total = co2.reduce((a, c) => a + c.landlordAmount, 0);
  return {
    periodDays,
    totalCosts: round2(statement.costs.reduce((a, c) => a + c.amount, 0)),
    tenants: tenantResults,
    vacancies,
    co2,
    landlordShare: round2(vacancyTotal + co2Total),
    warnings,
    deadline: addMonths(periodEnd, 12),
  };
}
