import { describe, expect, it } from "vitest";
import { buildSegments, calculateStatement } from "./calc";
import { meterDates } from "./meters";
import { classifyLabel } from "./classify";
import {
  we09Annual2024,
  we09Lease,
  we09Plan2025,
  we09PreviousTenant,
  we09Property,
  we09Statement,
  we09Tenant,
  we09TrialTenant2024,
} from "./fixtures/we09";
import { degreeDays } from "./degreeDays";
import { emptyData, migrate } from "./model";
import { agreementFor } from "./lease";
import { changedSinceRelease, releasedTenant, releaseStatement, releaseTenant, revokeRelease, statementReadiness } from "./release";
import type { AppData, Statement, WegAnnualStatement } from "./types";
import {
  checkAnnual,
  checkKeyMath,
  checkPlan,
  comparePlanActual,
  explainDrivers,
  forecastForTenant,
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
    tenants: [we09TrialTenant2024(), we09Tenant()],
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
    const result = calculateStatement({ ...st, costs: items }, we09Property(), [we09TrialTenant2024()]);
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
    const st = { ...we09Statement(2024), prepaymentsConfirmed: { "we09-probe": true }, prepaymentOverrides: { "we09-probe": 960 } };
    const withCosts = { ...st, costs: transferToStatement(resolved, st).items };
    expect(statementReadiness(withCosts, data).blockers).toEqual([]);
    const released = releaseStatement(withCosts, data);
    expect(released.status).toBe("released");
    expect(changedSinceRelease(released, data)).toBe(false);
    const changedData = { ...data, tenants: [{ ...we09TrialTenant2024(), persons: 2 }, we09Tenant()] };
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

describe("Mietvertrag WE 09 (§ 3, § 6)", () => {
  // Probelauf: Ist-Daten 2024, als hätte der Mietvertrag schon gegolten
  const tenantWithLease = () => ({ ...we09TrialTenant2024(), lease: we09Lease() });
  const context = () => ({ property: we09Property(), tenants: [tenantWithLease()] });

  it("erkennt vereinbarte und nicht vereinbarte Kostenarten", () => {
    const lease = we09Lease();
    expect(agreementFor("Gebäudeversicherung", 13, lease).status).toBe("agreed");
    expect(agreementFor("Winterdienst", 8, lease).status).toBe("agreed");
    expect(agreementFor("Wartung Dach", 17, lease)).toMatchObject({ status: "partial" });
    expect(agreementFor("Wartung Dach", 17, lease).text).toContain("Dachrinnenreinigung");
    expect(agreementFor("Dachrinnenreinigung", 17, lease).status).toBe("agreed");
    expect(agreementFor("Wartung Rauchwarnmelder", 17, lease).status).toBe("not_agreed");
    expect(agreementFor("Sonstige Ausgaben", null, lease).status).toBe("not_agreed");
    expect(agreementFor("Kabelfernsehen", 15, { ...lease, agreedCategories: [1, 2, 3] }).status).toBe("not_agreed");
  });

  it("legt nach Verbrauch bzw. Miteigentumsanteil um statt nach dem Gruppenschlüssel der WEG", () => {
    const st = we09Statement(2024);
    const { items } = transferToStatement(reviewedAnnual(), st, context());
    const item = (label: string) => items.find((i) => i.label === label);
    // Position behält den Anteil laut WEG (das zahlt der Vermieter) …
    expect(item("Treppenhausreinigung")?.amount).toBe(126.1);
    // … der Mieter trägt laut Vertrag 2.125,10 € × 49/1.000
    expect(item("Treppenhausreinigung")?.leaseAmounts?.consumption_mea?.amount).toBe(104.13);
    expect(item("Treppenhausreinigung")?.note).toContain("126,10");
    // Einzelkosten von WE 06 werden nicht per MEA auf WE 09 verteilt
    expect(item("Treppenhausreinigung WE 06")).toBeUndefined();
    const r = calculateStatement({ ...st, costs: items }, we09Property(), [tenantWithLease()]);
    const share = (label: string) => r.tenants[0].items.find((i) => i.label === label)?.amount;
    expect(share("Treppenhausreinigung")).toBe(104.13);
    // Verbrauch (cbm) und MEA bleiben, Heizkosten folgen der Heizkostenabrechnung
    expect(share("Wasser")).toBe(60.23);
    expect(share("Gebäudeversicherung")).toBe(180.75);
    expect(share("Heiz- und Warmwasserkosten")).toBe(417.86);
    expect(r.tenants[0].totalCosts).toBe(1034.38);
    expect(r.landlordItems).toEqual([expect.objectContaining({ label: "Treppenhausreinigung", amount: 21.97 })]);
  });

  it("übernimmt die Dachwartung nur nach ausdrücklicher Bestätigung und weist auf den Vertragswortlaut hin", () => {
    const a = reviewedAnnual();
    const skipped = transferToStatement(a, we09Statement(2024), context()).skipped.find((s) => s.position.label === "Wartung Dach");
    expect(skipped?.reason).toBe("Prüfung erforderlich");
    const confirmed = { ...a, positions: a.positions.map((p) => (p.label === "Wartung Dach" ? { ...p, classification: "allocable" as const, origin: "user" as const, reviewed: true } : p)) };
    const st = we09Statement(2024);
    const { items } = transferToStatement(confirmed, st, context());
    expect(items.some((i) => i.label === "Wartung Dach")).toBe(true);
    const data = appData({ tenants: [tenantWithLease()], wegAnnuals: [confirmed] });
    const r = statementReadiness({ ...st, costs: items }, data);
    expect(r.hints.some((h) => h.includes("Dachrinnenreinigung"))).toBe(true);
    // Grundsteuer und Müll trägt der Eigentümer erst ab 01.01.2026 – für 2024 kein Hinweis
    expect(r.hints.some((h) => h.includes("Grundsteuer"))).toBe(false);
  });

  it("Abgaben der Gemeinde: 2025 nicht umlegbar, ab 2026 Hinweis auf Grundsteuer und Müll", () => {
    const data = appData({ tenants: [tenantWithLease()], wegAnnuals: [] });
    const tax = { id: "gs", category: 1, label: "Grundsteuer", amount: 194.42, key: "direct" as const, directUnitId: "we09-u" };
    const r25 = statementReadiness({ ...we09Statement(2025), costs: [tax] }, data);
    expect(r25.general.some((g) => g.includes("erst ab 01.01.2026"))).toBe(true);
    const ins = { id: "v", category: 13, label: "Gebäudeversicherung", amount: 196, key: "direct" as const, directUnitId: "we09-u" };
    const r26 = statementReadiness({ ...we09Statement(2026), costs: [ins] }, appData({ tenants: [we09Tenant()] }));
    expect(r26.hints.some((h) => h.includes("Grundsteuer ist vereinbart"))).toBe(true);
    expect(r26.hints.some((h) => h.includes("Müllgebühr"))).toBe(true);
  });

  it("schließt nicht vereinbarte sonstige Betriebskosten aus", () => {
    const a = reviewedAnnual();
    const extra = {
      ...a,
      managementCostsActual: null,
      positions: [...a.positions, { ...a.positions[0], id: "rw", label: "Wartung Rauchwarnmelder", amount: 12.5, category: 17, classification: "allocable" as const, origin: "user" as const, reviewed: true }],
    };
    const { items, skipped } = transferToStatement(extra, we09Statement(2024), context());
    expect(items.some((i) => i.label === "Wartung Rauchwarnmelder")).toBe(false);
    expect(skipped.find((s) => s.position.id === "rw")?.reason).toContain("nicht umlegbar");
  });

  it("2025: Mietbeginn 01.08., Vorauszahlungen 5 × 130 €, Leerstand Jan–Jul trägt der Vermieter", () => {
    const st = { ...we09Statement(2025), costs: [{ id: "x", category: 13, label: "Gebäudeversicherung", amount: 196, key: "direct" as const, directUnitId: "we09-u" }] };
    const r = calculateStatement(st, we09Property(), [we09Tenant()]);
    expect(r.tenants[0].days).toBe(153);
    expect(r.tenants[0].prepayments).toBe(650);
    expect(r.tenants[0].totalCosts).toBe(82.16);
    expect(r.landlordShare).toBe(113.84);
  });
});

describe("Prognose 2025 für den Mieter WE 09", () => {
  it("rechnet zeitanteilig ab Mietbeginn und nach dem Vertragsschlüssel", () => {
    const f = forecastForTenant(we09Plan2025(), we09Property(), we09Tenant())!;
    // Plan umlagefähig 1.228,20 € − Dachwartung (ungeklärt) 19,60 € − Wohnungsstationen nach WE 56,36 € + nach MEA 30,38 €
    // = 1.182,62 €. Grundsteuer und Müll trägt der Eigentümer erst ab 01.01.2026 – 2025 nicht umlegbar
    expect(f.charges).toEqual([]);
    expect(f.expectedYear).toBe(1182.62);
    expect(f.uncertainYear).toBe(19.6);
    expect(f.days).toBe(153);
    expect(f.prepayments).toBe(650);
    expect(f.expectedShare).toBe(495.73);
    expect(f.result).toBe(-154.27);
  });

  it("Dachwartung vom Eigentümer bestätigt: zählt in der Prognose mit", () => {
    const plan = we09Plan2025();
    const confirmed = {
      ...plan,
      positions: plan.positions.map((p) => (p.label === "Wartung Dach" ? { ...p, classification: "allocable" as const, origin: "user" as const, reviewed: true } : p)),
    };
    const f = forecastForTenant(confirmed, we09Property(), we09Tenant())!;
    expect(f.uncertainYear).toBe(0);
    expect(f.expectedYear).toBe(1202.22);
  });

  it("Abgaben ab 01.08.2025 nach dem Bescheid 2025: Grundsteuer 71,44 € und Müll 44,78 € anteilig", () => {
    const p = {
      ...we09Property(),
      propertyTaxFrom: "2025-08-01",
      municipalBills: [
        { id: "b25", year: 2025, propertyTax: 170.42, wasteFee: 106.84, note: "" },
        { id: "b26", year: 2026, propertyTax: 194.42, wasteFee: 142.55, note: "" },
      ],
    };
    const f = forecastForTenant(we09Plan2025(), p, we09Tenant())!;
    expect(f.charges.map((c) => [c.label, c.year, c.share])).toEqual([
      ["Grundsteuer", 170.42, 71.44],
      ["Müllgebühr", 106.84, 44.78],
    ]);
  });

  it("2026 (Plan 2025 fortgeschrieben): Grundsteuer 194,42 € und Müll 142,55 € kommen dazu", () => {
    const plan = { ...we09Plan2025(), year: 2026 };
    const f = forecastForTenant(plan, we09Property(), we09Tenant())!;
    expect(f.charges.map((c) => [c.label, c.year])).toEqual([
      ["Grundsteuer", 194.42],
      ["Müllgebühr", 142.55],
    ]);
    expect(f.expectedYear).toBe(1519.59);
    expect(f.prepayments).toBe(1560);
    expect(f.result).toBe(-40.41);
  });
});

describe("2025: Mieterwechsel am 31.07./01.08.", () => {
  // Stellvertretend die Ist-Daten 2024 als Kosten 2025 – die echten Werte kommen mit der Jahresabrechnung 2025
  const annual2025 = (): WegAnnualStatement => {
    const a = reviewedAnnual();
    return { ...a, id: "we09-a2025-probe", year: 2025 };
  };
  const tenants = () => [we09PreviousTenant(), we09Tenant()];
  const statementWithCosts = (extra: Partial<Statement> = {}) => {
    const st = { ...we09Statement(2025), ...extra };
    return { ...st, costs: transferToStatement(annual2025(), st, { property: we09Property(), tenants: tenants() }).items };
  };

  it("teilt die Heizkosten ohne Zwischenablesung nach § 9b Abs. 2 HeizkostenV", () => {
    expect(degreeDays("2025-01-01", "2025-07-31")).toBeCloseTo(596.667, 2);
    expect(degreeDays("2025-08-01", "2025-12-31")).toBeCloseTo(403.333, 2);
    const r = calculateStatement(statementWithCosts(), we09Property(), tenants());
    const [before, after] = r.tenants;
    const heat = (t: typeof before) => t.items.filter((i) => i.label.startsWith("Heiz- und Warmwasserkosten"));
    expect(heat(before).map((i) => i.amount)).toEqual([66.54, 135.14, 7.36, 37.25]);
    expect(heat(after).map((i) => i.amount)).toEqual([48.02, 91.35, 5.32, 26.88]);
    const sum = [...heat(before), ...heat(after)].reduce((a, i) => a + Math.round(i.amount * 100), 0);
    expect(sum).toBe(41786);
    expect(r.warnings.some((w) => w.includes("Gradtagzahlen"))).toBe(true);
  });

  it("nutzt die Zwischenablesung, wenn sie für beide Mieter vorliegt", () => {
    const st = statementWithCosts({ interimReadings: { "we09-vormieterin": { heating: 1200, water: 250 }, "we09-t": { heating: 385, water: 198.8 } } });
    const r = calculateStatement(st, we09Property(), tenants());
    const consumption = (i: number) => r.tenants[i].items.find((x) => x.label.includes("Verbrauchskosten Heizung"))!;
    expect(consumption(0).key).toBe("reading");
    expect(consumption(0).amount).toBe(171.48);
    expect(consumption(1).amount).toBe(55.01);
  });

  it("verteilt je Mieter nach dem eigenen Vertrag; die Differenz trägt der Vermieter", () => {
    const r = calculateStatement(statementWithCosts(), we09Property(), tenants());
    const stairs = (i: number) => r.tenants[i].items.find((x) => x.label === "Treppenhausreinigung")!.amount;
    // Vormieterin ohne erfassten Vertrag: WEG-Schlüssel 126,10 € × 212/365
    expect(stairs(0)).toBe(73.24);
    // neuer Mieter laut § 6 Nr. 3: 104,13 € × 153/365
    expect(stairs(1)).toBe(43.65);
    expect(r.landlordItems.find((x) => x.label === "Treppenhausreinigung")?.amount).toBe(9.21);
    // Vorauszahlungen: neuer Mieter 5 × 130 €
    expect(r.tenants[1].prepayments).toBe(650);
  });

  it("berechnet eine Kostenart laut Objekteinstellung jedem Mieter mit dem WEG-Anteil", () => {
    const property = { ...we09Property(), wegShareAlways: ["Treppenhausreinigung"] };
    const r = calculateStatement(statementWithCosts(), property, tenants());
    const stairs = (i: number) => r.tenants[i].items.find((x) => x.label === "Treppenhausreinigung")!.amount;
    // beide nach WEG-Schlüssel 126,10 € zeitanteilig, nichts bleibt beim Vermieter
    expect(stairs(0) + stairs(1)).toBe(126.1);
    expect(stairs(1)).toBe(52.86);
    expect(r.landlordItems.find((x) => x.label === "Treppenhausreinigung")).toBeUndefined();
  });

  it("verlangt Vermieterangaben je Mietverhältnis und keine erfundenen Vorauszahlungen", () => {
    const data = appData({ tenants: tenants(), wegAnnuals: [annual2025()] });
    const st = { ...statementWithCosts(), prepaymentsConfirmed: { "we09-vormieterin": true, "we09-t": true } };
    const r = statementReadiness(st, data);
    expect(r.blockers.some((b) => b.includes("Vermieters von Vormieterin"))).toBe(true);
    expect(r.hints.some((h) => h.includes("keine Vorauszahlungen hinterlegt"))).toBe(true);
  });
});

describe("Freigabe je Mietverhältnis", () => {
  const resolvedAnnual2025 = (): WegAnnualStatement => {
    const a = reviewedAnnual();
    return {
      ...a,
      id: "we09-a2025-probe",
      year: 2025,
      positions: a.positions.map((p) => (p.label === "Wartung Dach" ? { ...p, classification: "non_allocable" as const, origin: "user" as const, reviewed: true } : p)),
    };
  };
  const setup = () => {
    const data = appData({ tenants: [we09PreviousTenant(), we09Tenant()], wegAnnuals: [resolvedAnnual2025()] });
    const st0 = { ...we09Statement(2025), prepaymentsConfirmed: { "we09-t": true } };
    const st = { ...st0, costs: transferToStatement(resolvedAnnual2025(), st0, { property: we09Property(), tenants: data.tenants }).items };
    return { data, st };
  };

  it("gibt den neuen Mieter frei, obwohl Angaben zur Vormieterin fehlen", () => {
    const { data, st } = setup();
    const r = statementReadiness(st, data);
    expect(r.general).toEqual([]);
    expect(r.tenants.find((t) => t.tenantId === "we09-t")?.ready).toBe(true);
    expect(r.tenants.find((t) => t.tenantId === "we09-vormieterin")?.ready).toBe(false);
    const released = releaseTenant(st, data, "we09-t");
    expect(released.status).toBe("partial");
    expect(releasedTenant(released, "we09-t")?.result.days).toBe(153);
    expect(() => releaseTenant(released, data, "we09-vormieterin")).toThrow(/Vorauszahlungen von Vormieterin/);
  });

  it("Angaben zur Vormieterin ändern das freigegebene Anschreiben nicht", () => {
    const { data, st } = setup();
    const released = releaseTenant(st, data, "we09-t");
    const later = { ...released, prepaymentOverrides: { "we09-vormieterin": 700 }, prepaymentsConfirmed: { ...released.prepaymentsConfirmed, "we09-vormieterin": true } };
    expect(changedSinceRelease(later, data, "we09-t")).toBe(false);
    // eine Änderung an gemeinsamen Kosten würde das Ergebnis ändern – das wird angezeigt
    const changedCosts = { ...released, costs: released.costs.map((c) => (c.label === "Winterdienst" ? { ...c, amount: 40 } : c)) };
    expect(changedSinceRelease(changedCosts, data, "we09-t")).toBe(true);
  });

  it("vollständig freigegeben, wenn alle Mietverhältnisse freigegeben sind; Aufheben setzt zurück", () => {
    const { data, st } = setup();
    const withFather = {
      ...data,
      tenants: [
        { ...we09PreviousTenant(), mailingAddress: "Neue Straße 2\n52525 Ort", landlord: { name: "Vater", address: "Straße 1\n52525 Ort", iban: "" } },
        we09Tenant(),
      ],
    };
    const ready = { ...st, prepaymentsConfirmed: { "we09-t": true, "we09-vormieterin": true } };
    const all = releaseStatement(ready, withFather);
    expect(all.status).toBe("released");
    expect(revokeRelease(all, withFather, "we09-t").status).toBe("partial");
  });

  it("verlangt nach dem Auszug die aktuelle Postanschrift", () => {
    const { data, st } = setup();
    const r = statementReadiness(st, data);
    const prev = r.tenants.find((t) => t.tenantId === "we09-vormieterin")!;
    const text = prev.blockers.find((b) => b.includes("aktuelle Postanschrift"))!;
    expect(r.targets[text].href).toContain("f=anschrift");
  });

  it("übernimmt frühere Freigaben der ganzen Abrechnung", () => {
    const old = {
      version: 2,
      properties: [],
      tenants: [],
      statements: [
        { ...we09Statement(2024), releases: undefined, status: "released", release: { releasedAt: "2026-01-10T00:00:00Z", resultJson: JSON.stringify({ periodDays: 366, co2: [], tenants: [{ tenant: { id: "x" }, days: 366 }] }) } },
      ],
      settings: {},
    };
    const migrated = migrate(old);
    expect(Object.keys(migrated.statements[0].releases)).toEqual(["x"]);
    expect(migrated.statements[0].status).toBe("released");
  });
});

describe("Zählerstände zum Mieterwechsel", () => {
  const annual2025 = (): WegAnnualStatement => ({ ...reviewedAnnual(), id: "we09-a2025-probe", year: 2025 });
  const tenants = () => [we09PreviousTenant(), we09Tenant()];
  const calc = (meterReadings: Statement["meterReadings"]) => {
    const st0 = { ...we09Statement(2025), meterReadings };
    const st = { ...st0, costs: transferToStatement(annual2025(), st0, { property: we09Property(), tenants: tenants() }).items };
    return calculateStatement(st, we09Property(), tenants());
  };
  const share = (r: ReturnType<typeof calc>, i: number, label: string) => r.tenants[i].items.find((x) => x.label.startsWith(label))!;

  it("errechnet den Verbrauch je Mieter aus den Ständen 01.01., Wechseltag und 31.12.", () => {
    const r = calc({ "we09-u": { heating: [10000, 11200, 11585] } });
    expect(share(r, 0, "Heiz- und Warmwasserkosten – Verbrauchskosten Heizung").amount).toBe(171.48);
    expect(share(r, 1, "Heiz- und Warmwasserkosten – Verbrauchskosten Heizung").amount).toBe(55.01);
    expect(share(r, 1, "Heiz- und Warmwasserkosten – Verbrauchskosten Heizung").basisShare).toBe(385);
  });

  it("verteilt Wasser und Abwasser nach den Kaltwasser-Zählerständen statt nach Tagen", () => {
    const r = calc({ "we09-u": { coldWater: [100, 120, 134.766] } });
    expect(share(r, 0, "Wasser").amount).toBe(34.65);
    expect(share(r, 1, "Wasser").amount).toBe(25.58);
    expect(share(r, 0, "Abwassergebühren").amount).toBe(82.7);
    expect(share(r, 1, "Abwassergebühren").amount).toBe(61.05);
    expect(share(r, 1, "Wasser").key).toBe("reading");
  });

  it("verwirft fallende Zählerstände und teilt dann nach Tagen", () => {
    const r = calc({ "we09-u": { coldWater: [100, 90, 134.766] } });
    expect(share(r, 1, "Wasser").amount).toBe(25.25);
    expect(r.warnings.some((w) => w.includes("Kaltwasser-Zählerständen"))).toBe(true);
  });

  it("Stichtage: Beginn, Wechsel, Ende", () => {
    const st = we09Statement(2025);
    const segs = buildSegments(we09Property().units, tenants(), st.periodStart, st.periodEnd);
    expect(meterDates(segs)).toEqual(["2025-01-01", "2025-08-01", "2025-12-31"]);
  });
});
