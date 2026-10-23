import { deleteBlob, getBlob } from "./blobs";
import type { AppData, Attachment, AttachmentKind, AttachmentPage, Redaction } from "./types";

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
