/**
 * Mieterhöhung bis zur ortsüblichen Vergleichsmiete (§ 558 BGB): Sperrfrist, Kappungsgrenze, Vergleichsmiete –
 * und der Text des Erhöhungsverlangens.
 */
import { addMonths, formatDate, fromDay, toDay } from "./dates";
import { rentAt } from "./model";
import type { ISODate, Property, RentReview, Tenant } from "./types";

export interface RentIncreaseCheck {
  /** Staffel- oder Indexmiete: keine Erhöhung nach § 558 */
  excluded: boolean;
  /** letzte Änderung der Kaltmiete (bzw. Mietbeginn) */
  lastChange: ISODate;
  /** frühester Zugang des Erhöhungsverlangens: ein Jahr nach der letzten Erhöhung (§ 558 Abs. 1 S. 2) */
  earliestRequest: ISODate;
  /** frühestes Wirksamwerden: Beginn des dritten Monats nach Zugang, frühestens 15 Monate nach der letzten Änderung */
  effectiveFrom: ISODate;
  area: number;
  /** aktuelle Nettokaltmiete ohne Zuschläge */
  currentRent: number;
  /** Kaltmiete drei Jahre vor dem Wirksamwerden – Basis der Kappungsgrenze */
  baseRent3y: number;
  capPercent: 15 | 20;
  /** höchstens erreichbar nach der Kappungsgrenze (§ 558 Abs. 3) */
  capLimit: number;
  /** Wohnfläche × Vergleichsmiete; null = Vergleichsmiete nicht erfasst */
  comparableLimit: number | null;
  /** neue Miete höchstens; null = ohne Vergleichsmiete nicht bestimmbar */
  maxRent: number | null;
  increase: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const firstOfMonth = (d: ISODate) => `${d.slice(0, 7)}-01`;
/** erster Monatserster am oder nach `d` */
const nextFirst = (d: ISODate) => (d.endsWith("-01") ? d : addMonths(firstOfMonth(d), 1));

export function rentIncreaseCheck(tenant: Tenant, property: Property, today: ISODate, review: RentReview | undefined = tenant.rentReview): RentIncreaseCheck | null {
  const history = [...tenant.rentHistory].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  if (!history.length) return null;
  // Nur Änderungen der Kaltmiete zählen – angepasste Vorauszahlungen lösen keine Sperrfrist aus
  let lastChange = tenant.moveIn > history[0].validFrom ? tenant.moveIn : history[0].validFrom;
  for (let i = 1; i < history.length; i++) if (history[i].coldRent !== history[i - 1].coldRent) lastChange = history[i].validFrom;

  const yearAfter = addMonths(lastChange, 12);
  const earliestRequest = yearAfter > today ? yearAfter : today;
  const byRequest = addMonths(firstOfMonth(earliestRequest), 3);
  const bySperrfrist = nextFirst(addMonths(lastChange, 15));
  const effectiveFrom = byRequest > bySperrfrist ? byRequest : bySperrfrist;

  const currentRent = rentAt(tenant, today)?.coldRent ?? 0;
  const baseRent3y = rentAt(tenant, addMonths(effectiveFrom, -36))?.coldRent ?? currentRent;
  const capPercent = review?.capPercent ?? 20;
  const capLimit = round2(baseRent3y * (1 + capPercent / 100));
  const area = property.units.find((u) => u.id === tenant.unitId)?.area ?? 0;
  const comparableLimit = review?.comparableRentPerSqm && area ? round2(area * review.comparableRentPerSqm) : null;
  const maxRent = comparableLimit === null ? null : Math.min(capLimit, comparableLimit);
  return {
    excluded: !!review?.excluded,
    lastChange,
    earliestRequest,
    effectiveFrom,
    area,
    currentRent,
    baseRent3y,
    capPercent,
    capLimit,
    comparableLimit,
    maxRent,
    increase: maxRent === null ? null : round2(maxRent - currentRent),
  };
}

/** Wirksamwerden bei Zugang an `delivered`, mindestens das früheste Datum laut Prüfung */
export function effectiveAfter(check: RentIncreaseCheck, delivered: ISODate): ISODate {
  const byRequest = addMonths(firstOfMonth(delivered), 3);
  return byRequest > check.effectiveFrom ? byRequest : check.effectiveFrom;
}

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
const num = (n: number, digits = 2) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

/** Erhöhungsverlangen in Textform (§ 558a BGB) – zum Kopieren */
export function rentIncreaseLetter(opts: {
  tenant: Tenant;
  property: Property;
  check: RentIncreaseCheck;
  review: RentReview;
  newRent: number;
  /** geplanter Zugang beim Mieter */
  delivered: ISODate;
  landlordName: string;
}): string {
  const { tenant, property, check, review, newRent, delivered, landlordName } = opts;
  const du = !!tenant.informal;
  const w = (sie: string, duText: string) => (du ? duText : sie);
  const first = tenant.name.split(" ")[0];
  const from = effectiveAfter(check, delivered);
  // Zustimmungsfrist: bis zum Ablauf des zweiten Kalendermonats nach Zugang (§ 558b Abs. 2)
  const consentEnd = formatDate(fromDay(toDay(addMonths(firstOfMonth(delivered), 3)) - 1));
  const r = rentAt(tenant, from);
  const prepayments = (r?.prepaymentOperating ?? 0) + (r?.prepaymentHeating ?? 0);
  const surcharge = r?.surcharge ?? 0;
  const unit = property.units.find((u) => u.id === tenant.unitId);
  const perSqm = check.area ? newRent / check.area : 0;
  return [
    `Mieterhöhung für die Wohnung ${[unit?.name, property.address.replace(/\s*\n\s*/g, ", ")].filter(Boolean).join(", ")}`,
    "",
    du ? `Hallo ${first},` : `Guten Tag ${tenant.name},`,
    "",
    `${w("Ihre", "deine")} Nettokaltmiete beträgt seit dem ${formatDate(check.lastChange)} unverändert ${eur(check.currentRent)} im Monat. ` +
      `Nach § 558 BGB bitte ich ${w("Sie", "dich")}, einer Erhöhung der Nettokaltmiete auf ${eur(newRent)} ` +
      `(+ ${eur(round2(newRent - check.currentRent))}) mit Wirkung ab dem ${formatDate(from)} zuzustimmen.`,
    "",
    "Begründung:",
    `Die ortsübliche Vergleichsmiete für vergleichbare Wohnungen nach Art, Größe, Ausstattung, Beschaffenheit und Lage beträgt ` +
      `${review.comparableRentPerSqm ? `${num(review.comparableRentPerSqm)} € je m²` : "–"}${review.source ? ` (${review.source})` : ""}. ` +
      `Bei ${num(check.area)} m² Wohnfläche ergibt das ${check.comparableLimit !== null ? eur(check.comparableLimit) : "–"} im Monat. ` +
      `Die verlangte Miete entspricht ${num(perSqm)} € je m² und liegt damit nicht über der Vergleichsmiete.`,
    `Die Miete steigt innerhalb von drei Jahren um nicht mehr als ${check.capPercent} % (Kappungsgrenze, § 558 Abs. 3 BGB): ` +
      `Ausgangsmiete ${eur(check.baseRent3y)}, Grenze ${eur(check.capLimit)}.`,
    "",
    `Die Vorauszahlungen auf die Betriebs- und Heizkosten (${eur(prepayments)})${surcharge ? ` und der Zuschlag (${eur(surcharge)})` : ""} bleiben unverändert. ` +
      `Die Gesamtmiete beträgt ab dem ${formatDate(from)} damit ${eur(round2(newRent + prepayments + surcharge))} im Monat.`,
    "",
    `${w("Bitte teilen Sie mir", "Bitte teile mir")} bis zum ${consentEnd} in Textform mit, ob ${w("Sie", "du")} der Erhöhung ${w("zustimmen", "zustimmst")}. ` +
      `Eine kurze E-Mail oder ${w("Ihre", "deine")} Unterschrift unter dieses Schreiben genügt.`,
    "",
    du ? "Viele Grüße" : "Freundliche Grüße",
    landlordName,
    "",
    "",
    `Ich stimme der Erhöhung der Nettokaltmiete auf ${eur(newRent)} ab dem ${formatDate(from)} zu.`,
    "",
    "____________________________",
    `Datum, Unterschrift ${tenant.name}`,
  ].join("\n");
}
