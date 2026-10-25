import { deleteBlob, getBlob } from "./blobs";
import { uid } from "./model";
import type { AppData, Attachment, AttachmentKind, AttachmentPage, DocPage, PageCut, Redaction, WegAnnualStatement } from "./types";

export const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  wegAnnual: "Einzelabrechnung der WEG (umlagefähige Kosten)",
  heating: "Heizkostenabrechnung",
  propertyTax: "Grundsteuer- und Abgabenbescheid",
};

/** Kurzname für Auswahllisten */
export const ATTACHMENT_SHORT_LABELS: Record<AttachmentKind, string> = {
  wegAnnual: "WEG-Einzelabrechnung",
  heating: "Heizkostenabrechnung",
  propertyTax: "Grundsteuerbescheid",
};

/** Reihenfolge im Mieterschreiben: zuerst die WEG-Abrechnung */
export const ATTACHMENT_KINDS: AttachmentKind[] = ["wegAnnual", "heating", "propertyTax"];

export const attachmentLabel = (a: Pick<Attachment, "kind" | "year">) => `${ATTACHMENT_LABELS[a.kind]} ${a.year}`;

export function findAttachment(data: AppData, propertyId: string, year: number, kind: AttachmentKind): Attachment | undefined {
  return (data.attachments ?? []).find((a) => a.propertyId === propertyId && a.year === year && a.kind === kind);
}

/** Schwärzungen, die im Schreiben an diesen Mieter gelten (für alle + nur für ihn) */
export const redactionsFor = (page: AttachmentPage, tenantId: string | null): Redaction[] =>
  page.redactions.filter((r) => r.tenantId === null || r.tenantId === tenantId);

/** Hat die Seite Änderungen, die nur im gerenderten Bild sichtbar sind (herausgeschnittene Zeilen, überschriebene Beträge)? */
export const hasSheetEdits = (page: AttachmentPage) => (page.cuts?.length ?? 0) > 0 || (page.patches?.length ?? 0) > 0;

/** Papierton rund um eine Fläche (Median der Randpixel), damit Überschriebenes nicht als weißer Kasten auffällt */
function paperColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string {
  const pad = 4;
  const sx = Math.max(0, Math.floor(x - pad));
  const sy = Math.max(0, Math.floor(y - pad));
  const sw = Math.min(ctx.canvas.width - sx, Math.ceil(w + 2 * pad));
  const sh = Math.min(ctx.canvas.height - sy, Math.ceil(h + 2 * pad));
  const data = ctx.getImageData(sx, sy, sw, sh).data;
  const r: number[] = [], g: number[] = [], b: number[] = [];
  for (let yy = 0; yy < sh; yy++)
    for (let xx = 0; xx < sw; xx++) {
      if (xx >= pad && xx < sw - pad && yy >= pad && yy < sh - pad) continue;
      const i = (yy * sw + xx) * 4;
      r.push(data[i]), g.push(data[i + 1]), b.push(data[i + 2]);
    }
  // hellster Bereich der Randpixel – Schrift am Rand soll den Ton nicht verdunkeln
  const pick = (v: number[]) => v.sort((p, q) => p - q)[Math.floor(v.length * 0.7)] ?? 255;
  return `rgb(${pick(r)}, ${pick(g)}, ${pick(b)})`;
}

/** Seite als Bild: Schwärzungen, überschriebene Beträge, herausgeschnittene Zeilen – danach Teil des Bildes selbst */
export async function renderPage(page: AttachmentPage, tenantId: string | null): Promise<HTMLCanvasElement> {
  const blob = await getBlob(page.blobId);
  if (!blob) throw new Error(`Die Seite „${page.source}“ ist auf diesem Gerät nicht verfügbar.`);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const W = canvas.width, H = canvas.height;
  for (const p of page.patches ?? []) {
    ctx.fillStyle = paperColor(ctx, p.x * W, p.y * H, p.w * W, p.h * H);
    ctx.fillRect(p.x * W, p.y * H, p.w * W, p.h * H);
    // dunkel und leicht nachgezogen, damit es wie die gedruckten (fotografierten) Ziffern wirkt
    ctx.fillStyle = ctx.strokeStyle = "#151515";
    ctx.lineWidth = Math.max(0.5, p.fontSize * H * 0.035);
    ctx.font = `${Math.round(p.fontSize * H)}px Calibri, Carlito, "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    const tx = (p.x + p.w) * W - Math.max(2, p.h * H * 0.2);
    ctx.fillText(p.text, tx, p.baseline * H);
    ctx.strokeText(p.text, tx, p.baseline * H);
  }
  ctx.fillStyle = "#000";
  for (const r of redactionsFor(page, tenantId)) ctx.fillRect(r.x * W, r.y * H, r.w * W, r.h * H);
  return applyCuts(canvas, page.cuts ?? []);
}

/** Herausgeschnittene Streifen entfernen, der Rest rückt nach oben */
function applyCuts(src: HTMLCanvasElement, cuts: PageCut[]): HTMLCanvasElement {
  if (!cuts.length) return src;
  const H = src.height;
  const spans = [...cuts].map((c) => [Math.max(0, Math.round(c.y * H)), Math.min(H, Math.round((c.y + c.h) * H))] as const).sort((a, b) => a[0] - b[0]);
  const keep: [number, number][] = [];
  let y = 0;
  for (const [a, b] of spans) {
    if (a > y) keep.push([y, a]);
    y = Math.max(y, b);
  }
  if (y < H) keep.push([y, H]);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = keep.reduce((s, [a, b]) => s + b - a, 0);
  const ctx = out.getContext("2d")!;
  let to = 0;
  for (const [a, b] of keep) {
    ctx.drawImage(src, 0, a, src.width, b - a, 0, to, src.width, b - a);
    to += b - a;
  }
  return out;
}

/** Seitenbilder löschen, die nirgends mehr verwendet werden (weder Anlage noch WEG-Unterlage noch Belegablage) */
export function releaseUnusedBlobs(before: AppData, after: AppData) {
  const used = (d: AppData) =>
    new Set([
      ...(d.attachments ?? []).flatMap((a) => a.pages.map((p) => p.blobId)),
      ...d.wegAnnuals.flatMap((w) => (w.sourcePages ?? []).map((p) => p.blobId)),
      ...(d.documents ?? []).flatMap((doc) => doc.pages.map((p) => p.blobId)),
    ]);
  const keep = used(after);
  for (const id of used(before)) if (!keep.has(id)) void deleteBlob(id);
}

/** Seiten automatisch als Anlage übernehmen; bereits vorhandene Seiten (gleiches Bild) werden nicht doppelt angehängt */
export function autoAttach(d: AppData, propertyId: string, year: number, kind: AttachmentKind, pages: (DocPage & Partial<AttachmentPage>)[]): AppData {
  if (!pages.length) return d;
  const list = d.attachments ?? [];
  const current = list.find((a) => a.propertyId === propertyId && a.year === year && a.kind === kind);
  const known = new Set(current?.pages.map((p) => p.blobId));
  const added: AttachmentPage[] = pages.filter((p) => !known.has(p.blobId)).map((p) => ({ include: true, redactions: [], ...p, id: uid() }));
  if (!added.length) return d;
  const next: Attachment = current ? { ...current, pages: [...current.pages, ...added] } : { id: uid(), propertyId, year, kind, pages: added };
  return { ...d, attachments: current ? list.map((a) => (a === current ? next : a)) : [...list, next] };
}

/**
 * Einzelabrechnung der WEG für den Mieter (nur umlagefähige Zeilen, angepasste Summen) als erste Anlage anhängen.
 * Ersetzt eine vorhandene Fassung, Schwärzungen bleiben dabei nicht erhalten. false, wenn keine Seite erkennbar war.
 */
export async function attachTenantSheet(update: (fn: (d: AppData) => AppData) => void, annual: WegAnnualStatement): Promise<boolean> {
  const { tenantSheetPage } = await import("./wegSheet");
  const page = await tenantSheetPage(annual);
  if (!page) return false;
  update((d) => {
    const list = d.attachments ?? [];
    const current = list.find((a) => a.propertyId === annual.propertyId && a.year === annual.year && a.kind === "wegAnnual");
    const next: Attachment = {
      id: current?.id ?? uid(),
      propertyId: annual.propertyId,
      year: annual.year,
      kind: "wegAnnual",
      pages: [{ include: true, redactions: [], ...page, id: uid() }],
    };
    return { ...d, attachments: current ? list.map((a) => (a === current ? next : a)) : [...list, next] };
  });
  return true;
}

/** Seiten der Heizkostenabrechnung aus hochgeladenen WEG-Unterlagen (laut Auslese) */
export function heatingSourcePages(annual: WegAnnualStatement): DocPage[] {
  const pages = annual.sourcePages ?? [];
  return (annual.heatingPages ?? []).map((n) => pages[n - 1]).filter((p): p is DocPage => !!p);
}
