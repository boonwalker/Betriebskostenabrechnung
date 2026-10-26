/**
 * Belegeingang: beliebige Fotos und PDFs hochladen; die App erkennt die Dokumente darin, ordnet sie zu
 * (WEG-Jahresabrechnung, Wirtschaftsplan, Heizkostenabrechnung, Abgabenbescheid, Rechnung, Sonstiges)
 * und legt sie in der Belegablage ab.
 */
import type { AiAccess } from "./aiAccess";
import { attachTenantSheet, autoAttach, heatingSourcePages } from "./attachments";
import { COST_CATEGORIES } from "./betrkv";
import { getBlob } from "./blobs";
import { ensureStatement, newRentPeriod, uid } from "./model";
import type { LeaseExtraction } from "./extract";
import type { AppData, CostItem, DocPage, DocumentKind, LeaseAgreement, Property, RentPeriod, StoredDocument, Tenant, Unit } from "./types";
import { annualFromExtraction, planFromExtraction } from "./wegImport";

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  weg_annual: "WEG-Jahresabrechnung",
  weg_plan: "Wirtschaftsplan",
  heating: "Heizkostenabrechnung",
  municipal: "Abgabenbescheid",
  invoice: "Rechnung",
  lease: "Mietvertrag",
  other: "Sonstiges",
};

type Update = (fn: (d: AppData) => AppData) => void;

const patchDoc = (update: Update, id: string, patch: Partial<StoredDocument>) =>
  update((d) => ({ ...d, documents: (d.documents ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

export async function pageFiles(pages: DocPage[]): Promise<File[]> {
  return Promise.all(
    pages.map(async (p, i) => {
      const blob = await getBlob(p.blobId);
      if (!blob) throw new Error("Seitenbild nicht gefunden.");
      return new File([blob], `Seite ${i + 1}.jpg`, { type: "image/jpeg" });
    }),
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Einen Upload verarbeiten. `snapshot` ist der Datenstand beim Hochladen (für Objektliste und Prüfungen);
 * alle Änderungen laufen über `update`, damit parallele Eingaben nicht verloren gehen.
 */
export async function processUpload(files: File[], access: AiAccess, snapshot: AppData, update: Update): Promise<void> {
  // eigener Stand dieses Uploads, damit spätere Dokumente sehen, was frühere angelegt haben (z. B. die Abrechnung)
  let current = snapshot;
  const tracked: Update = (fn) => {
    current = fn(current);
    update(fn);
  };
  const batchId = uid();
  const now = new Date().toISOString();
  const placeholder: StoredDocument = { id: batchId, createdAt: now, kind: "other", title: files.map((f) => f.name).join(", "), year: null, propertyId: null, pages: [], status: "processing", result: "Seiten werden gespeichert …" };
  update((d) => ({ ...d, documents: [placeholder, ...(d.documents ?? [])] }));

  let pages: DocPage[] = [];
  try {
    const { filesToPages } = await import("./pages");
    pages = await filesToPages(files);
    patchDoc(update, batchId, { pages, result: "Wird erkannt …" });

    const { classifyDocuments, extractInvoice, extractWegDocument, extractLease } = await import("./extract");
    const properties = snapshot.properties.map((p) => ({ id: p.id, name: p.name, address: p.address, units: p.units.map((u) => u.name) }));
    const cls = await classifyDocuments(await pageFiles(pages), access, properties);

    // Seiten auf die erkannten Dokumente verteilen; was die Erkennung nicht zuordnet, bleibt als „Sonstiges“
    const used = new Set<number>();
    const docs = cls.documents
      .map((c) => ({ c, pages: c.pages.filter((n) => n >= 1 && n <= pages.length && !used.has(n) && (used.add(n), true)).map((n) => pages[n - 1]) }))
      .filter((x) => x.pages.length);
    const rest = pages.filter((_, i) => !used.has(i + 1));
    if (rest.length) docs.push({ c: { kind: "other", pages: [], title: "Nicht zugeordnete Seiten", year: null, propertyId: "unknown", unitName: "", tenantName: "" }, pages: rest });

    const single = snapshot.properties.length === 1 ? snapshot.properties[0].id : null;
    const stored: StoredDocument[] = docs.map(({ c, pages: ps }) => ({
      id: uid(),
      createdAt: now,
      kind: c.kind,
      title: c.title || DOCUMENT_KIND_LABELS[c.kind],
      year: c.year,
      propertyId: snapshot.properties.some((p) => p.id === c.propertyId) ? c.propertyId : single,
      pages: ps,
      status: "processing",
      result: "Wird zugeordnet …",
    }));
    update((d) => ({ ...d, documents: [...stored, ...(d.documents ?? []).filter((x) => x.id !== batchId)] }));

    for (const [i, doc] of stored.entries()) {
      try {
        const outcome = await route(doc, docs[i].c.unitName, access, current, tracked, { extractInvoice, extractWegDocument, extractLease }, docs[i].c.tenantName ?? "");
        patchDoc(update, doc.id, { status: "done", ...outcome });
      } catch (e) {
        patchDoc(update, doc.id, { status: "error", error: (e as Error).message, result: "Abgelegt, aber nicht ausgewertet." });
      }
    }
  } catch (e) {
    patchDoc(update, batchId, { status: "error", error: (e as Error).message, result: pages.length ? "Abgelegt, aber nicht erkannt." : "Konnte nicht gespeichert werden." });
  }
}

type Extractors = Pick<typeof import("./extract"), "extractInvoice" | "extractWegDocument" | "extractLease">;

/** Ein erkanntes Dokument an die passende Stelle bringen; Rückgabe: was geschehen ist */
async function route(
  doc: StoredDocument,
  unitName: string,
  access: AiAccess,
  snapshot: AppData,
  update: Update,
  { extractInvoice, extractWegDocument, extractLease }: Extractors,
  tenantName = "",
): Promise<Partial<StoredDocument>> {
  const property = snapshot.properties.find((p) => p.id === doc.propertyId);
  if (doc.kind === "other") return { result: "Abgelegt." };
  if (!property) return { result: "Abgelegt – kein passendes Objekt gefunden. Bitte unten zuordnen." };

  const year = doc.year;
  const files = await pageFiles(doc.pages);
  if (doc.kind === "lease") return routeLease(doc, property, snapshot, update, await extractLease(files, access), unitName, tenantName);

  /** Abrechnung des Jahres anlegen, falls noch keine da ist (und in dem Jahr vermietet war); Rückgabe: Zusatz für die Meldung */
  const ensure = (y: number): string => {
    const { created } = ensureStatement(snapshot, property.id, y);
    if (!created) return "";
    update((d) => (d.statements.some((s) => s.propertyId === property.id && s.periodStart.startsWith(String(y))) ? d : { ...d, statements: [...d.statements, created] }));
    snapshot = { ...snapshot, statements: [...snapshot.statements, created] };
    return ` Betriebskostenabrechnung ${y} angelegt.`;
  };

  if (doc.kind === "weg_annual" || doc.kind === "weg_plan") {
    const kind = doc.kind === "weg_annual" ? "annual" : "plan";
    const unit = property.units.find((u) => u.name.replace(/\s/g, "").toLowerCase() === unitName.replace(/\s/g, "").toLowerCase()) ?? property.units[0];
    const x = await extractWegDocument(files, access, unit?.name ?? "", kind);
    const ctx = { propertyId: property.id, unitId: unit?.id ?? "", documents: [doc.title], fallbackYear: year ?? new Date().getFullYear() - 1 };
    if (kind === "annual") {
      const annual = { ...annualFromExtraction(x, ctx), sourcePages: doc.pages, heatingPages: x.heating ? (x.heating.pages.length ? x.heating.pages : x.heating.page ? [x.heating.page] : []) : [] };
      const same = (w: { propertyId: string; unitId: string; year: number }) => w.propertyId === property.id && w.unitId === annual.unitId && w.year === annual.year;
      const existing = snapshot.wegAnnuals.find(same);
      if (existing) {
        // Abrechnungsspitze und Rücklagenstand nachtragen, falls sie noch fehlen
        const addSettlement = !existing.settlement && !!annual.settlement;
        const addBalance = !existing.reserveBalance && !!annual.reserveBalance;
        if (addSettlement || addBalance) {
          update((d) => ({
            ...d,
            wegAnnuals: d.wegAnnuals.map((w) =>
              w.id === existing.id
                ? { ...w, settlement: w.settlement ?? annual.settlement ?? null, reserveBalance: w.reserveBalance ?? annual.reserveBalance ?? null }
                : w,
            ),
          }));
          const what = [
            addSettlement && `Abrechnungsspitze (${annual.settlement!.amount > 0 ? "Erstattung" : "Nachzahlung"} ${Math.abs(annual.settlement!.amount).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €)`,
            addBalance && "Rücklagenstand",
          ].filter(Boolean);
          return { year: annual.year, result: `${what.join(" und ")} ${annual.year} ergänzt – sonst nur abgelegt.` };
        }
        return { year: annual.year, result: `Für ${annual.year} gibt es schon eine WEG-Jahresabrechnung – nur abgelegt.` };
      }
      const extra = ensure(annual.year);
      update((d) => (d.wegAnnuals.some(same) ? d : autoAttach({ ...d, wegAnnuals: [...d.wegAnnuals, annual] }, property.id, annual.year, "heating", heatingSourcePages(annual))));
      // Einzelabrechnung für den Mieter (ohne nicht umlagefähige Zeilen) als erste Anlage
      const sheet = await attachTenantSheet(update, annual).catch(() => false);
      const attached = [sheet ? "Einzelabrechnung (nur umlagefähige Kosten)" : "", annual.heatingPages?.length ? "Heizkostenabrechnung" : ""].filter(Boolean);
      return {
        year: annual.year,
        result: `WEG-Jahresabrechnung ${annual.year} angelegt${attached.length ? `, als Anlage übernommen: ${attached.join(" und ")}` : ""} – bitte Positionen prüfen und dann in die Abrechnung übernehmen.${extra}`,
        link: `#/weg/jahresabrechnung/${annual.id}`,
      };
    }
    const plan = planFromExtraction(x, ctx);
    const same = (w: { propertyId: string; unitId: string; year: number }) => w.propertyId === property.id && w.unitId === plan.unitId && w.year === plan.year;
    if (snapshot.economicPlans.some(same)) return { year: plan.year, result: `Für ${plan.year} gibt es schon einen Wirtschaftsplan – nur abgelegt.` };
    update((d) => (d.economicPlans.some(same) ? d : { ...d, economicPlans: [...d.economicPlans, plan] }));
    return { year: plan.year, result: `Wirtschaftsplan ${plan.year} angelegt – bitte prüfen.`, link: `#/weg/wirtschaftsplan/${plan.id}` };
  }

  if (doc.kind === "heating") {
    if (!year) return { result: "Abgelegt – das Jahr der Heizkostenabrechnung war nicht erkennbar." };
    const extra = ensure(year);
    update((d) => autoAttach(d, property.id, year, "heating", doc.pages));
    return { result: `Als Anlage „Heizkostenabrechnung ${year}“ übernommen.${extra}`, link: statementLink(snapshot, property.id, year) };
  }

  // Abgabenbescheid und Rechnungen: Beträge auslesen
  const period = year ? `01.01.${year} bis 31.12.${year}` : "unbekannt";
  const x = await extractInvoice(files, access, period);
  const y = year ?? (Number(x.servicePeriodStart.slice(0, 4)) || null);
  if (!y) return { result: "Abgelegt – das Jahr war nicht erkennbar." };

  if (doc.kind === "municipal") {
    const tax = round2(x.items.filter((it) => it.category === 1).reduce((a, it) => a + it.allocableAmount + it.nonAllocableAmount, 0));
    const waste = round2(x.items.filter((it) => it.category === 8).reduce((a, it) => a + it.allocableAmount + it.nonAllocableAmount, 0));
    const known = (property.municipalBills ?? []).find((b) => b.year === y);
    const extra = ensure(y);
    const note = known && ((known.propertyTax ?? 0) !== tax || (known.wasteFee ?? 0) !== waste) ? ` Abweichung zum erfassten Bescheid ${y} – bitte prüfen.` : "";
    update((d) => {
      const after = autoAttach(d, property.id, y, "propertyTax", doc.pages);
      return {
        ...after,
        properties: after.properties.map((p) => {
          if (p.id !== property.id) return p;
          const bills = p.municipalBills ?? [];
          const existing = bills.find((b) => b.year === y);
          if (existing) return p;
          return { ...p, municipalBills: [...bills, { id: uid(), year: y, propertyTax: tax || null, wasteFee: waste || null, note: doc.title }] };
        }),
      };
    });
    return {
      year: y,
      result: `Bescheid ${y}: Grundsteuer ${tax.toFixed(2).replace(".", ",")} €, Müll ${waste.toFixed(2).replace(".", ",")} €${known ? "" : " beim Objekt erfasst"}, als Anlage übernommen.${note}${extra}`,
      link: `#/objekte/${property.id}/bearbeiten?f=grundsteuer`,
    };
  }

  // Rechnung: Positionen in die Abrechnung des Jahres, sofern es eine offene gibt
  const items: CostItem[] = x.items
    .filter((it) => it.allocableAmount !== 0)
    .map((it) => ({
      id: uid(),
      category: it.category,
      label: it.description || COST_CATEGORIES.find((c) => c.no === it.category)?.label || "",
      amount: it.allocableAmount,
      key: it.recommendedKey,
      note: it.reasoning,
      ...(it.laborKind !== "none" && it.laborCost > 0 ? { laborCost: it.laborCost, laborKind: it.laborKind } : {}),
      ...(it.co2Cost > 0 ? { co2Cost: it.co2Cost, co2Kg: it.co2Kg || undefined } : {}),
      ...(it.recommendedKey === "direct" ? { directUnitId: property.units[0]?.id } : {}),
      source: doc.title,
    }));
  const extra = items.length ? ensure(y) : "";
  const st = snapshot.statements.find((s) => s.propertyId === property.id && s.periodStart.startsWith(String(y)) && s.status !== "released");
  if (!st) return { year: y, result: `Abgelegt – für ${y} gibt es noch keine offene Abrechnung. Umlagefähig laut Beleg: ${items.length} Position(en).` };
  if (!items.length) return { year: y, result: "Abgelegt – keine umlagefähigen Kosten erkannt." };
  update((d) => ({ ...d, statements: d.statements.map((s) => (s.id === st.id ? { ...s, costs: [...s.costs, ...items] } : s)) }));
  return { year: y, result: `${items.length} Position(en) in die Abrechnung ${y} übernommen – bitte prüfen.${extra}`, link: `#/abrechnungen/${st.id}?f=kosten` };
}

/**
 * Mietvertrag: dem passenden Mieter zuordnen (über den Namen, sonst über Wohnung und Mietbeginn). Gibt es ihn noch nicht,
 * wird er angelegt – samt Wohnung bzw. Stellplatz im Objekt, falls die fehlt. Bei bestehenden Mietern werden nur leere
 * Angaben ergänzt; ein Nachtrag wird zu einem neuen Mietstand.
 */
function routeLease(
  doc: StoredDocument,
  property: Property,
  snapshot: AppData,
  update: Update,
  x: LeaseExtraction,
  unitHint: string,
  nameHint: string,
): Partial<StoredDocument> {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const compact = (s: string) => norm(s).replace(/[\s.-]/g, "");
  const tenantName = x.tenantNames.filter(Boolean).join(" und ") || nameHint;
  const tenants = snapshot.tenants.filter((t) => t.propertyId === property.id);
  const names = norm(tenantName);
  // ein übereinstimmender Namensteil genügt, damit „Luca Schmitz“ auch „Schmitz, Luca“ findet
  const filler = new Set(["und", "von", "van", "der", "den", "die", "dem", "geb"]);
  const byName = names
    ? tenants.find((t) => norm(t.name).split(/[\s,.]+/).some((part) => part.length > 2 && !filler.has(part) && names.split(/[\s,.]+/).includes(part)))
    : undefined;
  const unitLabel = x.unitName || unitHint;
  let unit = unitLabel ? property.units.find((u) => compact(u.name) === compact(unitLabel)) : undefined;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(x.startDate) ? x.startDate : null;
  const inUnit = tenants.filter((t) => !unit || t.unitId === unit.id);
  const byStart = start ? inUnit.find((t) => t.moveIn === start) : doc.year ? inUnit.find((t) => t.moveIn.startsWith(String(doc.year))) : undefined;
  const existing = byName ?? byStart;

  const period = (validFrom: string) => rentPeriodFromLease(x, validFrom);
  const lease = leaseFromExtraction(x, doc.title);

  if (existing) {
    const done: string[] = [];
    const patch: Partial<Tenant> = {};
    if (x.isAmendment && start && !existing.rentHistory.some((r) => r.validFrom === start)) {
      patch.rentHistory = [...existing.rentHistory, period(start)].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      done.push(`neuer Mietstand ab ${start.split("-").reverse().join(".")}`);
    } else if (!x.isAmendment && existing.rentHistory.every((r) => !r.coldRent && !r.prepaymentOperating && !r.prepaymentHeating) && x.coldRent) {
      patch.rentHistory = [period(existing.rentHistory[0]?.validFrom ?? existing.moveIn)];
      done.push("Miete und Vorauszahlungen");
    }
    if (!existing.lease && lease) {
      patch.lease = lease;
      done.push("Betriebskostenvereinbarung");
    }
    if (!existing.deposit && x.deposit) {
      patch.deposit = x.deposit;
      done.push("Kaution");
    }
    // Vertrag im Mieterprofil hinterlegen
    if (!existing.leaseDocIds?.includes(doc.id)) patch.leaseDocIds = [...(existing.leaseDocIds ?? []), doc.id];
    if (Object.keys(patch).length) update((d) => ({ ...d, tenants: d.tenants.map((t) => (t.id === existing.id ? { ...t, ...patch } : t)) }));
    return {
      result: `Mietvertrag von ${existing.name}${done.length ? ` – ergänzt: ${done.join(", ")}` : " – bereits erfasste Angaben bleiben unverändert"}. Bitte im Mieterprofil prüfen.`,
      link: `#/mieter?t=${existing.id}`,
      year: Number((start ?? existing.moveIn).slice(0, 4)),
    };
  }

  // Neuer Mieter – Wohnung bzw. Stellplatz anlegen, wenn das Objekt sie noch nicht kennt
  let newUnit: Unit | null = null;
  if (!unit && unitLabel) newUnit = { id: uid(), name: unitLabel, area: x.unitArea ?? 0 };
  else if (!unit) unit = property.units.length === 1 ? property.units[0] : undefined;
  if (!unit && !newUnit) newUnit = { id: uid(), name: `Wohnung ${property.units.length + 1}`, area: x.unitArea ?? 0 };
  const unitId = (unit ?? newUnit)!.id;
  const moveIn = start ?? (doc.year ? `${doc.year}-01-01` : new Date().toISOString().slice(0, 8) + "01");
  const tenant: Tenant = {
    id: uid(),
    name: tenantName || "Mieter laut Mietvertrag",
    mailingAddress: "",
    propertyId: property.id,
    unitId,
    moveIn,
    moveOut: /^\d{4}-\d{2}-\d{2}$/.test(x.endDate) ? x.endDate : null,
    persons: x.persons ?? 1,
    deposit: x.deposit ?? 0,
    rentHistory: [period(moveIn)],
    lease,
    leaseDocIds: [doc.id],
  };
  update((d) => ({
    ...d,
    properties: newUnit ? d.properties.map((p) => (p.id === property.id ? { ...p, units: [...p.units, newUnit!] } : p)) : d.properties,
    tenants: [...d.tenants, tenant],
  }));
  return {
    result:
      `Mieter ${tenant.name} angelegt${newUnit ? `, Einheit „${newUnit.name}“ im Objekt ergänzt` : ""}` +
      ` – Miete, Vorauszahlungen und vereinbarte Betriebskosten aus dem Vertrag übernommen. Bitte im Mieterprofil prüfen${newUnit && !newUnit.area ? " und die Wohnfläche ergänzen" : ""}.`,
    link: `#/mieter?t=${tenant.id}`,
    year: Number(moveIn.slice(0, 4)),
  };
}

/** Mietstand aus dem ausgelesenen Mietvertrag */
export function rentPeriodFromLease(x: LeaseExtraction, validFrom: string): RentPeriod {
  return {
    ...newRentPeriod(validFrom),
    coldRent: x.coldRent ?? 0,
    surcharge: x.surcharge || undefined,
    prepaymentOperating: x.prepaymentOperating ?? 0,
    prepaymentHeating: x.prepaymentHeating ?? 0,
  };
}

/** Betriebskostenvereinbarung aus dem ausgelesenen Mietvertrag (null, wenn keine Kostenarten genannt sind) */
export function leaseFromExtraction(x: LeaseExtraction, fallbackReference: string): LeaseAgreement | null {
  return x.agreedCategories.length || x.otherCosts.length
    ? {
        reference: x.reference || fallbackReference,
        agreedCategories: [...new Set(x.agreedCategories)].sort((a, b) => a - b),
        otherCosts: x.otherCosts,
        allocationRule: x.allocationRule === "weg" ? "weg" : "consumption_mea",
        propertyTaxIndividual: x.propertyTaxIndividual,
        paymentTerm: x.paymentTerm === "30days" ? "30days" : "endOfNextMonth",
      }
    : null;
}

function statementLink(d: AppData, propertyId: string, year: number): string | undefined {
  const st = d.statements.find((s) => s.propertyId === propertyId && s.periodStart.startsWith(String(year)));
  return st ? `#/abrechnungen/${st.id}?f=anlagen` : undefined;
}

/** Ein abgelegtes Dokument erneut zuordnen, z. B. nachdem von Hand ein Objekt gewählt wurde */
export async function rerouteDocument(doc: StoredDocument, access: AiAccess, snapshot: AppData, update: Update): Promise<void> {
  patchDoc(update, doc.id, { ...doc, status: "processing", result: "Wird zugeordnet …", error: undefined });
  try {
    const ex = await import("./extract");
    const outcome = await route(doc, "", access, snapshot, update, ex);
    patchDoc(update, doc.id, { status: "done", ...outcome });
  } catch (e) {
    patchDoc(update, doc.id, { status: "error", error: (e as Error).message, result: "Abgelegt, aber nicht ausgewertet." });
  }
}
