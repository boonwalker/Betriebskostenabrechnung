import { useEffect, useId, useRef, useState } from "react";
import { formatDate, toDay } from "../lib/dates";
import { formatEUR0, formatSignedEUR0 } from "../lib/format";
import type { ValuePoint } from "../lib/finance";

const M = { top: 14, right: 14, bottom: 30, left: 76 };
const MONTH_STEPS = [1, 2, 3, 6, 12, 24];

/** „Schöne“ Achsenteilung: Schrittweite 1, 2, 2,5 oder 5 × 10^n für etwa vier Linien */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

const monthLabel = new Intl.DateTimeFormat("de-DE", { month: "short", year: "2-digit" });

/**
 * Wertverlauf im Koordinatensystem: Datum auf der x-Achse, Wert auf der y-Achse, Fläche unter der Linie.
 * Ziehen (Finger oder Maus) bzw. Pfeiltasten verschieben die Markierung; oben steht der Wert zum gewählten Zeitpunkt.
 */
export default function ValueChart({ points, height = 240, label }: { points: ValuePoint[]; height?: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const gradientId = useId().replace(/:/g, "");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const xs = sorted.map((p) => toDay(p.date));
  const ys = sorted.map((p) => p.value);
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys));
  const [yLo, yHi] = [yTicks[0], yTicks[yTicks.length - 1]];
  const [x0, x1] = [xs[0], xs[xs.length - 1]];
  const plotW = width - M.left - M.right;
  const plotH = height - M.top - M.bottom;
  const sx = (x: number) => M.left + ((x - x0) / Math.max(1, x1 - x0)) * plotW;
  const sy = (y: number) => M.top + plotH - ((y - yLo) / Math.max(1e-9, yHi - yLo)) * plotH;
  const coords = sorted.map((p, i) => [sx(xs[i]), sy(p.value)] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${M.top + plotH} L${coords[0][0].toFixed(1)},${M.top + plotH} Z`;

  // Monatsachse: Abstand so wählen, dass die Beschriftungen nicht kollidieren (ca. 64 px je Label)
  const first = new Date(sorted[0].date);
  const last = new Date(sorted[sorted.length - 1].date);
  const months = (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth();
  const step = MONTH_STEPS.find((s) => months / s <= Math.max(2, Math.floor(plotW / 64))) ?? 36;
  const xTicks: { x: number; text: string }[] = [];
  for (let m = 0; m <= months + 1; m += step) {
    const d = new Date(first.getFullYear(), first.getMonth() + m + 1, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const day = toDay(iso);
    if (day < x0 || day > x1) continue;
    xTicks.push({ x: sx(day), text: monthLabel.format(d) });
  }

  const idx = active ?? sorted.length - 1;
  const point = sorted[idx];
  const delta = point.value - sorted[0].value;
  const pick = (clientX: number, rect: DOMRect) => {
    const x = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    coords.forEach(([cx], i) => Math.abs(cx - x) < Math.abs(coords[best][0] - x) && (best = i));
    setActive(best);
  };

  return (
    <div className="value-chart" ref={ref}>
      <div className="value-chart-readout" aria-live="polite">
        <strong>{formatEUR0(point.value)}</strong>
        <span>
          {formatDate(point.date)}
          {idx > 0 && ` · ${formatSignedEUR0(delta)} seit ${formatDate(sorted[0].date)}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={sorted.length - 1}
        aria-valuenow={idx}
        aria-valuetext={`${formatDate(point.date)}: ${formatEUR0(point.value)}`}
        style={{ touchAction: "pan-y" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          pick(e.clientX, e.currentTarget.getBoundingClientRect());
        }}
        onPointerMove={(e) => {
          if (dragging || e.pointerType === "mouse") pick(e.clientX, e.currentTarget.getBoundingClientRect());
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !dragging) setActive(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive(Math.max(0, idx - 1));
          else if (e.key === "ArrowRight") setActive(Math.min(sorted.length - 1, idx + 1));
          else if (e.key === "Home") setActive(0);
          else if (e.key === "End") setActive(sorted.length - 1);
          else return;
          e.preventDefault();
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Gitter und y-Achse */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle" className="value-chart-axis">
              {formatEUR0(t)}
            </text>
          </g>
        ))}
        {/* x-Achse */}
        <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--muted)" strokeWidth={1} />
        {xTicks.map((t) => (
          <g key={t.text}>
            <line x1={t.x} x2={t.x} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--muted)" strokeWidth={1} />
            <text x={t.x} y={M.top + plotH + 18} textAnchor="middle" className="value-chart-axis">
              {t.text}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        {/* Markierung zum gewählten Zeitpunkt */}
        <line x1={coords[idx][0]} x2={coords[idx][0]} y1={M.top} y2={M.top + plotH} stroke="var(--head)" strokeOpacity={0.35} strokeDasharray="3 3" />
        <circle cx={coords[idx][0]} cy={coords[idx][1]} r={14} fill="var(--accent)" fillOpacity={0.12} />
        <circle cx={coords[idx][0]} cy={coords[idx][1]} r={6.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />
      </svg>
      <div className="value-chart-hint small muted">Zum Ansehen einzelner Monate auf der Kurve ziehen.</div>
    </div>
  );
}
