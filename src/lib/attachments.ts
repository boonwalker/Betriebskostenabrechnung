import { deleteBlob, getBlob } from "./blobs";
import { uid } from "./model";
import type { AppData, Attachment, AttachmentKind, AttachmentPage, DocPage, Redaction, WegAnnualStatement } from "./types";

export const ATTACHMENT_LABELS: Record<AttachmentKind, string> = {
  heating: "Heizkostenabrechnung",
  propertyTax: "Grundsteuer- und Abgabenbescheid",
};

export const ATTACHMENT_KINDS: AttachmentKind[] = ["heating", "propertyTax"];

export const attachmentLabel = (a: Pick<Attachment, "kind" | "year">) => `${ATTACHMENT_LABELS[a.kind]} ${a.year}`;

export function findAttachment(data: AppData, propertyId: string, year: number, kind: AttachmentKind): Attachment | undefined {
  return (data.attachments ?? []).find((a) => a.propertyId === propertyId && a.year === year && a.kind === kind);
}

/** Schwärzungen, die im Schreiben an diesen Mieter gelten (für alle + nur für ihn) */
export const redactionsFor = (page: AttachmentPage, tenantId: string | null): Redaction[] =>
  page.redactions.filter((r) => r.tenantId === null || r.tenantId === tenantId);

/** Seite als Bild mit Schwärzungen – die geschwärzten Stellen sind danach im Bild selbst überdeckt */
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
  ctx.fillStyle = "#000";
  for (const r of redactionsFor(page, tenantId)) ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
  return canvas;
}

/** Seitenbilder löschen, die nirgends mehr verwendet werden (auch nicht in WEG-Unterlagen) */
export function releaseUnusedBlobs(before: AppData, after: AppData) {
  const used = (d: AppData) =>
    new Set([...(d.attachments ?? []).flatMap((a) => a.pages.map((p) => p.blobId)), ...d.wegAnnuals.flatMap((w) => (w.sourcePages ?? []).map((p) => p.blobId))]);
  const keep = used(after);
  for (const id of used(before)) if (!keep.has(id)) void deleteBlob(id);
}

/** Seiten automatisch als Anlage übernehmen; bereits vorhandene Seiten (gleiches Bild) werden nicht doppelt angehängt */
export function autoAttach(d: AppData, propertyId: string, year: number, kind: AttachmentKind, pages: DocPage[]): AppData {
  if (!pages.length) return d;
  const list = d.attachments ?? [];
  const current = list.find((a) => a.propertyId === propertyId && a.year === year && a.kind === kind);
  const known = new Set(current?.pages.map((p) => p.blobId));
  const added: AttachmentPage[] = pages.filter((p) => !known.has(p.blobId)).map((p) => ({ ...p, id: uid(), include: true, redactions: [] }));
  if (!added.length) return d;
  const next: Attachment = current ? { ...current, pages: [...current.pages, ...added] } : { id: uid(), propertyId, year, kind, pages: added };
  return { ...d, attachments: current ? list.map((a) => (a === current ? next : a)) : [...list, next] };
}

/** Seiten der Heizkostenabrechnung aus hochgeladenen WEG-Unterlagen (laut Auslese) */
export function heatingSourcePages(annual: WegAnnualStatement): DocPage[] {
  const pages = annual.sourcePages ?? [];
  return (annual.heatingPages ?? []).map((n) => pages[n - 1]).filter((p): p is DocPage => !!p);
}
