import type { Classification, LedgerPosition } from "./types";

/**
 * Regelbasierte Erstbewertung von Kostenpositionen aus WEG-Abrechnungen und
 * Wirtschaftsplänen. Die Regeln sind bewusst vorsichtig: Was nicht eindeutig
 * einer Kostenart nach § 2 BetrKV zugeordnet werden kann, geht auf „Prüfung
 * erforderlich“. Ergebnis ist immer ein Vorschlag – die verbindliche Bewertung
 * trifft der Vermieter (reviewed = true), auch unter Berücksichtigung des Mietvertrags.
 */
export interface ClassificationResult {
  category: number | null;
  classification: Classification;
  reason: string;
  heating?: "total" | "component";
}

interface Rule {
  test: RegExp;
  result: (year: number) => ClassificationResult;
}

const allocable = (category: number, reason: string): ClassificationResult => ({ category, classification: "allocable", reason });
const nonAllocable = (reason: string): ClassificationResult => ({ category: null, classification: "non_allocable", reason });
const review = (category: number | null, reason: string): ClassificationResult => ({ category, classification: "review", reason });

const RULES: Rule[] = [
  // --- nicht umlagefähig (§ 1 Abs. 2 BetrKV) ---
  {
    test: /r(ü|ue)cklage/,
    result: () => nonAllocable("Zuführung zur Erhaltungsrücklage: Vermögensbildung der Eigentümer, keine Betriebskosten (§ 1 Abs. 2 BetrKV)."),
  },
  { test: /verwalt/, result: () => nonAllocable("Verwaltungskosten sind keine Betriebskosten (§ 1 Abs. 2 Nr. 1 BetrKV).") },
  {
    test: /bank|kontof(ü|ue)hr|spesen|geldverkehr|mahn|zinsen/,
    result: () => nonAllocable("Kosten des Geldverkehrs gehören zu den Verwaltungskosten (§ 1 Abs. 2 Nr. 1 BetrKV)."),
  },
  {
    test: /instand|reparatur|erhaltung|sanierung|erneuerung|ersatzbeschaffung/,
    result: () => nonAllocable("Instandhaltung und Instandsetzung sind keine Betriebskosten (§ 1 Abs. 2 Nr. 2 BetrKV)."),
  },
  { test: /rechtsschutz|hausrat|rechtsanwalt|gericht|beirat|eigent(ü|ue)merversammlung/, result: () => nonAllocable("Kosten der Eigentümergemeinschaft bzw. Verwaltung, keine Betriebskosten.") },

  // --- Heizung und Warmwasser (HeizkostenV) ---
  {
    test: /(strom|energie).*(w(ä|ae)rmepumpe|heizung)|w(ä|ae)rmepumpe.*strom|heizstrom|brennstoff|heiz(ö|oe)l|gasbezug|gaslieferung|fernw(ä|ae)rme|wartung.*(heizung|wohnungsstation|(ü|ue)bergabestation|frischwasserstation|w(ä|ae)rmepumpe)|(heizung|w(ä|ae)rmepumpe)s?\s*-?wartung|wohnungsstation|messdienst|verbrauchserfassung|ablesung|heizkostenverteil|w(ä|ae)rmez(ä|ae)hler/,
    result: () => ({
      category: 6,
      classification: "allocable",
      heating: "component",
      reason:
        "Kosten der Heizungs- bzw. Warmwasseranlage (Energie, Wartung, Messdienst; § 7 Abs. 2, § 8 Abs. 2 HeizkostenV). Sie sind in der Heizkostenabrechnung enthalten und dürfen nicht zusätzlich umgelegt werden.",
    }),
  },
  {
    test: /heiz|warmwasser|w(ä|ae)rme/,
    result: () => ({
      category: 6,
      classification: "allocable",
      heating: "total",
      reason: "Heiz- und Warmwasserkosten laut Heizkostenabrechnung (§ 2 Nr. 4–6 BetrKV, Verteilung nach HeizkostenV).",
    }),
  },

  // --- prüfpflichtig ---
  {
    test: /dach/,
    result: () =>
      review(
        17,
        "Dachwartung bzw. Dachrinnenreinigung kann als sonstige Betriebskosten umlagefähig sein, wenn sie regelmäßig anfällt und im Mietvertrag ausdrücklich vereinbart ist. Inspektionen mit Reparaturanteil sind Instandhaltung. Bitte die konkrete Leistung und den Mietvertrag prüfen.",
      ),
  },
  {
    test: /rauch(warn)?melder/,
    result: () =>
      review(17, "Wartung von Rauchwarnmeldern ist als sonstige Betriebskosten umlagefähig, wenn vereinbart; Miet- oder Leasingkosten der Geräte sind es nicht."),
  },
  {
    test: /hausmeister|hauswart/,
    result: () => review(14, "Hauswartkosten sind umlagefähig, aber ohne Anteile für Reparaturen und Verwaltung (§ 2 Nr. 14 BetrKV). Bitte den Anteil prüfen."),
  },
  {
    test: /kabel|antenne|breitband|fernseh|\btv\b/,
    result: (year) =>
      year >= 2025
        ? nonAllocable("Kosten für Kabel-TV sind seit 01.07.2024 nicht mehr umlagefähig (§ 2 Nr. 15 BetrKV n. F.).")
        : review(15, "Kabel-TV ist nur bis 30.06.2024 umlagefähig (Übergangsregel § 2 Nr. 15 BetrKV). Bitte zeitanteilig prüfen."),
  },
  {
    test: /aufzug.*wartung|wartung.*aufzug|fahrstuhl.*wartung/,
    result: () => allocable(7, "Wartung des Aufzugs gehört zu den Betriebskosten des Aufzugs (§ 2 Nr. 7 BetrKV)."),
  },
  {
    test: /wartung/,
    result: () =>
      review(
        17,
        "Wartung ist nur umlagefähig, soweit sie einer Kostenart der BetrKV zugeordnet werden kann (z. B. Aufzug, Heizung) oder als sonstige Betriebskosten vereinbart ist. Reparaturanteile sind nicht umlagefähig.",
      ),
  },

  // --- umlagefähig (§ 2 BetrKV) ---
  { test: /grundsteuer/, result: () => allocable(1, "Grundsteuer (§ 2 Nr. 1 BetrKV).") },
  {
    test: /abwasser|schmutzwasser|niederschlag|regenwasser|kanal|entw(ä|ae)sser|siel/,
    result: () => allocable(3, "Entwässerung: Schmutz- und Niederschlagswasser (§ 2 Nr. 3 BetrKV)."),
  },
  { test: /wasser/, result: () => allocable(2, "Wasserversorgung (§ 2 Nr. 2 BetrKV).") },
  { test: /aufzug|fahrstuhl|\blift\b/, result: () => allocable(7, "Betrieb des Personen- oder Lastenaufzugs (§ 2 Nr. 7 BetrKV).") },
  {
    test: /winterdienst|schnee|stra(ß|ss)enreinigung|gehwegreinigung/,
    result: () => allocable(8, "Straßenreinigung einschließlich Winterdienst (§ 2 Nr. 8 BetrKV)."),
  },
  { test: /m(ü|ue)ll|abfall|entsorgung/, result: () => allocable(8, "Müllbeseitigung (§ 2 Nr. 8 BetrKV).") },
  { test: /ungeziefer|sch(ä|ae)dling/, result: () => allocable(9, "Ungezieferbekämpfung (§ 2 Nr. 9 BetrKV).") },
  { test: /treppenhaus|geb(ä|ae)udereinigung|reinigung|putz/, result: () => allocable(9, "Gebäudereinigung (§ 2 Nr. 9 BetrKV).") },
  { test: /garten|gr(ü|ue)n|rasen|baum|hecke/, result: () => allocable(10, "Gartenpflege (§ 2 Nr. 10 BetrKV).") },
  { test: /allgemeinstrom|beleuchtung|hausstrom|treppenlicht/, result: () => allocable(11, "Beleuchtung bzw. Allgemeinstrom (§ 2 Nr. 11 BetrKV).") },
  { test: /schornstein|kaminkehr|abgasmess|feuerst(ä|ae)tten|immissions/, result: () => allocable(12, "Schornsteinreinigung (§ 2 Nr. 12 BetrKV).") },
  { test: /versicherung/, result: () => allocable(13, "Sach- und Haftpflichtversicherung (§ 2 Nr. 13 BetrKV).") },
  { test: /wasch|w(ä|ae)sche/, result: () => allocable(16, "Einrichtungen für die Wäschepflege (§ 2 Nr. 16 BetrKV).") },
  { test: /strom/, result: () => review(11, "Stromkosten: nur als Allgemeinstrom umlagefähig. Bitte prüfen, wofür der Strom verwendet wird.") },
];

const normalize = (label: string) => label.toLowerCase().replace(/\s+/g, " ").trim();

export function classifyLabel(label: string, year: number): ClassificationResult {
  const text = normalize(label);
  for (const rule of RULES) if (rule.test.test(text)) return rule.result(year);
  return review(null, "Keine eindeutige Kostenart nach § 2 BetrKV erkannt. Bitte Leistung und Mietvertrag prüfen.");
}

/** Wendet die Regeln auf eine Position an, sofern der Vermieter sie nicht schon selbst bewertet hat */
export function applyRules<T extends LedgerPosition>(position: T, year: number): T {
  if (position.origin === "user") return position;
  const r = classifyLabel(position.label, year);
  return {
    ...position,
    category: r.category,
    classification: r.classification,
    reason: r.reason,
    heating: r.heating,
    origin: "rule",
    // Geänderter Vorschlag muss erneut bestätigt werden
    reviewed: r.classification === position.classification ? position.reviewed : false,
  };
}

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  allocable: "umlagefähig",
  non_allocable: "nicht umlagefähig",
  review: "Prüfung erforderlich",
};
