import { describe, expect, it } from "vitest";
import { autoAttach, heatingSourcePages } from "./attachments";
import { emptyData } from "./model";
import type { DocPage, WegAnnualStatement } from "./types";

const page = (n: number): DocPage => ({ id: `p${n}`, blobId: `l:b${n}`, width: 100, height: 141, source: `scan.pdf, Seite ${n}` });

describe("Anlagen automatisch übernehmen", () => {
  it("nimmt aus den WEG-Unterlagen nur die Seiten der Heizkostenabrechnung", () => {
    const annual = { sourcePages: [page(1), page(2), page(3), page(4)], heatingPages: [3, 4, 9] } as unknown as WegAnnualStatement;
    expect(heatingSourcePages(annual).map((p) => p.blobId)).toEqual(["l:b3", "l:b4"]);
  });

  it("legt die Anlage an und hängt dieselbe Seite nicht doppelt an", () => {
    let d = autoAttach(emptyData(), "obj", 2025, "propertyTax", [page(1)]);
    d = autoAttach(d, "obj", 2025, "propertyTax", [page(1), page(2)]);
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments![0].pages.map((p) => [p.blobId, p.include, p.redactions.length])).toEqual([
      ["l:b1", true, 0],
      ["l:b2", true, 0],
    ]);
  });

  it("trennt nach Jahr und Art", () => {
    let d = autoAttach(emptyData(), "obj", 2025, "heating", [page(1)]);
    d = autoAttach(d, "obj", 2026, "heating", [page(2)]);
    d = autoAttach(d, "obj", 2025, "propertyTax", [page(3)]);
    expect(d.attachments).toHaveLength(3);
  });
});
