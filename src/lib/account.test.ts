import { describe, expect, it } from "vitest";
import { accountLedger } from "./account";
import { showcaseData } from "./demo";

describe("Mietkonto WE 09 (Soll-Kontostand)", () => {
  const data = showcaseData();
  const p = data.properties[0];

  it("22.10.2026: 15 Mieten, 15 Hausgelder, 3 Quartalsraten Grundbesitzabgaben, 14 Entnahmen", () => {
    const l = accountLedger(p, data, "2026-10-22")!;
    expect(l.opening).toEqual({ date: "2025-08-01", amount: 0 });
    // 15 × 630 = 9.450,00; 15 × 160,31 = 2.404,65; 3 × 84,24 = 252,72; 14 × 300 = 4.200,00
    expect(l.incoming).toBe(9450);
    expect(l.outgoing).toBe(-(2404.65 + 252.72 + 4200));
    expect(l.balance).toBe(2592.63);
  });

  it("Grundbesitzabgaben erst ab 2026, Raten wie im Bescheid (84,24 / 84,24 / 84,24 / 84,25)", () => {
    const l = accountLedger(p, data, "2026-12-31")!;
    const rates = l.bookings.filter((b) => b.label.startsWith("Grundsteuer"));
    expect(rates.map((b) => [b.date, b.amount])).toEqual([
      ["2026-02-15", -84.24],
      ["2026-05-15", -84.24],
      ["2026-08-15", -84.24],
      ["2026-11-15", -84.25],
    ]);
  });

  it("Abgaben ab 01.08.2025: anteilige Erstattung an die Eltern zum Jahresende, ab 2026 Quartalsraten", () => {
    const l = accountLedger({ ...p, propertyTaxFrom: "2025-08-01" }, data, "2026-03-01")!;
    const refund = l.bookings.find((b) => b.label.startsWith("Erstattung"))!;
    expect(refund.date).toBe("2025-12-31");
    // 336,97 € × 153/365
    expect(refund.amount).toBe(-141.25);
    expect(l.bookings.filter((b) => b.label.includes("Rate")).map((b) => b.date)).toEqual(["2026-02-15"]);
  });

  it("Bescheide je Jahr: Erstattung 2025 nach dem Bescheid 2025 (277,26 € × 153/365), 2026 nach dem Bescheid 2026", () => {
    const bills = [
      { id: "b25", year: 2025, propertyTax: 170.42, wasteFee: 106.84, note: "" },
      { id: "b26", year: 2026, propertyTax: 194.42, wasteFee: 142.55, note: "" },
    ];
    const l = accountLedger({ ...p, propertyTaxFrom: "2025-08-01", municipalBills: bills }, data, "2026-03-01")!;
    expect(l.bookings.find((b) => b.label.startsWith("Erstattung"))!.amount).toBe(-116.22);
    expect(l.bookings.find((b) => b.label.includes("1. Rate"))!.amount).toBe(-84.24);
  });

  it("berücksichtigt einen Anfangsbestand", () => {
    const l = accountLedger({ ...p, accountOpeningBalance: 500 }, data, "2025-08-31")!;
    expect(l.balance).toBe(500 + 630 - 160.31);
  });

  it("Abrechnungsspitze der WEG am Tag der Zahlung (Erstattung 2024 am 04.12.2025)", () => {
    const annuals = data.wegAnnuals.map((a) => (a.year === 2024 ? { ...a, settlement: { amount: 110.65, paidOn: "2025-12-04" } } : a));
    const l = accountLedger(p, { ...data, wegAnnuals: annuals }, "2025-12-31")!;
    const b = l.bookings.find((x) => x.kind === "wegSettlement")!;
    expect([b.date, b.amount, b.label]).toEqual(["2025-12-04", 110.65, "Abrechnungsspitze WEG 2024 (Erstattung)"]);
    expect(l.balance).toBeCloseTo(accountLedger(p, data, "2025-12-31")!.balance + 110.65, 2);
  });

  it("Abrechnungsspitze ohne Zahltag: am 31.12. des Folgejahres", () => {
    const annuals = data.wegAnnuals.map((a) => ({ ...a, year: 2025, settlement: { amount: 155.3, paidOn: null } }));
    const l = accountLedger(p, { ...data, wegAnnuals: annuals }, "2026-12-31")!;
    const b = l.bookings.find((x) => x.kind === "wegSettlement")!;
    expect([b.date, b.amount, b.label]).toEqual(["2026-12-31", 155.3, "Abrechnungsspitze WEG 2025 (Erstattung, Zahltag angenommen)"]);
  });
});
