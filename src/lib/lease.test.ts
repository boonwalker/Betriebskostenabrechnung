import { describe, expect, it } from "vitest";
import { we09Lease } from "./fixtures/we09";
import { agreementFor, agreementForItem } from "./lease";

describe("Vereinbarung laut Mietvertrag", () => {
  it("„Wartung Dach“ ist nur ähnlich zu „Dachrinnenreinigung“, bis der Vermieter es bestätigt", () => {
    const lease = we09Lease();
    expect(agreementFor("Wartung Dach", 17, lease)).toMatchObject({ status: "partial", term: "Dachrinnenreinigung" });
    expect(agreementForItem({ label: "Wartung Dach", category: 17, confirmedAgreement: "Dachrinnenreinigung" }, lease).status).toBe("agreed");
    // eine Bestätigung für eine Leistung, die nicht im Vertrag steht, zählt nicht
    expect(agreementForItem({ label: "Wartung Dach", category: 17, confirmedAgreement: "Dachsanierung" }, lease).status).toBe("partial");
  });
});

describe("Reihenfolge der Kostenpositionen", () => {
  it("ordnet WEG-Positionen wie im Originalbeleg, eigene Positionen davor", async () => {
    const { orderCosts } = await import("./weg");
    const annual = { id: "a", positions: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] } as never;
    const c = (id: string, pos?: string) => ({ id, label: id, category: 1, amount: 1, key: "direct" as const, ...(pos ? { sourceAnnualId: "a", sourcePositionId: pos } : {}) });
    const sorted = orderCosts([c("Grundsteuer"), c("Dach", "p3"), c("Müll"), c("Wasser", "p1"), c("Strom", "p2")], [annual]);
    expect(sorted.map((x) => x.id)).toEqual(["Grundsteuer", "Müll", "Wasser", "Strom", "Dach"]);
  });
});
