/** Zeitpunkt der letzten heruntergeladenen Sicherung (nur auf diesem Gerät) */
const KEY = "immofriend-last-backup";

export function lastBackup(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function markBackup() {
  try {
    localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // ohne Speicher keine Erinnerung
  }
}

/** Erinnern, wenn noch nie oder vor mehr als 30 Tagen gesichert wurde */
export function backupDue(now = Date.now()): boolean {
  const last = lastBackup();
  return !last || now - Date.parse(last) > 30 * 86_400_000;
}
