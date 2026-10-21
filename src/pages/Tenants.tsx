import { useState } from "react";
import { Modal, NumberInput, type PageProps } from "../components/ui";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { newRentPeriod, rentAt, uid, warmRent } from "../lib/model";
import type { AppData, RentPeriod, Tenant } from "../lib/types";

export function newTenant(data: AppData, propertyId?: string, unitId?: string): Tenant | null {
  const p = data.properties.find((x) => x.id === propertyId) ?? data.properties[0];
  if (!p) return null;
  const moveIn = todayISO().slice(0, 8) + "01";
  return {
    id: uid(),
    name: "",
    mailingAddress: "",
    propertyId: p.id,
    unitId: unitId ?? p.units[0]?.id ?? "",
    moveIn,
    moveOut: null,
    persons: 1,
    deposit: 0,
    rentHistory: [newRentPeriod(moveIn)],
  };
}

export function saveTenant(update: PageProps["update"], t: Tenant) {
  update((d) => ({
    ...d,
    tenants: d.tenants.some((x) => x.id === t.id) ? d.tenants.map((x) => (x.id === t.id ? t : x)) : [...d.tenants, t],
  }));
}

export default function Tenants({ data, update }: PageProps) {
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [showFormer, setShowFormer] = useState(false);
  const today = todayISO();

  const remove = (t: Tenant) => {
    if (!confirm(`Mieter „${t.name}“ löschen? Tipp: Bei Auszug besser ein Auszugsdatum eintragen, damit ältere Abrechnungen stimmen.`)) return;
    update((d) => ({ ...d, tenants: d.tenants.filter((x) => x.id !== t.id) }));
  };

  if (data.properties.length === 0) {
    return (
      <>
        <h1>Mieter</h1>
        <div className="card empty">
          <p>Lege zuerst ein Objekt mit Wohneinheiten an.</p>
          <a className="btn primary" href="#/objekte/neu">Objekt anlegen</a>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Mieter</h1>
        <div className="row">
          <label className="row small muted">
            <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} /> ehemalige anzeigen
          </label>
          <button className="primary" onClick={() => setEditing(newTenant(data))}>+ Mieter anlegen</button>
        </div>
      </div>

      {data.properties.map((p) => {
        const tenants = data.tenants
          .filter((t) => t.propertyId === p.id && (showFormer || !t.moveOut || t.moveOut >= today))
          .sort((a, b) => a.moveIn.localeCompare(b.moveIn));
        return (
          <div className="card" key={p.id}>
            <h2><a href={`#/objekte/${p.id}`} style={{ color: "inherit" }}>{p.name}</a></h2>
            {tenants.length === 0 ? (
              <p className="muted">Keine Mieter erfasst.</p>
            ) : (
              <TenantTable data={data} tenants={tenants} onEdit={(t) => setEditing(structuredClone(t))} onRemove={remove} />
            )}
          </div>
        );
      })}

      {editing && (
        <TenantForm
          data={data}
          initial={editing}
          onSave={(t) => {
            saveTenant(update, t);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function TenantTable({ data, tenants, onEdit, onRemove }: { data: AppData; tenants: Tenant[]; onEdit: (t: Tenant) => void; onRemove?: (t: Tenant) => void }) {
  const today = todayISO();
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Einheit</th>
            <th>Mietzeit</th>
            <th className="num">Pers.</th>
            <th className="num">Kaltmiete</th>
            <th className="num">BK / HK-Vorausz.</th>
            <th className="num">Warmmiete</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => {
            const r = rentAt(t, t.moveOut && t.moveOut < today ? t.moveOut : today);
            const unit = data.properties.find((p) => p.id === t.propertyId)?.units.find((u) => u.id === t.unitId);
            return (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{unit?.name ?? "–"}</td>
                <td>{formatDate(t.moveIn)} – {t.moveOut ? formatDate(t.moveOut) : "heute"}</td>
                <td className="num">{t.persons}</td>
                <td className="num">{formatEUR(r?.coldRent ?? 0)}</td>
                <td className="num">{formatEUR(r?.prepaymentOperating ?? 0)} / {formatEUR(r?.prepaymentHeating ?? 0)}</td>
                <td className="num"><strong>{formatEUR(warmRent(r))}</strong></td>
                <td className="num">
                  <button className="ghost" onClick={() => onEdit(t)}>Bearbeiten</button>
                  {onRemove && <button className="ghost" onClick={() => onRemove(t)} aria-label="Löschen">✕</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TenantForm({ data, initial, onSave, onClose }: { data: AppData; initial: Tenant; onSave: (t: Tenant) => void; onClose: () => void }) {
  const [t, setT] = useState(initial);
  const property = data.properties.find((p) => p.id === t.propertyId);
  const history = [...t.rentHistory].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  const setRent = (id: string, patch: Partial<RentPeriod>) => setT({ ...t, rentHistory: t.rentHistory.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const valid = t.name.trim() && t.unitId && t.moveIn && (!t.moveOut || t.moveOut >= t.moveIn) && t.persons >= 0 && t.rentHistory.length > 0;

  return (
    <Modal title={initial.name ? "Mieter bearbeiten" : "Neuer Mieter"} onClose={onClose}>
      <div className="stack">
        <div className="grid">
          <label className="field">
            Name
            <input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="z. B. Familie Müller" autoFocus />
          </label>
          <label className="field">
            Objekt
            <select
              value={t.propertyId}
              onChange={(e) => {
                const p = data.properties.find((x) => x.id === e.target.value)!;
                setT({ ...t, propertyId: p.id, unitId: p.units[0]?.id ?? "" });
              }}
            >
              {data.properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Einheit
            <select value={t.unitId} onChange={(e) => setT({ ...t, unitId: e.target.value })}>
              {property?.units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Einzug (Mietbeginn)
            <input
              type="date"
              value={t.moveIn}
              onChange={(e) => {
                const moveIn = e.target.value;
                // der erste Mietstand beginnt mit dem Einzug
                const first = history[0];
                setT({ ...t, moveIn, rentHistory: t.rentHistory.map((r) => (r.id === first?.id ? { ...r, validFrom: moveIn } : r)) });
              }}
            />
          </label>
          <label className="field">
            Auszug (leer = wohnt noch dort)
            <input type="date" value={t.moveOut ?? ""} onChange={(e) => setT({ ...t, moveOut: e.target.value || null })} />
          </label>
          <label className="field">
            Personen im Haushalt
            <NumberInput value={t.persons} onChange={(persons) => setT({ ...t, persons })} />
          </label>
          <label className="field">
            Mietkaution (€)
            <NumberInput value={t.deposit} onChange={(deposit) => setT({ ...t, deposit })} />
          </label>
        </div>

        <div>
          <h3 style={{ marginBottom: 2 }}>Miete und Vorauszahlungen</h3>
          <p className="hint">
            Laut Mietvertrag. Lege bei jeder Mieterhöhung oder Anpassung der Vorauszahlungen (§ 560 BGB) eine neue Zeile ab dem Stichtag an – so werden die
            Vorauszahlungen in der Abrechnung monatsgenau berechnet.
          </p>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>gültig ab</th>
                  <th className="num">Kaltmiete</th>
                  <th className="num">BK-Vorausz.</th>
                  <th className="num">HK-Vorausz.</th>
                  <th className="num">Warmmiete</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ minWidth: 140 }}>
                      <input type="date" value={r.validFrom} disabled={i === 0} onChange={(e) => e.target.value && setRent(r.id, { validFrom: e.target.value })} aria-label="gültig ab" />
                    </td>
                    <td style={{ minWidth: 95 }}><NumberInput value={r.coldRent} onChange={(coldRent) => setRent(r.id, { coldRent })} ariaLabel="Kaltmiete" /></td>
                    <td style={{ minWidth: 95 }}><NumberInput value={r.prepaymentOperating} onChange={(v) => setRent(r.id, { prepaymentOperating: v })} ariaLabel="Betriebskostenvorauszahlung" /></td>
                    <td style={{ minWidth: 95 }}><NumberInput value={r.prepaymentHeating} onChange={(v) => setRent(r.id, { prepaymentHeating: v })} ariaLabel="Heizkostenvorauszahlung" /></td>
                    <td className="num">{formatEUR(warmRent(r))}</td>
                    <td>
                      {i > 0 && (
                        <button className="ghost" onClick={() => setT({ ...t, rentHistory: t.rentHistory.filter((x) => x.id !== r.id) })} aria-label="Zeile entfernen">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            style={{ marginTop: 8 }}
            onClick={() => {
              const last = history[history.length - 1];
              setT({ ...t, rentHistory: [...t.rentHistory, newRentPeriod(todayISO().slice(0, 8) + "01", last)] });
            }}
          >
            + Änderung ab Stichtag
          </button>
          <p className="small muted" style={{ marginTop: 6 }}>
            Wenn Betriebs- und Heizkosten gemeinsam vorausgezahlt werden, trage den Gesamtbetrag unter „BK-Vorausz.“ ein.
          </p>
        </div>

        <label className="field">
          Anschrift für die Abrechnung (leer = Anschrift der Wohnung; nach Auszug die neue Anschrift)
          <textarea rows={2} value={t.mailingAddress} onChange={(e) => setT({ ...t, mailingAddress: e.target.value })} />
        </label>
        <div className="row">
          <span className="spacer" />
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!valid} onClick={() => onSave(t)}>Speichern</button>
        </div>
      </div>
    </Modal>
  );
}
