import { useState } from "react";
import { Modal, NumberInput, type PageProps } from "../components/ui";
import { formatNum } from "../lib/format";
import { uid } from "../lib/store";
import type { Property } from "../lib/types";

function newProperty(): Property {
  return { id: uid(), name: "", address: "", units: [{ id: uid(), name: "Wohnung 1", area: 0 }] };
}

export default function Properties({ data, update }: PageProps) {
  const [editing, setEditing] = useState<Property | null>(null);

  const save = (p: Property) => {
    update((d) => ({
      ...d,
      properties: d.properties.some((x) => x.id === p.id) ? d.properties.map((x) => (x.id === p.id ? p : x)) : [...d.properties, p],
    }));
    setEditing(null);
  };

  const remove = (p: Property) => {
    const tenantCount = data.tenants.filter((t) => t.propertyId === p.id).length;
    const stmtCount = data.statements.filter((s) => s.propertyId === p.id).length;
    if (!confirm(`„${p.name}“ löschen? ${tenantCount} Mieter und ${stmtCount} Abrechnungen werden ebenfalls gelöscht.`)) return;
    update((d) => ({
      ...d,
      properties: d.properties.filter((x) => x.id !== p.id),
      tenants: d.tenants.filter((t) => t.propertyId !== p.id),
      statements: d.statements.filter((s) => s.propertyId !== p.id),
    }));
  };

  return (
    <>
      <div className="page-head">
        <h1>Objekte</h1>
        <button className="primary" onClick={() => setEditing(newProperty())}>+ Objekt anlegen</button>
      </div>

      {data.properties.length === 0 && (
        <div className="card empty">
          <p>Noch keine Objekte. Lege dein erstes Mietobjekt mit seinen Wohneinheiten an.</p>
          <button className="primary" onClick={() => setEditing(newProperty())}>+ Objekt anlegen</button>
        </div>
      )}

      {data.properties.map((p) => {
        const total = p.units.reduce((a, u) => a + u.area, 0);
        return (
          <div className="card" key={p.id}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div>
                <h2 style={{ marginBottom: 2 }}>{p.name}</h2>
                <div className="muted small">{p.address}</div>
              </div>
              <span className="spacer" />
              <button onClick={() => setEditing(structuredClone(p))}>Bearbeiten</button>
              <button className="danger" onClick={() => remove(p)}>Löschen</button>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Einheit</th>
                    <th className="num">Wohnfläche</th>
                    <th>Aktueller Mieter</th>
                  </tr>
                </thead>
                <tbody>
                  {p.units.map((u) => {
                    const current = data.tenants.find((t) => t.unitId === u.id && !t.moveOut);
                    return (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td className="num">{formatNum(u.area)} m²</td>
                        <td>{current ? current.name : <span className="badge neutral">frei</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{p.units.length} Einheiten</td>
                    <td className="num">{formatNum(total)} m²</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {editing && <PropertyForm initial={editing} onSave={save} onClose={() => setEditing(null)} />}
    </>
  );
}

function PropertyForm({ initial, onSave, onClose }: { initial: Property; onSave: (p: Property) => void; onClose: () => void }) {
  const [p, setP] = useState(initial);
  const setUnit = (id: string, patch: Partial<Property["units"][number]>) =>
    setP({ ...p, units: p.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  const valid = p.name.trim() && p.units.length > 0 && p.units.every((u) => u.name.trim() && u.area > 0);

  return (
    <Modal title={initial.name ? "Objekt bearbeiten" : "Neues Objekt"} onClose={onClose}>
      <div className="stack">
        <div className="grid">
          <label className="field">
            Bezeichnung
            <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="z. B. Mehrfamilienhaus Lindenstraße" autoFocus />
          </label>
          <label className="field">
            Anschrift
            <input value={p.address} onChange={(e) => setP({ ...p, address: e.target.value })} placeholder="Lindenstraße 5, 12345 Musterstadt" />
          </label>
        </div>
        <h3>Wohneinheiten</h3>
        <table className="compact">
          <thead>
            <tr>
              <th>Bezeichnung</th>
              <th className="num">Wohnfläche (m²)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.units.map((u) => (
              <tr key={u.id}>
                <td>
                  <input value={u.name} onChange={(e) => setUnit(u.id, { name: e.target.value })} aria-label="Bezeichnung der Einheit" />
                </td>
                <td style={{ width: 160 }}>
                  <NumberInput value={u.area} onChange={(area) => setUnit(u.id, { area })} ariaLabel="Wohnfläche" />
                </td>
                <td style={{ width: 40 }}>
                  <button className="ghost" onClick={() => setP({ ...p, units: p.units.filter((x) => x.id !== u.id) })} aria-label="Einheit entfernen">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setP({ ...p, units: [...p.units, { id: uid(), name: `Wohnung ${p.units.length + 1}`, area: 0 }] })}>+ Einheit</button>
        <p className="muted small">Tipp: Auch eine selbst genutzte Wohnung als Einheit anlegen – ihr Kostenanteil bleibt dann bei dir.</p>
        <div className="row">
          <span className="spacer" />
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!valid} onClick={() => onSave(p)}>Speichern</button>
        </div>
      </div>
    </Modal>
  );
}
