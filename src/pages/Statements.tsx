import { useState } from "react";
import { Balance, Modal, type PageProps } from "../components/ui";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { uid } from "../lib/store";
import { carryOverCosts } from "../lib/model";
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
        <div className="tiles">
          {sorted.map((s) => {
            const p = data.properties.find((x) => x.id === s.propertyId);
            if (!p) return null;
            const r = calculateStatement(s, p, data.tenants);
            const due = r.tenants.filter((t) => t.balance > 0).reduce((a, t) => a + t.balance, 0);
            const credit = r.tenants.filter((t) => t.balance < 0).reduce((a, t) => a - t.balance, 0);
            const today = todayISO();
            const overdue = r.deadline < today;
            const daysLeft = Math.round((Date.parse(r.deadline) - Date.parse(today)) / 86400000);
            const open = () => (window.location.hash = `#/abrechnungen/${s.id}`);
            return (
              <div
                key={s.id}
                className="tile statement-tile"
                role="link"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => e.key === "Enter" && open()}
              >
                <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="tile-title">Abrechnung {s.periodStart.slice(0, 4)}</div>
                    <div className="muted small ellipsis">{p.name}</div>
                  </div>
                  <span className="spacer" />
                  <span className={`badge ${s.status === "draft" ? "status-draft" : "status-released"}`}>
                    {s.status === "released" ? "freigegeben" : s.status === "partial" ? "teilweise freigegeben" : "Entwurf"}
                  </span>
                </div>

                <div className="muted small" style={{ marginTop: 12 }}>Umlagefähige Kosten</div>
                <div className="tile-value" style={{ marginTop: 0 }}>{formatEUR(r.totalCosts)}</div>
                <div className="muted small">{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</div>

                {r.tenants.length > 0 && (
                  <ul className="statement-tile-tenants">
                    {r.tenants.map((t) => (
                      <li key={t.tenant.id + t.start}>
                        <span className="ellipsis">{t.tenant.name}</span>
                        <Balance value={t.balance} />
                      </li>
                    ))}
                  </ul>
                )}

                <div className="tile-stats">
                  <div>
                    <span className="muted small">Nachzahlungen</span>
                    <strong>{formatEUR(due)}</strong>
                  </div>
                  <div>
                    <span className="muted small">Guthaben</span>
                    <strong>{formatEUR(credit)}</strong>
                  </div>
                  <div>
                    <span className="muted small">Frist</span>
                    <strong className={overdue && s.status !== "released" ? "danger-text" : undefined}>{formatDate(r.deadline)}</strong>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
                  {s.status !== "released" && (
                    <span className={`badge ${overdue ? "danger" : daysLeft <= 60 ? "warn" : "neutral"}`}>
                      {overdue ? "Frist abgelaufen" : `noch ${daysLeft} Tage bis zur Frist`}
                    </span>
                  )}
                  <span className="spacer" />
                  <button
                    className="ghost small"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(s);
                    }}
                    aria-label="Abrechnung löschen"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
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
      costs: copy && previous ? carryOverCosts(previous) : [],
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
