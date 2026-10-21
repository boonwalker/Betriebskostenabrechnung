import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { COST_CATEGORIES } from "./betrkv";
import { isSupportedFile, type ImageType } from "./files";
import type { AllocationKey } from "./types";

const KEYS = ["area", "persons", "units", "consumption", "heating", "direct"] as const satisfies readonly AllocationKey[];

const ExtractionSchema = z.object({
  vendor: z.string(),
  invoiceDate: z.string(),
  servicePeriodStart: z.string(),
  servicePeriodEnd: z.string(),
  totalAmount: z.number(),
  items: z.array(
    z.object({
      description: z.string(),
      category: z.number().int().min(1).max(17),
      allocableAmount: z.number(),
      nonAllocableAmount: z.number(),
      recommendedKey: z.enum(KEYS),
      laborCost: z.number(),
      laborKind: z.enum(["none", "service", "craftsman"]),
      co2Cost: z.number(),
      co2Kg: z.number(),
      reasoning: z.string(),
    }),
  ),
  notes: z.string(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vendor", "invoiceDate", "servicePeriodStart", "servicePeriodEnd", "totalAmount", "items", "notes"],
  properties: {
    vendor: { type: "string", description: "Rechnungssteller bzw. Behörde" },
    invoiceDate: { type: "string", description: "Rechnungs-/Bescheiddatum als YYYY-MM-DD, leer wenn unbekannt" },
    servicePeriodStart: { type: "string", description: "Beginn des Leistungszeitraums als YYYY-MM-DD, leer wenn unbekannt" },
    servicePeriodEnd: { type: "string", description: "Ende des Leistungszeitraums als YYYY-MM-DD, leer wenn unbekannt" },
    totalAmount: { type: "number", description: "Rechnungsendbetrag brutto in Euro" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "description",
          "category",
          "allocableAmount",
          "nonAllocableAmount",
          "recommendedKey",
          "laborCost",
          "laborKind",
          "co2Cost",
          "co2Kg",
          "reasoning",
        ],
        properties: {
          description: { type: "string" },
          category: { type: "integer", description: "Nummer der Kostenart nach § 2 BetrKV (1-17)" },
          allocableAmount: { type: "number", description: "umlagefähiger Bruttobetrag in Euro" },
          nonAllocableAmount: {
            type: "number",
            description: "nicht umlagefähiger Bruttobetrag in Euro (z. B. Reparatur, Instandhaltung, Verwaltung)",
          },
          recommendedKey: { type: "string", enum: [...KEYS] },
          laborCost: {
            type: "number",
            description: "im umlagefähigen Betrag enthaltene Arbeits-, Maschinen- und Fahrtkosten inkl. USt nach § 35a EStG, 0 wenn nicht ausgewiesen",
          },
          laborKind: {
            type: "string",
            enum: ["none", "service", "craftsman"],
            description: "service = haushaltsnahe Dienstleistung (§ 35a Abs. 2), craftsman = Handwerkerleistung (§ 35a Abs. 3)",
          },
          co2Cost: { type: "number", description: "im Betrag enthaltene CO2-Kosten in Euro (nur Brennstoff/Wärme), sonst 0" },
          co2Kg: { type: "number", description: "ausgewiesener CO2-Ausstoß in kg (nur Brennstoff/Wärme), sonst 0" },
          reasoning: { type: "string", description: "kurze Begründung auf Deutsch" },
        },
      },
    },
    notes: { type: "string", description: "Hinweise für den Vermieter auf Deutsch, z. B. abweichender Leistungszeitraum" },
  },
} as const;

const SYSTEM = `Du hilfst einem privaten Vermieter in Deutschland bei der Betriebskostenabrechnung.
Du bekommst einen Beleg (Rechnung, Abgabenbescheid, Versicherungspolice o. Ä.) und überträgst ihn in Kostenpositionen.

Kostenarten nach § 2 BetrKV:
${COST_CATEGORIES.map((c) => `${c.no}. ${c.label}`).join("\n")}

Umlageschlüssel: area = Wohnfläche, persons = Personenzahl, units = Wohneinheiten, consumption = erfasster Verbrauch,
heating = Heiz-/Warmwasserkosten nach HeizkostenV (Grund- und Verbrauchskosten), direct = nur eine Wohnung betroffen.

Regeln:
- Trenne umlagefähige von nicht umlagefähigen Anteilen. Nicht umlagefähig sind u. a. Reparaturen, Instandhaltung, Instandsetzung, Verwaltungskosten, Bankgebühren, Mahngebühren, Rücklagen und Anschaffungen. Bei Hauswart-Rechnungen gehören Reparatur- und Verwaltungstätigkeiten nicht dazu.
- Beträge sind Bruttobeträge inkl. Umsatzsteuer.
- Fasse gleichartige Positionen zu einer Kostenart zusammen; lege nur dann mehrere Positionen an, wenn verschiedene Kostenarten betroffen sind.
- Wenn ein Abgabenbescheid mehrere Kostenarten enthält (z. B. Grundsteuer, Straßenreinigung, Müll), lege je Kostenart eine Position an.
- Wenn der Leistungszeitraum nicht dem Abrechnungsjahr entspricht oder es sich um Abschlagszahlungen handelt, weise in notes darauf hin.
- Bei einer Hausgeld-/Jahresabrechnung einer WEG übernimm nur den Anteil der Einheit (Einzelabrechnung), nicht die Gesamtkosten der Gemeinschaft. Verwaltervergütung, Erhaltungsrücklage und Instandhaltung sind nicht umlagefähig. Die Grundsteuer ist nicht im Hausgeld enthalten.
- Wenn Arbeitskosten (Lohn, Maschinen, Fahrt) für § 35a EStG ausgewiesen sind, gib sie in laborCost an (sonst 0 und laborKind = none). Gartenpflege, Reinigung, Hauswart, Winterdienst sind haushaltsnahe Dienstleistungen; Wartungen, Reparaturen, Schornsteinfeger sind Handwerkerleistungen.
- Brennstoff- und Wärmerechnungen müssen CO2-Kosten und CO2-Ausstoß ausweisen (§ 3 CO2KostAufG). Übernimm beide Werte, sonst 0.
- Erfinde keine Werte. Wenn etwas nicht lesbar ist, schreibe es in notes.`;


async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function toBlock(file: File, data: string): BetaContentBlockParam {
  return file.type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: file.type as ImageType, data } };
}

/** Sendet Dokumente mit strukturierter Ausgabe an Claude und gibt das JSON zurück */
async function askClaude(files: File[], apiKey: string, system: string, schema: Record<string, unknown>, instruction: string): Promise<unknown> {
  for (const f of files) if (!isSupportedFile(f)) throw new Error(`„${f.name}“: Bitte PDF-Dateien oder Bilder (JPG, PNG, WebP, GIF) hochladen.`);
  const blocks: BetaContentBlockParam[] = [];
  for (const [i, f] of files.entries()) {
    blocks.push({ type: "text", text: `Datei ${i + 1}: ${f.name}` });
    blocks.push(toBlock(f, await toBase64(f)));
  }

  // Der Schlüssel liegt nur im Browser des Nutzers und geht direkt an die Anthropic-API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let response;
  try {
    // Streaming, weil mehrseitige Abrechnungen lange Antworten erzeugen können
    response = await client.beta.messages
      .stream({
        model: "claude-opus-5-5",
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "high", format: { type: "json_schema", schema } },
        system,
        messages: [{ role: "user", content: [...blocks, { type: "text", text: instruction }] }],
      })
      .finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Zu viele Anfragen – bitte kurz warten und erneut versuchen.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Keine Verbindung zur Anthropic-API.");
    if (err instanceof Anthropic.APIError) throw new Error(`Fehler der Anthropic-API (${err.status}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new Error("Das Dokument konnte nicht verarbeitet werden.");
  if (response.stop_reason === "max_tokens") throw new Error("Das Dokument ist zu umfangreich für eine automatische Erfassung.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text);
}

export async function extractInvoice(file: File, apiKey: string, billingPeriod: string): Promise<Extraction> {
  const json = await askClaude([file], apiKey, SYSTEM, JSON_SCHEMA, `Abrechnungszeitraum: ${billingPeriod}. Bitte erfasse diesen Beleg.`);
  return ExtractionSchema.parse(json);
}

/* ---------- WEG-Jahresabrechnung und Wirtschaftsplan ---------- */

const nullableNumber = { type: ["number", "null"] } as const;

const WegSchema = z.object({
  documentKind: z.enum(["annual", "plan", "other"]),
  year: z.number().int().nullable(),
  unitName: z.string(),
  managementCostsActual: z.number().nullable(),
  managementCostsPlan: z.number().nullable(),
  buildingTotal: z.number().nullable(),
  monthlyReserve: z.number().nullable(),
  monthlyCosts: z.number().nullable(),
  reserveContribution: z.number().nullable(),
  annualHausgeld: z.number().nullable(),
  monthlyHausgeld: z.number().nullable(),
  positions: z.array(
    z.object({
      label: z.string(),
      unitAmount: z.number(),
      totalAmount: z.number().nullable(),
      wegKey: z.string(),
      basisTotal: z.number().nullable(),
      basisShare: z.number().nullable(),
      basisUnit: z.string(),
      remark: z.string(),
      declaredAllocable: z.enum(["yes", "no", "unknown"]),
      isReserve: z.boolean(),
      page: z.number().int().nullable(),
      sourceText: z.string(),
      confidence: z.number(),
    }),
  ),
  heating: z
    .object({
      heatSource: z.string(),
      buildingTotal: z.number().nullable(),
      unitShare: z.number(),
      baseSharePct: z.number().nullable(),
      areaTotal: z.number().nullable(),
      consumptionHeatingKwh: z.number().nullable(),
      consumptionWaterKwh: z.number().nullable(),
      components: z.array(z.object({ label: z.string(), amount: z.number() })),
      includedCosts: z.array(z.object({ label: z.string(), amount: z.number() })),
      co2Cost: z.number().nullable(),
      co2Kg: z.number().nullable(),
      page: z.number().int().nullable(),
    })
    .nullable(),
  notes: z.string(),
});

export type WegExtraction = z.infer<typeof WegSchema>;

const WEG_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "documentKind",
    "year",
    "unitName",
    "managementCostsActual",
    "managementCostsPlan",
    "buildingTotal",
    "monthlyReserve",
    "monthlyCosts",
    "reserveContribution",
    "annualHausgeld",
    "monthlyHausgeld",
    "positions",
    "heating",
    "notes",
  ],
  properties: {
    documentKind: { type: "string", enum: ["annual", "plan", "other"], description: "annual = Jahres-/Einzelabrechnung (Ist), plan = Wirtschaftsplan" },
    year: { type: ["integer", "null"] },
    unitName: { type: "string", description: "Bezeichnung der Wohnung, z. B. WE 09" },
    managementCostsActual: { ...nullableNumber, description: "Bewirtschaftungskosten Ist der Wohnung (ohne Rücklage)" },
    managementCostsPlan: { ...nullableNumber, description: "Bewirtschaftungskosten Soll laut Wirtschaftsplan in der Jahresabrechnung" },
    buildingTotal: { ...nullableNumber, description: "Summe der Spalte Gesamtkosten der WEG in der Einzelabrechnung" },
    monthlyReserve: { ...nullableNumber, description: "nur Wirtschaftsplan: davon monatlich für Rücklage" },
    monthlyCosts: { ...nullableNumber, description: "nur Wirtschaftsplan: davon monatlich für Kostentragung" },
    reserveContribution: { ...nullableNumber, description: "Zuführung zur Erhaltungsrücklage der Wohnung" },
    annualHausgeld: { ...nullableNumber, description: "nur Wirtschaftsplan: Hausgeld pro Jahr" },
    monthlyHausgeld: { ...nullableNumber, description: "nur Wirtschaftsplan: Hausgeld pro Monat" },
    positions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "unitAmount",
          "totalAmount",
          "wegKey",
          "basisTotal",
          "basisShare",
          "basisUnit",
          "remark",
          "declaredAllocable",
          "isReserve",
          "page",
          "sourceText",
          "confidence",
        ],
        properties: {
          label: { type: "string", description: "Bezeichnung exakt wie im Dokument" },
          unitAmount: { type: "number", description: "Anteil der Wohnung in Euro" },
          totalAmount: { ...nullableNumber, description: "Gesamtbetrag der WEG in Euro" },
          wegKey: { type: "string", description: "Verteilerschlüssel laut Dokument, z. B. MEA, Wohnfläche, Einheiten, HKA; leer wenn nicht erkennbar" },
          basisTotal: { ...nullableNumber, description: "Schlüssel gesamt, z. B. 1000 (MEA), 11 (WE), 478.182 (cbm)" },
          basisShare: { ...nullableNumber, description: "Schlüssel Anteil der Wohnung, z. B. 49 (MEA), 1 (WE), 34.766 (cbm)" },
          basisUnit: { type: "string", description: "Einheit des Schlüssels, z. B. MEA, WE, cbm, m², kWh; leer wenn keiner" },
          remark: { type: "string", description: "Bemerkung zur Position im Dokument (z. B. Rechnungsdaten, Zahlungszeitpunkt), sonst leer" },
          declaredAllocable: { type: "string", enum: ["yes", "no", "unknown"], description: "Kennzeichnung der Verwaltung, ob umlagefähig" },
          isReserve: { type: "boolean", description: "Zuführung zur Erhaltungsrücklage" },
          page: { type: ["integer", "null"], description: "Seite im Dokument (1-basiert, über alle Dateien fortlaufend)" },
          sourceText: { type: "string", description: "Tabellenzeile wörtlich, gekürzt" },
          confidence: { type: "number", description: "Sicherheit der Erkennung von 0 bis 1" },
        },
      },
    },
    heating: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "heatSource",
            "buildingTotal",
            "unitShare",
            "baseSharePct",
            "areaTotal",
            "consumptionHeatingKwh",
            "consumptionWaterKwh",
            "components",
            "includedCosts",
            "co2Cost",
            "co2Kg",
            "page",
          ],
          properties: {
            heatSource: { type: "string", description: "z. B. Gas, Öl, Fernwärme, Wärmepumpe" },
            buildingTotal: nullableNumber,
            unitShare: { type: "number" },
            baseSharePct: { ...nullableNumber, description: "Grundkostenanteil in Prozent" },
            areaTotal: nullableNumber,
            consumptionHeatingKwh: nullableNumber,
            consumptionWaterKwh: nullableNumber,
            components: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "amount"],
                properties: { label: { type: "string" }, amount: { type: "number" } },
              },
            },
            includedCosts: {
              type: "array",
              description: "Kostenaufstellung der Liegenschaft: in den Gesamtheizkosten enthaltene Kosten, z. B. Brennstoff/Wärmestrom, Heizungswartung",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "amount"],
                properties: { label: { type: "string" }, amount: { type: "number" } },
              },
            },
            co2Cost: nullableNumber,
            co2Kg: { ...nullableNumber, description: "CO2-Ausstoß der Liegenschaft in kg" },
            page: { type: ["integer", "null"] },
          },
        },
      ],
    },
    notes: { type: "string", description: "Unklarheiten, unleserliche Stellen, Hinweise auf Deutsch" },
  },
} as const;

const WEG_SYSTEM = `Du liest Unterlagen einer Wohnungseigentümergemeinschaft (WEG) aus: Jahresabrechnung/Einzelabrechnung, Heiz- und Warmwasserkostenabrechnung oder Wirtschaftsplan.

Regeln:
- Erfasse jede Kostenposition der Einzelabrechnung bzw. des Einzelwirtschaftsplans der angegebenen Wohnung einzeln mit der Bezeichnung exakt wie im Dokument. Fasse nichts zusammen und bewerte nichts selbst.
- unitAmount ist immer der Anteil der Wohnung, totalAmount der Gesamtbetrag der Gemeinschaft (falls ausgewiesen).
- Deutsche Zahlen: „1.468,43“ = 1468.43.
- Die Zuführung zur Erhaltungsrücklage ist bei Jahresabrechnungen meist nicht Teil der Bewirtschaftungskosten: Erfasse sie in reserveContribution und NICHT als Position. Im Wirtschaftsplan ist sie eine Position (isReserve = true).
- Über-/Unterdeckung, Abrechnungsspitze, Hausgeldzahlungen und Salden sind keine Kostenpositionen – nicht als Position erfassen.
- Heizkosten: Ist eine Heizkostenabrechnung enthalten, erfasse in heating den Anteil der Wohnung, die Bestandteile (Grund-/Verbrauchskosten Heizung und Warmwasser), Verbräuche und ggf. CO2-Angaben. Die Gesamtsumme der Heizkosten der Wohnung erscheint zusätzlich als Position, wenn sie in der Einzelabrechnung als Zeile steht.
- Übernimm zu jeder Position den Verteilerschlüssel mit Basis (z. B. 49 von 1000 MEA, 1 von 11 WE, 34,766 von 478,182 cbm) und Bemerkungen (z. B. „Rg. v. 19.12.23 und 28.11.24“), falls angegeben. Aus Gesamtdarstellungen der Einnahmen/Ausgaben übernimm nur Bemerkungen zu den Positionen der Einzelabrechnung, keine zusätzlichen Positionen.
- Übersichten mit Daten anderer Eigentümer (Abrechnungsergebnis aller Wohnungen, Rücklagenanteile) nicht erfassen – nur die angegebene Wohnung.
- Seiten über mehrere Dateien fortlaufend zählen. Gedrehte oder fotografierte Seiten sorgfältig lesen.
- confidence < 0.8, wenn ein Wert schwer lesbar oder die Zuordnung zur Wohnung unsicher ist.
- Erfinde keine Werte. Fehlende Werte als null, Unklarheiten in notes.`;

export async function extractWegDocument(files: File[], apiKey: string, unitName: string, expectedKind: "annual" | "plan"): Promise<WegExtraction> {
  const json = await askClaude(
    files,
    apiKey,
    WEG_SYSTEM,
    WEG_JSON_SCHEMA,
    `Wohnung: ${unitName}. Erwarteter Dokumenttyp: ${expectedKind === "annual" ? "Jahresabrechnung (Ist)" : "Wirtschaftsplan"}. Bitte erfasse die Daten.`,
  );
  return WegSchema.parse(json);
}
