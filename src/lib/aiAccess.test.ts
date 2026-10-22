import { describe, expect, it } from "vitest";
import { aiAccess } from "./aiAccess";
import { emptyData, exportData } from "./store";

describe("Zugang zur Belegerkennung", () => {
  it("nutzt den eigenen Schlüssel vorrangig", () => {
    const s = { ...emptyData().settings, anthropicApiKey: "sk-ant-x", inviteCode: "anna" };
    expect(aiAccess(s)).toEqual({ kind: "key", apiKey: "sk-ant-x" });
  });

  it("ohne Proxy-Adresse hilft ein Einladungscode allein nicht", () => {
    expect(aiAccess({ ...emptyData().settings, inviteCode: "anna" })).toBeNull();
  });

  it("Sicherungen enthalten weder Schlüssel noch Einladungscode", () => {
    const d = { ...emptyData(), settings: { ...emptyData().settings, anthropicApiKey: "sk-ant-x", inviteCode: "anna" } };
    const json = exportData(d);
    expect(json).not.toContain("sk-ant-x");
    expect(json).not.toContain("anna");
  });
});
