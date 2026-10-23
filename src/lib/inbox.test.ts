import { beforeEach, describe, expect, it, vi } from "vitest";
import { we09PreviousTenant, we09Property, we09Tenant } from "./fixtures/we09";
import { emptyData, newStatement } from "./model";
import type { AppData, DocPage } from "./types";

// Seitenspeicher, Seitenumwandlung und KI nachbilden
vi.mock("./blobs", () => ({ getBlob: async () => new Blob(["x"], { type: "image/jpeg" }), putBlob: async () => "l:x", deleteBlob: async () => undefined }));
vi.mock("./pages", () => ({
  filesToPages: async (files: File[]): Promise<DocPage[]> => files.map((f, i) => ({ id: `p${i + 1}`, blobId: `l:b${i + 1}`, width: 100, height: 141, source: f.name })),
}));
const heating = { heatSource: "Gas", buildingTotal: 1, unitShare: 600, baseSharePct: 30, areaTotal: 900, consumptionHeatingKwh: null, consumptionWaterKwh: null, components: [], includedCosts: [], co2Cost: null, co2Kg: null, page: 2, pages: [2] };
const item = (category: number, allocableAmount: number) => ({ description: "", category, allocableAmount, nonAllocableAmount: 0, recommendedKey: "direct", laborCost: 0, laborKind: "none", co2Cost: 0, co2Kg: 0, reasoning: "" });
vi.mock("./extract", () => ({
  classifyDocuments: async () => ({
    documents: [
      { kind: "weg_annual", pages: [1, 2], title: "Hausgeldabrechnung 2025", year: 2025, propertyId: "we09-p", unitName: "WE 09" },
      { kind: "municipal", pages: [3], title: "Grundbesitzabgabenbescheid 2026", year: 2026, propertyId: "we09-p", unitName: "" },
      { kind: "invoice", pages: [4], title: "Rechnung Schornsteinfeger 2025", year: 2025, propertyId: "we09-p", unitName: "" },
      { kind: "other", pages: [5], title: "Schreiben der Hausverwaltung", year: 2025, propertyId: "unknown", unitName: "" },
      { kind: "lease", pages: [6], title: "Mietvertrag WE 09", year: 2025, propertyId: "we09-p", unitName: "WE 09", tenantName: "Max Mieter" },
    ],
    notes: "",
  }),
  extractWegDocument: async () => ({
    documentKind: "annual", year: 2025, unitName: "WE 09", managementCostsActual: 100, managementCostsPlan: null, buildingTotal: null, monthlyReserve: null, monthlyCosts: null,
    reserveContribution: 0, annualHausgeld: null, monthlyHausgeld: null, positions: [], heating, notes: "",
  }),
  extractLease: async () => lease,
  extractInvoice: async (_files: File[], _access: unknown, period: string) =>
    period.includes("2026")
      ? { vendor: "", invoiceDate: "", servicePeriodStart: "2026-01-01", servicePeriodEnd: "", totalAmount: 0, notes: "", isMunicipalNotice: true, items: [item(1, 170.42), item(8, 106.84)] }
      : { vendor: "", invoiceDate: "", servicePeriodStart: "2025-01-01", servicePeriodEnd: "", totalAmount: 0, notes: "", isMunicipalNotice: false, items: [item(15, 35)] },
}));

// vi.mock wird nach oben gezogen – daher var, damit der Mock die Variable schon kennt
// eslint-disable-next-line no-var
var lease = leaseExtraction();
function leaseExtraction(patch: Record<string, unknown> = {}) {
  return {
    tenantNames: ["Max Mieter"], unitName: "WE 09", unitArea: 44.75, isAmendment: false, startDate: "2025-08-01", endDate: "", coldRent: 480, surcharge: 20,
    prepaymentOperating: 130, prepaymentHeating: 0, persons: 1, deposit: 1440, reference: "Mietvertrag vom 10.07.2025", agreedCategories: [1, 2, 3], otherCosts: [],
    allocationRule: "consumption_mea", propertyTaxIndividual: true, paymentTerm: "endOfNextMonth", notes: "", ...patch,
  };
}

let data: AppData;
const update = (fn: (d: AppData) => AppData) => {
  data = fn(data);
};

describe("Belegeingang", () => {
  beforeEach(() => {
    const p = { ...we09Property(), municipalBills: [] };
    const st = { ...newStatement(p.id, "2025-01-01", "2025-12-31"), id: "st25" };
    data = { ...emptyData(), properties: [p], statements: [st] };
  });

  it("erkennt, ordnet zu und legt ab", async () => {
    const { processUpload } = await import("./inbox");
    const files = [1, 2, 3, 4, 5].map((n) => new File(["x"], `foto${n}.jpg`, { type: "image/jpeg" }));
    await processUpload(files, { kind: "key", apiKey: "k" }, data, update);

    // WEG-Jahresabrechnung angelegt, Seite 2 als Heizkostenabrechnung angehängt
    expect(data.wegAnnuals).toHaveLength(1);
    expect(data.wegAnnuals[0].year).toBe(2025);
    const hk = data.attachments!.find((a) => a.kind === "heating")!;
    expect(hk.year).toBe(2025);
    expect(hk.pages.map((p) => p.blobId)).toEqual(["l:b2"]);

    // Bescheid 2026: Beträge beim Objekt, Bescheid als Anlage
    expect(data.properties[0].municipalBills).toEqual([expect.objectContaining({ year: 2026, propertyTax: 170.42, wasteFee: 106.84 })]);
    expect(data.attachments!.find((a) => a.kind === "propertyTax")).toMatchObject({ year: 2026 });

    // Rechnung: Position in die Abrechnung 2025
    expect(data.statements[0].costs.map((c) => c.amount)).toContain(35);

    // alles abgelegt, Sonstiges ohne Zuordnung
    const docs = data.documents!;
    expect(docs.map((d) => d.kind).sort()).toEqual(["invoice", "municipal", "other", "weg_annual"]);
    expect(docs.every((d) => d.status === "done")).toBe(true);
    expect(docs.find((d) => d.kind === "other")!.result).toBe("Abgelegt.");
  });

  it("legt die Abrechnung des Jahres an, wenn es noch keine gibt – genau einmal", async () => {
    data = { ...data, statements: [], tenants: [{ ...we09Tenant(), moveIn: "2024-01-01", moveOut: null }] };
    const { processUpload } = await import("./inbox");
    const files = [1, 2, 3, 4, 5].map((n) => new File(["x"], `foto${n}.jpg`, { type: "image/jpeg" }));
    await processUpload(files, { kind: "key", apiKey: "k" }, data, update);

    const years = data.statements.map((s) => s.periodStart.slice(0, 4)).sort();
    expect(years).toEqual(["2025", "2026"]);
    // die Rechnung landet in der eben angelegten Abrechnung 2025
    expect(data.statements.find((s) => s.periodStart.startsWith("2025"))!.costs.map((c) => c.amount)).toContain(35);
    expect(data.documents!.find((d) => d.kind === "weg_annual")!.result).toContain("Betriebskostenabrechnung 2025 angelegt");
    expect(data.documents!.find((d) => d.kind === "invoice")!.result).not.toContain("angelegt");
  });

  it("legt ohne Mieter im Jahr keine Abrechnung an", async () => {
    data = { ...data, statements: [], tenants: [] };
    const { processUpload } = await import("./inbox");
    await processUpload([new File(["x"], "a.jpg", { type: "image/jpeg" })], { kind: "key", apiKey: "k" }, data, update);
    expect(data.statements).toEqual([]);
  });

  it("ordnet einen Mietvertrag dem passenden Mieter zu", async () => {
    data = { ...data, tenants: [we09PreviousTenant(), we09Tenant()] };
    const { processUpload } = await import("./inbox");
    const files = [1, 2, 3, 4, 5, 6].map((n) => new File(["x"], `foto${n}.jpg`, { type: "image/jpeg" }));
    await processUpload(files, { kind: "key", apiKey: "k" }, data, update);
    const lease = data.documents!.find((d) => d.kind === "lease")!;
    expect(lease.status).toBe("done");
    expect(lease.result).toContain("Mietvertrag von Mieter WE 09");
    expect(lease.link).toBe("#/objekte/we09-p?t=we09-t");
  });

  it("legt aus einem Mietvertrag Mieter und fehlende Einheit an", async () => {
    lease = leaseExtraction({ tenantNames: ["Luca Schmitz"], unitName: "Stellplatz 3", unitArea: null, startDate: "2026-02-01", coldRent: 0, surcharge: 40, prepaymentOperating: 0 });
    data = { ...data, tenants: [] };
    const { processUpload } = await import("./inbox");
    const files = [1, 2, 3, 4, 5, 6].map((n) => new File(["x"], `foto${n}.jpg`, { type: "image/jpeg" }));
    await processUpload(files, { kind: "key", apiKey: "k" }, data, update);
    const t = data.tenants.find((x) => x.name === "Luca Schmitz")!;
    expect(t).toBeDefined();
    expect(t.moveIn).toBe("2026-02-01");
    expect(t.deposit).toBe(1440);
    expect(t.rentHistory[0]).toMatchObject({ validFrom: "2026-02-01", surcharge: 40 });
    const unit = data.properties[0].units.find((u) => u.id === t.unitId)!;
    expect(unit.name).toBe("Stellplatz 3");
    expect(data.documents!.find((d) => d.kind === "lease")!.result).toContain("Einheit „Stellplatz 3“");
    lease = leaseExtraction();
  });

  it("ergänzt bei bestehendem Mieter nur Leeres und übernimmt Nachträge als Mietstand", async () => {
    lease = leaseExtraction({ tenantNames: ["Max Mieter"], isAmendment: true, startDate: "2026-08-01", coldRent: 500 });
    data = { ...data, tenants: [{ ...we09Tenant(), lease: null }] };
    const { processUpload } = await import("./inbox");
    const files = [1, 2, 3, 4, 5, 6].map((n) => new File(["x"], `foto${n}.jpg`, { type: "image/jpeg" }));
    await processUpload(files, { kind: "key", apiKey: "k" }, data, update);
    const t = data.tenants[0];
    expect(data.tenants).toHaveLength(1);
    expect(t.rentHistory.map((r) => [r.validFrom, r.coldRent])).toEqual([["2025-08-01", 480], ["2026-08-01", 500]]);
    expect(t.lease?.agreedCategories).toEqual([1, 2, 3]);
    lease = leaseExtraction();
  });
});
