import { calculateStatement, type Co2Result, type TenantResult } from "./calc";
import { formatDate } from "./dates";
import type { AppData, Statement, Tenant } from "./types";
import { agreementFor } from "./lease";
import { estimatePropertyTax } from "./propertyTax";
import { checkAnnual } from "./weg";

/** Vermieter eines Mietverhältnisses: abweichend am Mieter hinterlegt oder aus den Einstellungen */
export const landlordFor = (tenant: Tenant, data: AppData) => tenant.landlord ?? data.settings.landlord;

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export interface TenantReadiness {
  tenantId: string;
  name: string;
  /** nur dieses Mietverhältnis betreffend */
  blockers: string[];
  hints: string[];
  /** freigabefähig: keine allgemeinen und keine eigenen Blocker */
  ready: boolean;
}

export interface Readiness {
  /** Blocker, die alle Mietverhältnisse betreffen (Kosten, WEG-Abrechnung …) */
  general: string[];
  generalHints: string[];
  tenants: TenantReadiness[];
  /** alle Blocker und Hinweise zusammen */
  blockers: string[];
  hints: string[];
  /** alle Mietverhältnisse freigabefähig */
  ready: boolean;
}

const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * Prüft, ob eine Mieterabrechnung versandfertig ist – getrennt nach allgemeinen Punkten und je
 * Mietverhältnis, damit z. B. das Anschreiben an den neuen Mieter nicht auf fehlende Angaben
 * zum Vormieter warten muss. Solange Blocker bestehen, ist das Ergebnis nur vorläufig.
 */
export function statementReadiness(statement: Statement, data: AppData): Readiness {
  const general: string[] = [];
  const generalHints: string[] = [];
  const property = data.properties.find((p) => p.id === statement.propertyId);
  if (!property) return { general: ["Objekt nicht gefunden."], generalHints: [], tenants: [], blockers: ["Objekt nicht gefunden."], hints: [], ready: false };
  const year = Number(statement.periodStart.slice(0, 4));
  const result = calculateStatement(statement, property, data.tenants);

  if (statement.costs.length === 0) general.push("Es sind keine Ist-Kosten erfasst.");

  // Eigentumswohnung: Ist-Kosten kommen aus der WEG-Jahresabrechnung
  if (property.type === "etw") {
    for (const unit of property.units) {
      const annual = data.wegAnnuals.find((a) => a.propertyId === property.id && a.unitId === unit.id && a.year === year);
      if (!annual) {
        general.push(`Die WEG-Jahresabrechnung ${year} für ${unit.name} fehlt (Ist-Kosten). Ein Wirtschaftsplan ersetzt sie nicht.`);
        continue;
      }
      for (const f of checkAnnual(annual)) if (f.level === "error") general.push(`WEG-Jahresabrechnung ${year}: ${f.text}`);
      const open = annual.positions.filter((p) => p.classification === "review");
      if (open.length) general.push(`${open.length} Position(en) der WEG-Jahresabrechnung ${year} sind noch als „Prüfung erforderlich“ markiert: ${open.map((p) => p.label).join(", ")}.`);
      const unreviewed = annual.positions.filter((p) => p.classification === "allocable" && !p.reviewed);
      if (unreviewed.length) general.push(`${unreviewed.length} umlagefähige Position(en) der WEG-Jahresabrechnung ${year} sind noch nicht als geprüft bestätigt.`);
      const transferred = new Set(statement.costs.map((c) => c.sourcePositionId));
      const missing = annual.positions.filter(
        (p) => p.classification === "allocable" && p.reviewed && p.heating !== "component" && p.amount !== 0 && !transferred.has(p.id),
      );
      if (missing.length) generalHints.push(`Noch nicht übernommen: ${missing.map((p) => p.label).join(", ")}.`);
    }
  }

  // Übernommene Beträge müssen noch zur Quelle passen
  for (const c of statement.costs) {
    if (!c.sourcePositionId) {
      if (!c.source) generalHints.push(`„${c.label}“ ist manuell erfasst und hat keinen Beleg.`);
      continue;
    }
    const annual = data.wegAnnuals.find((a) => a.id === c.sourceAnnualId);
    const pos = annual?.positions.find((p) => p.id === c.sourcePositionId);
    if (!pos) general.push(`„${c.label}“: Die Quellposition in der WEG-Jahresabrechnung existiert nicht mehr.`);
    else if (pos.amount !== (c.sourceAmount ?? c.amount))
      general.push(`„${c.label}“: Die WEG-Jahresabrechnung wurde geändert (jetzt ${eur(pos.amount)}). Bitte die Position neu übernehmen.`);
    else if (pos.classification !== "allocable") general.push(`„${c.label}“ ist in der WEG-Jahresabrechnung nicht mehr als umlagefähig bewertet.`);
  }

  // Grundsteuer gegen Schätzung aus Grundsteuerwert und Hebesatz prüfen
  const est = estimatePropertyTax(property);
  const taxItems = statement.costs.filter((c) => c.category === 1);
  if (est && taxItems.length) {
    const entered = taxItems.reduce((a, c) => a + c.amount, 0);
    if (Math.abs(entered - est.tax) > Math.max(5, est.tax * 0.05)) {
      generalHints.push(
        `Grundsteuer ${eur(entered)} weicht von der Schätzung ${eur(est.tax)} ab (Grundsteuerwert × 0,31 ‰ × Hebesatz). Bitte mit dem Bescheid der Gemeinde für das Abrechnungsjahr abgleichen.`,
      );
    }
  }
  for (const x of result.landlordItems) generalHints.push(`„${x.label}“: ${eur(x.amount)} trägt der Vermieter (${x.reason}).`);
  for (const w of result.warnings) generalHints.push(w);
  if (result.tenants.length === 0) generalHints.push("Im Abrechnungszeitraum gab es keinen Mieter.");

  // Je Mietverhältnis: Vertrag, Vermieter, Vorauszahlungen
  const tenants: TenantReadiness[] = result.tenants.map((t) => {
    const blockers: string[] = [];
    const hints: string[] = [];
    const lease = t.tenant.lease;
    if (!lease) {
      hints.push(`Die Betriebskostenvereinbarung im Mietvertrag von ${t.tenant.name} ist nicht erfasst – die Umlagefähigkeit wurde nicht gegen den Vertrag geprüft.`);
    } else {
      for (const c of statement.costs) {
        if (c.key === "direct" && c.directUnitId !== t.unit.id) continue;
        const m = agreementFor(c.label, c.category, lease);
        if (m.status === "not_agreed") hints.push(`„${c.label}“ wird ${t.tenant.name} nicht berechnet (${m.text}); der Anteil bleibt beim Vermieter.`);
        else if (m.status === "partial") hints.push(`„${c.label}“: ${m.text}. Bitte anhand der Rechnung bestätigen.`);
      }
      if (property.type === "etw" && lease.propertyTaxIndividual && lease.agreedCategories.includes(1) && !taxItems.length) {
        hints.push(
          `Die Grundsteuer ist vereinbart, aber nicht erfasst. Trage den Jahresbetrag aus dem Grundsteuerbescheid der Gemeinde ein (direkt der Wohnung zugeordnet)${est ? ` – zur Kontrolle: geschätzt ${eur(est.tax)} pro Jahr` : ""}.`,
        );
      }
    }
    if (statement.prepaymentsConfirmed[t.tenant.id] !== true) {
      blockers.push(`Vorauszahlungen von ${t.tenant.name} (${formatDate(t.start)}–${formatDate(t.end)}) sind nicht bestätigt. Bitte die tatsächlich gezahlten Beträge prüfen.`);
    }
    if (!t.prepayments && statement.prepaymentOverrides[t.tenant.id] === undefined) hints.push(`Für ${t.tenant.name} sind keine Vorauszahlungen hinterlegt. Stimmt das?`);
    const landlord = landlordFor(t.tenant, data);
    if (!landlord.name || !landlord.address) {
      blockers.push(
        t.tenant.landlord
          ? `Name und Anschrift des Vermieters von ${t.tenant.name} fehlen (beim Mieter unter „Anderer Vermieter für dieses Mietverhältnis“).`
          : "Name und Anschrift des Vermieters fehlen (Einstellungen).",
      );
    }
    return { tenantId: t.tenant.id, name: t.tenant.name, blockers: uniq(blockers), hints: uniq(hints), ready: general.length === 0 && blockers.length === 0 };
  });

  const blockers = uniq([...general, ...tenants.flatMap((t) => t.blockers)]);
  const hints = uniq([...generalHints, ...tenants.flatMap((t) => t.hints)]);
  return { general: uniq(general), generalHints: uniq(generalHints), tenants, blockers, hints, ready: blockers.length === 0 };
}

/** Eingefrorener Stand eines Mietverhältnisses: alles, was das Anschreiben braucht */
export interface ReleasedTenant {
  result: TenantResult;
  periodDays: number;
  co2: Co2Result[];
}

function snapshot(statement: Statement, data: AppData, tenantId: string): ReleasedTenant | null {
  const property = data.properties.find((p) => p.id === statement.propertyId);
  if (!property) return null;
  const all = calculateStatement(statement, property, data.tenants);
  const result = all.tenants.find((t) => t.tenant.id === tenantId);
  return result ? { result, periodDays: all.periodDays, co2: all.co2 } : null;
}

const statusOf = (statement: Statement, data: AppData, releases: Statement["releases"]): Statement["status"] => {
  const property = data.properties.find((p) => p.id === statement.propertyId);
  const ids = property ? calculateStatement(statement, property, data.tenants).tenants.map((t) => t.tenant.id) : [];
  const count = ids.filter((id) => releases[id]).length;
  return count === 0 ? "draft" : count === ids.length ? "released" : "partial";
};

/** Gibt ein Mietverhältnis frei und friert sein Ergebnis ein */
export function releaseTenant(statement: Statement, data: AppData, tenantId: string, now = new Date()): Statement {
  const r = statementReadiness(statement, data);
  const t = r.tenants.find((x) => x.tenantId === tenantId);
  if (!t) throw new Error("Mieter nicht in dieser Abrechnung.");
  if (!t.ready) throw new Error(`Freigabe nicht möglich: ${[...r.general, ...t.blockers][0]}`);
  const snap = snapshot(statement, data, tenantId)!;
  const releases = { ...statement.releases, [tenantId]: { releasedAt: now.toISOString(), resultJson: JSON.stringify(snap) } };
  return { ...statement, releases, status: statusOf(statement, data, releases) };
}

export function revokeRelease(statement: Statement, data: AppData, tenantId: string): Statement {
  const releases = { ...statement.releases };
  delete releases[tenantId];
  return { ...statement, releases, status: statusOf(statement, data, releases) };
}

/** Gibt alle Mietverhältnisse frei (nur wenn alle freigabefähig sind) */
export function releaseStatement(statement: Statement, data: AppData, now = new Date()): Statement {
  const r = statementReadiness(statement, data);
  if (!r.ready) throw new Error(`Freigabe nicht möglich: ${r.blockers[0]}`);
  return r.tenants.reduce((st, t) => releaseTenant(st, data, t.tenantId, now), statement);
}

export function releasedTenant(statement: Statement, tenantId: string): ReleasedTenant | null {
  const rel = statement.releases[tenantId];
  return rel ? (JSON.parse(rel.resultJson) as ReleasedTenant) : null;
}

/**
 * true, wenn sich das Ergebnis eines freigegebenen Mietverhältnisses durch spätere Änderungen
 * ändern würde (ohne tenantId: bei irgendeinem). Das freigegebene Anschreiben bleibt unverändert.
 */
export function changedSinceRelease(statement: Statement, data: AppData, tenantId?: string): boolean {
  const ids = tenantId ? [tenantId] : Object.keys(statement.releases);
  return ids.some((id) => {
    const rel = statement.releases[id];
    if (!rel) return false;
    const now = snapshot(statement, data, id);
    return !now || JSON.stringify(now) !== rel.resultJson;
  });
}
