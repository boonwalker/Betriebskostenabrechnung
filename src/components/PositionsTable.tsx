import { COST_CATEGORIES } from "../lib/betrkv";
import { applyRules, CLASSIFICATION_LABELS } from "../lib/classify";
import { formatEUR, formatNum } from "../lib/format";
import { uid } from "../lib/model";
import type { Classification, LedgerPosition } from "../lib/types";
import { NumberInput } from "./ui";

export function newPosition(year: number, document = "manuelle Eingabe"): LedgerPosition {
  return applyRules(
    {
      id: uid(),
      label: "",
      amount: 0,
      category: null,
      classification: "review",
      reason: "",
      origin: "rule",
      reviewed: false,
      declaredAllocable: null,
      provenance: { document },
    },
    year,
  );
}

const CLASS_BADGE: Record<Classification, string> = { allocable: "ok", non_allocable: "neutral", review: "warn" };

/**
 * Tabelle der Kostenpositionen einer WEG-Jahresabrechnung oder eines Wirtschaftsplans.
 * Jede Bewertung zeigt Begründung und Herkunft; manuelle Änderungen werden als solche markiert.
 */
export default function PositionsTable({
  positions,
  year,
  showDeclared,
  highlight,
  onChange,
}: {
  positions: LedgerPosition[];
  year: number;
  showDeclared?: boolean;
  highlight?: Set<string>;
  onChange: (positions: LedgerPosition[]) => void;
}) {
  const set = (id: string, patch: Partial<LedgerPosition>) => onChange(positions.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <div className="table-wrap">
      <table className="compact positions">
        <thead>
          <tr>
            <th style={{ minWidth: 220 }}>Position (wie im Dokument)</th>
            <th className="num" style={{ minWidth: 110 }}>Anteil Wohnung</th>
            {showDeclared && <th>laut Verwaltung</th>}
            <th style={{ minWidth: 170 }}>Bewertung für Mieter</th>
            <th style={{ minWidth: 170 }}>Kostenart</th>
            <th>geprüft</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const uncertain = p.confidence !== undefined && p.confidence < 0.8;
            return (
              <tr key={p.id} id={`pos-${p.id}`} className={highlight?.has(p.id) ? "row-flag" : undefined}>
                <td>
                  <input
                    value={p.label}
                    onChange={(e) => {
                      const next = { ...p, label: e.target.value };
                      // Neue Bezeichnung → Regelvorschlag aktualisieren, solange nicht manuell bewertet
                      set(p.id, p.origin === "user" ? { label: e.target.value } : applyRules(next, year));
                    }}
                    aria-label="Bezeichnung"
                  />
                  <div className="small muted" style={{ marginTop: 3 }}>
                    {p.heating === "component" && <span className="badge neutral">in Heizkosten enthalten</span>}{" "}
                    {p.reason}
                    {p.origin === "user" && " (manuell bewertet)"}
                  </div>
                  <div className="small muted">
                    Quelle: {p.provenance?.document ?? "–"}
                    {p.provenance?.page ? `, S. ${p.provenance.page}` : ""}
                    {p.provenance?.row ? ` · „${p.provenance.row}“` : ""}
                    {uncertain && <span className="badge warn" style={{ marginLeft: 6 }}>unsicher erkannt</span>}
                  </div>
                  {p.note && <div className="small" style={{ color: "var(--warn)" }}>Bemerkung im Dokument: {p.note}</div>}
                </td>
                <td>
                  <NumberInput
                    value={p.amount}
                    onChange={(amount) =>
                      set(p.id, {
                        amount,
                        // Originalwert aus dem Dokument festhalten
                        ...(p.extractedAmount === undefined && p.provenance?.document !== "manuelle Eingabe" ? { extractedAmount: p.amount } : {}),
                      })
                    }
                    ariaLabel="Betrag"
                  />
                  {(p.totalAmount !== null && p.totalAmount !== undefined) || p.wegBasis ? (
                    <div className="small muted" style={{ textAlign: "right" }}>
                      {p.totalAmount !== null && p.totalAmount !== undefined && <>von {formatEUR(p.totalAmount)}</>}
                      {p.wegBasis ? <> · {formatNum(p.wegBasis.share)}/{formatNum(p.wegBasis.total)} {p.wegBasis.unit}</> : p.wegKey ? <> · {p.wegKey}</> : null}
                    </div>
                  ) : null}
                  {p.extractedAmount !== undefined && p.extractedAmount !== p.amount && (
                    <div className="small muted">korrigiert, ausgelesen: {formatEUR(p.extractedAmount)}</div>
                  )}
                </td>
                {showDeclared && (
                  <td style={{ minWidth: 140 }}>
                    <select
                      value={p.declaredAllocable === null ? "" : p.declaredAllocable ? "yes" : "no"}
                      onChange={(e) => set(p.id, { declaredAllocable: e.target.value === "" ? null : e.target.value === "yes" })}
                      aria-label="Kennzeichnung der Verwaltung"
                    >
                      <option value="">–</option>
                      <option value="yes">umlagefähig</option>
                      <option value="no">nicht umlagefähig</option>
                    </select>
                  </td>
                )}
                <td>
                  <select
                    value={p.classification}
                    onChange={(e) =>
                      set(p.id, {
                        classification: e.target.value as Classification,
                        origin: "user",
                        reviewed: e.target.value !== "review",
                        reason: p.origin === "user" ? p.reason : `${p.reason} – Vorschlag war: ${CLASSIFICATION_LABELS[p.classification]}`,
                      })
                    }
                    aria-label="Bewertung"
                  >
                    {Object.entries(CLASSIFICATION_LABELS).map(([k, l]) => (
                      <option key={k} value={k}>{l}</option>
                    ))}
                  </select>
                  <div style={{ marginTop: 3 }}>
                    <span className={`badge ${CLASS_BADGE[p.classification]}`}>
                      {p.classification === "review" ? "⚠ " : ""}
                      {CLASSIFICATION_LABELS[p.classification]}
                    </span>
                  </div>
                </td>
                <td>
                  <select
                    value={p.category ?? ""}
                    onChange={(e) => set(p.id, { category: e.target.value ? Number(e.target.value) : null, origin: "user" })}
                    aria-label="Kostenart"
                  >
                    <option value="">– keine –</option>
                    {COST_CATEGORIES.map((c) => (
                      <option key={c.no} value={c.no}>{c.no}. {c.label}</option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={p.reviewed}
                    disabled={p.classification === "review"}
                    title={p.classification === "review" ? "Erst bewerten, dann bestätigen" : "Bewertung geprüft und bestätigt"}
                    onChange={(e) => set(p.id, { reviewed: e.target.checked })}
                    aria-label="geprüft"
                  />
                </td>
                <td>
                  <button className="ghost" onClick={() => onChange(positions.filter((x) => x.id !== p.id))} aria-label="Position entfernen">✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
