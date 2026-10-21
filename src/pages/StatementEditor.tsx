import { useMemo, useState } from "react";
import { Balance, NumberInput, type PageProps } from "../components/ui";
import ReceiptImport from "../components/ReceiptImport";
import { COST_CATEGORIES, KEY_LABELS } from "../lib/betrkv";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR, formatNum } from "../lib/format";
import { uid } from "../lib/store";
import type { AllocationKey, CostItem, Property, Statement } from "../lib/types";

export default function StatementEditor({ data, update, statementId }: PageProps & { statementId: string }) {
  const statement = data.statements.find((s) => s.id === statementId);
  const property = data.properties.find((p) => p.id === statement?.propertyId);
  const [importing, setImporting] = useState(false);
  const result = useMemo(
    () => (statement && property ? calculateStatement(statement, property, data.tenants) : null),
    [statement, property, data.tenants],
  );

  if (!statement || !property || !result) {
    return (
      <div className="card empty">
        <p>Abrechnung nicht gefunden.</p>
        <a className="btn" href="#/abrechnungen">Zur Übersicht</a>
      </div>
    );
  }

  const set = (patch: Partial<Statement>) =>
    update((d) => ({ ...d, statements: d.statements.map((s) => (s.id === statement.id ? { ...s, ...patch } : s)) }));
  const setCost = (id: string, patch: Partial<CostItem>) =>
    set({ costs: statement.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCost = () =>
    set({ costs: [...statement.costs, { id: uid(), category: 1, label: "Grundsteuer", amount: 0, key: "area" }] });
  const setOverride = (tenantId: string, value: number | null) => {
    const next = { ...statement.prepaymentOverrides };
    if (value === null) delete next[tenantId];
    else next[tenantId] = value;
    set({ prepaymentOverrides: next });
  };

  const today = todayISO();
  const daysLeft = Math.round((Date.parse(result.deadline) - Date.parse(today)) / 86_400_000);

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/abrechnungen" className="small">← Abrechnungen</a>
          <h1>Betriebskostenabrechnung {property.name}</h1>
        </div>
        <a className="btn primary" href={`#/abrechnungen/${statement.id}/druck`}>Abrechnungen drucken / PDF</a>
      </div>

      {daysLeft < 0 ? (
        <div className="alert danger">
          Die Abrechnungsfrist ist am {formatDate(result.deadline)} abgelaufen. Nachforderungen sind in der Regel ausgeschlossen (§ 556 Abs. 3 BGB), Guthaben müssen trotzdem ausgezahlt werden.
        </div>
      ) : daysLeft <= 90 ? (
        <div className="alert warn">
          Noch {daysLeft} Tage: Die Abrechnung muss den Mietern spätestens am {formatDate(result.deadline)} zugehen.
        </div>
      ) : null}
      {result.warnings.map((w) => (
        <div className="alert warn" key={w}>{w}</div>
      ))}

      <div className="card">
        <div className="grid">
          <label className="field">
            Abrechnungszeitraum von
            <input type="date" value={statement.periodStart} onChange={(e) => e.target.value && set({ periodStart: e.target.value })} />
          </label>
          <label className="field">
            bis
            <input type="date" value={statement.periodEnd} onChange={(e) => e.target.value && set({ periodEnd: e.target.value })} />
          </label>
          <div>
            <div className="muted small">Umlagefähige Gesamtkosten</div>
            <div className="stat">{formatEUR(result.totalCosts)}</div>
          </div>
          <div>
            <div className="muted small">davon Leerstand / Vermieter</div>
            <div className="stat">{formatEUR(result.landlordShare)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Kostenpositionen</h2>
          <span className="spacer" />
          <button onClick={() => setImporting(true)}>📄 Belege hochladen</button>
          <button className="primary" onClick={addCost}>+ Position</button>
        </div>
        {statement.costs.length === 0 ? (
          <div className="empty">
            <p>Noch keine Kosten erfasst. Lade deine Rechnungen und Bescheide hoch oder trage die Beträge selbst ein.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th style={{ minWidth: 190 }}>Kostenart (§ 2 BetrKV)</th>
                  <th style={{ minWidth: 170 }}>Bezeichnung</th>
                  <th style={{ minWidth: 120 }} className="num">Betrag (€)</th>
                  <th style={{ minWidth: 150 }}>Umlageschlüssel</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {statement.costs.map((c) => (
                  <CostRow key={c.id} cost={c} property={property} onChange={(patch) => setCost(c.id, patch)} onRemove={() => set({ costs: statement.costs.filter((x) => x.id !== c.id) })} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Summe</td>
                  <td className="num">{formatEUR(result.totalCosts)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Ergebnis je Mieter</h2>
        {result.tenants.length === 0 ? (
          <p className="muted">Im Abrechnungszeitraum wohnten keine Mieter in diesem Objekt.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mieter</th>
                  <th>Zeitraum</th>
                  <th className="num">Kostenanteil</th>
                  <th className="num">Vorauszahlungen</th>
                  <th className="num">Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                {result.tenants.map((r) => {
                  const overridden = statement.prepaymentOverrides[r.tenant.id] !== undefined;
                  return (
                    <tr key={r.tenant.id + r.start}>
                      <td>
                        {r.tenant.name}
                        <div className="muted small">{r.unit.name}</div>
                      </td>
                      <td>
                        {formatDate(r.start)} – {formatDate(r.end)}
                        <div className="muted small">{r.days} Tage</div>
                      </td>
                      <td className="num">{formatEUR(r.totalCosts)}</td>
                      <td className="num" style={{ minWidth: 150 }}>
                        <NumberInput
                          value={r.prepayments}
                          onChange={(v) => setOverride(r.tenant.id, v)}
                          style={{ width: 120 }}
                          ariaLabel={`Vorauszahlungen ${r.tenant.name}`}
                        />
                        <div className="muted small">
                          {overridden ? (
                            <button className="ghost small" onClick={() => setOverride(r.tenant.id, null)}>
                              Soll: {formatEUR(r.prepaymentsCalculated)} übernehmen
                            </button>
                          ) : (
                            "laut Mietvertrag"
                          )}
                        </div>
                      </td>
                      <td className="num"><Balance value={r.balance} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          Trage bei den Vorauszahlungen den tatsächlich gezahlten Betrag ein, falls er vom Mietvertrag abweicht (z. B. Zahlungsrückstände oder Anpassungen im Jahr).
        </p>
        {result.vacancies.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>Leerstand (trägt der Vermieter)</h3>
            <table className="compact">
              <tbody>
                {result.vacancies.map((v) => (
                  <tr key={v.unit.id + v.start}>
                    <td>{v.unit.name}</td>
                    <td>{formatDate(v.start)} – {formatDate(v.end)} ({v.days} Tage)</td>
                    <td className="num">{formatEUR(v.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {importing && (
        <ReceiptImport
          apiKey={data.settings.anthropicApiKey}
          statement={statement}
          property={property}
          onClose={() => setImporting(false)}
          onAdd={(items) => {
            set({ costs: [...statement.costs, ...items] });
          }}
        />
      )}
    </>
  );
}

function CostRow({ cost, property, onChange, onRemove }: { cost: CostItem; property: Property; onChange: (p: Partial<CostItem>) => void; onRemove: () => void }) {
  return (
    <>
      <tr>
        <td>
          <select
            value={cost.category}
            onChange={(e) => {
              const cat = COST_CATEGORIES.find((c) => c.no === Number(e.target.value))!;
              const labelWasDefault = COST_CATEGORIES.some((c) => c.label === cost.label) || !cost.label;
              onChange({ category: cat.no, key: cat.defaultKey, ...(labelWasDefault ? { label: cat.label } : {}) });
            }}
            aria-label="Kostenart"
          >
            {COST_CATEGORIES.map((c) => (
              <option key={c.no} value={c.no}>{c.no}. {c.label}</option>
            ))}
          </select>
        </td>
        <td>
          <input value={cost.label} onChange={(e) => onChange({ label: e.target.value })} aria-label="Bezeichnung" />
          {cost.source && <div className="muted small" title={cost.note}>aus Beleg: {cost.source}</div>}
        </td>
        <td>
          <NumberInput value={cost.amount} onChange={(amount) => onChange({ amount })} ariaLabel="Betrag" />
        </td>
        <td>
          <select value={cost.key} onChange={(e) => onChange({ key: e.target.value as AllocationKey })} aria-label="Umlageschlüssel">
            {Object.entries(KEY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </td>
        <td>
          <button className="ghost" onClick={onRemove} aria-label="Position entfernen">✕</button>
        </td>
      </tr>
      {cost.key === "direct" && (
        <tr>
          <td />
          <td colSpan={4}>
            <label className="row small muted">
              Betrifft Einheit:
              <select value={cost.directUnitId ?? ""} onChange={(e) => onChange({ directUnitId: e.target.value })}>
                <option value="">– bitte wählen –</option>
                {property.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          </td>
        </tr>
      )}
      {cost.key === "consumption" && (
        <tr>
          <td />
          <td colSpan={4}>
            <div className="small muted" style={{ marginBottom: 4 }}>Verbrauch je Einheit (z. B. kWh, m³ oder Einheiten laut Heizkostenverteiler):</div>
            <div className="row">
              {property.units.map((u) => (
                <label key={u.id} className="field" style={{ width: 130 }}>
                  {u.name}
                  <NumberInput
                    value={cost.consumption?.[u.id]}
                    onChange={(v) => onChange({ consumption: { ...cost.consumption, [u.id]: v } })}
                  />
                </label>
              ))}
              <span className="small muted">
                Summe: {formatNum(property.units.reduce((a, u) => a + (cost.consumption?.[u.id] ?? 0), 0))}
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
