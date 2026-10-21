import { useState } from "react";
import { uid } from "../lib/model";
import type { AppData, EconomicPlan, Property, WegAnnualStatement } from "../lib/types";
import { annualFromExtraction, planFromExtraction } from "../lib/wegImport";
import { Modal } from "./ui";

/** Legt eine WEG-Jahresabrechnung oder einen Wirtschaftsplan an – per KI-Auslese oder leer zur manuellen Erfassung */
export default function WegImport({
  data,
  property,
  onClose,
  onCreate,
}: {
  data: AppData;
  property: Property;
  onClose: () => void;
  onCreate: (doc: WegAnnualStatement | EconomicPlan) => void;
}) {
  const lastYear = new Date().getFullYear() - 1;
  const [kind, setKind] = useState<"annual" | "plan">("annual");
  const [unitId, setUnitId] = useState(property.units[0]?.id ?? "");
  const [year, setYear] = useState(lastYear);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const apiKey = data.settings.anthropicApiKey;
  const unitName = property.units.find((u) => u.id === unitId)?.name ?? "";
  const exists = (kind === "annual" ? data.wegAnnuals : data.economicPlans).some((d) => d.unitId === unitId && d.year === year);

  const createEmpty = () => {
    const base = { id: uid(), propertyId: property.id, unitId, year, positions: [], documents: [], createdAt: new Date().toISOString() };
    onCreate(
      kind === "annual"
        ? { ...base, kind, managementCostsActual: null, managementCostsPlan: null, reserveContribution: 0, heating: null }
        : { ...base, kind, annualHausgeld: null, monthlyHausgeld: null },
    );
  };

  const extract = async () => {
    setBusy(true);
    setError(null);
    try {
      const { extractWegDocument } = await import("../lib/extract");
      const x = await extractWegDocument(files, apiKey, unitName, kind);
      if (x.documentKind !== "other" && x.documentKind !== kind) {
        setError(
          `Das Dokument sieht aus wie ${x.documentKind === "annual" ? "eine Jahresabrechnung" : "ein Wirtschaftsplan"}. Bitte den Dokumenttyp prüfen – Plan- und Ist-Werte werden getrennt gespeichert.`,
        );
        return;
      }
      if (x.notes) setNotes(x.notes);
      const ctx = { propertyId: property.id, unitId, documents: files.map((f) => f.name), fallbackYear: year };
      onCreate(kind === "annual" ? annualFromExtraction(x, ctx) : planFromExtraction(x, ctx));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="WEG-Unterlagen erfassen" onClose={onClose}>
      <div className="stack">
        <div className="grid">
          <label className="field">
            Dokumenttyp
            <select value={kind} onChange={(e) => setKind(e.target.value as "annual" | "plan")}>
              <option value="annual">Jahresabrechnung / Einzelabrechnung (Ist)</option>
              <option value="plan">Wirtschaftsplan (Plan)</option>
            </select>
          </label>
          <label className="field">
            Wohnung
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              {property.units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Jahr
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </label>
        </div>
        {exists && <div className="alert warn small">Für diese Wohnung und dieses Jahr gibt es bereits ein solches Dokument.</div>}
        <p className="small muted">
          {kind === "annual"
            ? "Lade die Einzelabrechnung der Wohnung hoch, am besten zusammen mit der Heiz- und Warmwasserkostenabrechnung. Mehrere Dateien oder Fotos von Seiten sind möglich."
            : "Lade den Wirtschaftsplan mit den Beträgen je Wohnung hoch. Er dient nur der Prognose und dem Plan-Ist-Vergleich."}
        </p>
        {apiKey ? (
          <>
            <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <p className="small muted">
              Die Dateien werden zur Auswertung an die Anthropic-API gesendet. Danach prüfst du jede Position – nichts wird ungeprüft in eine Mieterabrechnung übernommen.
            </p>
          </>
        ) : (
          <div className="alert info small">
            Zum automatischen Auslesen brauchst du einen API-Schlüssel (<a href="#/einstellungen">Einstellungen</a>). Du kannst die Positionen auch von Hand erfassen.
          </div>
        )}
        {error && <div className="alert danger">{error}</div>}
        {notes && <div className="alert info small">Hinweis der Auslese: {notes}</div>}
        <div className="row">
          <button onClick={createEmpty} disabled={busy}>Von Hand erfassen</button>
          <span className="spacer" />
          <button onClick={onClose}>Abbrechen</button>
          {apiKey && (
            <button className="primary" disabled={busy || files.length === 0} onClick={extract}>
              {busy ? "Wird ausgelesen …" : "Auslesen"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
