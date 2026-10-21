import { useState } from "react";
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
          <table>
            <thead>
              <tr>
                <th>Objekt</th>
                <th>Zeitraum</th>
                <th className="num">Gesamtkosten</th>
                <th className="num">Nachzahlungen</th>
                <th className="num">Guthaben</th>
                <th>Frist</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const p = data.properties.find((x) => x.id === s.propertyId);
                if (!p) return null;
                const r = calculateStatement(s, p, data.tenants);
                const due = r.tenants.filter((t) => t.balance > 0).reduce((a, t) => a + t.balance, 0);
                const credit = r.tenants.filter((t) => t.balance < 0).reduce((a, t) => a - t.balance, 0);
                const overdue = r.deadline < todayISO();
                return (
                  <tr key={s.id}>
                    <td><a href={`#/abrechnungen/${s.id}`}>{p.name}</a></td>
                    <td>{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</td>
                    <td className="num">{formatEUR(r.totalCosts)}</td>
                    <td className="num">{formatEUR(due)}</td>
                    <td className="num">{formatEUR(credit)}</td>
                    <td>
                      <span className={`badge ${overdue ? "danger" : "neutral"}`}>{formatDate(r.deadline)}</span>
                    </td>
                    <td className="num">
                      <a className="btn" href={`#/abrechnungen/${s.id}`}>Öffnen</a>{" "}
                      <button className="ghost" onClick={() => remove(s)} aria-label="Löschen">✕</button>
                    </td>
                  </tr>
                );
              })}
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
          ? previous.costs.map((c) => ({
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
