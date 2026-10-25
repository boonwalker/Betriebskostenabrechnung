/**
 * Einzelabrechnung der WEG als Anlage fürs Mieterschreiben: nicht umlagefähige Zeilen werden aus dem Foto
 * herausgeschnitten, die Summen der Tabelle auf die umlagefähigen Beträge umgeschrieben und der Block mit
 * Kostenanteil, Vorschüssen und Abrechnungsspitze (nur Eigentümer) entfernt.
 *
 * Die KI liefert die ungefähre Lage der Zeilen; die App richtet sie an den tatsächlichen Textzeilen im Bild aus.
 */
import { getBlob } from "./blobs";
import { uid } from "./model";
import type { DocPage, PageCut, TextPatch, WegAnnualStatement } from "./types";

/** Textzeile im Bild: erste und erste nicht mehr dunkle Pixelzeile */
export type Band = [number, number];

/** Graustufenbild */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

/** dunkle Pixel: deutlich dunkler als das Papier der jeweiligen Zeile */
function darkMask(img: Gray): Uint8Array {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let x = 0; x < w; x++) hist[data[y * w + x]]++;
    // Papierton der Zeile: 70-%-Quantil (Text macht nur einen kleinen Teil aus)
    let acc = 0, paper = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= w * 0.7) {
        paper = v;
        break;
      }
    }
    const limit = paper - 60;
    for (let x = 0; x < w; x++) mask[y * w + x] = data[y * w + x] < limit ? 1 : 0;
  }
  return mask;
}

/**
 * Textzeilen: zusammenhängende Pixelzeilen mit Schrift. Tabellenlinien (über weite Strecken dunkel) trennen
 * Zeilen und gehören nie dazu – so werden sie beim Herausschneiden nicht mit entfernt.
 */
export function textBands(img: Gray, mask = darkMask(img)): Band[] {
  const { width: w, height: h } = img;
  const x0 = Math.floor(w * 0.04), x1 = Math.ceil(w * 0.97);
  const bands: Band[] = [];
  let start = -1;
  for (let y = 0; y <= h; y++) {
    let n = 0, run = 0, longest = 0, gap = 0;
    if (y < h)
      for (let x = x0; x < x1; x++) {
        const ink = mask[y * w + x];
        n += ink;
        // durchgehender Strich (kleine Lücken erlaubt) = Linie, Schrift besteht aus kurzen Stücken
        if (ink) (run += 1 + gap), (gap = 0);
        else if (run && ++gap > 3) (run = 0), (gap = 0);
        if (run > longest) longest = run;
      }
    if (longest > (x1 - x0) * 0.3) n = 0; // Linie
    if (n > 3 && start < 0) start = y;
    if ((n <= 3 || y === h) && start >= 0) {
      if (y - start >= 4) bands.push([start, y]);
      start = -1;
    }
  }
  return bands;
}

/** Linker und rechter Rand der Schrift einer Zeile */
export function inkExtent(img: Gray, band: Band, mask = darkMask(img)): [number, number] {
  const { width: w } = img;
  let l = w, r = -1;
  for (let y = band[0]; y < band[1]; y++)
    for (let x = Math.floor(w * 0.02); x < Math.ceil(w * 0.99); x++)
      if (mask[y * w + x]) {
        if (x < l) l = x;
        if (x > r) r = x;
      }
  return [l, r + 1];
}

/** Waagerechte Textblöcke innerhalb einer Zeile (z. B. die einzelnen Beträge), Lücken unter `gap` px zusammengefasst */
export function inkRuns(img: Gray, band: Band, gap: number, mask = darkMask(img)): [number, number][] {
  const { width: w } = img;
  const runs: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= w; x++) {
    let ink = false;
    if (x < w) for (let y = band[0]; y < band[1] && !ink; y++) ink = mask[y * w + x] === 1;
    if (ink && start < 0) start = x;
    if (!ink && start >= 0) {
      const last = runs[runs.length - 1];
      if (last && start - last[1] < gap) last[1] = x;
      else runs.push([start, x]);
      start = -1;
    }
  }
  return runs;
}

const euro = (n: number) => `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`;
const cents = (n: number) => Math.round(n * 100);

export interface SheetPlan {
  cuts: PageCut[];
  patches: TextPatch[];
  /** was die App nicht sicher zuordnen konnte */
  problems: string[];
}

type Target = { key: string; top: number; bottom: number };

/**
 * Textzeilen den geschätzten Bereichen zuordnen: erst einen gemeinsamen Versatz der Schätzung herausrechnen
 * (Fotos sind oft etwas verschoben), dann jede Textzeile dem nächstgelegenen Bereich geben.
 */
function assignBands(bands: Band[], targets: Target[], H: number): Map<string, number[]> {
  const centers = bands.map((b) => (b[0] + b[1]) / 2);
  const inBand = (y: number) => bands.some((b) => y >= b[0] - 1 && y <= b[1] + 1);
  let shift = 0, best = -1;
  for (let d = -0.04 * H; d <= 0.04 * H; d += 1) {
    // Treffer: Mitte bzw. Oberkante des Bereichs liegt in einer Textzeile; kleiner Versatz bevorzugt
    const score = targets.reduce((n, t) => n + (inBand((t.top + t.bottom) / 2 + d) || inBand(t.top + d + 2) ? 1 : 0), 0) - Math.abs(d) / H;
    if (score > best) (best = score), (shift = d);
  }
  const result = new Map<string, number[]>();
  const tol = 0.015 * H;
  centers.forEach((c, i) => {
    let key = "", dist = Infinity;
    for (const t of targets) {
      const top = t.top + shift, bottom = t.bottom + shift;
      const d = c < top ? top - c : c > bottom ? c - bottom : 0;
      const tie = Math.abs(c - (top + bottom) / 2) / H / 1000;
      if (d + tie < dist) (dist = d + tie), (key = t.key);
    }
    if (key && dist <= tol) result.set(key, [...(result.get(key) ?? []), i]);
  });
  return result;
}

/** Ergebnis der Strukturerkennung: Textzeilen je Position (in Reihenfolge), Summenzeile, Eigentümerblock */
export interface SheetStructure {
  rows: number[][];
  sum: number;
  owner: number[];
}

/**
 * Tabelle über ihre Struktur erkennen: Positionszeilen haben links eine Bezeichnung und rechts einen Betrag,
 * Fortsetzungszeilen (z. B. „WE 06“) nur links Text, die Summenzeile nur rechts. Die letzten `count`
 * Betragszeilen vor der Summenzeile sind die Positionen – in derselben Reihenfolge wie in der Auslese.
 */
export function findStructure(bands: Band[], extents: [number, number][], width: number, count: number): SheetStructure | null {
  const labelled = (i: number) => extents[i][0] < width * 0.35;
  const amount = (i: number) => extents[i][1] > width * 0.85;
  let seen = 0;
  for (let i = 0; i < bands.length; i++) {
    if (labelled(i) && amount(i)) seen++;
    else if (!labelled(i) && amount(i) && seen >= count && count > 0) {
      const amountRows = bands.slice(0, i).flatMap((_, j) => (labelled(j) && amount(j) ? [j] : [])).slice(-count);
      const rows = amountRows.map((j, k) => {
        const until = k + 1 < amountRows.length ? amountRows[k + 1] : i;
        const cont: number[] = [];
        for (let c = j + 1; c < until && labelled(c) && !amount(c); c++) cont.push(c);
        return [j, ...cont];
      });
      // Eigentümerblock: folgende Zeilen ohne Bezeichnung links, ohne große Lücke
      const owner: number[] = [];
      for (let o = i + 1; o < bands.length && !labelled(o) && bands[o][0] - bands[owner.length ? owner[owner.length - 1] : i][1] < width * 0.12; o++) owner.push(o);
      return { rows, sum: i, owner };
    }
  }
  return null;
}

/** Zuordnung nach der Struktur der Tabelle in Schätz-Form bringen (Position → Textzeilen) */
function structureAssignment(structure: SheetStructure, positionIds: string[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  positionIds.forEach((id, k) => m.set(id, structure.rows[k]));
  m.set("#sum", [structure.sum]);
  if (structure.owner.length) m.set("#owner", structure.owner);
  return m;
}

/**
 * Schnitte und überschriebene Summen planen. Alle Lagen in Pixeln des Bildes; das Ergebnis relativ zur Seite.
 * `runsIn` liefert die Textblöcke einer Zeile (für die Summenbeträge).
 */
export function planSheetEdits(
  annual: WegAnnualStatement,
  bands: Band[],
  size: { width: number; height: number },
  runsIn: (band: Band) => [number, number][],
  extents?: [number, number][],
): SheetPlan {
  const { width: W, height: H } = size;
  const page = annual.sheet?.page ?? 1;
  const problems: string[] = [];
  const sameBlock = annual.positions.filter((p) => (p.provenance?.page ?? page) === page);
  // 1. Wahl: Struktur der Tabelle; 2. Wahl: von der KI geschätzte Lage der Zeilen
  const structure = extents ? findStructure(bands, extents, W, sameBlock.length) : null;
  let onPage = sameBlock;
  let assigned: Map<string, number[]>;
  const sum = annual.sheet?.sum ?? (structure ? { top: 0, bottom: 0, totalLeft: 0, totalRight: 0, shareLeft: 0, shareRight: 0 } : null);
  const owner = annual.sheet?.owner ?? (structure?.owner.length ? { top: 0, bottom: 0 } : null);
  if (structure) assigned = structureAssignment(structure, sameBlock.map((p) => p.id));
  else {
    onPage = sameBlock.filter((p) => p.provenance?.rowTop !== undefined && p.provenance?.rowBottom !== undefined);
    const targets: Target[] = [
      ...onPage.map((p) => ({ key: p.id, top: p.provenance!.rowTop! * H, bottom: p.provenance!.rowBottom! * H })),
      ...(sum ? [{ key: "#sum", top: sum.top * H, bottom: sum.bottom * H }] : []),
      ...(owner ? [{ key: "#owner", top: owner.top * H, bottom: owner.bottom * H }] : []),
    ];
    assigned = assignBands(bands, targets, H);
  }
  const owned = new Set(onPage.flatMap((p) => assigned.get(p.id) ?? []));

  const cuts: PageCut[] = [];
  for (const p of onPage.filter((x) => x.classification === "non_allocable")) {
    const idx = assigned.get(p.id);
    if (!idx?.length) {
      problems.push(`Zeile „${p.label}“ nicht im Bild gefunden`);
      continue;
    }
    const first = Math.min(...idx), last = Math.max(...idx);
    const prev = bands[first - 1], next = bands[last + 1];
    const start = prev ? (prev[1] + bands[first][0]) / 2 : bands[first][0] - 2;
    // folgt eine weitere Tabellenzeile, bis zur Mitte der Lücke; sonst (Tabellenende/Linie) direkt unter der Schrift
    const end = next && owned.has(last + 1) ? (bands[last][1] + next[0]) / 2 : bands[last][1];
    cuts.push({ id: uid(), y: start / H, h: (end - start) / H });
  }

  const patches: TextPatch[] = [];
  const sumIdx = assigned.get("#sum") ?? [];
  const sumBand = sumIdx.length ? bands[sumIdx[0]] : null;
  if (sum && !sumBand) problems.push("Summenzeile nicht im Bild gefunden");
  if (sum && sumBand) {
    const runs = runsIn(sumBand);
    const pick = (left: number, right: number, fromEnd: number) => {
      // ohne geschätzte Lage: die Beträge sind die letzten Textblöcke der Zeile (davor steht „Summe:“)
      if (!annual.sheet?.sum) return runs.length > fromEnd ? runs[runs.length - 1 - fromEnd] : null;
      const l = left * W, r = right * W;
      const hits = runs.filter(([a, b]) => b > l - W * 0.02 && a < r + W * 0.02);
      return hits.length ? ([Math.min(...hits.map((x) => x[0])), Math.max(...hits.map((x) => x[1]))] as const) : null;
    };
    const nonAllocable = annual.positions.filter((p) => p.classification === "non_allocable");
    const total =
      annual.buildingTotal !== null && annual.buildingTotal !== undefined
        ? (cents(annual.buildingTotal) - nonAllocable.reduce((a, p) => a + cents(p.totalAmount ?? 0), 0)) / 100
        : null;
    const share = (annual.positions.reduce((a, p) => a + cents(p.amount), 0) - nonAllocable.reduce((a, p) => a + cents(p.amount), 0)) / 100;
    const height = sumBand[1] - sumBand[0];
    const patch = (run: readonly [number, number] | null, text: string, what: string) => {
      if (!run) return void problems.push(`Summenbetrag „${what}“ nicht im Bild gefunden`);
      const pad = Math.max(4, height * 0.3);
      patches.push({
        id: uid(),
        x: (run[0] - pad) / W,
        y: (sumBand[0] - pad) / H,
        w: (run[1] - run[0] + 2 * pad) / W,
        h: (height + 2 * pad) / H,
        text,
        fontSize: (height * 1.15) / H,
        baseline: (sumBand[0] + height * 0.84) / H,
      });
    };
    if (total !== null) patch(pick(sum.totalLeft, sum.totalRight, 1), euro(total), "Gesamt");
    patch(pick(sum.shareLeft, sum.shareRight, 0), euro(share), "Anteil");
  }

  const ownerIdx = assigned.get("#owner") ?? [];
  if (owner && ownerIdx.length) {
    const first = Math.min(...ownerIdx), last = Math.max(...ownerIdx);
    const start = sumBand ? Math.max(sumBand[1] + 4, (sumBand[1] + bands[first][0]) / 2) : bands[first][0] - 6;
    cuts.push({ id: uid(), y: start / H, h: (bands[last][1] + 6 - start) / H });
  }
  return { cuts, patches, problems };
}

/** Graustufen eines gespeicherten Seitenbilds (im Browser) */
async function grayOf(blobId: string): Promise<Gray | null> {
  const blob = await getBlob(blobId);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) | 0;
  return { width: canvas.width, height: canvas.height, data };
}

/**
 * Seite der Einzelabrechnung mit geplanten Schnitten und Summen – fertig zum Anhängen.
 * null, wenn keine Seite oder keine Zeilenlagen vorliegen.
 */
export async function tenantSheetPage(annual: WegAnnualStatement): Promise<(DocPage & { cuts: PageCut[]; patches: TextPatch[] }) | null> {
  const pageNo = annual.sheet?.page ?? 1;
  const page = annual.sourcePages?.[pageNo - 1];
  if (!page || (annual.heatingPages ?? []).includes(pageNo)) return null;
  const img = await grayOf(page.blobId);
  if (!img) return null;
  const mask = darkMask(img);
  const bands = textBands(img, mask);
  const plan = planSheetEdits(
    annual,
    bands,
    img,
    (band) => inkRuns(img, band, img.width * 0.012, mask),
    bands.map((b) => inkExtent(img, b, mask)),
  );
  return { ...page, cuts: plan.cuts, patches: plan.patches };
}
