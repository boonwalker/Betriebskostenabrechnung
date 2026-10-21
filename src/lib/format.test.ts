import { describe, expect, it } from "vitest";
import { parseNumber } from "./format";

describe("parseNumber", () => {
  it("versteht deutsche und englische Schreibweise", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("300.000")).toBe(300000);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("1234.56")).toBe(1234.56);
    expect(parseNumber("450 €")).toBe(450);
    expect(parseNumber("")).toBe(0);
  });
});
