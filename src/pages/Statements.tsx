import { useState, type ReactNode } from "react";
import { Modal, type PageProps } from "../components/ui";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { uid } from "../lib/store";
import type { AppData, Statement } from "../lib/types";

export default function Statements({ data, update }: PageProps) {
  const [creating, setCreating] = useState(false);

  const remove = (s: Statement) => {
    if (!confirm("Diese Abrechnung löschen?")) return;
    update((d) => ({ ...d, statements: d.statements.filter((x) => x.id !== s.id) }));
  };

  const sorted = [...data.statements].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  // Eine Spalte je Abrechnung, die neueste vorn
  const rows = sorted.flatMap((s) => {
    const p = data.properties.find((x) => x.id === s.propertyId);
    if (!p) return [];
    const r = calculateStatement(s, p, data.tenants);
    const due = r.tenants.filter((t) => t.balance > 0).reduce((a, t) => a + t.balance, 0);
    const credit = r.tenants.filter((t) => t.balance < 0).reduce((a, t) => a - t.balance, 0);
    return [{ s, p, r, due, credit, overdue: r.deadline < todayISO() }];
  });
  const multiProperty = new Set(rows.map((x) => x.p.id)).size > 1;
  const row = (label: string, cell: (x: (typeof rows)[number]) => ReactNode) => (
    <tr>
      <th scope="row">{label}</th>
      {rows.map((x) => (
        <td key={x.s.id} className="num">{cell(x)}</td>
      ))}
    </tr>
  );

  return (
    <>
      <div className="page-head">
        <h1>Abrechnungen</h1>
        <button className="primary" disabled={data.properties.length === 0} onClick={() => setCreating(true)}>+ Neue Abrechnung</button>
      </div>

      {sorted.length === 0 ? (
        <div className="card empty">
          {data.properties.length === 0 ? (
            <>
              <p>Lege zuerst ein Objekt und deine Mieter an.</p>
              <a className="btn primary" href="#/objekte">Zu den Objekten</a>
            </>
          ) : (
            <>
              <p>Noch keine Abrechnung erstellt.</p>
              <button className="primary" onClick={() => setCreating(true)}>+ Neue Abrechnung</button>
            </>
          )}
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="transposed">
            <thead>
              <tr>
                <th />
                {rows.map(({ s, p }) => (
                  <th key={s.id} scope="col" className="num">
                    <a className="tenant-name" href={`#/abrechnungen/${s.id}`}>{s.periodStart.slice(0, 4)}</a>
                    {multiProperty && <span className="muted small">{p.name}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {row("Zeitraum", ({ s }) => <>{formatDate(s.periodStart)} –<br />{formatDate(s.periodEnd)}</>)}
              {row("Gesamtkosten", ({ r }) => formatEUR(r.totalCosts))}
              {row("Nachzahlungen", ({ due }) => formatEUR(due))}
              {row("Guthaben", ({ credit }) => formatEUR(credit))}
              {row("Status", ({ s }) => (
                <span className={`badge ${s.status === "draft" ? "status-draft" : "status-released"}`}>
                  {s.status === "released" ? "freigegeben" : s.status === "partial" ? "teilweise freigegeben" : "Entwurf"}
                </span>
              ))}
              {row("Frist", ({ r, overdue }) => <span className={`badge ${overdue ? "danger" : "neutral"}`}>{formatDate(r.deadline)}</span>)}
              <tr className="actions">
                <th />
                {rows.map(({ s }) => (
                  <td key={s.id} className="num">
                    <a className="btn small" href={`#/abrechnungen/${s.id}`}>Öffnen</a>{" "}
                    <button className="ghost small" onClick={() => remove(s)} aria-label="Löschen">✕</button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewStatement
          data={data}
          onClose={() => setCreating(false)}
          onCreate={(s) => {
            update((d) => ({ ...d, statements: [...d.statements, s] }));
            window.location.hash = `#/abrechnungen/${s.id}`;
          }}
        />
      )}
    </>
  );
}

function NewStatement({ data, onClose, onCreate }: { data: AppData; onClose: () => void; onCreate: (s: Statement) => void }) {
  const lastYear = new Date().getFullYear() - 1;
  const [propertyId, setPropertyId] = useState(data.properties[0].id);
  const [year, setYear] = useState(lastYear);
  const previous = data.statements
    .filter((s) => s.propertyId === propertyId)
    .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  const [copy, setCopy] = useState(true);

  const create = () => {
    onCreate({
      id: uid(),
      propertyId,
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-12-31`,
      costs:
        copy && previous
          ? previous.costs
              // Positionen aus einer WEG-Jahresabrechnung kommen jedes Jahr neu aus der Abrechnung des Jahres
              .filter((c) => !c.sourceAnnualId)
              .map((c) => ({
                ...c,
                id: uid(),
                amount: 0,
                source: undefined,
                consumption: c.key === "consumption" || c.key === "heating" ? {} : c.consumption,
                co2Cost: undefined,
                co2Kg: undefined,
                laborCost: undefined,
              }))
          : [],
      prepaymentOverrides: {},
      prepaymentsConfirmed: {},
      status: "draft",
      releases: {},
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <Modal title="Neue Abrechnung" onClose={onClose}>
      <div className="stack">
        <div className="grid">
          <label className="field">
            Objekt
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              {data.properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Abrechnungsjahr
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </label>
        </div>
        <p className="muted small">Der Zeitraum ist zunächst das Kalenderjahr und kann in der Abrechnung angepasst werden.</p>
        {previous && (
          <label className="row">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            Kostenpositionen aus der Abrechnung {previous.periodStart.slice(0, 4)} übernehmen (ohne Beträge)
          </label>
        )}
        <div className="row">
          <span className="spacer" />
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={create}>Anlegen</button>
        </div>
      </div>
    </Modal>
  );
}
