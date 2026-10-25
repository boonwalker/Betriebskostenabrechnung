import { useState } from "react";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { DELIVERY_LABELS, followUps, reminderText, statementDeadline } from "../lib/followUp";
import type { AppData, Delivery, DeliveryMethod, ISODate, Statement } from "../lib/types";
import { CopyTextModal } from "./CopyText";

/** Nach der Freigabe: Zugang beim Mieter, Fristen und Zahlungseingang */
export function TenantFollowUpRow({ data, statement, tenantId, save }: { data: AppData; statement: Statement; tenantId: string; save: (s: Statement) => void }) {
  const today = todayISO();
  const [reminder, setReminder] = useState(false);
  const f = followUps(statement, data, today).find((x) => x.tenantId === tenantId);
  if (!f) return null;
  const delivery = statement.delivery?.[tenantId];
  const tenant = data.tenants.find((t) => t.id === tenantId);
  const landlord = tenant?.landlord ?? data.settings.landlord;
  const setDelivery = (d: Delivery | null) => {
    const next = { ...statement.delivery };
    if (d) next[tenantId] = d;
    else delete next[tenantId];
    save({ ...statement, delivery: next });
  };
  const setSettled = (date: ISODate | null) => {
    const next = { ...statement.settled };
    if (date) next[tenantId] = date;
    else delete next[tenantId];
    save({ ...statement, settled: next });
  };
  const hasBalance = Math.abs(f.balance) >= 0.01;
  const due = f.balance > 0;

  return (
    <div className="follow-up">
      <div className="follow-up-row">
        <label className="field">
          Zugegangen am
          <input type="date" value={delivery?.date ?? ""} max={today} onChange={(e) => setDelivery(e.target.value ? { date: e.target.value, method: delivery?.method ?? "brief" } : null)} />
        </label>
        <label className="field">
          auf dem Weg
          <select value={delivery?.method ?? "brief"} disabled={!delivery} onChange={(e) => delivery && setDelivery({ ...delivery, method: e.target.value as DeliveryMethod })}>
            {Object.entries(DELIVERY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        {!delivery && (
          <button className="follow-up-today" onClick={() => setDelivery({ date: today, method: "persoenlich" })}>
            Heute übergeben
          </button>
        )}
      </div>

      {!delivery ? (
        <p className="small muted" style={{ margin: 0 }}>
          Trage ein, wann das Schreiben angekommen ist – Zugang bis spätestens {formatDate(statementDeadline(statement))}. Daraus ergeben sich Fälligkeit und
          Einwendungsfrist. Bei einem Brief zählt der Tag, an dem er im Briefkasten liegt; sicher nachweisbar ist ein Einwurf-Einschreiben oder die Übergabe mit Zeugen.
        </p>
      ) : (
        <>
          {f.late && (
            <div className="alert danger small" style={{ margin: 0 }}>
              Zugang nach Ablauf der Abrechnungsfrist ({formatDate(statementDeadline(statement))}): eine Nachzahlung kann in der Regel nicht mehr verlangt werden, ein
              Guthaben ist trotzdem auszuzahlen.
            </div>
          )}
          <dl className="follow-up-facts">
            {hasBalance && (
              <>
                <dt>{due ? "Nachzahlung fällig" : "Guthaben auszahlen bis"}</dt>
                <dd>
                  {formatDate(f.due)} <span className="muted">({formatEUR(Math.abs(f.balance))})</span>
                </dd>
              </>
            )}
            <dt>Einwendungen bis</dt>
            <dd>{formatDate(f.objectionsUntil)}</dd>
          </dl>
          {hasBalance && (
            <div className="follow-up-row">
              <label className="check">
                <input type="checkbox" checked={!!f.settledOn} onChange={(e) => setSettled(e.target.checked ? today : null)} />
                {due ? "Nachzahlung eingegangen" : "Guthaben ausgezahlt"}
              </label>
              {f.settledOn && <input type="date" value={f.settledOn} max={today} onChange={(e) => e.target.value && setSettled(e.target.value)} aria-label="am" />}
            </div>
          )}
          {f.overdue && (
            <div className={`alert ${due ? "warn" : "danger"} small follow-up-overdue`}>
              <span>
                {due
                  ? `Die Nachzahlung war am ${formatDate(f.due)} fällig und ist noch nicht als eingegangen abgehakt.`
                  : `Das Guthaben hätte bis zum ${formatDate(f.due)} ausgezahlt werden müssen.`}
              </span>
              {due && <button onClick={() => setReminder(true)}>Zahlungserinnerung</button>}
            </div>
          )}
        </>
      )}
      {reminder && <CopyTextModal title={`Zahlungserinnerung an ${f.name}`} text={reminderText(f, tenant, statement, landlord.name, landlord.iban)} onClose={() => setReminder(false)} />}
    </div>
  );
}
