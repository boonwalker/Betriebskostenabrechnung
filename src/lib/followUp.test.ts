import { describe, expect, it } from "vitest";
import { anlageV } from "./anlageV";
import { showcaseData } from "./demo";
import { collectDeadlines, endOfMonth, objectionDeadline, paymentDue, statementDeadline } from "./followUp";
import { effectiveAfter, rentIncreaseCheck, rentIncreaseLetter } from "./rentIncrease";
import type { Tenant } from "./types";

describe("Fristen nach dem Versand", () => {
  it("Monatsende und Fälligkeit", () => {
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2026-01-31", 1)).toBe("2026-02-28");
    expect(paymentDue("2026-03-15", "endOfNextMonth")).toBe("2026-04-30");
    expect(paymentDue("2026-03-15")).toBe("2026-04-14");
  });

  it("Einwendungen bis Ende des 12. Monats nach Zugang, Abrechnung bis Ende des Folgejahres", () => {
    expect(objectionDeadline("2026-03-15")).toBe("2027-03-31");
    expect(statementDeadline({ periodEnd: "2025-12-31" })).toBe("2026-12-31");
  });
});

describe("Mieterhöhung § 558 BGB", () => {
  const data = showcaseData();
  const p = data.properties[0];
  const luca = data.tenants.find((t) => !t.landlord)!;
  const withRent = (t: Tenant, history: [string, number][]): Tenant => ({
    ...t,
    moveIn: history[0][0],
    rentHistory: history.map(([validFrom, coldRent], i) => ({ id: `r${i}`, validFrom, coldRent, prepaymentOperating: 100, prepaymentHeating: 30 })),
  });

  it("Sperrfrist: Verlangen frühestens 12 Monate nach der letzten Erhöhung, wirksam frühestens nach 15 Monaten", () => {
    const t = withRent(luca, [["2025-08-01", 480]]);
    const c = rentIncreaseCheck(t, p, "2026-03-10")!;
    expect(c.earliestRequest).toBe("2026-08-01");
    expect(c.effectiveFrom).toBe("2026-11-01");
    // Zugang im September → wirksam ab Dezember
    expect(effectiveAfter(c, "2026-09-20")).toBe("2026-12-01");
  });

  it("angepasste Vorauszahlungen lösen keine Sperrfrist aus", () => {
    const t = withRent(luca, [["2022-01-01", 400]]);
    t.rentHistory.push({ id: "x", validFrom: "2026-01-01", coldRent: 400, prepaymentOperating: 120, prepaymentHeating: 30 });
    expect(rentIncreaseCheck(t, p, "2026-03-10")!.lastChange).toBe("2022-01-01");
  });

  it("Kappungsgrenze 20 % auf die Miete vor drei Jahren, Vergleichsmiete × Fläche", () => {
    const t = withRent(luca, [["2020-01-01", 400]]);
    const c = rentIncreaseCheck(t, p, "2026-03-10", { comparableRentPerSqm: 12, source: "Mietspiegel", capPercent: 20 })!;
    expect(c.capLimit).toBe(480);
    expect(c.comparableLimit).toBe(537);
    expect(c.maxRent).toBe(480);
    expect(c.increase).toBe(80);
    const low = rentIncreaseCheck(t, p, "2026-03-10", { comparableRentPerSqm: 10, source: "", capPercent: 15 })!;
    expect(low.capLimit).toBe(460);
    expect(low.maxRent).toBe(447.5);
  });

  it("Schreiben nennt neue Miete, Wirksamkeit und Zustimmungsfrist", () => {
    const t = { ...withRent(luca, [["2020-01-01", 400]]), name: "Luca Schmitz", informal: true };
    const review = { comparableRentPerSqm: 12, source: "Mietspiegel Heinsberg 2025", capPercent: 20 as const };
    const c = rentIncreaseCheck(t, p, "2026-03-10", review)!;
    const text = rentIncreaseLetter({ tenant: t, property: p, check: c, review, newRent: 480, delivered: "2026-03-20", landlordName: "Niklas" });
    expect(text).toMatch(/auf 480,00\s€/);
    expect(text).toContain("ab dem 01.06.2026");
    expect(text).toContain("bis zum 31.05.2026");
    expect(text).toContain("Mietspiegel Heinsberg 2025");
    expect(text).toContain("Hallo Luca,");
  });
});

describe("Anlage V WE 09", () => {
  const data = showcaseData();
  const p = data.properties[0];

  it("2025 ab Erwerb: nur die eigenen Mieter, AfA anteilig ab August", () => {
    const av = anlageV({ ...p, acquisitionType: "gift", predecessorCost: 111809.85, landShare: 13.25, yearBuilt: 2015 }, data, 2025)!;
    expect(av.from).toBe("2025-08-01");
    expect(av.income[0].note).not.toContain("Lea");
    const afa = av.costs.find((c) => c.label.startsWith("Absetzung"))!;
    expect(afa.note).toContain("5/12");
    // 111.809,85 € × 86,75 % × 2 % × 5/12
    expect(afa.amount).toBe(808.29);
  });

  it("Nachzahlung zählt im Jahr des Eingangs", () => {
    const tenantId = data.tenants.find((t) => !t.landlord)!.id;
    const statement = {
      id: "s", propertyId: p.id, periodStart: "2025-01-01", periodEnd: "2025-12-31", status: "released" as const, costs: [],
      releases: { [tenantId]: { releasedAt: "2026-03-01T00:00:00Z", resultJson: JSON.stringify({ result: { tenant: { id: tenantId, name: "Luca" }, balance: 30.86 } }) } },
      settled: { [tenantId]: "2026-04-10" },
    };
    const d = { ...data, statements: [statement as never] };
    expect(anlageV(p, d, 2026)!.income.find((l) => l.label.startsWith("Nachzahlungen"))?.amount).toBe(30.86);
    expect(anlageV(p, d, 2025)!.income.some((l) => l.label.startsWith("Nachzahlungen"))).toBe(false);
  });

  it("Fristen-Übersicht: Abrechnung 2025 zustellen bis 31.12.2026", () => {
    const deadlines = collectDeadlines(data, "2026-10-25");
    expect(deadlines.find((d) => d.title.includes("2025 zustellen"))?.date).toBe("2026-12-31");
  });
});
