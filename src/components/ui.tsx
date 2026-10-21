import { useEffect, useState, type ReactNode } from "react";
import { formatNum, formatSignedEUR0, formatSignedPct, parseNumber } from "../lib/format";
import type { AppData } from "../lib/types";

export interface PageProps {
  data: AppData;
  update: (fn: (d: AppData) => AppData) => void;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row" style={{ marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="ghost" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Zahleneingabe mit deutscher Schreibweise (Komma als Dezimaltrennzeichen) */
export function NumberInput({
  value,
  onChange,
  placeholder,
  style,
  ariaLabel,
  allowEmpty,
}: {
  value: number | undefined;
  /** bei allowEmpty: NaN für ein leeres Feld (statt 0) */
  onChange: (n: number) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  allowEmpty?: boolean;
}) {
  const fmt = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? "" : formatNum(n));
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
  }, [value, focused]);
  return (
    <input
      className="num"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      style={style}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(allowEmpty && !e.target.value.trim() ? NaN : parseNumber(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        setText(allowEmpty && !text.trim() ? "" : fmt(parseNumber(text)));
      }}
    />
  );
}

export function Balance({ value }: { value: number }) {
  const fmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  if (value > 0) return <span className="balance-pos">Nachzahlung {fmt.format(value)}</span>;
  if (value < 0) return <span className="balance-neg">Guthaben {fmt.format(-value)}</span>;
  return <span className="muted">ausgeglichen</span>;
}

/** Gewinn/Verlust mit Pfeil und Vorzeichen – die Richtung ist nie nur an der Farbe erkennbar */
export function Delta({ value, pct, suffix }: { value: number; pct: number | null; suffix?: string }) {
  const dir = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  return (
    <div className={`delta ${dir}`}>
      <span aria-hidden="true">{arrow}</span> {formatSignedEUR0(value)} ({formatSignedPct(pct)})
      {suffix && <span className="muted"> {suffix}</span>}
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="muted small">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}
