import { calculateStatement, type StatementResult } from "./calc";
import { formatDate } from "./dates";
import type { AppData, Statement, StatementRelease, Tenant } from "./types";
import { agreementFor } from "./lease";
import { estimatePropertyTax } from "./propertyTax";
import { checkAnnual } from "./weg";

/** Vermieter eines Mietverhältnisses: abweichend am Mieter hinterlegt oder aus den Einstellungen */
export const landlordFor = (tenant: Tenant, data: AppData) => tenant.landlord ?? data.settings.landlord;

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);

export interface Readiness {
  /** verhindern die Freigabe */
  blockers: string[];
  /** Hinweise, die die Freigabe nicht verhindern */
  hints: string[];
  ready: boolean;
}

/**
 * Prüft, ob eine Mieterabrechnung versandfertig ist. Solange Blocker bestehen, bleibt sie
 * ein Entwurf und das Ergebnis wird nur als vorläufig angezeigt (keine Scheingenauigkeit).
 */
export function statementReadiness(statement: Statement, data: AppData): Readiness {
  const blockers: string[] = [];
  const hints: string[] = [];
  const property = data.properties.find((p) => p.id === statement.propertyId);
  if (!property) return { blockers: ["Objekt nicht gefunden."], hints, ready: false };
  const year = Number(statement.periodStart.slice(0, 4));
  const result = calculateStatement(statement, property, data.tenants);

  if (statement.costs.length === 0) blockers.push("Es sind keine Ist-Kosten erfasst.");

  // Eigentumswohnung: Ist-Kosten kommen aus der WEG-Jahresabrechnung
  if (property.type === "etw") {
    for (const unit of property.units) {
      const annual = data.wegAnnuals.find((a) => a.propertyId === property.id && a.unitId === unit.id && a.year === year);
      if (!annual) {
        blockers.push(`Die WEG-Jahresabrechnung ${year} für ${unit.name} fehlt (Ist-Kosten). Ein Wirtschaftsplan ersetzt sie nicht.`);
        continue;
      }
      for (const f of checkAnnual(annual)) if (f.level === "error") blockers.push(`WEG-Jahresabrechnung ${year}: ${f.text}`);
      const open = annual.positions.filter((p) => p.classification === "review");
      if (open.length) blockers.push(`${open.length} Position(en) der WEG-Jahresabrechnung ${year} sind noch als „Prüfung erforderlich“ markiert: ${open.map((p) => p.label).join(", ")}.`);
      const unreviewed = annual.positions.filter((p) => p.classification === "allocable" && !p.reviewed);
      if (unreviewed.length) blockers.push(`${unreviewed.length} umlagefähige Position(en) der WEG-Jahresabrechnung ${year} sind noch nicht als geprüft bestätigt.`);
      const transferred = new Set(statement.costs.map((c) => c.sourcePositionId));
      const missing = annual.positions.filter(
        (p) => p.classification === "allocable" && p.reviewed && p.heating !== "component" && p.amount !== 0 && !transferred.has(p.id),
      );
      if (missing.length) hints.push(`Noch nicht übernommen: ${missing.map((p) => p.label).join(", ")}.`);
    }
  }

  // Übernommene Beträge müssen noch zur Quelle passen
  for (const c of statement.costs) {
    if (!c.sourcePositionId) {
      if (!c.source) hints.push(`„${c.label}“ ist manuell erfasst und hat keinen Beleg.`);
      continue;
    }
    const annual = data.wegAnnuals.find((a) => a.id === c.sourceAnnualId);
    const pos = annual?.positions.find((p) => p.id === c.sourcePositionId);
    if (!pos) blockers.push(`„${c.label}“: Die Quellposition in der WEG-Jahresabrechnung existiert nicht mehr.`);
    else if (pos.amount !== (c.sourceAmount ?? c.amount))
      blockers.push(`„${c.label}“: Die WEG-Jahresabrechnung wurde geändert (jetzt ${eur(pos.amount)}). Bitte die Position neu übernehmen.`);
    else if (pos.classification !== "allocable") blockers.push(`„${c.label}“ ist in der WEG-Jahresabrechnung nicht mehr als umlagefähig bewertet.`);
  }

  // Mietvertrag: Ist jede Position vereinbart?
  for (const t of result.tenants) {
    const lease = t.tenant.lease;
    if (!lease) {
      hints.push(`Die Betriebskostenvereinbarung im Mietvertrag von ${t.tenant.name} ist nicht erfasst – die Umlagefähigkeit wurde nicht gegen den Vertrag geprüft.`);
      continue;
    }
    for (const c of statement.costs) {
      if (c.key === "direct" && c.directUnitId !== t.unit.id) continue;
      const m = agreementFor(c.label, c.category, lease);
      if (m.status === "not_agreed") hints.push(`„${c.label}“ wird ${t.tenant.name} nicht berechnet (${m.text}); der Anteil bleibt beim Vermieter.`);
      else if (m.status === "partial") hints.push(`„${c.label}“: ${m.text}. Bitte anhand der Rechnung bestätigen.`);
    }
    if (property.type === "etw" && lease.propertyTaxIndividual && lease.agreedCategories.includes(1) && !statement.costs.some((c) => c.category === 1)) {
      const est = estimatePropertyTax(property);
      hints.push(
        `Die Grundsteuer ist vereinbart, aber nicht erfasst. Trage den Jahresbetrag aus dem Grundsteuerbescheid der Gemeinde ein (direkt der Wohnung zugeordnet)${est ? ` – zur Kontrolle: geschätzt ${eur(est.tax)} pro Jahr` : ""}.`,
      );
    }
  }

  // Grundsteuer gegen Schätzung aus Grundsteuerwert und Hebesatz prüfen
  const est = estimatePropertyTax(property);
  const taxItems = statement.costs.filter((c) => c.category === 1);
  if (est && taxItems.length) {
    const entered = taxItems.reduce((a, c) => a + c.amount, 0);
    if (Math.abs(entered - est.tax) > Math.max(5, est.tax * 0.05)) {
      hints.push(
        `Grundsteuer ${eur(entered)} weicht von der Schätzung ${eur(est.tax)} ab (Grundsteuerwert × 0,31 ‰ × Hebesatz). Bitte mit dem Bescheid der Gemeinde für das Abrechnungsjahr abgleichen.`,
      );
    }
  }

  // Tatsächlich geleistete Vorauszahlungen
  for (const t of result.tenants) {
    const confirmed = statement.prepaymentsConfirmed[t.tenant.id] === true;
    if (!confirmed) {
      blockers.push(
        `Vorauszahlungen von ${t.tenant.name} (${formatDate(t.start)}–${formatDate(t.end)}) sind nicht bestätigt. Bitte die tatsächlich gezahlten Beträge prüfen.`,
      );
    }
  }
  if (result.tenants.length === 0) hints.push("Im Abrechnungszeitraum gab es keinen Mieter.");

  for (const t of result.tenants) {
    const landlord = landlordFor(t.tenant, data);
    if (!landlord.name || !landlord.address) {
      blockers.push(
        t.tenant.landlord
          ? `Name und Anschrift des Vermieters von ${t.tenant.name} fehlen (beim Mieter unter „Vermieter dieses Mietverhältnisses“).`
          : "Name und Anschrift des Vermieters fehlen (Einstellungen).",
      );
    }
    if (!t.prepayments && statement.prepaymentOverrides[t.tenant.id] === undefined) {
      hints.push(`Für ${t.tenant.name} sind keine Vorauszahlungen hinterlegt. Stimmt das?`);
    }
  }
  for (const x of result.landlordItems) hints.push(`„${x.label}“: ${x.amount.toFixed(2).replace(".", ",")} € trägt der Vermieter (${x.reason}).`);
  for (const w of result.warnings) hints.push(w);

  return { blockers: [...new Set(blockers)], hints: [...new Set(hints)], ready: blockers.length === 0 };
}

/** Eingangsdaten, die das Ergebnis bestimmen – Änderung nach Freigabe wird erkannt */
export function statementFingerprint(statement: Statement, data: AppData): string {
  const property = data.properties.find((p) => p.id === statement.propertyId);
  const input = JSON.stringify({
    period: [statement.periodStart, statement.periodEnd],
    costs: statement.costs,
    overrides: statement.prepaymentOverrides,
    confirmed: statement.prepaymentsConfirmed,
    units: property?.units,
    tenants: data.tenants.filter((t) => t.propertyId === statement.propertyId),
  });
  // FNV-1a 32 Bit – zur Änderungserkennung, nicht als Sicherheitsmerkmal
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function releaseStatement(statement: Statement, data: AppData, now = new Date()): Statement {
  const readiness = statementReadiness(statement, data);
  if (!readiness.ready) throw new Error(`Freigabe nicht möglich: ${readiness.blockers[0]}`);
  const property = data.properties.find((p) => p.id === statement.propertyId)!;
  const result = calculateStatement(statement, property, data.tenants);
  const release: StatementRelease = {
    releasedAt: now.toISOString(),
    fingerprint: statementFingerprint(statement, data),
    resultJson: JSON.stringify(result),
  };
  return { ...statement, status: "released", release };
}

export function releasedResult(statement: Statement): StatementResult | null {
  return statement.release ? (JSON.parse(statement.release.resultJson) as StatementResult) : null;
}

/** true, wenn sich Eingangsdaten seit der Freigabe geändert haben */
export function changedSinceRelease(statement: Statement, data: AppData): boolean {
  return !!statement.release && statement.release.fingerprint !== statementFingerprint(statement, data);
}
