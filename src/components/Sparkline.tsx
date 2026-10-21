import { useEffect, useRef, useState } from "react";
import { formatDate, toDay } from "../lib/dates";
import { formatEUR0 } from "../lib/format";
import type { ValuePoint } from "../lib/finance";

/**
 * Wertverlauf als Linie: Verlauf in der zurückhaltenden Farbe, aktueller Wert in der
 * Akzentfarbe. Beim Überfahren zeigt ein Tooltip Datum und Wert des nächsten Punkts.
 */
export default function Sparkline({ points, height = 48, label }: { points: ValuePoint[]; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Die Linie füllt die Breite des Containers; gemessen statt skaliert, damit Strich und Punkte nicht verzerren
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(80, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const xs = sorted.map((p) => toDay(p.date));
  const ys = sorted.map((p) => p.value);
  const pad = 5;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad + ((x - x0) / Math.max(1, x1 - x0)) * (width - 2 * pad);
  const sy = (y: number) => (yMax === yMin ? height / 2 : height - pad - ((y - yMin) / (yMax - yMin)) * (height - 2 * pad));
  const coords = sorted.map((p, i) => [sx(xs[i]), sy(p.value)] as const);
  const d = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const active = hover !== null ? sorted[hover] : null;

  return (
    <div className="sparkline" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`${label}: von ${formatEUR0(sorted[0].value)} (${formatDate(sorted[0].date)}) auf ${formatEUR0(sorted[sorted.length - 1].value)} (${formatDate(sorted[sorted.length - 1].date)})`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          let best = 0;
          coords.forEach(([cx], i) => Math.abs(cx - x) < Math.abs(coords[best][0] - x) && (best = i));
          setHover(best);
        }}
      >
        <path d={d} fill="none" stroke="var(--spark)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={coords[hover][0]} x2={coords[hover][0]} y1={0} y2={height} stroke="var(--border)" strokeWidth={1} />}
        <circle cx={last[0]} cy={last[1]} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        {hover !== null && hover !== coords.length - 1 && (
          <circle cx={coords[hover][0]} cy={coords[hover][1]} r={4} fill="var(--spark)" stroke="var(--surface)" strokeWidth={2} />
        )}
      </svg>
      {active && (
        <div className="spark-tip" style={{ left: `${(coords[hover!][0] / width) * 100}%` }}>
          <strong>{formatEUR0(active.value)}</strong>
          <span>{formatDate(active.date)}</span>
        </div>
      )}
    </div>
  );
}
