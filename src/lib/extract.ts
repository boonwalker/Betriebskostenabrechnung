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

export async function extractInvoice(file: File, apiKey: string, billingPeriod: string): Promise<Extraction> {
  if (!isSupportedFile(file)) throw new Error("Bitte eine PDF-Datei oder ein Bild (JPG, PNG, WebP, GIF) hochladen.");
  const data = await toBase64(file);
  const doc: BetaContentBlockParam =
    file.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: file.type as ImageType, data } };

  // Der Schlüssel liegt nur im Browser des Nutzers und geht direkt an die Anthropic-API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: JSON_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [doc, { type: "text", text: `Abrechnungszeitraum: ${billingPeriod}. Bitte erfasse diesen Beleg.` }],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.");
    if (err instanceof Anthropic.RateLimitError) throw new Error("Zu viele Anfragen – bitte kurz warten und erneut versuchen.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Keine Verbindung zur Anthropic-API.");
    if (err instanceof Anthropic.APIError) throw new Error(`Fehler der Anthropic-API (${err.status}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new Error("Der Beleg konnte nicht verarbeitet werden.");
  if (response.stop_reason === "max_tokens") throw new Error("Der Beleg ist zu umfangreich für eine automatische Erfassung.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return ExtractionSchema.parse(JSON.parse(text));
}
