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

  it("berücksichtigt einen Anfangsbestand", () => {
    const l = accountLedger({ ...p, accountOpeningBalance: 500 }, data, "2025-08-31")!;
    expect(l.balance).toBe(500 + 630 - 160.31);
  });
});
