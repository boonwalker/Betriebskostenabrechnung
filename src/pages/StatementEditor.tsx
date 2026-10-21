import { useMemo, useState } from "react";
import { Balance, NumberInput, type PageProps } from "../components/ui";
import ReceiptImport from "../components/ReceiptImport";
import { COST_CATEGORIES, isHeatingCategory, KEY_LABELS } from "../lib/betrkv";
import { co2Stage } from "../lib/co2";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR, formatNum } from "../lib/format";
import { changedSinceRelease, releaseStatement, statementReadiness } from "../lib/release";
import { uid } from "../lib/store";
import { transferToStatement } from "../lib/weg";
import type { AllocationKey, CostItem, Property, Section35aKind, Statement } from "../lib/types";

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

  const readiness = statementReadiness(statement, data);
  const released = statement.status === "released";
  const changed = changedSinceRelease(statement, data);
  const year = Number(statement.periodStart.slice(0, 4));
  const annuals = data.wegAnnuals.filter((a) => a.propertyId === property.id && a.year === year);

  const takeOverWeg = () => {
    let costs = statement.costs;
    const notes: string[] = [];
    let added = 0;
    for (const a of annuals) {
      const { items, skipped } = transferToStatement(a, { ...statement, costs }, { property, tenants: data.tenants });
      costs = [...costs, ...items];
      added += items.length;
      for (const sk of skipped) if (sk.reason !== "bereits übernommen" && sk.reason !== "nicht umlagefähig") notes.push(`• ${sk.position.label}: ${sk.reason}`);
    }
    set({ costs });
    alert(`${added} Position(en) übernommen.` + (notes.length ? `\n\nNicht übernommen:\n${notes.join("\n")}` : ""));
  };

  const release = () => {
    try {
      const next = releaseStatement(statement, data);
      update((d) => ({ ...d, statements: d.statements.map((s) => (s.id === next.id ? next : s)) }));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const today = todayISO();
  const daysLeft = Math.round((Date.parse(result.deadline) - Date.parse(today)) / 86_400_000);

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/abrechnungen" className="small">← Abrechnungen</a>
          <h1>Betriebskostenabrechnung {property.name}</h1>
          <span className={`badge ${released ? "status-released" : "status-draft"}`}>
            {released ? `✓ freigegeben am ${formatDate(statement.release!.releasedAt.slice(0, 10))}` : "Entwurf"}
          </span>
        </div>
        <a className="btn primary" href={`#/abrechnungen/${statement.id}/druck`}>Abrechnungen drucken / PDF</a>
      </div>

      {released ? (
        <div className={`alert ${changed ? "danger" : "info"}`}>
          {changed ? (
            <>
              <strong>Daten wurden nach der Freigabe geändert.</strong> Die Druckansicht zeigt weiterhin den freigegebenen Stand. Hebe die Freigabe auf, um die Abrechnung neu
              zu berechnen und erneut freizugeben.
            </>
          ) : (
            <>Die Abrechnung ist freigegeben und gesperrt. Die Druckansicht zeigt den eingefrorenen Stand.</>
          )}{" "}
          <button
            className="ghost"
            onClick={() => confirm("Freigabe aufheben? Die Abrechnung wird wieder zum Entwurf.") && set({ status: "draft", release: null })}
          >
            Freigabe aufheben
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="row" style={{ marginBottom: readiness.blockers.length || readiness.hints.length ? 8 : 0 }}>
            <h2 style={{ margin: 0 }}>{readiness.ready ? "Bereit zur Freigabe" : "Was noch fehlt"}</h2>
            <span className="spacer" />
            <button className="primary" disabled={!readiness.ready} onClick={release} title={readiness.ready ? "Ergebnis einfrieren und als versandfertig markieren" : "Erst alle offenen Punkte klären"}>
              Freigeben
            </button>
          </div>
          {(readiness.blockers.length > 0 || readiness.hints.length > 0) && (
            <ul className="findings">
              {readiness.blockers.map((b) => (
                <li key={b} className="error">✗ {b}</li>
              ))}
              {readiness.hints.map((h) => (
                <li key={h} className="warning">⚠ {h}</li>
              ))}
            </ul>
          )}
          {!readiness.ready && (
            <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Solange Punkte offen sind, ist das Ergebnis vorläufig. Gedruckt wird es nur als gekennzeichneter Entwurf.
            </p>
          )}
        </div>
      )}

      <fieldset className="plain-fieldset" disabled={released}>
      {daysLeft < 0 ? (
        <div className="alert danger">
          Die Abrechnungsfrist ist am {formatDate(result.deadline)} abgelaufen. Nachforderungen sind in der Regel ausgeschlossen (§ 556 Abs. 3 BGB), Guthaben müssen trotzdem ausgezahlt werden.
        </div>
      ) : daysLeft <= 90 ? (
        <div className="alert warn">
          Noch {daysLeft} Tage: Die Abrechnung muss den Mietern spätestens am {formatDate(result.deadline)} zugehen.
        </div>
      ) : null}


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
            <div className="muted small">davon trägst du (Leerstand, CO2)</div>
            <div className="stat">{formatEUR(result.landlordShare)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Kostenpositionen</h2>
          <span className="spacer" />
          {annuals.length > 0 && (
            <button onClick={takeOverWeg} title="Geprüfte, umlagefähige Positionen der WEG-Jahresabrechnung übernehmen">Aus WEG-Jahresabrechnung {year} übernehmen</button>
          )}
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
                  <th>tatsächlich gezahlt?</th>
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
                              Soll: {formatEUR(r.prepaymentsCalculated.total)} übernehmen
                            </button>
                          ) : (
                            <>BK {formatEUR(r.prepaymentsCalculated.operating)} + HK {formatEUR(r.prepaymentsCalculated.heating)}</>
                          )}
                        </div>
                      </td>
                      <td>
                        <label className="row small" style={{ flexWrap: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={statement.prepaymentsConfirmed[r.tenant.id] === true}
                            onChange={(e) => set({ prepaymentsConfirmed: { ...statement.prepaymentsConfirmed, [r.tenant.id]: e.target.checked } })}
                          />
                          bestätigt
                        </label>
                      </td>
                      <td className="num">
                        {!readiness.ready && !released && <div className="small muted">vorläufig</div>}
                        <Balance value={r.balance} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          Vergleiche die Vorauszahlungen mit deinen Kontoauszügen. Weicht der gezahlte Betrag vom Mietvertrag ab (z. B. Rückstände), trage ihn ein und bestätige ihn erst dann.
        </p>
        {(result.vacancies.length > 0 || result.co2.length > 0) && (
          <>
            <h3 style={{ marginTop: 16 }}>Trägst du als Vermieter</h3>
            <table className="compact">
              <tbody>
                {result.vacancies.map((v) => (
                  <tr key={v.unit.id + v.start}>
                    <td>Leerstand {v.unit.name}</td>
                    <td>{formatDate(v.start)} – {formatDate(v.end)} ({v.days} Tage)</td>
                    <td className="num">{formatEUR(v.amount)}</td>
                  </tr>
                ))}
                {result.co2.map((c) => (
                  <tr key={c.costId}>
                    <td>CO2-Kosten {c.label}</td>
                    <td>
                      {formatNum(c.kgPerM2Year)} kg CO2/m²/Jahr → Stufe {c.stage}: {c.landlordPct} % Vermieter (CO2KostAufG)
                    </td>
                    <td className="num">{formatEUR(c.landlordAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      </fieldset>

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
  const heating = isHeatingCategory(cost.category);
  const [open, setOpen] = useState(!!(cost.laborCost || cost.co2Cost));
  const totalArea = property.units.reduce((a, u) => a + u.area, 0);
  const stage = cost.co2Kg && totalArea ? co2Stage(cost.co2Kg / totalArea) : null;
  const needsConsumption = cost.key === "consumption" || cost.key === "heating";

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
          {cost.sourceAnnualId ? (
            <div className="muted small" title={cost.note}>
              aus <a href={`#/weg/jahresabrechnung/${cost.sourceAnnualId}`}>WEG-Jahresabrechnung</a>, Anteil der Wohnung
            </div>
          ) : (
            cost.source && <div className="muted small" title={cost.note}>aus Beleg: {cost.source}</div>
          )}
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
        <td className="num" style={{ whiteSpace: "nowrap" }}>
          <button className="ghost" onClick={() => setOpen(!open)} aria-expanded={open} title="§ 35a, CO2, Notiz">
            {open ? "▾" : "▸"} Details
          </button>
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
      {needsConsumption && (
        <tr>
          <td />
          <td colSpan={4}>
            {cost.key === "heating" && (
              <label className="row small muted" style={{ marginBottom: 6 }}>
                Verbrauchsanteil (HeizkostenV 50–70 %):
                <NumberInput
                  value={cost.consumptionShare ?? 70}
                  onChange={(v) => onChange({ consumptionShare: v })}
                  style={{ width: 70 }}
                  ariaLabel="Verbrauchsanteil in Prozent"
                />
                % · Rest als Grundkosten nach Wohnfläche
              </label>
            )}
            <div className="small muted" style={{ marginBottom: 4 }}>Verbrauch je Einheit (kWh, m³ oder Einheiten laut Heizkostenverteiler bzw. Messdienst):</div>
            <div className="row">
              {property.units.map((u) => (
                <label key={u.id} className="field" style={{ width: 130 }}>
                  {u.name}
                  <NumberInput value={cost.consumption?.[u.id]} onChange={(v) => onChange({ consumption: { ...cost.consumption, [u.id]: v } })} />
                </label>
              ))}
              <span className="small muted">Summe: {formatNum(property.units.reduce((a, u) => a + (cost.consumption?.[u.id] ?? 0), 0))}</span>
            </div>
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td />
          <td colSpan={4}>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
              <label className="field">
                Arbeitskosten § 35a EStG (€)
                <NumberInput value={cost.laborCost} onChange={(laborCost) => onChange({ laborCost, laborKind: cost.laborKind ?? "service" })} />
              </label>
              <label className="field">
                Art der Leistung
                <select value={cost.laborKind ?? "service"} onChange={(e) => onChange({ laborKind: e.target.value as Section35aKind })}>
                  <option value="service">haushaltsnahe Dienstleistung</option>
                  <option value="craftsman">Handwerkerleistung</option>
                </select>
              </label>
              {heating && (
                <>
                  <label className="field">
                    darin CO2-Kosten (€)
                    <NumberInput value={cost.co2Cost} onChange={(co2Cost) => onChange({ co2Cost })} />
                  </label>
                  <label className="field">
                    CO2-Ausstoß des Gebäudes (kg)
                    <NumberInput value={cost.co2Kg} onChange={(co2Kg) => onChange({ co2Kg })} />
                  </label>
                </>
              )}
            </div>
            <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
              § 35a: Nur Lohn-, Maschinen- und Fahrtkosten (ohne Material) – deine Mieter können 20 % davon von der Steuer abziehen.
              {heating && " CO2-Kosten und Ausstoß stehen auf der Brennstoff- bzw. Wärmerechnung (Pflichtangabe)."}
              {stage && ` → ${formatNum(cost.co2Kg! / totalArea)} kg/m²: Stufe ${stage.stage}, du trägst ${stage.landlordPct} % der CO2-Kosten.`}
            </p>
            <label className="field" style={{ marginTop: 8 }}>
              Notiz
              <input value={cost.note ?? ""} onChange={(e) => onChange({ note: e.target.value })} />
            </label>
          </td>
        </tr>
      )}
    </>
  );
}
