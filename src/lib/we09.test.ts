import { describe, expect, it } from "vitest";
import { calculateStatement } from "./calc";
import { classifyLabel } from "./classify";
import { we09Annual2024, we09Plan2025, we09Property, we09Statement, we09Tenant } from "./fixtures/we09";
import { emptyData } from "./model";
import { changedSinceRelease, releaseStatement, statementReadiness } from "./release";
import type { AppData, WegAnnualStatement } from "./types";
import {
  checkAnnual,
  checkKeyMath,
  checkPlan,
  comparePlanActual,
  explainDrivers,
  includedInHeatingBill,
  summarizeAnnual,
  summarizePlan,
  transferToStatement,
} from "./weg";

/** Akzeptanztests aus dem Projektbriefing, Testfall WE 09 */

function reviewedAnnual(): WegAnnualStatement {
  // Vermieter bestätigt die Regelbewertung aller eindeutigen Positionen
  const a = we09Annual2024();
  return { ...a, positions: a.positions.map((p) => ({ ...p, reviewed: p.classification !== "review" })) };
}

function appData(partial: Partial<AppData> = {}): AppData {
  return {
    ...emptyData(),
    settings: { ...emptyData().settings, landlord: { name: "Vermieter", address: "Straße 1\n12345 Ort", iban: "" } },
    properties: [we09Property()],
    tenants: [we09Tenant()],
    ...partial,
  };
}

describe("Testfall 1 – Jahresabrechnung 2024", () => {
  const s = summarizeAnnual(we09Annual2024());

  it("klassifiziert die Positionen wie fachlich geprüft", () => {
    expect(s.allocable).toBe(1056.35);
    expect(s.nonAllocable).toBe(377.09);
    expect(s.review).toBe(34.99);
  });

  it("die drei Kostenblöcke ergeben exakt die Bewirtschaftungskosten", () => {
    expect(s.total).toBe(1468.43);
    expect(s.declared).toBe(1468.43);
    expect(s.matchesDeclared).toBe(true);
    expect(checkAnnual(we09Annual2024()).filter((f) => f.level === "error")).toEqual([]);
  });

  it("erkennt eine fehlende Position über die Kontrollsumme", () => {
    const a = we09Annual2024();
    const broken = { ...a, positions: a.positions.filter((p) => p.label !== "Winterdienst") };
    expect(summarizeAnnual(broken).difference).toBe(-29.36);
    expect(checkAnnual(broken).some((f) => f.level === "error" && f.text.includes("Kontrollsumme"))).toBe(true);
  });
});

describe("Testfall 2 – Heizkosten", () => {
  it("Heizkostenbestandteile ergeben den Anteil der Wohnung", () => {
    const h = we09Annual2024().heating!;
    expect(h.components.reduce((a, c) => a + Math.round(c.amount * 100), 0)).toBe(41786);
    expect(checkAnnual(we09Annual2024()).some((f) => f.text.startsWith("Heizkostenabrechnung"))).toBe(false);
  });

  it("Wärmepumpe: keine CO2-Kostenaufteilung (kein CO2-Preis auf Strom)", () => {
    expect(we09Annual2024().heating!.co2Applicable).toBe(false);
  });

  it("enthaltene Energiekosten werden nicht zusätzlich umgelegt", () => {
    const a = reviewedAnnual();
    const withPower: WegAnnualStatement = {
      ...a,
      managementCostsActual: null,
      positions: [
        ...a.positions,
        { ...a.positions[0], id: "x1", label: "Strom Wärmepumpe", amount: 410.4, category: 6, heating: "component", reviewed: true, classification: "allocable" },
      ],
    };
    expect(classifyLabel("Strom Wärmepumpe", 2024).heating).toBe("component");
    expect(checkAnnual(withPower).some((f) => f.positionId === "x1")).toBe(true);
    const { items, skipped } = transferToStatement(withPower, we09Statement(2024));
    expect(items.some((i) => i.label === "Strom Wärmepumpe")).toBe(false);
    expect(skipped.find((s) => s.position.id === "x1")?.reason).toBe("in der Heizkostenabrechnung enthalten");
    expect(items.reduce((a, i) => a + Math.round(i.amount * 100), 0)).toBe(105635);
  });

  it("erkennt Abweichungen zwischen Heizkostenabrechnung und Jahresabrechnung", () => {
    const a = we09Annual2024();
    const off = { ...a, heating: { ...a.heating!, unitShare: 420 } };
    expect(checkAnnual(off).filter((f) => f.level === "error").length).toBeGreaterThan(0);
  });
});

describe("Testfall 3 – Wirtschaftsplan 2025", () => {
  const p = summarizePlan(we09Plan2025());
  it("erkennt die Summen laut Verwaltung", () => {
    expect(p.declaredAllocable).toBe(1228.2);
    expect(p.declaredNonAllocable).toBe(695.56);
    expect(p.total).toBe(1923.76);
    expect(p.monthly).toBe(160.31);
    expect(p.matchesAnnualHausgeld).toBe(true);
    expect(p.matchesMonthlyHausgeld).toBe(true);
    expect(p.reserve).toBe(220.5);
    expect(p.managementCosts).toBe(1703.26);
  });

  it("bewertet Planpositionen eigenständig statt die Kennzeichnung der Verwaltung zu übernehmen", () => {
    const plan = we09Plan2025();
    const byLabel = (l: string) => plan.positions.find((x) => x.label === l)!;
    expect(byLabel("Wartung Dach").declaredAllocable).toBe(true);
    expect(byLabel("Wartung Dach").classification).toBe("review");
    expect(byLabel("Strom Wärmepumpe").heating).toBe("component");
    expect(byLabel("Wartung Wohnungsstationen").heating).toBe("component");
  });
});

describe("Testfall 4 – Trennung Vermieter/Mieter", () => {
  it("die Hausgeld-Überdeckung ist Eigentümersache und kein Mieterguthaben", () => {
    const a = reviewedAnnual();
    expect(summarizeAnnual(a).ownerOverUnderCoverage).toBe(110.65);
    const st = we09Statement(2024);
    const { items } = transferToStatement(a, st);
    expect(items.some((i) => Math.round(i.amount * 100) === 11065 || /deckung|r(ü|ue)cklage/i.test(i.label))).toBe(false);
    const result = calculateStatement({ ...st, costs: items }, we09Property(), [we09Tenant()]);
    expect(result.tenants[0].totalCosts).toBe(1056.35);
  });

  it("übernimmt Positionen nicht doppelt", () => {
    const a = reviewedAnnual();
    const st = we09Statement(2024);
    const first = transferToStatement(a, st);
    const second = transferToStatement(a, { ...st, costs: first.items });
    expect(second.items).toEqual([]);
    expect(second.skipped.filter((s) => s.reason === "bereits übernommen")).toHaveLength(first.items.length);
  });
});

describe("Testfall 5 – fehlende Informationen", () => {
  it("behauptet ohne Ist-Kosten 2025 und bestätigte Vorauszahlungen keine endgültige Nachzahlung", () => {
    const data = appData({ wegAnnuals: [reviewedAnnual()], economicPlans: [we09Plan2025()] });
    const st = we09Statement(2025);
    const r = statementReadiness(st, data);
    expect(r.ready).toBe(false);
    expect(r.blockers.some((b) => b.includes("WEG-Jahresabrechnung 2025") && b.includes("fehlt"))).toBe(true);
    expect(r.blockers.some((b) => b.includes("Vorauszahlungen") && b.includes("nicht bestätigt"))).toBe(true);
    expect(() => releaseStatement(st, data)).toThrow(/Freigabe nicht möglich/);
  });

  it("gibt frei, sobald alles vorliegt, und erkennt spätere Änderungen", () => {
    const annual = reviewedAnnual();
    const resolved = { ...annual, positions: annual.positions.map((p) => (p.label === "Wartung Dach" ? { ...p, classification: "non_allocable" as const, origin: "user" as const, reviewed: true } : p)) };
    const data = appData({ wegAnnuals: [resolved] });
    const st = { ...we09Statement(2024), prepaymentsConfirmed: { "we09-t": true }, prepaymentOverrides: { "we09-t": 960 } };
    const withCosts = { ...st, costs: transferToStatement(resolved, st).items };
    expect(statementReadiness(withCosts, data).blockers).toEqual([]);
    const released = releaseStatement(withCosts, data);
    expect(released.status).toBe("released");
    expect(changedSinceRelease(released, data)).toBe(false);
    const changedData = { ...data, tenants: [{ ...we09Tenant(), persons: 2 }] };
    expect(changedSinceRelease(released, changedData)).toBe(true);
  });
});

describe("Testfall 6 – Prognose", () => {
  it("vergleicht Plan 2025 mit Ist 2024", () => {
    const rows = comparePlanActual(we09Plan2025(), we09Annual2024());
    const row = (key: string) => rows.find((r) => r.key === key)!;
    expect(row("heating")).toMatchObject({ plan: 605.16, actual: 417.86 });
    expect(row("reserve")).toMatchObject({ plan: 220.5, actual: 147 });
    expect(row("management")).toMatchObject({ plan: 380, actual: 361.55 });
    const planTotal = rows.reduce((a, r) => a + Math.round(r.plan * 100), 0);
    const actualTotal = rows.reduce((a, r) => a + Math.round((r.actual ?? 0) * 100), 0);
    expect(planTotal).toBe(192376);
    expect(actualTotal).toBe(161543);
    expect(explainDrivers(rows)[0]).toContain("Heizung");
  });

  it("ein Wirtschaftsplan kann nie in eine Mieterabrechnung übernommen werden", () => {
    expect(() => transferToStatement(we09Plan2025(), we09Statement(2025))).toThrow(/Wirtschaftsplan/);
  });
});

describe("Testfall 7 – prüfpflichtige Positionen", () => {
  it("markiert die Dachwartung zur Prüfung statt sie zu übernehmen", () => {
    const a = reviewedAnnual();
    const dach = a.positions.find((p) => p.label === "Wartung Dach")!;
    expect(dach.classification).toBe("review");
    const { items, skipped } = transferToStatement(a, we09Statement(2024));
    expect(items.some((i) => i.label === "Wartung Dach")).toBe(false);
    expect(skipped.find((s) => s.position.label === "Wartung Dach")?.reason).toBe("Prüfung erforderlich");
  });

  it("bewertet weitere Positionen vorsichtig", () => {
    expect(classifyLabel("Hausmeister", 2025).classification).toBe("review");
    expect(classifyLabel("Wartung Rauchwarnmelder", 2025).classification).toBe("review");
    expect(classifyLabel("Wartung Aufzug", 2025)).toMatchObject({ classification: "allocable", category: 7 });
    expect(classifyLabel("Kabelfernsehen", 2025).classification).toBe("non_allocable");
    expect(classifyLabel("Sonstige Ausgaben", 2025).classification).toBe("review");
    expect(classifyLabel("Heizungswartung", 2025).heating).toBe("component");
  });
});

describe("Abgleich mit den Originaldokumenten", () => {
  it("die Anteile der Wohnung folgen exakt den Schlüsseln der Verwaltung", () => {
    expect(checkKeyMath(we09Annual2024().positions)).toEqual([]);
    expect(checkKeyMath(we09Plan2025().positions)).toEqual([]);
  });

  it("die Gesamtkosten der WEG ergeben 25.274,93 €", () => {
    expect(checkAnnual(we09Annual2024()).some((f) => f.text.startsWith("Gesamtkosten der WEG"))).toBe(false);
  });

  it("erkennt einen falsch übernommenen Betrag über die Schlüsselrechnung", () => {
    const a = we09Annual2024();
    const typo = a.positions.map((p) => (p.label === "Gebäudeversicherung" ? { ...p, amount: 108.75 } : p));
    expect(checkKeyMath(typo).find((f) => f.level === "warning")?.text).toContain("180,75");
  });

  it("weist die Centdifferenz der Heizkosten zwischen den Dokumenten als Rundung aus", () => {
    const f = checkAnnual(we09Annual2024()).find((x) => x.text.startsWith("Gesamtheizkosten"));
    expect(f?.level).toBe("info");
    expect(f?.text).toContain("Rundungsdifferenz");
  });

  it("Wärmestrom und Heizungswartung sind laut Kostenaufstellung in den Heizkosten enthalten", () => {
    const h = we09Annual2024().heating;
    const plan = we09Plan2025();
    const byLabel = (l: string) => plan.positions.find((p) => p.label === l)!;
    expect(includedInHeatingBill(byLabel("Strom Wärmepumpe"), h)).toBe(true);
    expect(includedInHeatingBill(byLabel("Wartung Heizung"), h)).toBe(true);
    // Wohnungsstationen rechnet die WEG gesondert nach Wohneinheiten ab – nicht in der Heizkostenabrechnung
    expect(includedInHeatingBill(byLabel("Wartung Wohnungsstationen"), h)).toBe(false);
  });

  it("übernimmt Wohnungsstationen-Wartung außerhalb der Heizkostenabrechnung nicht ungeprüft", () => {
    const a = reviewedAnnual();
    const ws = { ...a, positions: a.positions.map((p) => (p.label === "Wartung Wohnungsstationen" ? { ...p, amount: 56.36, reviewed: true } : p)) };
    const finding = checkAnnual(ws).find((f) => f.text.includes("außerhalb der Heizkostenabrechnung"));
    expect(finding).toBeDefined();
    const { skipped } = transferToStatement(ws, we09Statement(2024));
    expect(skipped.find((s) => s.position.label === "Wartung Wohnungsstationen")?.reason).toContain("außerhalb der Heizkostenabrechnung");
  });

  it("zeigt die Bemerkung zur Dachwartung (zwei Leistungsjahre) zur Prüfung an", () => {
    expect(checkAnnual(we09Annual2024()).some((f) => f.level === "info" && f.text.includes("19.12.2023"))).toBe(true);
  });

  it("findet die Rundungsdifferenz in der monatlichen Aufteilung des Wirtschaftsplans", () => {
    const f = checkPlan(we09Plan2025());
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe("info");
    expect(f[0].text).toContain("160,32");
  });
});
