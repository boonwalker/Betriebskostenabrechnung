import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ATTACHMENT_KINDS, ATTACHMENT_LABELS, findAttachment, redactionsFor, releaseUnusedBlobs } from "../lib/attachments";
import { getBlob } from "../lib/blobs";
import { uid } from "../lib/model";
import type { AppData, Attachment, AttachmentKind, AttachmentPage, DocPage, Property, Redaction, Tenant } from "../lib/types";
import { Modal, type PageProps } from "./ui";

/** Objekt-URL für ein gespeichertes Seitenbild */
function useBlobUrl(blobId: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    getBlob(blobId).then((b) => {
      if (!alive) return;
      made = b ? URL.createObjectURL(b) : null;
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [blobId]);
  return url;
}

/** Seitenbild mit schwarzen Flächen; `tenantId` undefined = nur Schwärzungen für alle */
export function PageImage({ page, redactions = [], maxHeight }: { page: DocPage; redactions?: Redaction[]; maxHeight?: string }) {
  const url = useBlobUrl(page.blobId);
  // Höhe nur über die Breite begrenzen, damit die schwarzen Flächen genau auf dem Bild liegen
  const width = maxHeight ? `min(100%, calc(${maxHeight} * ${page.width / page.height}))` : undefined;
  return (
    <div className="page-image" style={{ aspectRatio: `${page.width} / ${page.height}`, width, marginInline: maxHeight ? "auto" : undefined }}>
      {url ? <img src={url} alt={page.source} draggable={false} /> : <span className="muted small">{url === null ? "Bild auf diesem Gerät nicht verfügbar" : "lädt …"}</span>}
      {redactions.map((r) => (
        <span key={r.id} className="redaction" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
      ))}
    </div>
  );
}

/** Karte in der Abrechnung: Heizkostenabrechnung und Grundsteuer-/Abgabenbescheid als Anlagen fürs Mieterschreiben */
export function AttachmentsCard({ data, update, property, year, tenants }: PageProps & { property: Property; year: number; tenants: Tenant[] }) {
  const [busy, setBusy] = useState<AttachmentKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{ kind: AttachmentKind; pageId: string } | null>(null);
  const annual = data.wegAnnuals.find((w) => w.propertyId === property.id && w.year === year && (w.sourcePages?.length ?? 0) > 0);

  const change = (kind: AttachmentKind, fn: (pages: AttachmentPage[]) => AttachmentPage[]) =>
    update((d) => {
      const list = d.attachments ?? [];
      const current = list.find((a) => a.propertyId === property.id && a.year === year && a.kind === kind);
      const pages = fn(current?.pages ?? []);
      const next: Attachment = current ? { ...current, pages } : { id: uid(), propertyId: property.id, year, kind, pages };
      const after = { ...d, attachments: current ? list.map((a) => (a === current ? next : a)) : [...list, next] };
      releaseUnusedBlobs(d, after);
      return after;
    });

  const addPages = (kind: AttachmentKind, pages: DocPage[]) =>
    change(kind, (old) => [...old, ...pages.map((p) => ({ ...p, id: uid(), include: true, redactions: [] }))]);

  // Dateien als Kopie übergeben: das Zurücksetzen des Dateifelds leert die ursprüngliche Liste
  const upload = async (kind: AttachmentKind, files: File[]) => {
    if (!files.length) return;
    setBusy(kind);
    setError(null);
    try {
      const { filesToPages } = await import("../lib/pages");
      addPages(kind, await filesToPages(files));
    } catch (e) {
      setError(`Die Datei konnte nicht übernommen werden: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const editingPage = editing ? findAttachment(data, property.id, year, editing.kind)?.pages.find((p) => p.id === editing.pageId) : undefined;

  return (
    <div className="card" id="anlagen">
      <h2>Anlagen für das Mieterschreiben</h2>
      <p className="hint">
        Diese Seiten werden jedem Mieterschreiben angehängt – im Ausdruck und im PDF. Die Heizkostenabrechnung aus hochgeladenen WEG-Unterlagen und ein über
        „Belege hochladen“ erkannter Bescheid der Gemeinde werden automatisch übernommen. Schwärze, was der jeweilige Mieter nicht sehen soll (z. B. Name und Verbrauch
        des Vor- oder Nachmieters). Die Originale bleiben unverändert gespeichert.
      </p>
      {error && <div className="alert danger small">{error}</div>}
      {ATTACHMENT_KINDS.map((kind) => {
        const att = findAttachment(data, property.id, year, kind);
        const pages = att?.pages ?? [];
        return (
          <div key={kind} className="attachment-group">
            <div className="row">
              <h3 style={{ margin: 0 }}>
                {ATTACHMENT_LABELS[kind]} {year}
              </h3>
              <span className="muted small">{pages.filter((p) => p.include).length} von {pages.length} Seiten beigefügt</span>
              <span className="spacer" />
              {kind === "heating" && annual && (
                <button className="small" onClick={() => setPicking(true)}>Aus WEG-Unterlagen wählen</button>
              )}
              <label className={`btn small ${busy === kind ? "disabled" : ""}`}>
                {busy === kind ? "Wird übernommen …" : "+ Fotos / PDF"}
                <input type="file" multiple accept="application/pdf,image/*" hidden disabled={busy !== null} onChange={(e) => { void upload(kind, [...(e.target.files ?? [])]); e.target.value = ""; }} />
              </label>
            </div>
            {pages.length === 0 ? (
              <p className="muted small">
                {kind === "heating"
                  ? "Noch keine Seiten. Wähle sie aus den hochgeladenen WEG-Unterlagen oder lade die Heizkostenabrechnung hoch."
                  : "Noch keine Seiten. Lade den Bescheid der Gemeinde (Grundsteuer und Müll) als Foto oder PDF hoch."}
              </p>
            ) : (
              <div className="attachment-pages">
                {pages.map((p, i) => (
                  <div key={p.id} className={`attachment-thumb ${p.include ? "" : "excluded"}`}>
                    <button type="button" className="thumb-open" onClick={() => setEditing({ kind, pageId: p.id })} title="Schwärzen">
                      <PageImage page={p} redactions={p.redactions.filter((r) => r.tenantId === null)} maxHeight="200px" />
                    </button>
                    <div className="thumb-bar">
                      <label className="row small" title="dem Mieterschreiben beifügen">
                        <input type="checkbox" checked={p.include} onChange={(e) => change(kind, (old) => old.map((x) => (x.id === p.id ? { ...x, include: e.target.checked } : x)))} />
                        Seite {i + 1}
                      </label>
                      <span className="spacer" />
                      <button className="ghost small" aria-label="Seite entfernen" onClick={() => confirm("Seite entfernen?") && change(kind, (old) => old.filter((x) => x.id !== p.id))}>
                        ✕
                      </button>
                    </div>
                    <button className="ghost small thumb-redact" onClick={() => setEditing({ kind, pageId: p.id })}>
                      Schwärzen{p.redactions.length ? ` (${p.redactions.length})` : ""}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {picking && annual && (
        <PagePicker
          pages={annual.sourcePages ?? []}
          already={new Set(findAttachment(data, property.id, year, "heating")?.pages.map((p) => p.blobId))}
          onClose={() => setPicking(false)}
          onPick={(pages) => {
            addPages("heating", pages);
            setPicking(false);
          }}
        />
      )}
      {editing && editingPage && (
        <RedactionEditor
          page={editingPage}
          tenants={tenants}
          onClose={() => setEditing(null)}
          onChange={(redactions) => change(editing.kind, (old) => old.map((x) => (x.id === editingPage.id ? { ...x, redactions } : x)))}
        />
      )}
    </div>
  );
}

/** Seiten aus den hochgeladenen WEG-Unterlagen auswählen (z. B. die Heizkostenabrechnung) */
function PagePicker({ pages, already, onClose, onPick }: { pages: DocPage[]; already: Set<string>; onClose: () => void; onPick: (pages: DocPage[]) => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  return (
    <Modal title="Seiten der Heizkostenabrechnung wählen" onClose={onClose}>
      <p className="small muted">Tippe die Seiten an, die zur Heizkostenabrechnung gehören. Die Einzelabrechnung der WEG gehört nicht zum Mieterschreiben.</p>
      <div className="attachment-pages">
        {pages.map((p, i) => {
          const on = chosen.has(p.id);
          const used = already.has(p.blobId);
          return (
            <button
              key={p.id}
              type="button"
              className={`attachment-thumb pick ${on ? "picked" : ""}`}
              disabled={used}
              onClick={() => setChosen((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
            >
              <PageImage page={p} maxHeight="200px" />
              <span className="thumb-bar small">{used ? "bereits Anlage" : `${on ? "✓ " : ""}Seite ${i + 1}`}</span>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <button onClick={onClose}>Abbrechen</button>
        <button className="primary" disabled={chosen.size === 0} onClick={() => onPick(pages.filter((p) => chosen.has(p.id)))}>
          {chosen.size} Seite{chosen.size === 1 ? "" : "n"} übernehmen
        </button>
      </div>
    </Modal>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Rechtecke über eine Seite ziehen – für alle Schreiben oder nur für das Schreiben an einen Mieter.
 * Ein Finger schwärzt, zwei Finger zoomen und verschieben; am Rechner per Knöpfen oder Strg + Mausrad.
 */
function RedactionEditor({ page, tenants, onClose, onChange }: { page: AttachmentPage; tenants: Tenant[]; onClose: () => void; onChange: (r: Redaction[]) => void }) {
  const [scope, setScope] = useState<string | null>(null);
  const [draft, setDraft] = useState<Redaction | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; px: number; py: number } | null>(null);
  // nach einer Zwei-Finger-Geste nicht mit dem verbleibenden Finger weiterzeichnen
  const blocked = useRef(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  // Scrollposition erst setzen, wenn die neue Zoomstufe gerendert ist
  useLayoutEffect(() => {
    const vp = viewport.current;
    if (vp && pendingScroll.current) {
      vp.scrollLeft = pendingScroll.current.left;
      vp.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);

  /** Auf eine Zoomstufe gehen, sodass der Seitenpunkt unter (clientX, clientY) dort bleibt bzw. dorthin wandert */
  const zoomAt = (next: number, from: number, contentX: number, contentY: number, clientX: number, clientY: number) => {
    const vp = viewport.current;
    if (!vp) return;
    const z = clampZoom(next);
    const r = vp.getBoundingClientRect();
    const scroll = { left: (contentX * z) / from - (clientX - r.left), top: (contentY * z) / from - (clientY - r.top) };
    pendingScroll.current = scroll;
    if (z === zoom) {
      vp.scrollLeft = scroll.left;
      vp.scrollTop = scroll.top;
      pendingScroll.current = null;
    } else setZoom(z);
  };

  // Knöpfe: um die Mitte des sichtbaren Ausschnitts zoomen
  const zoomBy = (factor: number) => {
    const vp = viewport.current;
    if (!vp) return;
    const r = vp.getBoundingClientRect();
    zoomAt(zoom * factor, zoom, vp.scrollLeft + r.width / 2, vp.scrollTop + r.height / 2, r.left + r.width / 2, r.top + r.height / 2);
  };

  // Strg + Mausrad bzw. Trackpad-Geste am Rechner (muss „passive: false“ sein, um das Browser-Zoomen zu verhindern)
  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomAt(zoom * Math.exp(-e.deltaY / 200), zoom, vp.scrollLeft + e.clientX - r.left, vp.scrollTop + e.clientY - r.top, e.clientX, e.clientY);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  });

  const point = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Redaction => ({
    id: uid(),
    tenantId: scope,
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).classList.contains("redaction") && pointers.current.size === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // zweiter Finger: Zeichnen abbrechen, Zoomen beginnen
      start.current = null;
      setDraft(null);
      blocked.current = true;
      const vp = viewport.current!;
      const r = vp.getBoundingClientRect();
      const { dist, cx, cy } = twoFingers();
      pinch.current = { dist, zoom, px: vp.scrollLeft + cx - r.left, py: vp.scrollTop + cy - r.top };
    } else if (pointers.current.size === 1 && !blocked.current) {
      const p = point(e);
      start.current = { ...p, id: e.pointerId };
      setDraft(rectFrom(p, p));
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const { dist, cx, cy } = twoFingers();
      const p = pinch.current;
      zoomAt(p.zoom * (dist / p.dist), p.zoom, p.px, p.py, cx, cy);
    } else if (start.current?.id === e.pointerId) setDraft(rectFrom(start.current, point(e)));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) blocked.current = false;
    if (start.current?.id !== e.pointerId) return;
    const r = rectFrom(start.current, point(e));
    start.current = null;
    setDraft(null);
    if (e.type === "pointerup" && r.w > 0.005 && r.h > 0.003) onChange([...page.redactions, r]);
  };

  const shown = redactionsFor(page, scope);
  const tenantName = (id: string | null) => (id === null ? "alle" : tenants.find((t) => t.id === id)?.name ?? "?");

  return (
    <Modal title="Schwärzen" onClose={onClose}>
      <p className="small muted">
        Ziehe mit einem Finger oder der Maus ein Rechteck über die Stelle. Mit zwei Fingern zoomst und verschiebst du (am Rechner: Strg + Mausrad). Tippe
        auf eine schwarze Fläche, um sie wieder zu entfernen.
      </p>
      <div className="row small" style={{ marginBottom: 10 }}>
        <span className="muted">Gilt für:</span>
        <button className={`chip ${scope === null ? "active" : ""}`} onClick={() => setScope(null)}>alle Schreiben</button>
        {tenants.map((t) => (
          <button key={t.id} className={`chip ${scope === t.id ? "active" : ""}`} onClick={() => setScope(t.id)}>
            nur an {t.name}
          </button>
        ))}
      </div>
      <div className="row small zoom-bar">
        <button className="small" onClick={() => zoomBy(1 / 1.5)} disabled={zoom <= MIN_ZOOM} aria-label="Verkleinern">−</button>
        <span className="zoom-value">{Math.round(zoom * 100)} %</span>
        <button className="small" onClick={() => zoomBy(1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Vergrößern">+</button>
        {zoom > 1 && <button className="ghost small" onClick={() => setZoom(1)}>Ganze Seite</button>}
      </div>
      <div ref={viewport} className="redaction-viewport">
        <div
          ref={box}
          className="redaction-canvas"
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <PageImage page={page} />
          {shown.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`redaction ${r.tenantId ? "scoped" : ""}`}
              title={`Schwärzung für ${tenantName(r.tenantId)} – antippen zum Entfernen`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
              onClick={() => onChange(page.redactions.filter((x) => x.id !== r.id))}
            />
          ))}
          {draft && <span className="redaction draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%` }} />}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {page.redactions.length === 0
          ? "Noch nichts geschwärzt."
          : `${page.redactions.length} Schwärzung${page.redactions.length === 1 ? "" : "en"}: ` +
            [...new Set(page.redactions.map((r) => r.tenantId))].map((id) => `${page.redactions.filter((r) => r.tenantId === id).length}× für ${tenantName(id)}`).join(", ")}
      </p>
      <div className="row">
        <span className="spacer" />
        <button className="primary" onClick={onClose}>Fertig</button>
      </div>
    </Modal>
  );
}

/** Für Druckansicht und PDF: die beigefügten Seiten aller Anlagen eines Jahres */
export function includedAttachments(data: AppData, propertyId: string, year: number): Attachment[] {
  return ATTACHMENT_KINDS.map((k) => findAttachment(data, propertyId, year, k)).filter((a): a is Attachment => !!a && a.pages.some((p) => p.include));
}
