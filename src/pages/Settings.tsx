import { useRef, useState } from "react";
import { NumberInput, type PageProps } from "../components/ui";
import { demoData } from "../lib/demo";
import { we09Annual2024, we09Plan2025, we09PreviousTenant, we09Property, we09Tenant } from "../lib/fixtures/we09";
import { emptyData, exportData, parseBackup } from "../lib/store";
import type { AppData, Landlord } from "../lib/types";

export default function SettingsPage({ data, update, replace }: PageProps & { replace: (d: AppData) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const landlord = data.settings.landlord;
  const setLandlord = (patch: Partial<Landlord>) =>
    update((d) => ({ ...d, settings: { ...d.settings, landlord: { ...d.settings.landlord, ...patch } } }));

  const download = () => {
    const blob = new Blob([exportData(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `betriebskosten-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restore = async (file: File) => {
    try {
      const restored = parseBackup(await file.text());
      if (!confirm("Alle aktuellen Daten durch die Sicherung ersetzen?")) return;
      replace({ ...restored, settings: { ...restored.settings, anthropicApiKey: data.settings.anthropicApiKey } });
      setMessage("Sicherung wiederhergestellt.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Die Datei konnte nicht gelesen werden.");
    }
  };

  const hasData = data.properties.length > 0 || data.tenants.length > 0;

  return (
    <>
      <h1>Einstellungen</h1>
      {message && <div className="alert info">{message}</div>}

      <div className="card stack">
        <h2>Vermieter</h2>
        <p className="muted small">Erscheint als Absender und Bankverbindung auf den Abrechnungen.</p>
        <div className="grid">
          <label className="field">
            Name
            <input value={landlord.name} onChange={(e) => setLandlord({ name: e.target.value })} />
          </label>
          <label className="field">
            IBAN
            <input value={landlord.iban} onChange={(e) => setLandlord({ iban: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Anschrift
          <textarea rows={2} value={landlord.address} onChange={(e) => setLandlord({ address: e.target.value })} />
        </label>
      </div>

      <div className="card stack">
        <h2>Steuern</h2>
        <label className="field" style={{ maxWidth: 320 }}>
          Persönlicher Grenzsteuersatz (%)
          <NumberInput
            value={data.settings.marginalTaxRate}
            onChange={(v) => update((d) => ({ ...d, settings: { ...d.settings, marginalTaxRate: Math.min(50, Math.max(0, v)) } }))}
          />
        </label>
        <p className="muted small">
          Für die Rendite nach Steuern: Steuersatz auf den letzten verdienten Euro, inklusive Solidaritätszuschlag und Kirchensteuer (meist 30–47 %). Steht
          sinngemäß in deinem letzten Steuerbescheid oder lässt sich mit dem Rechner des BMF ermitteln.
        </p>
      </div>

      <div className="card stack">
        <h2>Belege automatisch auslesen</h2>
        <p className="small">
          Hochgeladene Rechnungen und Bescheide werden mit der KI Claude von Anthropic ausgelesen. Dafür brauchst du einen API-Schlüssel von{" "}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>. Die Kosten liegen typischerweise bei wenigen Cent pro Beleg.
        </p>
        <label className="field">
          Anthropic API-Schlüssel
          <div className="row">
            <input
              type={showKey ? "text" : "password"}
              value={data.settings.anthropicApiKey}
              onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, anthropicApiKey: e.target.value.trim() } }))}
              placeholder="sk-ant-…"
              style={{ flex: 1 }}
              autoComplete="off"
            />
            <button onClick={() => setShowKey(!showKey)}>{showKey ? "Verbergen" : "Anzeigen"}</button>
          </div>
        </label>
        <p className="muted small">
          Der Schlüssel wird nur in diesem Browser gespeichert und direkt an die Anthropic-API gesendet. Nutze die App nur auf deinem eigenen Gerät und
          lege in der Anthropic-Konsole am besten ein Ausgabenlimit fest.
        </p>
      </div>

      <div className="card stack">
        <h2>Daten</h2>
        <p className="small">
          Alle Daten werden ausschließlich lokal in diesem Browser gespeichert. Erstelle regelmäßig eine Sicherung – beim Löschen der Browserdaten gehen sie sonst verloren.
        </p>
        <div className="row">
          <button onClick={download}>Sicherung herunterladen</button>
          <button onClick={() => fileRef.current?.click()}>Sicherung wiederherstellen</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) restore(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="row">
          <button
            onClick={() => {
              if (hasData && !confirm("Aktuelle Daten durch Beispieldaten ersetzen?")) return;
              replace({ ...demoData(), settings: { ...demoData().settings, anthropicApiKey: data.settings.anthropicApiKey } });
              setMessage("Beispieldaten geladen – schau dir die Abrechnung unter „Abrechnungen“ an.");
            }}
          >
            Beispieldaten laden
          </button>
          <button
            onClick={() => {
              if (data.properties.some((p) => p.id === "we09-p")) {
                setMessage("Der Testfall WE 09 ist bereits geladen.");
                return;
              }
              update((d) => ({
                ...d,
                properties: [...d.properties, we09Property()],
                tenants: [...d.tenants, we09PreviousTenant(), we09Tenant()],
                wegAnnuals: [...d.wegAnnuals, we09Annual2024()],
                economicPlans: [...d.economicPlans, we09Plan2025()],
              }));
              setMessage("Testfall WE 09 (Jahresabrechnung 2024, Wirtschaftsplan 2025) wurde ergänzt.");
            }}
          >
            Testfall WE 09 hinzufügen
          </button>
          <button
            className="danger"
            onClick={() => {
              if (!confirm("Wirklich alle Objekte, Mieter und Abrechnungen löschen?")) return;
              replace({ ...emptyData(), settings: data.settings });
              setMessage("Alle Daten gelöscht.");
            }}
          >
            Alle Daten löschen
          </button>
        </div>
      </div>
    </>
  );
}
