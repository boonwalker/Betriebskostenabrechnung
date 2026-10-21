import { useState } from "react";
import { Modal, NumberInput, type PageProps } from "../components/ui";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { newRentPeriod, rentAt, uid, warmRent } from "../lib/model";
import { COST_CATEGORIES } from "../lib/betrkv";
import { ALLOCATION_RULE_LABELS, defaultLease } from "../lib/lease";
import type { AppData, LeaseAgreement, RentPeriod, Tenant } from "../lib/types";

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
                  <th className="num">Zuschlag</th>
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
                    <td style={{ minWidth: 85 }} title="z. B. Stellplatz – Teil der Miete, keine Betriebskosten">
                      <NumberInput value={r.surcharge ?? 0} onChange={(surcharge) => setRent(r.id, { surcharge })} ariaLabel="Zuschlag" />
                    </td>
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

        <LeaseSection lease={t.lease ?? null} onChange={(lease) => setT({ ...t, lease })} />

        <div className="card stack" style={{ marginBottom: 0 }}>
          <label className="row">
            <input
              type="checkbox"
              checked={!!t.landlord}
              onChange={(e) => setT({ ...t, landlord: e.target.checked ? { name: "", address: "", iban: "" } : null })}
            />
            <strong>Anderer Vermieter für dieses Mietverhältnis</strong>
            <span className="small muted">(z. B. Voreigentümer oder Familienmitglied – erscheint als Absender und Bankverbindung im Anschreiben)</span>
          </label>
          {t.landlord && (
            <div className="grid">
              <label className="field">
                Name
                <input value={t.landlord.name} onChange={(e) => setT({ ...t, landlord: { ...t.landlord!, name: e.target.value } })} />
              </label>
              <label className="field">
                IBAN
                <input value={t.landlord.iban} onChange={(e) => setT({ ...t, landlord: { ...t.landlord!, iban: e.target.value } })} />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Anschrift
                <textarea rows={2} value={t.landlord.address} onChange={(e) => setT({ ...t, landlord: { ...t.landlord!, address: e.target.value } })} />
              </label>
            </div>
          )}
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

/** Betriebskostenvereinbarung aus dem Mietvertrag */
function LeaseSection({ lease, onChange }: { lease: LeaseAgreement | null; onChange: (l: LeaseAgreement | null) => void }) {
  if (!lease) {
    return (
      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: 2 }}>Betriebskosten laut Mietvertrag</h3>
        <p className="hint">
          Umgelegt werden darf nur, was im Mietvertrag vereinbart ist. Sonstige Betriebskosten (§ 2 Nr. 17 BetrKV) müssen namentlich genannt sein.
        </p>
        <button onClick={() => onChange(defaultLease())}>Vereinbarung erfassen</button>
      </div>
    );
  }
  const set = (patch: Partial<LeaseAgreement>) => onChange({ ...lease, ...patch });
  const toggle = (no: number) =>
    set({ agreedCategories: lease.agreedCategories.includes(no) ? lease.agreedCategories.filter((x) => x !== no) : [...lease.agreedCategories, no].sort((a, b) => a - b) });
  return (
    <div className="card stack" style={{ marginBottom: 0 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>Betriebskosten laut Mietvertrag</h3>
        <span className="spacer" />
        <button className="ghost" onClick={() => confirm("Vereinbarung entfernen?") && onChange(null)}>Entfernen</button>
      </div>
      <label className="field">
        Fundstelle
        <input value={lease.reference} onChange={(e) => set({ reference: e.target.value })} placeholder="z. B. Mietvertrag vom 10.07.2025, § 3 und § 6" />
      </label>
      <div>
        <div className="row small muted" style={{ marginBottom: 4 }}>
          Vereinbarte Kostenarten (§ 2 Nr. 1–16 BetrKV)
          <span className="spacer" />
          <button className="ghost small" onClick={() => set({ agreedCategories: Array.from({ length: 16 }, (_, i) => i + 1) })}>alle</button>
          <button className="ghost small" onClick={() => set({ agreedCategories: [] })}>keine</button>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 4 }}>
          {COST_CATEGORIES.filter((c) => c.no <= 16).map((c) => (
            <label key={c.no} className="row small" style={{ flexWrap: "nowrap" }}>
              <input type="checkbox" checked={lease.agreedCategories.includes(c.no)} onChange={() => toggle(c.no)} />
              {c.no}. {c.label}
            </label>
          ))}
        </div>
      </div>
      <label className="field">
        Sonstige Betriebskosten (§ 2 Nr. 17 BetrKV), je Zeile eine – nur was namentlich im Vertrag steht
        <textarea
          rows={4}
          value={lease.otherCosts.join("\n")}
          onChange={(e) => set({ otherCosts: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
          placeholder={"z. B.\nDachrinnenreinigung\nWartung der Rauchwarnmelder"}
        />
      </label>
      <div className="grid">
        <label className="field">
          Umlagemaßstab
          <select value={lease.allocationRule} onChange={(e) => set({ allocationRule: e.target.value as LeaseAgreement["allocationRule"] })}>
            {Object.entries(ALLOCATION_RULE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Fälligkeit Nachzahlung/Guthaben
          <select value={lease.paymentTerm} onChange={(e) => set({ paymentTerm: e.target.value as LeaseAgreement["paymentTerm"] })}>
            <option value="30days">innerhalb von 30 Tagen nach Zugang</option>
            <option value="endOfNextMonth">bis Ende des Folgemonats nach Zugang</option>
          </select>
        </label>
      </div>
      <label className="row small">
        <input type="checkbox" checked={lease.propertyTaxIndividual} onChange={(e) => set({ propertyTaxIndividual: e.target.checked })} />
        Grundsteuer in Höhe des Bescheids für die Wohnung
      </label>
      <p className="hint" style={{ margin: 0 }}>
        Bei „Verbrauch, im Übrigen Miteigentumsanteile“ rechnet die App Positionen, die die WEG nach einem anderen Schlüssel verteilt (z. B. Wohneinheiten oder
        Gruppen), auf Miteigentumsanteile um. Heizkosten folgen immer der Heizkostenabrechnung.
      </p>
    </div>
  );
}
