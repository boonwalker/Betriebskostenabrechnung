import { useCallback, useEffect, useState } from "react";
import { showcaseData } from "./demo";
import { emptyData, migrate } from "./model";
import type { AppData } from "./types";

export { emptyData, uid } from "./model";

// Die Vorführversion speichert getrennt; die Versionsnummer setzt dort gespeicherte Altstände zurück
const STORAGE_KEY = import.meta.env.VITE_SHOWCASE ? "betriebskosten-showcase-v5" : "betriebskosten-app-v1";

/** Ohne gespeicherte Daten: leer – im Vorführ-Build (VITE_SHOWCASE) mit dem Testfall WE 09 */
const initialData = () => (import.meta.env.VITE_SHOWCASE ? showcaseData() : emptyData());

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : initialData();
  } catch {
    return initialData();
  }
}

export function parseBackup(json: string): AppData {
  try {
    return migrate(JSON.parse(json));
  } catch {
    throw new Error("Keine gültige Sicherungsdatei.");
  }
}

/** Sicherung ohne API-Schlüssel */
export function exportData(data: AppData): string {
  return JSON.stringify({ ...data, settings: { ...data.settings, anthropicApiKey: "" } }, null, 2);
}

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus) – Daten bleiben nur in dieser Sitzung
    }
  }, [data]);
  const update = useCallback((fn: (d: AppData) => AppData) => setData((d) => fn(d)), []);
  return [data, update, setData] as const;
}
