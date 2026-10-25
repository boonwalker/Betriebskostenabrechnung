import { describe, expect, it } from "vitest";
import { we09Annual2024 } from "./fixtures/we09";
import { findStructure, planSheetEdits, type Band } from "./wegSheet";

// Nachgebaute Einzelabrechnung (1350 × 1800 px): Kopfzeile, 16 Positionen (drei davon zweizeilig), Summe, Eigentümerblock
const W = 1350, H = 1800;
const L: [number, number] = [90, 1270]; // Bezeichnung links und Betrag rechts
const C: [number, number] = [70, 290]; // Fortsetzung der Bezeichnung
const R: [number, number] = [550, 1180]; // ohne Bezeichnung (Summe, Eigentümerblock)
const layout: [Band, [number, number]][] = [
  [[431, 453], L], // Kopfzeile der Tabelle
  [[466, 486], L], [[498, 519], L], [[530, 552], L], [[562, 584], L], [[596, 613], C],
  [[626, 649], L], [[658, 681], L], [[690, 713], L], [[721, 745], L], [[753, 778], L], [[786, 810], L],
  [[818, 841], L], [[853, 873], C], [[882, 907], L], [[916, 937], L], [[954, 970], C],
  [[982, 1006], L], [[1013, 1036], L], [[1045, 1067], L],
  [[1077, 1096], [778, 1271]], // Summe
  [[1159, 1176], R], [[1209, 1227], R], [[1313, 1335], R], // Kostenanteil, Vorschüsse, Abrechnungsspitze
];
const bands = layout.map(([b]) => b);
const extents = layout.map(([, e]) => e);

describe("Einzelabrechnung für den Mieter", () => {
  it("erkennt Positionen, Fortsetzungszeilen, Summe und Eigentümerblock", () => {
    const s = findStructure(bands, extents, W, 16)!;
    expect(s.rows).toHaveLength(16);
    expect(s.rows[3]).toEqual([4, 5]); // Treppenhausreinigung WE 06 + „WE 06“
    expect(s.rows[13]).toEqual([17]); // Bankgebühren
    expect(s.sum).toBe(20);
    expect(s.owner).toEqual([21, 22, 23]);
  });

  it("schneidet nicht umlagefähige Zeilen heraus, behält die Tabellenlinie und passt die Summen an", () => {
    const annual = { ...we09Annual2024(), sheet: null };
    const runs = (b: Band) => (b[0] === 1077 ? ([[778, 860], [972, 1092], [1165, 1271]] as [number, number][]) : []);
    const plan = planSheetEdits(annual, bands, { width: W, height: H }, runs, extents);
    expect(plan.problems).toEqual([]);
    const px = plan.cuts.map((c) => [Math.round(c.y * H), Math.round((c.y + c.h) * H)]);
    // Bankgebühren, Verwalter, Instandhaltung: von der Lücke über Bankgebühren bis direkt unter Instandhaltung
    expect(px).toContainEqual([976, 1010]);
    expect(px).toContainEqual([1041, 1067]);
    // Eigentümerblock unter der Summe
    expect(px.at(-1)![0]).toBeGreaterThan(1096);
    const nonAllocable = annual.positions.filter((p) => p.classification === "non_allocable");
    const share = annual.positions.reduce((a, p) => a + p.amount, 0) - nonAllocable.reduce((a, p) => a + p.amount, 0);
    expect(plan.patches.map((p) => p.text)).toEqual([
      expect.stringContaining("€"),
      `${share.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`,
    ]);
  });
});
