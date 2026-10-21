import { describe, expect, it } from "vitest";
import { estimatePropertyTax } from "./propertyTax";

describe("Grundsteuer-Schätzung", () => {
  it("WE 09: Grundsteuerwert 112.200 €, Hebesatz Heinsberg 2026 für Wohngrundstücke 559 %", () => {
    expect(estimatePropertyTax({ propertyTaxValue: 112200, propertyTaxRate: 559 })).toEqual({ baseAmount: 34.78, tax: 194.42 });
  });
  it("ohne Hebesatz keine Schätzung", () => {
    expect(estimatePropertyTax({ propertyTaxValue: 112200, propertyTaxRate: null })).toBeNull();
  });
});
