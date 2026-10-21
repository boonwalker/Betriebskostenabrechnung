import { useState } from "react";
import { Modal, NumberInput, type PageProps } from "../components/ui";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { uid } from "../lib/store";
import type { AppData, Tenant } from "../lib/types";

export default function Tenants({ data, update }: PageProps) {
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [showFormer, setShowFormer] = useState(false);
  const today = todayISO();

  const newTenant = (): Tenant | null => {
    const p = data.properties[0];
    if (!p) return null;
    return {
      id: uid(),
      name: "",
      mailingAddress: "",
      propertyId: p.id,
      unitId: p.units[0]?.id ?? "",
      moveIn: today.slice(0, 8) + "01",
      moveOut: null,
      persons: 1,
      monthlyPrepayment: 0,
    };
  };

  const save = (t: Tenant) => {
    update((d) => ({
      ...d,
      tenants: d.tenants.some((x) => x.id === t.id) ? d.tenants.map((x) => (x.id === t.id ? t : x)) : [...d.tenants, t],
    }));
    setEditing(null);
  };

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
          <a className="btn primary" href="#/objekte">Zu den Objekten</a>
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
          <button className="primary" onClick={() => setEditing(newTenant())}>+ Mieter anlegen</button>
        </div>
      </div>

      {data.properties.map((p) => {
        const tenants = data.tenants
          .filter((t) => t.propertyId === p.id && (showFormer || !t.moveOut || t.moveOut >= today))
          .sort((a, b) => a.moveIn.localeCompare(b.moveIn));
        return (
          <div className="card" key={p.id}>
            <h2>{p.name}</h2>
            {tenants.length === 0 ? (
              <p className="muted">Keine Mieter erfasst.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Einheit</th>
                      <th>Mietzeit</th>
                      <th className="num">Personen</th>
                      <th className="num">BK-Vorauszahlung</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td>{p.units.find((u) => u.id === t.unitId)?.name ?? "–"}</td>
                        <td>
                          {formatDate(t.moveIn)} – {t.moveOut ? formatDate(t.moveOut) : "heute"}
                        </td>
                        <td className="num">{t.persons}</td>
                        <td className="num">{formatEUR(t.monthlyPrepayment)} / Monat</td>
                        <td className="num">
                          <button className="ghost" onClick={() => setEditing({ ...t })}>Bearbeiten</button>
                          <button className="ghost" onClick={() => remove(t)} aria-label="Löschen">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {editing && <TenantForm data={data} initial={editing} onSave={save} onClose={() => setEditing(null)} />}
    </>
  );
}

function TenantForm({ data, initial, onSave, onClose }: { data: AppData; initial: Tenant; onSave: (t: Tenant) => void; onClose: () => void }) {
  const [t, setT] = useState(initial);
  const property = data.properties.find((p) => p.id === t.propertyId);
  const valid = t.name.trim() && t.unitId && t.moveIn && (!t.moveOut || t.moveOut >= t.moveIn) && t.persons >= 0;

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
            Einzug
            <input type="date" value={t.moveIn} onChange={(e) => setT({ ...t, moveIn: e.target.value })} />
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
            BK-Vorauszahlung je Monat (€)
            <NumberInput value={t.monthlyPrepayment} onChange={(monthlyPrepayment) => setT({ ...t, monthlyPrepayment })} />
          </label>
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
