import { describe, expect, it } from "vitest";
import { allocate, sumEuro, toCents } from "./money";

describe("money", () => {
  it("rechnet Euro exakt in Cent um", () => {
    expect(toCents(1468.43)).toBe(146843);
    expect(toCents(1.005)).toBe(101);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(sumEuro([60.23, 143.75, 126.1, 45.53, 4.01, 44.94, 180.75, 3.82, 29.36, 417.86])).toBe(1056.35);
  });

  it("verteilt ohne Rundungsdifferenz", () => {
    const parts = allocate(10000, [1, 1, 1]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b)).toBe(10000);
  });

  it("vergibt Restcent nach den größten Resten", () => {
    // 100 Cent nach 72/58/90 m²: 32,72 / 26,36 / 40,90 → 33 / 26 / 41
    expect(allocate(100, [72, 58, 90])).toEqual([33, 26, 41]);
  });

  it("gibt Gewichten von 0 keinen Restcent", () => {
    expect(allocate(1, [0, 1, 0])).toEqual([0, 1, 0]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });

  it("verteilt auch negative Beträge (Gutschriften)", () => {
    const parts = allocate(-1001, [1, 1]);
    expect(parts.reduce((a, b) => a + b)).toBe(-1001);
  });
});
