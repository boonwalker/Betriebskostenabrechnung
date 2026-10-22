import { useCallback, useEffect, useRef, useState } from "react";
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

/** Zugangsdaten zur Belegerkennung bleiben auf dem Gerät: nicht in Sicherungen und nicht in der Datenbank */
const stripSecrets = (d: AppData): AppData => ({ ...d, settings: { ...d.settings, anthropicApiKey: "", inviteCode: undefined } });
const keepSecrets = (stored: AppData, local: AppData): AppData => ({
  ...stored,
  settings: { ...stored.settings, anthropicApiKey: local.settings.anthropicApiKey, inviteCode: local.settings.inviteCode },
});

/** Sicherung ohne API-Schlüssel und Einladungscode */
export function exportData(data: AppData): string {
  return JSON.stringify(stripSecrets(data), null, 2);
}

/* ---------- Dauerhafte Speicherung in der Datenbank des veröffentlichten Artifacts ---------- */

/** Ein Dokument mit dem gesamten Datenbestand (ohne API-Schlüssel); bleibt über neue Versionen der App erhalten */
const REMOTE_DOC = "appdata/state";

type RemoteSnapshot = { exists: boolean; data(): Record<string, unknown> | undefined; metadata?: { hasPendingWrites: boolean } };
type RemoteDoc = {
  get(): Promise<RemoteSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  onSnapshot(next: (snap: RemoteSnapshot) => void, error?: (e: unknown) => void): () => void;
};

export type SyncStatus = "local" | "loading" | "saved" | "saving" | "error";

/** Datenbank-Dokument, wenn die App als Artifact mit Datenbank läuft – sonst null (lokaler Betrieb) */
async function remoteDoc(): Promise<RemoteDoc | null> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<{ doc(path: string): RemoteDoc } | null> } }).claude;
  if (!claude?.use) return null;
  try {
    const db = await claude.use("db");
    return db ? db.doc(REMOTE_DOC) : null;
  } catch {
    return null;
  }
}

const withoutKey = (d: AppData) => JSON.stringify(stripSecrets(d));

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);
  const [sync, setSync] = useState<SyncStatus>("local");
  const remote = useRef<RemoteDoc | null>(null);
  const lastSaved = useRef<string | null>(null);

  // Lokal zwischenspeichern (auch ohne Datenbank)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus) – Daten bleiben nur in dieser Sitzung
    }
  }, [data]);

  // Beim Start: Stand aus der Datenbank laden; gibt es dort noch keinen, den lokalen Stand hochladen
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const doc = await remoteDoc();
      if (!doc || cancelled) return;
      setSync("loading");
      try {
        const snap = await doc.get();
        const json = snap.exists ? (snap.data()?.json as string | undefined) : undefined;
        if (cancelled) return;
        if (json) {
          lastSaved.current = json;
          // Zugangsdaten bleiben nur im Browser
          const stored = migrate(JSON.parse(json));
          setData((local) => keepSecrets(stored, local));
        }
        remote.current = doc;
        setSync("saved");
        // Änderungen von anderswo (anderes Gerät, Anpassung durch Claude) live übernehmen,
        // damit diese Ansicht sie nicht mit einem älteren Stand überschreibt
        unsubscribe = doc.onSnapshot(
          (s) => {
            const next = s.exists ? (s.data()?.json as string | undefined) : undefined;
            if (!next || s.metadata?.hasPendingWrites || next === lastSaved.current) return;
            lastSaved.current = next;
            const stored = migrate(JSON.parse(next));
            setData((local) => keepSecrets(stored, local));
          },
          () => undefined,
        );
      } catch {
        if (!cancelled) setSync("error");
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Änderungen gesammelt speichern (eine Schreiboperation pro Pause)
  useEffect(() => {
    const doc = remote.current;
    if (!doc) return;
    const json = withoutKey(data);
    if (json === lastSaved.current) return;
    setSync("saving");
    const timer = setTimeout(async () => {
      try {
        await doc.set({ json, savedAt: new Date().toISOString(), version: data.version });
        lastSaved.current = json;
        setSync("saved");
      } catch {
        setSync("error");
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [data, sync === "loading"]);

  const update = useCallback((fn: (d: AppData) => AppData) => setData((d) => fn(d)), []);
  return [data, update, setData, sync] as const;
}
