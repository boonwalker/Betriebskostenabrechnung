import { calculateStatement, type Co2Result, type TenantResult } from "./calc";
import { formatDate } from "./dates";
import type { AppData, Statement, Tenant } from "./types";
import { agreementForItem } from "./lease";
import { billFor, estimatePropertyTax, propertyTaxStart } from "./propertyTax";
import { checkAnnual } from "./weg";
import { link, type Target } from "./nav";

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

/** Direkte Behebung: Abgabe eintragen oder Leistung laut Mietvertrag bestätigen */
export type IssueFix = { kind: "tax" | "waste"; amount: number } | { kind: "confirm"; costId: string; term: string };

/** Wohin ein Klick auf einen Hinweis führt; `fix` trägt den fehlenden Betrag direkt ein */
export interface IssueTarget extends Target {
  fix?: IssueFix;
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
  /** Sprungziel je Hinweistext */
  targets: Record<string, IssueTarget>;
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
  if (!property)
    return { general: ["Objekt nicht gefunden."], generalHints: [], tenants: [], blockers: ["Objekt nicht gefunden."], hints: [], ready: false, targets: {} };
  const targets: Record<string, IssueTarget> = {};
  const to = (text: string, target: IssueTarget) => {
    targets[text] = target;
    return text;
  };
  const here = (f: string, label: string): IssueTarget => ({ href: link(`abrechnungen/${statement.id}`, { f }), label });
  const objectPage = (params: Record<string, string>, label: string): IssueTarget => ({ href: link(`objekte/${property.id}`, params), label });
  const annualPage = (id: string, label = "Zur WEG-Jahresabrechnung"): IssueTarget => ({ href: link(`weg/jahresabrechnung/${id}`, { f: "positionen" }), label });
  const year = Number(statement.periodStart.slice(0, 4));
  const result = calculateStatement(statement, property, data.tenants);

  if (statement.costs.length === 0) {
    const source = property.type === "etw" ? data.wegAnnuals.find((a) => a.propertyId === property.id && a.year === year) : undefined;
    general.push(to("Es sind keine Ist-Kosten erfasst.", source ? annualPage(source.id, "Aus der WEG-Jahresabrechnung übernehmen") : here("kosten", "Kosten erfassen")));
  }

  // Eigentumswohnung: Ist-Kosten kommen aus der WEG-Jahresabrechnung
  if (property.type === "etw") {
    for (const unit of property.units) {
      const annual = data.wegAnnuals.find((a) => a.propertyId === property.id && a.unitId === unit.id && a.year === year);
      if (!annual) {
        general.push(
          to(
            `Die WEG-Jahresabrechnung ${year} für ${unit.name} fehlt (Ist-Kosten). Ein Wirtschaftsplan ersetzt sie nicht.`,
            objectPage({ f: "weg-unterlagen" }, "Jahresabrechnung erfassen"),
          ),
        );
        continue;
      }
      for (const f of checkAnnual(annual)) if (f.level === "error") general.push(to(`WEG-Jahresabrechnung ${year}: ${f.text}`, annualPage(annual.id)));
      const open = annual.positions.filter((p) => p.classification === "review");
      if (open.length)
        general.push(
          to(
            `${open.length} Position(en) der WEG-Jahresabrechnung ${year} sind noch als „Prüfung erforderlich“ markiert: ${open.map((p) => p.label).join(", ")}.`,
            annualPage(annual.id, "Positionen bewerten"),
          ),
        );
      // Posten mit Anteil 0 € (z. B. Einzelkosten einer anderen Wohnung) brauchen keine Bestätigung
      const unreviewed = annual.positions.filter((p) => p.classification === "allocable" && !p.reviewed && p.amount !== 0);
      if (unreviewed.length)
        general.push(
          to(`${unreviewed.length} umlagefähige Position(en) der WEG-Jahresabrechnung ${year} sind noch nicht als geprüft bestätigt.`, annualPage(annual.id, "Positionen bestätigen")),
        );
      const transferred = new Set(statement.costs.map((c) => c.sourcePositionId));
      const missing = annual.positions.filter(
        (p) => p.classification === "allocable" && p.reviewed && p.heating !== "component" && p.amount !== 0 && !transferred.has(p.id),
      );
      if (missing.length) generalHints.push(to(`Noch nicht übernommen: ${missing.map((p) => p.label).join(", ")}.`, here("kosten", "Zur Übernahme")));
    }
  }

  // Übernommene Beträge müssen noch zur Quelle passen
  for (const c of statement.costs) {
    if (!c.sourcePositionId) {
      if (!c.source) generalHints.push(to(`„${c.label}“ ist manuell erfasst und hat keinen Beleg.`, here("kosten", "Zur Position")));
      continue;
    }
    const annual = data.wegAnnuals.find((a) => a.id === c.sourceAnnualId);
    const pos = annual?.positions.find((p) => p.id === c.sourcePositionId);
    if (!pos) general.push(to(`„${c.label}“: Die Quellposition in der WEG-Jahresabrechnung existiert nicht mehr.`, here("kosten", "Zur Position")));
    else if (pos.amount !== (c.sourceAmount ?? c.amount))
      general.push(to(`„${c.label}“: Die WEG-Jahresabrechnung wurde geändert (jetzt ${eur(pos.amount)}). Bitte die Position neu übernehmen.`, here("kosten", "Zur Position")));
    else if (pos.classification !== "allocable")
      general.push(to(`„${c.label}“ ist in der WEG-Jahresabrechnung nicht mehr als umlagefähig bewertet.`, annualPage(annual!.id)));
  }

  // Grundsteuer gegen Schätzung aus Grundsteuerwert und Hebesatz prüfen
  const estimate = estimatePropertyTax(property);
  const bill = billFor(property, year);
  const billTax = bill?.propertyTax ?? property.propertyTaxAnnual;
  const wasteFee = (bill?.wasteFee ?? property.wasteFeeAnnual) || null;
  const reference = billTax
    ? { tax: billTax, source: bill ? `dem Bescheid ${bill.year}` : "dem hinterlegten Bescheid" }
    : estimate
      ? { tax: estimate.tax, source: "der Schätzung (Grundsteuerwert × 0,31 ‰ × Hebesatz)" }
      : null;
  const est = reference;
  const taxItems = statement.costs.filter((c) => c.category === 1);
  const wasteItems = statement.costs.filter((c) => c.category === 8 && /m(ü|ue)ll|abfall/i.test(c.label));
  // Abgaben der Gemeinde trägt der Eigentümer erst ab dem 1. Januar nach dem Erwerb (§ 9 GrStG), sofern nichts anderes erfasst ist
  const chargeStart = property.type === "etw" ? propertyTaxStart(property) : null;
  const beforeStart = chargeStart !== null && statement.periodEnd < chargeStart;
  if (beforeStart) {
    for (const c of [...taxItems, ...wasteItems]) {
      general.push(
        to(
          `„${c.label}“: Du trägst die Abgaben der Gemeinde erst ab ${formatDate(chargeStart!)} (Bescheid an den Eigentümer zum 1. Januar). Kosten, die du nicht getragen hast, darfst du nicht umlegen.`,
          here("kosten", "Position entfernen"),
        ),
      );
    }
  }
  if (reference && taxItems.length && !beforeStart) {
    const entered = taxItems.reduce((a, c) => a + c.amount, 0);
    if (Math.abs(entered - reference.tax) > Math.max(5, reference.tax * 0.05)) {
      generalHints.push(
        to(
          `Grundsteuer ${eur(entered)} weicht von ${reference.source} mit ${eur(reference.tax)} ab. Bitte mit dem Bescheid der Gemeinde für das Abrechnungsjahr abgleichen.`,
          here("kosten", "Zur Grundsteuer"),
        ),
      );
    }
  }
  for (const x of result.landlordItems) generalHints.push(to(`„${x.label}“: ${eur(x.amount)} trägt der Vermieter (${x.reason}).`, here("vermieteranteil", "Details")));
  for (const w of result.warnings) generalHints.push(w);
  if (result.tenants.length === 0) generalHints.push(to("Im Abrechnungszeitraum gab es keinen Mieter.", objectPage({ f: "mieter" }, "Mieter erfassen")));

  // Je Mietverhältnis: Vertrag, Vermieter, Vorauszahlungen
  const tenants: TenantReadiness[] = result.tenants.map((t) => {
    const blockers: string[] = [];
    const hints: string[] = [];
    const lease = t.tenant.lease;
    if (!lease) {
      hints.push(
        to(
          `Die Betriebskostenvereinbarung im Mietvertrag von ${t.tenant.name} ist nicht erfasst – die Umlagefähigkeit wurde nicht gegen den Vertrag geprüft.`,
          objectPage({ t: t.tenant.id, f: "vertrag" }, "Vereinbarung erfassen"),
        ),
      );
    } else {
      for (const c of statement.costs) {
        if (c.key === "direct" && c.directUnitId !== t.unit.id) continue;
        const m = agreementForItem(c, lease);
        if (m.status === "not_agreed")
          hints.push(to(`„${c.label}“ wird ${t.tenant.name} nicht berechnet (${m.text}); der Anteil bleibt beim Vermieter.`, objectPage({ t: t.tenant.id, f: "vertrag" }, "Mietvertrag ansehen")));
        else if (m.status === "partial")
          hints.push(
            to(`„${c.label}“: ${m.text}. Bitte anhand der Rechnung bestätigen.`, {
              ...here("kosten", `Bestätigen: betrifft „${m.term}“`),
              fix: { kind: "confirm", costId: c.id, term: m.term! },
            }),
          );
      }
      if (property.type === "etw" && !beforeStart && wasteFee && lease.agreedCategories.includes(8) && !wasteItems.length) {
        hints.push(
          to(
            `Die Müllgebühr laut Bescheid der Gemeinde (${eur(wasteFee)} pro Jahr) ist vereinbar, aber nicht erfasst. Trage sie als „Müllbeseitigung“ (Nr. 8) direkt für die Wohnung ein.`,
            { ...here("kosten", `Jetzt eintragen (${eur(wasteFee)})`), fix: { kind: "waste", amount: wasteFee } },
          ),
        );
      }
      if (property.type === "etw" && !beforeStart && lease.propertyTaxIndividual && lease.agreedCategories.includes(1) && !taxItems.length) {
        hints.push(
          to(
            `Die Grundsteuer ist vereinbart, aber nicht erfasst. Trage den Jahresbetrag aus dem Grundsteuerbescheid der Gemeinde ein (direkt der Wohnung zugeordnet)${est ? ` – zur Kontrolle: ${eur(est.tax)} pro Jahr laut ${est.source}` : ""}.`,
            est
              ? { ...here("kosten", `Jetzt eintragen (${eur(est.tax)})`), fix: { kind: "tax", amount: est.tax } }
              : here("kosten", "Grundsteuer eintragen"),
          ),
        );
      }
    }
    if (statement.prepaymentsConfirmed[t.tenant.id] !== true) {
      blockers.push(
        to(
          `Vorauszahlungen von ${t.tenant.name} (${formatDate(t.start)}–${formatDate(t.end)}) sind nicht bestätigt. Bitte die tatsächlich gezahlten Beträge prüfen.`,
          here(`vz-${t.tenant.id}`, "Vorauszahlungen prüfen"),
        ),
      );
    }
    if (!t.prepayments && statement.prepaymentOverrides[t.tenant.id] === undefined)
      hints.push(to(`Für ${t.tenant.name} sind keine Vorauszahlungen hinterlegt. Stimmt das?`, objectPage({ t: t.tenant.id, f: "miete" }, "Vorauszahlungen eintragen")));
    const landlord = landlordFor(t.tenant, data);
    if (!landlord.name || !landlord.address) {
      blockers.push(
        t.tenant.landlord
          ? to(
              `Name und Anschrift des Vermieters von ${t.tenant.name} fehlen (beim Mieter unter „Anderer Vermieter für dieses Mietverhältnis“).`,
              objectPage({ t: t.tenant.id, f: "vermieter" }, "Vermieter eintragen"),
            )
          : to("Name und Anschrift des Vermieters fehlen (Einstellungen).", { href: link("einstellungen", { f: "vermieter" }), label: "Vermieter eintragen" }),
      );
    }
    // Ausgezogene Mieter erreicht das Anschreiben nur unter ihrer neuen Anschrift
    if (t.tenant.moveOut && t.tenant.moveOut < new Date().toISOString().slice(0, 10) && !t.tenant.mailingAddress.trim()) {
      blockers.push(
        to(
          `${t.tenant.name} ist am ${formatDate(t.tenant.moveOut)} ausgezogen – die aktuelle Postanschrift fehlt.`,
          objectPage({ t: t.tenant.id, f: "anschrift" }, "Anschrift eintragen"),
        ),
      );
    }
    return { tenantId: t.tenant.id, name: t.tenant.name, blockers: uniq(blockers), hints: uniq(hints), ready: general.length === 0 && blockers.length === 0 };
  });

  const blockers = uniq([...general, ...tenants.flatMap((t) => t.blockers)]);
  const hints = uniq([...generalHints, ...tenants.flatMap((t) => t.hints)]);
  return { general: uniq(general), generalHints: uniq(generalHints), tenants, blockers, hints, ready: blockers.length === 0, targets };
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
