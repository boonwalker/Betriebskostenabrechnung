import { useState } from "react";
import { aiAccess } from "../lib/aiAccess";
import { formatDate } from "../lib/dates";
import type { LeaseExtraction } from "../lib/extract";
import { uid } from "../lib/model";
import type { AppData, StoredDocument, Tenant } from "../lib/types";
import { PageImage } from "./Attachments";
import { Modal, type PageProps } from "./ui";
import { UploadButtons } from "./UploadButtons";

/** Hinterlegte Mietvertrags-Dokumente eines Mieters (gelöschte Belege fallen weg) */
export const leaseDocuments = (data: AppData, tenant: Tenant): StoredDocument[] =>
  (tenant.leaseDocIds ?? []).flatMap((id) => (data.documents ?? []).filter((d) => d.id === id));

/** Seiten eines Dokuments ansehen */
export function DocumentViewer({ doc, onClose }: { doc: StoredDocument; onClose: () => void }) {
  return (
    <Modal title={doc.title} onClose={onClose}>
      <div className="stack">
        {doc.pages.map((p) => (
          <PageImage key={p.id} page={p} />
        ))}
      </div>
    </Modal>
  );
}

/** Liste der Vertragsdokumente mit „ansehen“ */
export function LeaseDocumentList({ docs }: { docs: StoredDocument[] }) {
  const [viewing, setViewing] = useState<StoredDocument | null>(null);
  if (!docs.length) return null;
  return (
    <>
      <ul className="lease-docs">
        {docs.map((d) => (
          <li key={d.id}>
            <button type="button" className="lease-doc" onClick={() => setViewing(d)}>
              <span className="lease-doc-thumb">{d.pages[0] && <PageImage page={d.pages[0]} maxHeight="56px" />}</span>
              <span>
                <strong>{d.title}</strong>
                <span className="small muted">
                  {d.pages.length} Seite{d.pages.length === 1 ? "" : "n"} · hochgeladen {formatDate(d.createdAt.slice(0, 10))}
                </span>
              </span>
              <span className="small">Original ansehen →</span>
            </button>
          </li>
        ))}
      </ul>
      {viewing && <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * Ausgelesene Vertragsdaten ins Mieterformular übernehmen. Bei einem neuen Mieter gelten die Angaben aus dem Vertrag,
 * bei einem bestehenden werden nur leere Felder ergänzt.
 */
export async function applyLeaseExtraction(t: Tenant, x: LeaseExtraction, isNew: boolean, data: AppData, title: string): Promise<{ tenant: Tenant; taken: string[] }> {
  const { rentPeriodFromLease, leaseFromExtraction } = await import("../lib/inbox");
  const next: Tenant = { ...t };
  const taken: string[] = [];
  const names = x.tenantNames.filter(Boolean).join(" und ");
  if (names && (isNew || !t.name.trim())) {
    next.name = names;
    taken.push("Name");
  }
  const property = data.properties.find((p) => p.id === t.propertyId);
  const compact = (s: string) => s.toLowerCase().replace(/[\s.-]/g, "");
  const unit = x.unitName ? property?.units.find((u) => compact(u.name) === compact(x.unitName)) : undefined;
  if (unit && isNew) next.unitId = unit.id;
  if (!x.isAmendment && valid(x.startDate) && isNew) {
    next.moveIn = x.startDate;
    taken.push("Mietbeginn");
  }
  if (valid(x.endDate) && !t.moveOut) next.moveOut = x.endDate;
  if (x.persons && (isNew || !t.persons)) next.persons = x.persons;
  if (x.deposit && !t.deposit) {
    next.deposit = x.deposit;
    taken.push("Kaution");
  }
  const history = [...t.rentHistory].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const empty = history.every((r) => !r.coldRent && !r.prepaymentOperating && !r.prepaymentHeating);
  if (x.coldRent && x.isAmendment && valid(x.startDate) && !history.some((r) => r.validFrom === x.startDate)) {
    next.rentHistory = [...history, rentPeriodFromLease(x, x.startDate)];
    taken.push(`neuer Mietstand ab ${formatDate(x.startDate)}`);
  } else if (x.coldRent && (isNew || empty)) {
    next.rentHistory = [{ ...rentPeriodFromLease(x, next.moveIn), id: history[0]?.id ?? uid() }, ...history.slice(1)];
    taken.push("Miete und Vorauszahlungen");
  }
  const lease = leaseFromExtraction(x, title);
  if (lease && (isNew || !t.lease)) {
    next.lease = lease;
    taken.push("Betriebskostenvereinbarung");
  }
  return { tenant: next, taken };
}

/** Im Mieterformular: Mietvertrag fotografieren oder hochladen, ablegen und – mit Belegerkennung – Felder ausfüllen */
export function LeaseUploadSection({
  data,
  update,
  tenant,
  isNew,
  onChange,
}: {
  data: AppData;
  update: PageProps["update"];
  tenant: Tenant;
  isNew: boolean;
  onChange: (t: Tenant) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const access = aiAccess(data.settings);
  const docs = leaseDocuments(data, tenant);

  const add = async (files: File[]) => {
    setNote(null);
    setBusy("Seiten werden gespeichert …");
    try {
      const { filesToPages } = await import("../lib/pages");
      const pages = await filesToPages(files);
      const title = docs.length ? `Nachtrag zum Mietvertrag ${tenant.name}`.trim() : `Mietvertrag ${tenant.name}`.trim();
      const doc: StoredDocument = {
        id: uid(),
        createdAt: new Date().toISOString(),
        kind: "lease",
        title,
        year: Number(tenant.moveIn.slice(0, 4)) || null,
        propertyId: tenant.propertyId,
        pages,
        status: "done",
        result: "Im Mieterprofil hinterlegt.",
        link: `#/mieter?t=${tenant.id}`,
      };
      update((d) => ({ ...d, documents: [doc, ...(d.documents ?? [])] }));
      let next: Tenant = { ...tenant, leaseDocIds: [...(tenant.leaseDocIds ?? []), doc.id] };
      if (access) {
        setBusy("Vertrag wird ausgelesen …");
        try {
          const [{ extractLease }, { pageFiles }] = await Promise.all([import("../lib/extract"), import("../lib/inbox")]);
          const x = await extractLease(await pageFiles(pages), access);
          const r = await applyLeaseExtraction(next, x, isNew, data, title);
          next = r.tenant;
          const named = `${x.isAmendment ? "Nachtrag zum Mietvertrag" : "Mietvertrag"} ${next.name}`.trim();
          update((d) => ({ ...d, documents: (d.documents ?? []).map((y) => (y.id === doc.id ? { ...y, title: named, year: Number(next.moveIn.slice(0, 4)) } : y)) }));
          setNote({ text: r.taken.length ? `Aus dem Vertrag übernommen: ${r.taken.join(", ")}. Bitte prüfen und speichern.` : "Vertrag hinterlegt – die erfassten Angaben bleiben unverändert." });
        } catch (e) {
          setNote({ text: `Vertrag hinterlegt, aber nicht ausgelesen: ${(e as Error).message}`, error: true });
        }
      } else {
        setNote({ text: "Vertrag hinterlegt. Zum automatischen Ausfüllen brauchst du einen Einladungscode oder API-Schlüssel (Einstellungen)." });
      }
      onChange(next);
    } catch (e) {
      setNote({ text: `Konnte nicht gespeichert werden: ${(e as Error).message}`, error: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="mietvertrag" className={`card stack lease-upload ${isNew && !docs.length ? "prominent" : ""}`} style={{ marginBottom: 0 }}>
      <div>
        <h3 style={{ margin: 0 }}>{isNew && !docs.length ? "Hast du den Mietvertrag zur Hand?" : "Mietvertrag"}</h3>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {isNew && !docs.length
            ? access
              ? "Fotografiere ihn oder lade ihn hoch – ImmoFriend füllt Name, Mietbeginn, Miete, Vorauszahlungen, Kaution und die vereinbarten Betriebskosten aus und hinterlegt den Vertrag im Mieterprofil."
              : "Fotografiere ihn oder lade ihn hoch – er wird im Mieterprofil hinterlegt."
            : "Vertrag und Nachträge (z. B. Mieterhöhung) – im Mieterprofil mit dem Original verknüpft."}
        </p>
      </div>
      <LeaseDocumentList docs={docs} />
      {busy ? <div className="small muted">⏳ {busy}</div> : <UploadButtons compact onFiles={add} labels={docs.length ? ["Nachtrag fotografieren", "Nachtrag hochladen"] : ["Mietvertrag fotografieren", "Mietvertrag hochladen"]} />}
      {note && <div className={`alert ${note.error ? "danger" : "info"} small`} style={{ margin: 0 }}>{note.text}</div>}
    </div>
  );
}
