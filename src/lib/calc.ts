import { categoryLabel } from "./betrkv";
import { addMonths, daysInclusive, fromDay, intersect, toDay } from "./dates";
import type { AllocationKey, CostItem, ISODate, Property, Statement, Tenant, Unit } from "./types";

/** Belegungsabschnitt einer Einheit: ein Mieter oder Leerstand (tenantId = null) */
export interface Segment {
  unitId: string;
  tenantId: string | null;
  start: ISODate;
  end: ISODate;
  days: number;
  persons: number;
}

export interface ItemShare {
  costId: string;
  category: number;
  label: string;
  key: AllocationKey;
  /** Gesamtkosten der Position */
  total: number;
  /** Gesamtbasis des Schlüssels, z. B. 250 m² */
  basisTotal: number;
  /** Anteil an der Basis, zeitanteilig, z. B. 75 m² */
  basisShare: number;
  amount: number;
}

export interface TenantResult {
  tenant: Tenant;
  unit: Unit;
  start: ISODate;
  end: ISODate;
  days: number;
  items: ItemShare[];
  totalCosts: number;
  prepayments: number;
  prepaymentsCalculated: number;
  /** > 0: Nachzahlung des Mieters, < 0: Guthaben des Mieters */
  balance: number;
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
  totalCosts: number;
  tenants: TenantResult[];
  vacancies: VacancyResult[];
  /** Kosten, die mangels Mieter beim Vermieter verbleiben */
  landlordShare: number;
  warnings: string[];
  /** Spätester Zugang der Abrechnung beim Mieter (§ 556 Abs. 3 BGB) */
  deadline: ISODate;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Zerlegt den Abrechnungszeitraum je Einheit in Mieter- und Leerstandsabschnitte */
export function buildSegments(
  units: Unit[],
  tenants: Tenant[],
  periodStart: ISODate,
  periodEnd: ISODate,
): Segment[] {
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

/** Gewicht eines Abschnitts für eine Kostenposition, in "Basis × Tage" */
function weight(item: CostItem, seg: Segment, unit: Unit): number {
  switch (item.key) {
    case "area":
      return unit.area * seg.days;
    case "persons":
      return seg.persons * seg.days;
    case "units":
      return seg.days;
    case "consumption":
      return (item.consumption?.[unit.id] ?? 0) * seg.days;
    case "direct":
      return item.directUnitId === unit.id ? seg.days : 0;
  }
}

/** Vorauszahlungen eines Mieters im Zeitraum: Monatsbetrag anteilig je Kalendermonat */
export function calcPrepayments(tenant: Tenant, start: ISODate, end: ISODate): number {
  let sum = 0;
  let monthStart = start.slice(0, 8) + "01";
  while (toDay(monthStart) <= toDay(end)) {
    const nextMonth = addMonths(monthStart, 1);
    const monthEnd = fromDay(toDay(nextMonth) - 1);
    const overlap = intersect(monthStart, monthEnd, start, end);
    if (overlap) {
      sum += (tenant.monthlyPrepayment * daysInclusive(overlap.start, overlap.end)) / daysInclusive(monthStart, monthEnd);
    }
    monthStart = nextMonth;
  }
  return round2(sum);
}

export function calculateStatement(statement: Statement, property: Property, allTenants: Tenant[]): StatementResult {
  const { periodStart, periodEnd } = statement;
  const periodDays = daysInclusive(periodStart, periodEnd);
  const units = property.units;
  const unitById = new Map(units.map((u) => [u.id, u]));
  const tenants = allTenants.filter((t) => t.propertyId === property.id);
  const segments = buildSegments(units, tenants, periodStart, periodEnd);
  const warnings: string[] = [];

  if (periodDays > 366) warnings.push("Der Abrechnungszeitraum darf höchstens 12 Monate umfassen (§ 556 Abs. 3 BGB).");
  if (units.length === 0) warnings.push("Das Objekt hat noch keine Wohneinheiten.");

  for (const unit of units) {
    const unitSegs = segments.filter((s) => s.unitId === unit.id && s.tenantId);
    const occupiedDays = unitSegs.reduce((a, s) => a + s.days, 0);
    if (occupiedDays > periodDays) warnings.push(`Überschneidende Mietverhältnisse in „${unit.name}“ – bitte Ein-/Auszugsdaten prüfen.`);
  }

  // Anteile je Abschnitt und Position
  const shares = new Map<Segment, ItemShare[]>(segments.map((s) => [s, []]));
  for (const item of statement.costs) {
    const weights = segments.map((s) => weight(item, s, unitById.get(s.unitId)!));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
      if (item.amount !== 0) warnings.push(`„${item.label}“ kann nicht verteilt werden (Verteilungsbasis ist 0).`);
      continue;
    }
    segments.forEach((seg, i) => {
      shares.get(seg)!.push({
        costId: item.id,
        category: item.category,
        label: item.label || categoryLabel(item.category),
        key: item.key,
        total: item.amount,
        basisTotal: totalWeight / periodDays,
        basisShare: weights[i] / periodDays,
        amount: (item.amount * weights[i]) / totalWeight,
      });
    });
  }

  const tenantResults: TenantResult[] = [];
  const vacancies: VacancyResult[] = [];
  for (const seg of segments) {
    const items = shares.get(seg)!.map((s) => ({ ...s, amount: round2(s.amount) }));
    const totalCosts = round2(items.reduce((a, s) => a + s.amount, 0));
    const unit = unitById.get(seg.unitId)!;
    if (!seg.tenantId) {
      vacancies.push({ unit, start: seg.start, end: seg.end, days: seg.days, amount: totalCosts });
      continue;
    }
    const tenant = tenants.find((t) => t.id === seg.tenantId)!;
    const prepaymentsCalculated = calcPrepayments(tenant, seg.start, seg.end);
    const override = statement.prepaymentOverrides[tenant.id];
    const prepayments = override ?? prepaymentsCalculated;
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
    });
  }

  const totalCosts = round2(statement.costs.reduce((a, c) => a + c.amount, 0));
  return {
    periodDays,
    totalCosts,
    tenants: tenantResults,
    vacancies,
    landlordShare: round2(vacancies.reduce((a, v) => a + v.amount, 0)),
    warnings,
    deadline: addMonths(periodEnd, 12),
  };
}
