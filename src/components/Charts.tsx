import { formatEUR, formatPct } from "../lib/format";
import type { Finding } from "../lib/weg";

/** Auslastung eines Budgets (Ist ÷ Soll) als Balken mit 100-%-Marke */
export function BudgetMeter({ usage, label }: { usage: number; label: string }) {
  // Skala bis 100 % bzw. bis zur Überschreitung
  const max = Math.max(1, usage);
  return (
    <div className="meter" role="img" aria-label={`${label}: ${formatPct(usage)}`} title={`${label}: ${formatPct(usage)}`}>
      <div className={`meter-fill ${usage > 1 ? "over" : ""}`} style={{ width: `${(usage / max) * 100}%` }} />
      {usage > 1 && <div className="meter-mark" style={{ left: `${(1 / max) * 100}%` }} />}
    </div>
  );
}

export interface SplitPart {
  label: string;
  value: number;
  hint?: string;
}

/** Aufteilung eines Betrags in zwei bis drei Teile (gestapelter Balken mit Legende) */
export function SplitBar({ parts }: { parts: SplitPart[] }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  if (total <= 0) return null;
  return (
    <div className="split">
      <div className="split-bar">
        {parts.map((p, i) => (
          <div
            key={p.label}
            className={`split-seg s${i}`}
            style={{ flexGrow: Math.max(0, p.value) }}
            title={`${p.label}: ${formatEUR(p.value)} (${formatPct(p.value / total)})`}
          />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p, i) => (
          <div key={p.label}>
            <span className={`swatch s${i}`} aria-hidden="true" />
            <span>
              {formatPct(p.value / total)} {p.label}
              {p.hint && <span className="muted"> · {p.hint}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  /** Plan/Prognose: gestrichelt dargestellt */
  forecast?: boolean;
  hint?: string;
}

/** Horizontale Balken auf gemeinsamer Skala, Werte direkt beschriftet */
export function BarList({ items }: { items: BarItem[] }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (max <= 0) return null;
  return (
    <div className="barlist">
      {items.map((i) => (
        <div key={i.label} className="barlist-row" title={`${i.label}: ${formatEUR(i.value)}${i.hint ? ` (${i.hint})` : ""}`}>
          <div className="barlist-label">
            {i.label}
            {i.hint && <div className="muted small">{i.hint}</div>}
          </div>
          <div className="barlist-track">
            <div className={`barlist-bar ${i.forecast ? "forecast" : ""}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <div className="barlist-value">{formatEUR(i.value)}</div>
        </div>
      ))}
    </div>
  );
}

/** Prüfpunkte mit Symbol und Überschrift – Zustand nie nur über die Farbe */
export function Checkpoints({ items }: { items: Finding[] }) {
  if (!items.length) return <p className="muted small">Keine offenen Prüfpunkte.</p>;
  return (
    <ul className="checkpoints">
      {items.map((f, i) => (
        <li key={i} className={f.level}>
          <span className="cp-icon" aria-hidden="true">
            {f.level === "error" ? "✗" : f.level === "warning" ? "⚠" : "ⓘ"}
          </span>
          <div>
            {f.title && <strong>{f.title}</strong>}
            <div className="small">{f.text}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
