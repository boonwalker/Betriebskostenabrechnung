import { useState } from "react";
import { PageImage } from "../components/Attachments";
import { UploadButtons } from "../components/UploadButtons";
import { Modal, type PageProps } from "../components/ui";
import { aiAccess, PROXY_URL } from "../lib/aiAccess";
import { releaseUnusedBlobs } from "../lib/attachments";
import { formatDate } from "../lib/dates";
import { DOCUMENT_KIND_LABELS, rerouteDocument } from "../lib/inbox";
import type { StoredDocument } from "../lib/types";
import { askConfirm } from "../components/dialog";

/** Belegeingang und Belegablage */
export default function Documents({ data, update, onUpload }: PageProps & { onUpload: (files: File[]) => void }) {
  const [viewing, setViewing] = useState<StoredDocument | null>(null);
  const access = aiAccess(data.settings);
  const docs = [...(data.documents ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const years = [...new Set(docs.map((d) => d.year))].sort((a, b) => (b ?? 0) - (a ?? 0));
  const propertyName = (id: string | null) => data.properties.find((p) => p.id === id)?.name;

  const remove = async (doc: StoredDocument) => {
    if (!(await askConfirm(`„${doc.title}“ aus der Ablage löschen? Bereits übernommene Daten und Anlagen bleiben erhalten.`, { confirmLabel: "Löschen", danger: true }))) return;
    update((d) => {
      const after = { ...d, documents: (d.documents ?? []).filter((x) => x.id !== doc.id) };
      releaseUnusedBlobs(d, after);
      return after;
    });
  };

  // Objekt von Hand zuordnen und das Dokument gleich an die passende Stelle bringen
  const setProperty = (doc: StoredDocument, propertyId: string) => {
    if (!propertyId) return;
    const next = { ...doc, propertyId };
    if (access) void rerouteDocument(next, access, data, update);
    else update((d) => ({ ...d, documents: (d.documents ?? []).map((x) => (x.id === doc.id ? next : x)) }));
  };

  return (
    <>
      <div className="page-head">
        <h1>Belege</h1>
      </div>

      <div className="card inbox-card">
        <h2 style={{ marginTop: 0 }}>Belegeingang</h2>
        <p className="small" style={{ marginTop: 0 }}>
          Fotografiere oder lade hoch, was gerade anfällt – Mietvertrag, WEG-Abrechnung, Wirtschaftsplan, Heizkostenabrechnung, Grundsteuerbescheid oder Rechnungen, gern
          mehrere gemischt. ImmoFriend erkennt die Dokumente, trägt sie an der richtigen Stelle ein und legt sie hier ab.
        </p>
        {access ? (
          <UploadButtons onFiles={onUpload} />
        ) : (
          <div className="alert info small">
            Zum Erkennen brauchst du {PROXY_URL ? "einen Einladungscode oder " : ""}einen API-Schlüssel – trage ihn in den{" "}
            <a href="#/einstellungen?f=belegerkennung">Einstellungen</a> ein.
          </div>
        )}
      </div>

      <h2>Belegablage</h2>
      {docs.length === 0 ? (
        <div className="card empty">
          <p className="muted">Noch keine Belege abgelegt.</p>
        </div>
      ) : (
        years.map((y) => (
          <section key={y ?? "ohne"} className="doc-year">
            <h3>{y ?? "Ohne Jahr"}</h3>
            <div className="doc-list">
              {docs
                .filter((d) => d.year === y)
                .map((doc) => (
                  <div key={doc.id} className={`doc-row ${doc.status}`}>
                    <button type="button" className="doc-thumb" onClick={() => doc.pages.length && setViewing(doc)} aria-label="Seiten ansehen">
                      {doc.pages[0] ? <PageImage page={doc.pages[0]} maxHeight="96px" /> : <span className="doc-thumb-empty">…</span>}
                    </button>
                    <div className="doc-body">
                      <div className="doc-title">
                        <span className={`badge ${doc.status === "error" ? "danger" : doc.status === "processing" ? "warn" : "neutral"}`}>
                          {doc.status === "processing" ? "in Arbeit" : DOCUMENT_KIND_LABELS[doc.kind]}
                        </span>
                        <strong>{doc.title}</strong>
                      </div>
                      <div className="small muted">
                        {propertyName(doc.propertyId) ?? "kein Objekt"} · {doc.pages.length} Seite{doc.pages.length === 1 ? "" : "n"} · hochgeladen {formatDate(doc.createdAt.slice(0, 10))}
                      </div>
                      {doc.result && <div className="small doc-result">{doc.result}</div>}
                      {doc.error && <div className="small danger-text">{doc.error}</div>}
                      <div className="row small doc-actions">
                        {doc.link && <a href={doc.link}>Öffnen →</a>}
                        {!doc.propertyId && doc.status !== "processing" && data.properties.length > 0 && (
                          <select value="" onChange={(e) => setProperty(doc, e.target.value)} aria-label="Objekt zuordnen">
                            <option value="">Objekt zuordnen …</option>
                            {data.properties.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        )}
                        <span className="spacer" />
                        {doc.status !== "processing" && (
                          <button className="ghost small" onClick={() => remove(doc)} aria-label="Beleg löschen">✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))
      )}

      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)}>
          <div className="stack">
            {viewing.pages.map((p) => (
              <PageImage key={p.id} page={p} />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
