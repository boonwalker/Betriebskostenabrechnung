import { categoryLabel, isHeatingCategory } from "./betrkv";
import { co2Stage } from "./co2";
import { addMonths, daysInclusive, fromDay, intersect, toDay } from "./dates";
import { allocate, fromCents, sumEuro, toCents, type Cents } from "./money";
import { degreeDays } from "./degreeDays";
import { segmentConsumption } from "./meters";
import { agreementFor } from "./lease";
import type { CostItem, ISODate, LeaseAllocationRule, Property, Section35aKind, Statement, Tenant, Unit } from "./types";

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
export type DistributionKey =
  | "area"
  | "persons"
  | "units"
  | "consumption"
  | "direct"
  /** Heizkosten beim Nutzerwechsel (§ 9b HeizkostenV): nach Zeit, Gradtagzahlen oder Zwischenablesung */
  | "time"
  | "degreedays"
  | "reading";

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
  /** gesetzt, wenn basisTotal/basisShare Rohwerte in dieser Einheit sind (z. B. ‰, Tage, kWh) */
  basisUnit?: string;
}

/** Kosten, die beim Vermieter bleiben (außer Leerstand) */
export interface LandlordItem {
  costId: string;
  label: string;
  amount: number;
  reason: string;
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
  /** weitere Kosten beim Vermieter: nicht vereinbarte Kosten, Differenz Vertragsschlüssel */
  landlordItems: LandlordItem[];
  /** Kosten, die beim Vermieter verbleiben: Leerstand + Vermieteranteil CO2 + landlordItems */
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
  /** zu verteilender Betrag, darin enthaltene § 35a-Arbeitskosten und Mieteranteil CO2 – in Cent */
  amount: Cents;
  labor: Cents;
  co2: Cents;
}

function splitItem(item: CostItem, amount: Cents, labor: Cents, co2: Cents): Part[] {
  const label = item.label || categoryLabel(item.category);
  if (item.key !== "heating") return [{ item, label, key: item.key, amount, labor, co2 }];
  const share = Math.min(70, Math.max(50, item.consumptionShare ?? 70));
  const ratio = [100 - share, share];
  const [a, l, c] = [allocate(amount, ratio), allocate(labor, ratio), allocate(co2, ratio)];
  return [
    { item, label: `${label} – Grundkosten (${100 - share} %)`, key: "area", amount: a[0], labor: l[0], co2: c[0] },
    { item, label: `${label} – Verbrauchskosten (${share} %)`, key: "consumption", amount: a[1], labor: l[1], co2: c[1] },
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
    default:
      // time/degreedays/reading werden nur für Heizkosten beim Nutzerwechsel gesondert verteilt
      return seg.days;
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
  return { operating, heating, total: sumEuro([operating, heating]) };
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
  const distributable = new Map<string, Cents>();
  for (const item of statement.costs) {
    let amount = toCents(item.amount);
    if (item.co2Cost && item.co2Cost > 0) {
      // Stufe nach CO2-Ausstoß des Gebäudes je m² Wohnfläche des Gebäudes – bei WEG die Gesamtfläche
      const co2Area = property.type === "etw" && property.wegAreaTotal ? property.wegAreaTotal : totalArea;
      if (!item.co2Kg || co2Area === 0) {
        warnings.push(`„${item.label}“: Für die CO2-Kostenaufteilung fehlt der CO2-Ausstoß in kg. Ohne Angabe trägt der Mieter die CO2-Kosten voll – das ist nur bei Stufe 1 korrekt.`);
      } else {
        const kgPerM2Year = (item.co2Kg / co2Area) * (365 / periodDays);
        const stage = co2Stage(kgPerM2Year);
        const landlordCents = Math.round((toCents(item.co2Cost) * stage.landlordPct) / 100);
        const landlordAmount = fromCents(landlordCents);
        amount -= landlordCents;
        co2.push({ costId: item.id, label: item.label, co2Cost: item.co2Cost, co2Kg: item.co2Kg, kgPerM2Year, stage: stage.stage, landlordPct: stage.landlordPct, landlordAmount });
      }
    }
    if (item.laborCost && item.laborCost > item.amount) warnings.push(`„${item.label}“: Die Arbeitskosten nach § 35a sind höher als der Betrag.`);
    distributable.set(item.id, amount);
  }

  const shares = new Map<Segment, ItemShare[]>(segments.map((s) => [s, []]));
  const landlordItems: LandlordItem[] = [];
  const tenantOf = (seg: Segment) => (seg.tenantId ? tenants.find((t) => t.id === seg.tenantId) : undefined);

  for (const item of statement.costs) {
    const itemDistributable = distributable.get(item.id)!;
    const landlordCo2 = toCents(co2.find((c) => c.costId === item.id)?.landlordAmount ?? 0);
    const tenantCo2 = toCents(item.co2Cost ?? 0) - landlordCo2;
    const label = item.label || categoryLabel(item.category);
    const unitSegs = item.key === "direct" ? segments.filter((s) => s.unitId === item.directUnitId) : [];
    if (item.key === "heating" && Object.values(item.consumption ?? {}).every((v) => !v)) {
      warnings.push(`„${item.label}“: Für die Heizkostenverteilung fehlen die Verbrauchswerte der Einheiten (§ 7 HeizkostenV).`);
    }

    // Mieter, mit denen diese Kostenart nicht vereinbart ist: Ihr Anteil bleibt beim Vermieter
    const notAgreed = (seg: Segment) => {
      const lease = tenantOf(seg)?.lease;
      return !!lease && agreementFor(item.label, item.category, lease).status === "not_agreed";
    };

    /** verteilt Centbeträge auf Abschnitte und bucht nicht vereinbarte Anteile zum Vermieter */
    const book = (
      segs: Segment[],
      amounts: Cents[],
      labor: Cents[],
      co2Shares: Cents[],
      display: { label: string; key: DistributionKey; total: Cents; basisTotal: number; basis: number[]; basisUnit?: string },
    ) => {
      segs.forEach((seg, i) => {
        if (amounts[i] !== 0 && notAgreed(seg)) {
          landlordItems.push({ costId: item.id, label: display.label, amount: fromCents(amounts[i]), reason: `mit ${tenantOf(seg)!.name} nicht vereinbart` });
          return;
        }
        shares.get(seg)!.push({
          costId: item.id,
          category: item.category,
          label: display.label,
          key: display.key,
          total: fromCents(display.total),
          basisTotal: display.basisTotal,
          basisShare: display.basis[i],
          basisUnit: display.basisUnit,
          amount: fromCents(amounts[i]),
          laborAmount: fromCents(labor[i]),
          laborKind: item.laborKind,
          co2Amount: fromCents(co2Shares[i]),
        });
      });
    };

    // 1. Heizkosten einer Wohnung mit Nutzerwechsel: Bestandteile nach § 9b HeizkostenV
    if (item.key === "direct" && item.heatingParts && unitSegs.length > 1) {
      const hp = item.heatingParts;
      const parts = allocate(itemDistributable, [hp.baseHeating, hp.consumptionHeating, hp.baseWater, hp.consumptionWater].map(toCents));
      const days = unitSegs.map((sg) => sg.days);
      const heatReadings = segmentConsumption(statement, item.directUnitId!, unitSegs, "heating");
      const waterReadings = segmentConsumption(statement, item.directUnitId!, unitSegs, "water");
      const complete = (k: "heating" | "water") => (k === "heating" ? heatReadings : waterReadings) !== null;
      const heatW = heatReadings ?? unitSegs.map((sg) => degreeDays(sg.start, sg.end));
      const waterW = waterReadings ?? days;
      const defs: { name: string; amount: Cents; w: number[]; key: DistributionKey; unit: string }[] = [
        { name: "Grundkosten Heizung (nach Zeit)", amount: parts[0], w: days, key: "time", unit: "Tage" },
        complete("heating")
          ? { name: "Verbrauchskosten Heizung (Zwischenablesung)", amount: parts[1], w: heatW, key: "reading", unit: "Einh." }
          : { name: "Verbrauchskosten Heizung (Gradtagzahlen, § 9b HeizkostenV)", amount: parts[1], w: heatW, key: "degreedays", unit: "‰" },
        { name: "Grundkosten Warmwasser (nach Zeit)", amount: parts[2], w: days, key: "time", unit: "Tage" },
        complete("water")
          ? { name: "Verbrauchskosten Warmwasser (Zwischenablesung)", amount: parts[3], w: waterW, key: "reading", unit: "Einh." }
          : { name: "Verbrauchskosten Warmwasser (nach Zeit, § 9b HeizkostenV)", amount: parts[3], w: waterW, key: "time", unit: "Tage" },
      ];
      if (!complete("heating")) {
        warnings.push(
          `„${label}“: Ohne Zwischenablesung beim Nutzerwechsel werden die Verbrauchskosten Heizung nach Gradtagzahlen, Warmwasser nach Zeit aufgeteilt (§ 9b Abs. 2 HeizkostenV). Liegt eine Ablesung vor, trage die Werte bei den Mietern ein.`,
        );
      }
      const laborParts = allocate(toCents(item.laborCost ?? 0), parts);
      const co2Parts = allocate(tenantCo2, parts);
      defs.forEach((d, k) => {
        const total = d.w.reduce((a, b) => a + b, 0);
        if (total === 0) return;
        book(unitSegs, allocate(d.amount, d.w), allocate(laborParts[k], d.w), allocate(co2Parts[k], d.w), {
          label: `${label} – ${d.name}`,
          key: d.key,
          total: d.amount,
          basisTotal: total,
          basis: d.w,
          basisUnit: d.unit,
        });
      });
      continue;
    }

    // 2. Anteil der Wohnung, der je Mietvertrag nach unterschiedlichem Maßstab ermittelt wird
    if (item.key === "direct" && unitSegs.length > 0) {
      // Kaltwasser/Abwasser nach Verbrauch: bei Nutzerwechsel nach Zählerständen statt nach Tagen
      const isColdWater = /cbm|m³|m3/i.test(item.basis?.unit ?? "") || /cbm|m³|m3/i.test(item.leaseAmounts?.weg?.basis?.unit ?? "");
      const water = isColdWater && unitSegs.length > 1 ? segmentConsumption(statement, item.directUnitId!, unitSegs, "coldWater") : null;
      const days = water ?? unitSegs.map((sg) => sg.days);
      const byRule = new Map<string, Cents[]>();
      const amountFor = (rule: LeaseAllocationRule) => {
        if (!byRule.has(rule)) {
          const la = item.leaseAmounts?.[rule];
          byRule.set(rule, allocate(la ? toCents(la.amount) : itemDistributable, days));
        }
        return byRule.get(rule)!;
      };
      const amounts = unitSegs.map((sg, i) => amountFor(tenantOf(sg)?.lease?.allocationRule ?? "weg")[i]);
      const diff = itemDistributable - amounts.reduce((a, b) => a + b, 0);
      if (diff !== 0) landlordItems.push({ costId: item.id, label, amount: fromCents(diff), reason: "Differenz zwischen WEG-Schlüssel und Umlagemaßstab des Mietvertrags" });
      book(unitSegs, amounts, allocate(toCents(item.laborCost ?? 0), days), allocate(tenantCo2, days), {
        label: water ? `${label} (Zwischenablesung)` : label,
        key: water ? "reading" : "direct",
        total: itemDistributable,
        basisTotal: water ? water.reduce((a, b) => a + b, 0) : periodDays,
        basis: days,
        basisUnit: water ? "m³" : undefined,
      });
      if (isColdWater && unitSegs.length > 1 && !water) {
        warnings.push(`„${label}“: Beim Nutzerwechsel wird nach Tagen aufgeteilt. Mit den Kaltwasser-Zählerständen zum Wechseltag wird nach Verbrauch verteilt.`);
      }
      if (isHeatingCategory(item.category) && unitSegs.length > 1) {
        warnings.push(`„${label}“: Bei Nutzerwechsel ist eine Zwischenablesung nötig (§ 9b HeizkostenV). Ohne sie wird hier nur zeitanteilig aufgeteilt.`);
      }
      continue;
    }

    // 3. Regelfall: Verteilung nach Schlüssel über alle Abschnitte des Objekts
    if (isHeatingCategory(item.category) && (item.key === "direct" || item.key === "area")) {
      const unitsWithChange = units.filter((u) => segments.filter((s) => s.unitId === u.id).length > 1);
      if (unitsWithChange.length && !(item.key === "direct" && unitSegs.length <= 1)) {
        warnings.push(
          `„${item.label}“: Bei Mieterwechsel oder Leerstand in ${unitsWithChange.map((u) => u.name).join(", ")} ist eine Zwischenablesung nötig (§ 9b HeizkostenV). Ohne sie wird hier nur zeitanteilig aufgeteilt.`,
        );
      }
    }
    for (const part of splitItem(item, itemDistributable, toCents(item.laborCost ?? 0), tenantCo2)) {
      const weights = segments.map((s) => weight(part, s, unitById.get(s.unitId)!));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      if (totalWeight === 0) {
        if (part.amount !== 0) warnings.push(`„${part.label}“ kann nicht verteilt werden (Verteilungsbasis ist 0).`);
        continue;
      }
      // Cent-genaue Verteilung: Die Anteile ergeben exakt den Betrag der Position
      book(segments, allocate(part.amount, weights), allocate(part.labor, weights), allocate(part.co2, weights), {
        label: part.label,
        key: part.key,
        total: part.amount,
        basisTotal: totalWeight / periodDays,
        basis: weights.map((w) => w / periodDays),
      });
    }
  }

  const tenantResults: TenantResult[] = [];
  const vacancies: VacancyResult[] = [];
  for (const seg of segments) {
    const items = shares.get(seg)!;
    const totalCosts = sumEuro(items.map((s) => s.amount));
    const unit = unitById.get(seg.unitId)!;
    if (!seg.tenantId) {
      vacancies.push({ unit, start: seg.start, end: seg.end, days: seg.days, amount: totalCosts });
      continue;
    }
    const tenant = tenants.find((t) => t.id === seg.tenantId)!;
    const prepaymentsCalculated = calcPrepayments(tenant, seg.start, seg.end);
    const prepayments = statement.prepaymentOverrides[tenant.id] ?? prepaymentsCalculated.total;
    const labor = (kind: Section35aKind) => sumEuro(items.filter((s) => s.laborKind === kind).map((s) => s.laborAmount));
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
      balance: fromCents(toCents(totalCosts) - toCents(prepayments)),
      labor35a: { service: labor("service"), craftsman: labor("craftsman") },
    });
  }

  const vacancyTotal = sumEuro(vacancies.map((v) => v.amount));
  const co2Total = sumEuro(co2.map((c) => c.landlordAmount));
  const extraTotal = sumEuro(landlordItems.map((x) => x.amount));
  return {
    periodDays,
    totalCosts: sumEuro(statement.costs.map((c) => c.amount)),
    tenants: tenantResults,
    vacancies,
    co2,
    landlordItems,
    landlordShare: sumEuro([vacancyTotal, co2Total, extraTotal]),
    warnings,
    deadline: addMonths(periodEnd, 12),
  };
}
