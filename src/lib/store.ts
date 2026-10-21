import { useCallback, useEffect, useState } from "react";
import { emptyData, migrate } from "./model";
import type { AppData } from "./types";

export { emptyData, uid } from "./model";

const STORAGE_KEY = "betriebskosten-app-v1";

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
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
