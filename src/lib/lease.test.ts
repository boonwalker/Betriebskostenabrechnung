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
