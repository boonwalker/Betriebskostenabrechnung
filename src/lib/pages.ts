import { putBlob } from "./blobs";
import { uid } from "./model";
import type { DocPage } from "./types";

/** Längste Seite der gespeicherten Bilder: lesbar gedruckt, aber klein (rund 200–400 KB je Seite) */
const MAX_SIDE = 1800;
const QUALITY = 0.82;

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht erzeugt werden."))), "image/jpeg", QUALITY));
}

async function storeCanvas(canvas: HTMLCanvasElement, source: string): Promise<DocPage> {
  const blobId = await putBlob(await toJpeg(canvas));
  return { id: uid(), blobId, width: canvas.width, height: canvas.height, source };
}

async function imagePage(file: File): Promise<DocPage> {
  // createImageBitmap berücksichtigt die Ausrichtung aus den Kameradaten (EXIF)
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return storeCanvas(canvas, file.name);
}

async function pdfPages(file: File): Promise<DocPage[]> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: DocPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(await storeCanvas(canvas, `${file.name}, Seite ${n}`));
  }
  await doc.destroy();
  return pages;
}

/** Hochgeladene Fotos und PDFs als einzelne Seitenbilder speichern (PDFs Seite für Seite) */
export async function filesToPages(files: File[]): Promise<DocPage[]> {
  const out: DocPage[] = [];
  for (const f of files) {
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) out.push(...(await pdfPages(f)));
    else if (f.type.startsWith("image/")) out.push(await imagePage(f));
  }
  return out;
}
