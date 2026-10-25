/**
 * Nach dem Versand: Zugang des Anschreibens, Zahlungsfrist, Einwendungsfrist und Zahlungseingang je Mieter –
 * und die Fristen aller Objekte für die Übersicht auf der Startseite.
 */
import { addMonths, formatDate, fromDay, toDay, todayISO } from "./dates";
import { releasedTenant } from "./release";
import { rentIncreaseCheck } from "./rentIncrease";
import type { AppData, DeliveryMethod, ISODate, Statement, Tenant } from "./types";

export const DELIVERY_LABELS: Record<DeliveryMethod, string> = {
  brief: "Brief",
  einwurf: "Einwurf-Einschreiben",
  einschreiben: "Einschreiben mit Rückschein",
  persoenlich: "persönlich übergeben",
  email: "E-Mail",
};

/** letzter Tag des Monats, in dem `d` liegt, plus `months` Monate */
export function endOfMonth(d: ISODate, months = 0): ISODate {
  const first = addMonths(`${d.slice(0, 7)}-01`, months + 1);
  return fromDay(toDay(first) - 1);
}

/**
 * Fälligkeit des Ergebnisses ab Zugang: laut Vertrag bis Ende des Folgemonats, sonst nach 30 Tagen
 * (Prüfungsfrist des Mieters, BGH VIII ZR 133/04).
 */
export function paymentDue(delivered: ISODate, term: "30days" | "endOfNextMonth" = "30days"): ISODate {
  return term === "endOfNextMonth" ? endOfMonth(delivered, 1) : fromDay(toDay(delivered) + 30);
}

/** Einwendungen des Mieters bis zum Ablauf des zwölften Monats nach Zugang (§ 556 Abs. 3 S. 5 BGB) */
export const objectionDeadline = (delivered: ISODate) => endOfMonth(delivered, 12);

/** Abrechnung muss bis zum Ablauf des zwölften Monats nach Ende des Zeitraums zugehen (§ 556 Abs. 3 S. 2 BGB) */
export const statementDeadline = (st: Pick<Statement, "periodEnd">) => endOfMonth(st.periodEnd, 12);

export interface TenantFollowUp {
  tenantId: string;
  name: string;
  /** > 0 Nachzahlung des Mieters, < 0 Guthaben */
  balance: number;
  deliveredOn: ISODate | null;
  /** zu spät zugegangen: Nachforderung in der Regel ausgeschlossen */
  late: boolean;
  due: ISODate | null;
  objectionsUntil: ISODate | null;
  settledOn: ISODate | null;
  overdue: boolean;
}

/** Stand nach dem Versand für alle freigegebenen Mietverhältnisse einer Abrechnung */
export function followUps(statement: Statement, data: AppData, today: ISODate): TenantFollowUp[] {
  return Object.keys(statement.releases).flatMap((tenantId) => {
    const r = releasedTenant(statement, tenantId);
    if (!r) return [];
    const tenant = data.tenants.find((t) => t.id === tenantId);
    const d = statement.delivery?.[tenantId] ?? null;
    const balance = r.result.balance;
    const due = d && Math.abs(balance) >= 0.01 ? paymentDue(d.date, tenant?.lease?.paymentTerm ?? "30days") : null;
    const settledOn = statement.settled?.[tenantId] ?? null;
    return [
      {
        tenantId,
        name: tenant?.name ?? r.result.tenant.name,
        balance,
        deliveredOn: d?.date ?? null,
        late: !!d && d.date > statementDeadline(statement),
        due,
        objectionsUntil: d ? objectionDeadline(d.date) : null,
        settledOn,
        overdue: !!due && !settledOn && due < today,
      },
    ];
  });
}

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

/** Zahlungserinnerung an den Mieter (Nachzahlung) – zum Kopieren */
export function reminderText(f: TenantFollowUp, tenant: Tenant | undefined, statement: Statement, landlordName: string, iban: string, today = todayISO()): string {
  const du = !!tenant?.informal;
  const w = (sie: string, duText: string) => (du ? duText : sie);
  const first = tenant?.name.split(" ")[0] ?? "";
  const year = statement.periodStart.slice(0, 4);
  return [
    du ? `Hallo ${first},` : `Guten Tag ${tenant?.name ?? ""},`,
    "",
    `mit der Betriebskostenabrechnung ${year}, die ${w("Ihnen", "dir")} am ${formatDate(f.deliveredOn)} zugegangen ist, ergab sich eine Nachzahlung von ${eur(f.balance)}. ` +
      `Sie war bis zum ${formatDate(f.due)} fällig; ein Zahlungseingang ist bei mir bisher nicht verbucht.`,
    "",
    `${w("Bitte überweisen Sie", "Bitte überweise")} den Betrag bis zum ${formatDate(fromDay(Math.max(toDay(f.due ?? today), toDay(today)) + 14))}` +
      `${iban ? ` auf das Konto IBAN ${iban.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ")}` : ""} unter Angabe des Verwendungszwecks „Betriebskosten ${year}“. ` +
      `${w("Sollten Sie", "Solltest du")} inzwischen gezahlt haben, ${w("betrachten Sie", "betrachte")} dieses Schreiben bitte als gegenstandslos.`,
    "",
    du ? "Viele Grüße" : "Freundliche Grüße",
    landlordName,
  ].join("\n");
}

export interface Deadline {
  date: ISODate;
  title: string;
  detail?: string;
  href: string;
  /** überfällig, in den nächsten 30 Tagen, später */
  level: "overdue" | "soon" | "later";
  /** keine Frist im engeren Sinn, sondern eine Möglichkeit (z. B. Mieterhöhung) – nie dringend */
  optional?: boolean;
}

/** Alle anstehenden Fristen über alle Objekte, nach Datum sortiert */
export function collectDeadlines(data: AppData, today: ISODate): Deadline[] {
  const out: Omit<Deadline, "level">[] = [];
  const thisYear = Number(today.slice(0, 4));

  for (const p of data.properties) {
    const tenants = data.tenants.filter((t) => t.propertyId === p.id && !t.landlord);
    const allTenants = data.tenants.filter((t) => t.propertyId === p.id);
    // Abrechnungen der letzten beiden Jahre: zustellen bis Ende des Folgejahres
    for (const year of [thisYear - 2, thisYear - 1]) {
      const start = `${year}-01-01`, end = `${year}-12-31`;
      const rented = allTenants.filter((t) => t.moveIn <= end && (!t.moveOut || t.moveOut >= start));
      if (!rented.length) continue;
      const st = data.statements.find((s) => s.propertyId === p.id && s.periodStart.startsWith(String(year)));
      const deadline = st ? statementDeadline(st) : `${year + 1}-12-31`;
      const open = rented.filter((t) => !st?.delivery?.[t.id]);
      if (!open.length || deadline < `${thisYear - 1}-12-31`) continue;
      out.push({
        date: deadline,
        title: `Betriebskostenabrechnung ${year} zustellen`,
        detail: `${p.name}: ${open.map((t) => t.name).join(", ")}`,
        href: st ? `#/abrechnungen/${st.id}` : "#/abrechnungen",
      });
    }
    // Zahlungen und Einwendungsfristen aus zugestellten Abrechnungen
    for (const st of data.statements.filter((s) => s.propertyId === p.id)) {
      for (const f of followUps(st, data, today)) {
        if (f.due && !f.settledOn && Math.abs(f.balance) >= 0.01)
          out.push({
            date: f.due,
            title: f.balance > 0 ? `Nachzahlung ${f.name}: ${eur(f.balance)} fällig` : `Guthaben an ${f.name} auszahlen: ${eur(-f.balance)}`,
            detail: `Betriebskosten ${st.periodStart.slice(0, 4)}`,
            href: `#/abrechnungen/${st.id}`,
          });
        if (f.objectionsUntil && f.objectionsUntil >= today)
          out.push({
            date: f.objectionsUntil,
            title: `Einwendungsfrist ${f.name} endet`,
            detail: `Betriebskosten ${st.periodStart.slice(0, 4)}`,
            href: `#/abrechnungen/${st.id}`,
          });
      }
    }
    // Zinsbindung der Darlehen
    for (const l of p.loans) {
      if (l.fixedUntil && l.fixedUntil >= today && l.fixedUntil <= addMonths(today, 36))
        out.push({ date: l.fixedUntil, title: `Zinsbindung ${l.lender || "Darlehen"} endet`, detail: p.name, href: `#/objekte/${p.id}` });
    }
    // Mieterhöhung: ab wann ein Erhöhungsverlangen frühestens zugehen darf
    for (const t of tenants.filter((x) => !x.moveOut || x.moveOut > today)) {
      const c = rentIncreaseCheck(t, p, today);
      if (!c || c.excluded) continue;
      out.push({
        date: c.earliestRequest,
        title: `Mieterhöhung ${t.name} möglich`,
        detail: c.maxRent !== null && c.maxRent > c.currentRent ? `bis ${eur(c.maxRent)} kalt, wirksam ab ${formatDate(c.effectiveFrom)}` : `${c.earliestRequest <= today ? "Erhöhungsverlangen jederzeit" : "Erhöhungsverlangen ab diesem Tag"}, wirksam frühestens ab ${formatDate(c.effectiveFrom)} – Vergleichsmiete prüfen`,
        href: `#/mieter?t=${t.id}`,
        optional: true,
      });
    }
  }
  const soon = fromDay(toDay(today) + 30);
  return out
    .map((d) => ({ ...d, level: (d.optional ? "later" : d.date < today ? "overdue" : d.date <= soon ? "soon" : "later") as Deadline["level"] }))
    // Möglichkeiten, die schon bestehen (z. B. Mieterhöhung), stehen hinter den echten Fristen
    .sort((a, b) => Number(!!a.optional && a.date <= today) - Number(!!b.optional && b.date <= today) || a.date.localeCompare(b.date));
}
