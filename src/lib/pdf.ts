/**
 * PDF der Anschreiben direkt im Browser: jedes Anschreiben wird als A4-Bild gerendert und an
 * Absatz- bzw. Tabellenzeilengrenzen auf Seiten verteilt – nie mitten durch eine Zeile.
 * Die Bibliotheken werden erst beim Klick geladen.
 */

import { renderPage } from "./attachments";
import type { AttachmentPage } from "./types";

const A4_W_MM = 210;
const A4_H_MM = 297;
/** Breite, in der die Seite gerendert wird: 210 mm bei 96 dpi */
const PAGE_W_PX = 794;
const PX_PER_MM = PAGE_W_PX / A4_W_MM;
// Seitenränder wie beim Drucken (@page): oben 15, rechts 20, unten 12, links 25 mm
const TOP_MM = 15;
const BOTTOM_MM = 12;

/** Elemente, nach denen umbrochen werden darf (Unterkante); Überschriften nicht, damit sie bei ihrem Abschnitt bleiben */
const BREAKABLE = "p, tr, .letter-head, .letter-title, .letter-summary, .letter-notes > *, .letter-closing, table";

/** Eine Anlagenseite, die hinter einem Anschreiben folgt (mit den Schwärzungen für dessen Empfänger) */
export interface PdfAttachmentPage {
  page: AttachmentPage;
  label: string;
  tenantId: string | null;
}

export async function lettersToPdf(letters: { el: HTMLElement; attachments: PdfAttachmentPage[] }[]): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  let first = true;

  for (const { el, attachments } of letters) {
    // Fußzeile nicht mitrendern, sondern unten auf jede Seite des Anschreibens setzen (mit Seitenzahl)
    const foot = [...el.querySelectorAll(".letter-foot > span")].map((n) => (n.textContent ?? "").trim());
    const letterPages: number[] = [];
    let breaks: number[] = [];
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      // Eigene Fensterbreite für die Kopie: Handy-Darstellung (Media Queries) greift dann nicht
      windowWidth: 1100,
      onclone: (doc, clone) => {
        // Druckformatierung (@media print) übernehmen, damit das PDF genau wie der Ausdruck aussieht
        const printCss: string[] = [];
        for (const sheet of [...doc.styleSheets]) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of [...rules]) {
            if ("media" in rule && /print/.test((rule as CSSMediaRule).media.mediaText)) {
              for (const inner of [...(rule as CSSMediaRule).cssRules]) if (!inner.cssText.startsWith("@page")) printCss.push(inner.cssText);
            }
          }
        }
        // iOS-Textvergrößerung abschalten: Die Kopie ist 1100 px breit, auf dem Handy würde Safari
        // längere Absätze sonst stark vergrößern (Briefkopf klein, Fließtext riesig)
        printCss.push("html, body, * { -webkit-text-size-adjust: 100% !important; text-size-adjust: 100% !important; }");
        const style = doc.createElement("style");
        style.textContent = printCss.join("\n");
        doc.head.appendChild(style);
        clone.style.margin = "0";
        clone.style.border = "none";
        clone.style.padding = "0 20mm 0 25mm";
        clone.style.boxSizing = "border-box";
        clone.style.width = `${PAGE_W_PX}px`;
        clone.style.maxWidth = `${PAGE_W_PX}px`;
        clone.querySelectorAll(".letter-foot").forEach((n) => n.remove());
        const top = clone.getBoundingClientRect().top;
        const inClosing = (n: Element) => !n.classList.contains("letter-closing") && n.closest(".letter-closing");
        breaks = [...clone.querySelectorAll(BREAKABLE)]
          .filter((n) => !inClosing(n))
          .map((n) => n.getBoundingClientRect().bottom - top)
          .sort((a, b) => a - b);
      },
    });

    const scale = canvas.width / PAGE_W_PX;
    const total = canvas.height / scale;
    let y = 0;
    while (y < total - 1) {
      const top = TOP_MM * PX_PER_MM;
      const room = A4_H_MM * PX_PER_MM - top - BOTTOM_MM * PX_PER_MM;
      let end = Math.min(total, y + room);
      if (end < total) {
        // letzte erlaubte Umbruchstelle innerhalb der Seite; ohne passende Stelle hart schneiden
        const candidates = breaks.filter((b) => b > y + 40 && b <= end);
        if (candidates.length) end = candidates[candidates.length - 1];
      }
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.ceil((end - y) * scale);
      slice.getContext("2d")!.drawImage(canvas, 0, Math.floor(y * scale), canvas.width, slice.height, 0, 0, canvas.width, slice.height);

      if (!first) pdf.addPage();
      first = false;
      letterPages.push(pdf.getNumberOfPages());
      pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, top / PX_PER_MM, A4_W_MM, (end - y) / PX_PER_MM);
      y = end;
    }
    drawFooter(pdf, foot, letterPages);

    // Anlagen: je Seite ein Blatt, Bild innerhalb der Ränder eingepasst, Bezeichnung darüber
    const counts = new Map<string, number>();
    for (const a of attachments) counts.set(a.label, (counts.get(a.label) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const a of attachments) {
      const n = (seen.get(a.label) ?? 0) + 1;
      seen.set(a.label, n);
      const canvas = await renderPage(a.page, a.tenantId);
      const boxX = 20, boxY = 22, boxW = A4_W_MM - 40, boxH = A4_H_MM - boxY - 12;
      const f = Math.min(boxW / canvas.width, boxH / canvas.height);
      const w = canvas.width * f, h = canvas.height * f;
      pdf.addPage();
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(91, 107, 120);
      pdf.text(`Anlage: ${a.label}${(counts.get(a.label) ?? 1) > 1 ? ` · Seite ${n} von ${counts.get(a.label)}` : ""}`, boxX, 17);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.85), "JPEG", boxX + (boxW - w) / 2, boxY, w, h);
    }
  }
  return pdf.output("blob");
}

/** Fußzeile wie in der Vorschau: Linie, links Abrechnung und Einheit, rechts die Anschrift; ab zwei Seiten mit Seitenzahl */
function drawFooter(pdf: import("jspdf").jsPDF, [left = "", right = ""]: string[], pages: number[]) {
  const x1 = 25, x2 = A4_W_MM - 20, line = A4_H_MM - 9.5, base = A4_H_MM - 6.5;
  pages.forEach((n, i) => {
    pdf.setPage(n);
    pdf.setDrawColor(217, 225, 229);
    pdf.setLineWidth(0.2);
    pdf.line(x1, line, x2, line);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(91, 107, 120);
    pdf.text(pages.length > 1 ? `${left} · Seite ${i + 1} von ${pages.length}` : left, x1, base);
    pdf.text(right, x2, base, { align: "right" });
  });
  if (pages.length) pdf.setPage(pages[pages.length - 1]);
}

type Downloads = { save(r: { filename: string; data: Blob }): Promise<{ status: string }> };

/**
 * Datei übergeben: in der Claude-Vorschau über deren Speichern-Dialog, auf Touch-Geräten über das
 * Teilen-Menü (Sichern in Dateien, Mail …), sonst als Download.
 */
export async function deliverPdf(blob: Blob, filename: string): Promise<"saved" | "shared" | "downloaded" | "cancelled"> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (claude?.use) {
    const downloads = (await claude.use("downloads").catch(() => null)) as Downloads | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return "saved";
      } catch (e) {
        if ((e as { code?: string }).code === "declined") return "cancelled";
        // andere Fehler: unten weiter mit Teilen bzw. Download
      }
    }
  }

  const file = new File([blob], filename, { type: "application/pdf" });
  const touch = window.matchMedia?.("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}
