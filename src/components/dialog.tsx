/**
 * Eigene Rückfragen und Hinweise statt window.confirm/alert: In der Claude-Vorschau läuft die App in einem
 * abgeschirmten Rahmen, der Browser-Dialoge unterdrückt – confirm() liefert dort sofort „Abbrechen“.
 */
import { useEffect, useState } from "react";

interface Request {
  message: string;
  confirmLabel?: string;
  /** false = nur Hinweis mit „OK“ */
  ask: boolean;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let show: ((r: Request) => void) | null = null;

/** Rückfrage mit „Abbrechen“ und Bestätigen; ohne eingebundenen DialogHost wie window.confirm */
export function askConfirm(message: string, options: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(message));
  const open = show;
  return new Promise((resolve) => open({ message, confirmLabel: options.confirmLabel, ask: true, danger: options.danger ?? false, resolve }));
}

/** Hinweis mit „OK“ */
export function showMessage(message: string): Promise<void> {
  if (!show) {
    window.alert(message);
    return Promise.resolve();
  }
  const open = show;
  return new Promise((resolve) => open({ message, ask: false, danger: false, resolve: () => resolve() }));
}

/** Einmal in der App einbinden */
export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    show = (r) => setQueue((q) => [...q, r]);
    return () => {
      show = null;
    };
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!current) return null;

  function close(ok: boolean) {
    current.resolve(current.ask ? ok : true);
    setQueue((q) => q.slice(1));
  }

  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal dialog" role={current.ask ? "alertdialog" : "dialog"} aria-modal="true">
        <p className="dialog-message">{current.message}</p>
        <div className="row dialog-actions">
          <span className="spacer" />
          {current.ask && <button onClick={() => close(false)}>Abbrechen</button>}
          <button className={current.danger ? "danger-solid" : "primary"} onClick={() => close(true)} autoFocus>
            {current.ask ? (current.confirmLabel ?? "OK") : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
