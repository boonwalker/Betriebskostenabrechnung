import { focusElement } from "../lib/nav";
import { useState, type ReactNode } from "react";
import { Modal, NumberInput, type PageProps } from "../components/ui";
import { HouseFloor, HouseFrame, TenantCard, TenantProfile, VacantCard } from "../components/TenantCards";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { newRentPeriod, rentAt, uid, warmRent } from "../lib/model";
import { COST_CATEGORIES } from "../lib/betrkv";
import { ALLOCATION_RULE_LABELS, defaultLease } from "../lib/lease";
import type { AppData, LeaseAgreement, RentPeriod, Tenant } from "../lib/types";
import { askConfirm } from "../components/dialog";

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
  const [viewing, setViewing] = useState<string | null>(null);
  const viewingTenant = data.tenants.find((t) => t.id === viewing) ?? null;
  const today = todayISO();

  const remove = async (t: Tenant) => {
    if (!(await askConfirm(`Mieter „${t.name}“ löschen? Tipp: Bei Auszug besser ein Auszugsdatum eintragen, damit ältere Abrechnungen stimmen.`, { confirmLabel: "Löschen", danger: true }))) return false;
    update((d) => ({ ...d, tenants: d.tenants.filter((x) => x.id !== t.id) }));
    return true;
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
          .filter((t) => t.propertyId === p.id && (showFormer || notMovedOut(t, today)))
          .sort((a, b) => b.moveIn.localeCompare(a.moveIn));
        const multiUnit = p.units.length > 1;
        return (
          <HouseFrame property={p} key={p.id}>
            {p.units.map((u) => {
              const here = tenants.filter((t) => t.unitId === u.id);
              const occupied = here.some((t) => notMovedOut(t, today));
              return (
                <HouseFloor key={u.id} label={multiUnit ? u.name : undefined}>
                  {here.map((t) => (
                    <TenantCard key={t.id} tenant={t} onOpen={() => setViewing(t.id)} />
                  ))}
                  {!occupied && <VacantCard onRent={() => setEditing(newTenant(data, p.id, u.id))} />}
                </HouseFloor>
              );
            })}
          </HouseFrame>
        );
      })}

      {viewingTenant && !editing && (
        <TenantProfile
          data={data}
          tenant={viewingTenant}
          onClose={() => setViewing(null)}
          onEdit={(focus) => {
            setEditing(structuredClone(viewingTenant));
            if (focus) focusElement(focus);
          }}
          onRemove={() => {
            void remove(viewingTenant).then((ok) => ok && setViewing(null));
          }}
        />
      )}

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

/** Noch nicht ausgezogen (auch künftige Mieter); ehemalige erscheinen nur mit „ehemalige anzeigen“ */
export const notMovedOut = (t: Tenant, today: string) => !t.moveOut || t.moveOut >= today;

/** Mieter als Spalten, Merkmale als Zeilen – bleibt auch auf dem Handy lesbar; der neueste Mieter steht vorn */
export function TenantTable({ data, tenants, onEdit, onRemove }: { data: AppData; tenants: Tenant[]; onEdit: (t: Tenant) => void; onRemove?: (t: Tenant) => void }) {
  const today = todayISO();
  const cols = [...tenants]
    .sort((a, b) => b.moveIn.localeCompare(a.moveIn))
    .map((t) => {
      const property = data.properties.find((p) => p.id === t.propertyId);
      return { t, r: rentAt(t, t.moveOut && t.moveOut < today ? t.moveOut : today), unit: property?.units.find((u) => u.id === t.unitId), former: !!t.moveOut && t.moveOut < today };
    });
  const multiUnit = new Set(cols.map((c) => c.unit?.id)).size > 1 || cols.some((c) => (data.properties.find((p) => p.id === c.t.propertyId)?.units.length ?? 0) > 1);
  const anyFormer = cols.some((c) => c.former);
  const row = (label: string, cell: (c: (typeof cols)[number]) => ReactNode, className = "num") => (
    <tr>
      <th scope="row">{label}</th>
      {cols.map((c) => (
        <td key={c.t.id} className={className}>{cell(c)}</td>
      ))}
    </tr>
  );
  return (
    <div className="table-wrap">
      <table className="transposed">
        <thead>
          <tr>
            <th />
            {cols.map(({ t, former }) => (
              <th key={t.id} scope="col" className="num">
                <span className="tenant-name">{t.name}</span>
                <span className={`badge ${former ? "neutral" : "ok"}`}>{former ? "ausgezogen" : "aktuell"}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {multiUnit && row("Einheit", (c) => c.unit?.name ?? "–")}
          {row("Einzug", (c) => formatDate(c.t.moveIn))}
          {row("Auszug", (c) => (c.t.moveOut ? formatDate(c.t.moveOut) : "–"))}
          {row("Personen", (c) => c.t.persons)}
          {row("Kaltmiete", (c) => formatEUR(c.r?.coldRent ?? 0))}
          {row("Stellplatz", (c) => formatEUR(c.r?.surcharge ?? 0))}
          {row("BK-Vorauszahlung", (c) => formatEUR(c.r?.prepaymentOperating ?? 0))}
          {row("HK-Vorauszahlung", (c) => formatEUR(c.r?.prepaymentHeating ?? 0))}
          {row("Warmmiete", (c) => <strong>{formatEUR(warmRent(c.r))}</strong>)}
          {anyFormer &&
            row(
              "Neue Anschrift",
              ({ t, former }) =>
                !former ? (
                  ""
                ) : t.mailingAddress.trim() ? (
                  <span className="small">{t.mailingAddress.trim().split("\n").map((l, i) => <div key={i}>{l}</div>)}</span>
                ) : (
                  <button
                    className="badge danger"
                    style={{ border: 0, cursor: "pointer" }}
                    onClick={() => {
                      onEdit(t);
                      focusElement("anschrift");
                    }}
                  >
                    ⚠ fehlt – eintragen
                  </button>
                ),
              "num wrap",
            )}
          <tr className="actions">
            <th />
            {cols.map(({ t }) => (
              <td key={t.id} className="num">
                <button className="ghost small" onClick={() => onEdit(t)}>Bearbeiten</button>
                {onRemove && <button className="ghost small" onClick={() => onRemove(t)} aria-label="Löschen">✕</button>}
              </td>
            ))}
          </tr>
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
          {data.properties.length > 1 && (
          <label className="field">
            Immobilie
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
          )}
          {(property?.units.length ?? 0) > 1 && (
            <label className="field">
              Wohnung im Haus
              <select value={t.unitId} onChange={(e) => setT({ ...t, unitId: e.target.value })}>
                {property?.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          )}
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
          {t.moveOut && (
            <label className="field" id="anschrift" style={{ gridColumn: "1 / -1" }}>
              Neue Postanschrift nach dem Auszug (für die Betriebskostenabrechnung)
              <textarea rows={2} value={t.mailingAddress} onChange={(e) => setT({ ...t, mailingAddress: e.target.value })} placeholder={"Straße Nr.\nPLZ Ort"} />
            </label>
          )}
          <label className="field">
            Personen im Haushalt
            <NumberInput value={t.persons} onChange={(persons) => setT({ ...t, persons })} />
          </label>
          <label className="field">
            Mietkaution (€)
            <NumberInput value={t.deposit} onChange={(deposit) => setT({ ...t, deposit })} />
          </label>
        </div>

        <div id="miete">
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
                  <th className="num">Stellplatz</th>
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
                      <NumberInput value={r.surcharge ?? 0} onChange={(surcharge) => setRent(r.id, { surcharge })} ariaLabel="Stellplatz" />
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

        <div id="vertrag">
          <LeaseSection lease={t.lease ?? null} onChange={(lease) => setT({ ...t, lease })} />
        </div>

        <div id="vermieter" className="card stack" style={{ marginBottom: 0 }}>
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

        {!t.moveOut && (
          <label className="field">
            Abweichende Postanschrift für die Abrechnung (leer = Anschrift der Wohnung)
            <textarea rows={2} value={t.mailingAddress} onChange={(e) => setT({ ...t, mailingAddress: e.target.value })} placeholder={"Straße Nr.\nPLZ Ort"} />
          </label>
        )}
        <div className="field">
          Anrede im Anschreiben
          <div className="row">
            <label className="row">
              <input type="radio" name="anrede" checked={!t.informal} onChange={() => setT({ ...t, informal: false })} /> Sie
            </label>
            <label className="row">
              <input type="radio" name="anrede" checked={!!t.informal} onChange={() => setT({ ...t, informal: true })} /> du
            </label>
          </div>
        </div>
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
        <button className="ghost" onClick={async () => (await askConfirm("Vereinbarung entfernen?", { confirmLabel: "Entfernen", danger: true })) && onChange(null)}>Entfernen</button>
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
