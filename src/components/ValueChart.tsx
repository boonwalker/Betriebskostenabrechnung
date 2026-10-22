import { useEffect, useId, useRef, useState } from "react";
import { formatDate, toDay } from "../lib/dates";
import { formatEUR0, formatSignedEUR0 } from "../lib/format";
import type { ValuePoint } from "../lib/finance";

const FULL = { top: 14, right: 14, bottom: 30, left: 76 };
const COMPACT = { top: 10, right: 10, bottom: 6, left: 6 };
const MONTH_STEPS = [1, 2, 3, 6, 12, 24];
/** Fangbereich um die Kugel (px), in dem ein Finger sofort „einrastet“ */
const GRAB_RADIUS = 44;
/** Halten ohne Bewegung rastet ebenfalls ein (ms) */
const LONG_PRESS = 260;
/** Ab dieser Bewegung gilt eine Berührung als Scrollen bzw. Wischen (px) */
const MOVE_TOLERANCE = 8;

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
 * Wertverlauf mit verschiebbarer Kugel. Volle Variante: Koordinatensystem mit Datum (x) und Wert (y).
 * Kompakte Variante (Kacheln): nur Kurve und Fläche.
 *
 * Bedienung per Finger: Wer die Kugel berührt oder kurz auf der Kurve hält, „rastet ein“ – dann ist das
 * Scrollen gesperrt und die Kugel folgt dem Finger stufenlos. Ohne Einrasten scrollt die Seite wie gewohnt;
 * ein kurzes Antippen setzt die Kugel an die Stelle. Maus: Kugel folgt dem Zeiger. Tastatur: Pfeiltasten.
 */
export default function ValueChart({
  points,
  height,
  label,
  compact = false,
}: {
  points: ValuePoint[];
  height?: number;
  label: string;
  compact?: boolean;
}) {
  const M = compact ? COMPACT : FULL;
  const h = height ?? (compact ? 64 : 240);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(compact ? 260 : 640);
  /** Position der Kugel in Diagramm-Koordinaten (stufenlos); null = aktueller Wert am Ende */
  const [posX, setPosX] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  const gradientId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(compact ? 120 : 240, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const xs = sorted.map((p) => toDay(p.date));
  const ys = sorted.map((p) => p.value);
  const plotW = width - M.left - M.right;
  const plotH = h - M.top - M.bottom;
  const yTicks = compact ? [] : niceTicks(Math.min(...ys), Math.max(...ys));
  const [yLo, yHi] = compact
    ? (() => {
        const lo = Math.min(...ys);
        const hi = Math.max(...ys);
        return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
      })()
    : [yTicks[0], yTicks[yTicks.length - 1]];
  const [x0, x1] = [xs[0], xs[xs.length - 1]];
  const sx = (x: number) => M.left + ((x - x0) / Math.max(1, x1 - x0)) * plotW;
  const sy = (y: number) => M.top + plotH - ((y - yLo) / Math.max(1e-9, yHi - yLo)) * plotH;
  const coords = sorted.map((p, i) => [sx(xs[i]), sy(p.value)] as const);

  // Aktuelle Werte für die nativen Touch-Handler (die nur einmal registriert werden)
  const geo = useRef({ coords, width, M });
  geo.current = { coords, width, M };
  const posRef = useRef<number | null>(posX);
  posRef.current = posX;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let start: { x: number; y: number } | null = null;
    let isLocked = false;
    let moved = false;
    let timer: number | undefined;
    const toChartX = (clientX: number) => {
      const rect = svg.getBoundingClientRect();
      const { width: w, M: m } = geo.current;
      const x = ((clientX - rect.left) / rect.width) * w;
      return Math.min(w - m.right, Math.max(m.left, x));
    };
    const lock = (clientX: number) => {
      isLocked = true;
      setLocked(true);
      setPosX(toChartX(clientX));
      navigator.vibrate?.(8);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      moved = false;
      isLocked = false;
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / geo.current.width;
      const cs = geo.current.coords;
      const markerX = posRef.current ?? cs[cs.length - 1][0];
      const markerPx = rect.left + markerX * scale;
      if (Math.abs(t.clientX - markerPx) <= GRAB_RADIUS) {
        // direkt auf der Kugel: sofort einrasten, Scrollen gar nicht erst beginnen
        e.preventDefault();
        lock(t.clientX);
        return;
      }
      timer = window.setTimeout(() => !moved && start && lock(start.x), LONG_PRESS);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (isLocked) {
        e.preventDefault();
        setPosX(toChartX(t.clientX));
        return;
      }
      if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOLERANCE) {
        moved = true;
        window.clearTimeout(timer);
      }
    };
    const onEnd = (e: TouchEvent) => {
      window.clearTimeout(timer);
      if (!isLocked && !moved && start) {
        // kurzes Antippen: Kugel an diese Stelle setzen
        setPosX(toChartX(start.x));
        e.preventDefault();
      }
      isLocked = false;
      setLocked(false);
      start = null;
    };
    svg.addEventListener("touchstart", onStart, { passive: false });
    svg.addEventListener("touchmove", onMove, { passive: false });
    svg.addEventListener("touchend", onEnd, { passive: false });
    svg.addEventListener("touchcancel", onEnd);
    return () => {
      svg.removeEventListener("touchstart", onStart);
      svg.removeEventListener("touchmove", onMove);
      svg.removeEventListener("touchend", onEnd);
      svg.removeEventListener("touchcancel", onEnd);
      window.clearTimeout(timer);
    };
  }, [points.length >= 2]);

  if (points.length < 2) return null;

  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${M.top + plotH} L${coords[0][0].toFixed(1)},${M.top + plotH} Z`;

  // Kugel stufenlos auf der Linie: y zwischen den Nachbarpunkten interpolieren
  const mx = posX ?? coords[coords.length - 1][0];
  let seg = coords.findIndex(([cx]) => cx >= mx);
  if (seg <= 0) seg = seg === 0 ? 0 : coords.length - 1;
  const [ax, ay] = coords[Math.max(0, seg - 1)];
  const [bx, by] = coords[seg];
  const my = bx === ax ? by : ay + ((mx - ax) / (bx - ax)) * (by - ay);
  // Anzeige: nächstgelegener Monatswert
  let idx = 0;
  coords.forEach(([cx], i) => Math.abs(cx - mx) < Math.abs(coords[idx][0] - mx) && (idx = i));
  const point = sorted[idx];
  const delta = point.value - sorted[0].value;
  const atEnd = posX === null || idx === sorted.length - 1;

  // Monatsachse (volle Variante): Abstand so wählen, dass die Beschriftungen nicht kollidieren
  const xTicks: { x: number; text: string }[] = [];
  if (!compact) {
    const first = new Date(sorted[0].date);
    const last = new Date(sorted[sorted.length - 1].date);
    const months = (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth();
    const step = MONTH_STEPS.find((s) => months / s <= Math.max(2, Math.floor(plotW / 64))) ?? 36;
    for (let m = 0; m <= months + 1; m += step) {
      const d = new Date(first.getFullYear(), first.getMonth() + m + 1, 1);
      const day = toDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
      if (day >= x0 && day <= x1) xTicks.push({ x: sx(day), text: monthLabel.format(d) });
    }
  }

  const readout = (
    <div className="value-chart-readout" aria-live="polite">
      <strong>{formatEUR0(point.value)}</strong>
      <span>
        {formatDate(point.date)}
        {idx > 0 ? ` · ${formatSignedEUR0(delta)} seit ${formatDate(sorted[0].date)}` : " · Beginn"}
      </span>
    </div>
  );

  return (
    <div
      className={`value-chart ${compact ? "compact" : ""} ${locked ? "locked" : ""}`}
      ref={wrapRef}
      // In Kacheln (Links) soll das Bedienen der Kurve nicht zur Detailseite springen
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {!compact && readout}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${h}`}
        width="100%"
        height={h}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={sorted.length - 1}
        aria-valuenow={idx}
        aria-valuetext={`${formatDate(point.date)}: ${formatEUR0(point.value)}`}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const rect = e.currentTarget.getBoundingClientRect();
          setPosX(Math.min(width - M.right, Math.max(M.left, ((e.clientX - rect.left) / rect.width) * width)));
        }}
        onPointerLeave={(e) => e.pointerType === "mouse" && setPosX(null)}
        onKeyDown={(e) => {
          const step = (d: number) => setPosX(coords[Math.min(coords.length - 1, Math.max(0, idx + d))][0]);
          if (e.key === "ArrowLeft") step(-1);
          else if (e.key === "ArrowRight") step(1);
          else if (e.key === "Home") setPosX(coords[0][0]);
          else if (e.key === "End") setPosX(null);
          else return;
          e.preventDefault();
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={compact ? 0.22 : 0.28} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle" className="value-chart-axis">
              {formatEUR0(t)}
            </text>
          </g>
        ))}
        {!compact && <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="var(--muted)" strokeWidth={1} />}
        {xTicks.map((t) => (
          <g key={t.text}>
            <line x1={t.x} x2={t.x} y1={M.top + plotH} y2={M.top + plotH + 4} stroke="var(--muted)" strokeWidth={1} />
            <text x={t.x} y={M.top + plotH + 18} textAnchor="middle" className="value-chart-axis">
              {t.text}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={compact ? 2 : 2.25} strokeLinejoin="round" strokeLinecap="round" />
        {(!compact || !atEnd || locked) && (
          <line x1={mx} x2={mx} y1={M.top} y2={M.top + plotH} stroke="var(--head)" strokeOpacity={0.35} strokeDasharray="3 3" />
        )}
        <circle className="value-chart-halo" cx={mx} cy={my} r={locked ? 20 : 14} fill="var(--accent)" fillOpacity={locked ? 0.2 : 0.12} />
        <circle cx={mx} cy={my} r={locked ? 8.5 : compact ? 5.5 : 6.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2.5} />
      </svg>
      {compact ? (
        <div className="value-chart-readout compact">
          {atEnd && !locked ? (
            <span>Verlauf seit {formatDate(sorted[0].date)} – zum Ansehen ziehen</span>
          ) : (
            <>
              <strong>{formatEUR0(point.value)}</strong>
              <span>{formatDate(point.date)}</span>
            </>
          )}
        </div>
      ) : (
        <div className="value-chart-hint small muted">Kugel antippen und ziehen – oder kurz auf der Kurve halten.</div>
      )}
    </div>
  );
}
