import { useCallback, useEffect, useState } from "react";
import type { AppData } from "./types";

const STORAGE_KEY = "betriebskosten-app-v1";

export function emptyData(): AppData {
  return {
    version: 1,
    properties: [],
    tenants: [],
    statements: [],
    settings: { landlord: { name: "", address: "", iban: "" }, anthropicApiKey: "" },
  };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return { ...emptyData(), ...JSON.parse(raw) };
  } catch {
    return emptyData();
  }
}

export function parseBackup(json: string): AppData {
  const data = JSON.parse(json);
  if (data?.version !== 1 || !Array.isArray(data.properties)) throw new Error("Keine gültige Sicherungsdatei.");
  return { ...emptyData(), ...data };
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

export const uid = () => crypto.randomUUID();
