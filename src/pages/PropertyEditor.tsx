import { useState, type ReactNode } from "react";
import { NumberInput, type PageProps } from "../components/ui";
import { depreciationRate } from "../lib/finance";
import { estimatePropertyTax, impliedRate, propertyTaxStart } from "../lib/propertyTax";
import { formatEUR, formatNum, formatPct } from "../lib/format";
import { newProperty, PROPERTY_TYPE_LABELS, uid } from "../lib/model";
import type { AcquisitionType, Loan, Property, PropertyType, Unit, Withdrawal } from "../lib/types";
import { formatDate, todayISO } from "../lib/dates";

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {label}
      {children}
      {hint && <span className="small" style={{ color: "var(--muted)" }}>{hint}</span>}
    </label>
  );
}

export default function PropertyEditor({ data, update, propertyId }: PageProps & { propertyId: string | null }) {
  const existing = propertyId ? data.properties.find((p) => p.id === propertyId) : undefined;
  const [p, setP] = useState<Property>(() => (existing ? structuredClone(existing) : newProperty()));
  if (propertyId && !existing) return <div className="card empty">Objekt nicht gefunden.</div>;

  const set = (patch: Partial<Property>) => setP((x) => ({ ...x, ...patch }));
  const setUnit = (id: string, patch: Partial<Unit>) => set({ units: p.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  const setLoan = (id: string, patch: Partial<Loan>) => set({ loans: p.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)) });

  const totalArea = p.units.reduce((a, u) => a + u.area, 0);
  const invested = p.purchasePrice + p.transferTax + p.notaryCosts + p.brokerFee;
  const valid = p.name.trim() && p.units.length > 0 && p.units.every((u) => u.name.trim() && u.area > 0);
  const back = existing ? `#/objekte/${p.id}` : "#/";

  const save = () => {
    update((d) => ({
      ...d,
      properties: d.properties.some((x) => x.id === p.id) ? d.properties.map((x) => (x.id === p.id ? p : x)) : [...d.properties, p],
    }));
    window.location.hash = `#/objekte/${p.id}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <a href={back} className="small">← zurück</a>
          <h1>{existing ? `${existing.name} bearbeiten` : "Neues Objekt"}</h1>
        </div>
        <div className="row">
          <a className="btn" href={back}>Abbrechen</a>
          <button className="primary" disabled={!valid} onClick={save}>Speichern</button>
        </div>
      </div>

      <div className="card">
        <h2>Allgemein</h2>
        <div className="grid">
          <Field label="Bezeichnung">
            <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. Lindenstraße 5" autoFocus />
          </Field>
          <Field label="Anschrift">
            <input value={p.address} onChange={(e) => set({ address: e.target.value })} placeholder="Lindenstraße 5, 12345 Musterstadt" />
          </Field>
          <Field label="Art des Objekts" hint={p.type === "etw" ? "Die Betriebskosten kommen meist aus der Hausgeldabrechnung der WEG." : undefined}>
            <select value={p.type} onChange={(e) => set({ type: e.target.value as PropertyType })}>
              {Object.entries(PROPERTY_TYPE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Baujahr (Fertigstellung)"
            hint={`Abschreibung (AfA) ${formatPct(depreciationRate(p.yearBuilt))} p. a. nach § 7 Abs. 4 EStG`}
          >
            <input
              type="number"
              min={1800}
              max={2100}
              value={p.yearBuilt ?? ""}
              onChange={(e) => set({ yearBuilt: e.target.value ? Math.round(Number(e.target.value)) : null })}
              placeholder="z. B. 1985"
            />
          </Field>
        </div>
      </div>

      {p.type === "etw" && (
        <div className="card">
          <h2>Wohnungseigentümergemeinschaft</h2>
          <p className="hint">Steht in der Teilungserklärung und auf jeder Jahresabrechnung. Ohne abweichende Vereinbarung im Mietvertrag gilt für die Umlage der Schlüssel der WEG (§ 556a Abs. 3 BGB).</p>
          <div className="grid">
            <Field label="Hausverwaltung">
              <input value={p.wegManager} onChange={(e) => set({ wegManager: e.target.value })} />
            </Field>
            <Field label="Anzahl Einheiten der WEG">
              <NumberInput value={p.wegUnitsCount ?? undefined} onChange={(n) => set({ wegUnitsCount: n || null })} />
            </Field>
            <Field label="Miteigentumsanteile gesamt (Nenner)" hint="z. B. 1.000 oder 10.000">
              <NumberInput value={p.wegMeaTotal ?? undefined} onChange={(n) => set({ wegMeaTotal: n || null })} />
            </Field>
            <Field label="Wohnfläche der WEG gesamt (m²)" hint="für die CO2-Einstufung und Plausibilitätsprüfungen">
              <NumberInput value={p.wegAreaTotal ?? undefined} onChange={(n) => set({ wegAreaTotal: n || null })} />
            </Field>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Wohneinheiten</h2>
        <p className="hint">Die Wohnfläche ist der Regel-Umlageschlüssel (§ 556a BGB). Lege auch selbst genutzte Wohnungen an, damit ihr Kostenanteil bei dir bleibt.</p>
        <div className="table-wrap">
          <table className="compact">
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th className="num">Wohnfläche (m²)</th>
                {p.type === "etw" && <th className="num">MEA</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {p.units.map((u) => (
                <tr key={u.id}>
                  <td><input value={u.name} onChange={(e) => setUnit(u.id, { name: e.target.value })} aria-label="Bezeichnung der Einheit" /></td>
                  <td style={{ width: 170 }}><NumberInput value={u.area} onChange={(area) => setUnit(u.id, { area })} ariaLabel="Wohnfläche" /></td>
                  {p.type === "etw" && (
                    <td style={{ width: 120 }}>
                      <NumberInput value={u.mea} onChange={(mea) => setUnit(u.id, { mea: mea || undefined })} ariaLabel="Miteigentumsanteil" />
                    </td>
                  )}
                  <td style={{ width: 40 }}>
                    <button
                      className="ghost"
                      disabled={data.tenants.some((t) => t.unitId === u.id)}
                      title={data.tenants.some((t) => t.unitId === u.id) ? "Einheit hat Mieter" : "Einheit entfernen"}
                      onClick={() => set({ units: p.units.filter((x) => x.id !== u.id) })}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{p.units.length} Einheiten</td>
                <td className="num">{formatNum(totalArea)} m²</td>
                {p.type === "etw" && <td className="num">{p.wegMeaTotal ? `von ${formatNum(p.wegMeaTotal)}` : ""}</td>}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <button onClick={() => set({ units: [...p.units, { id: uid(), name: `Wohnung ${p.units.length + 1}`, area: 0 }] })}>+ Einheit</button>
      </div>

      <div className="card">
        <h2>Erwerb</h2>
        <p className="hint">Grundlage für Vermögensentwicklung, Rendite und Abschreibung.</p>
        <AcquisitionFields p={p} set={set} />
        <div className="grid" style={{ marginTop: 12 }}>
          <Field label="Anteil Grund und Boden (%)" hint="Nicht abschreibbar. Steht im Kaufvertrag oder lässt sich mit der Arbeitshilfe des BMF ermitteln.">
            <NumberInput value={p.landShare} onChange={(landShare) => set({ landShare: Math.min(100, Math.max(0, landShare)) })} />
          </Field>
        </div>
        {invested > 0 && (
          <p className="small" style={{ marginTop: 12 }}>
            Einstand gesamt: <strong>{formatEUR(invested)}</strong> · davon abschreibbar (Gebäude): {formatEUR(invested * (1 - p.landShare / 100))}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Grundsteuer</h2>
        <p className="hint">
          Der Grundsteuerwert steht im Feststellungsbescheid des Finanzamts, der Hebesatz in der Satzung bzw. im Grundsteuerbescheid der Gemeinde. Daraus schätzt die App die
          Jahressteuer zur Kontrolle – umgelegt wird immer der Betrag aus dem Bescheid der Gemeinde.
        </p>
        <div className="grid">
          <Field label="Grundsteuerwert (€)">
            <NumberInput value={p.propertyTaxValue ?? undefined} onChange={(v) => set({ propertyTaxValue: v || null })} />
          </Field>
          <Field label="Hebesatz der Gemeinde (%)" hint="Grundsteuer B, ggf. Satz für Wohngrundstücke">
            <NumberInput value={p.propertyTaxRate ?? undefined} onChange={(v) => set({ propertyTaxRate: v || null })} />
          </Field>
          <div>
            <div className="muted small">Geschätzte Grundsteuer pro Jahr</div>
            <div className="kpi-value">{estimatePropertyTax(p) ? formatEUR(estimatePropertyTax(p)!.tax) : "–"}</div>
            {estimatePropertyTax(p) && <div className="small muted">Messbetrag {formatEUR(estimatePropertyTax(p)!.baseAmount)} (× 0,31 ‰)</div>}
          </div>
        </div>
        <h3 style={{ marginTop: 16 }}>Bescheid der Gemeinde (Grundbesitzabgaben)</h3>
        <div className="grid">
          <Field label="Grundsteuer B laut Bescheid (€ pro Jahr)" hint="gilt vor der Schätzung – für Vermögensentwicklung, Prognose und Kontrolle der Abrechnung">
            <NumberInput value={p.propertyTaxAnnual ?? undefined} onChange={(v) => set({ propertyTaxAnnual: v || null })} />
          </Field>
          <Field label="Müllgebühr laut Bescheid (€ pro Jahr)" hint="falls die Stadt sie dir berechnet; umlegbar als Müllbeseitigung (Nr. 8)">
            <NumberInput value={p.wasteFeeAnnual ?? undefined} onChange={(v) => set({ wasteFeeAnnual: v || null })} />
          </Field>
          <Field label="trägst du ab" hint="leer: 1. Januar nach dem Erwerb – Schuldner ist, wer am 1. Januar Eigentümer ist (§ 9 GrStG)">
            <input type="date" value={p.propertyTaxFrom ?? ""} onChange={(e) => set({ propertyTaxFrom: e.target.value || null })} />
          </Field>
          <div>
            <div className="muted small">zusammen pro Monat</div>
            <div className="kpi-value">{p.propertyTaxAnnual || p.wasteFeeAnnual ? formatEUR(((p.propertyTaxAnnual ?? 0) + (p.wasteFeeAnnual ?? 0)) / 12) : "–"}</div>
            {!p.propertyTaxFrom && propertyTaxStart(p) && <div className="small muted">ab {formatDate(propertyTaxStart(p)!)}</div>}
          </div>
        </div>
        {(() => {
          const est = estimatePropertyTax(p);
          const rate = impliedRate(p);
          if (!p.propertyTaxAnnual || !est || Math.abs(p.propertyTaxAnnual - est.tax) <= Math.max(5, est.tax * 0.05)) return null;
          return (
            <div className="alert warn small" style={{ marginTop: 12 }}>
              Der Bescheid ({formatEUR(p.propertyTaxAnnual)}) weicht von der Schätzung ({formatEUR(est.tax)}) ab
              {rate ? `; rechnerisch entspräche das einem Hebesatz von ${rate.toFixed(0)} %` : ""}. Prüfe, ob der Betrag weitere Abgaben enthält (in NRW oft als
              Grundbesitzabgabenbescheid mit Abfall- oder Straßenreinigungsgebühren). Trage Müll im eigenen Feld ein – er ist eine eigene Kostenart.
            </div>
          );
        })()}
      </div>

      <div className="card">
        <h2>Entnahmen vom Mietkonto</h2>
        <p className="hint">
          Regelmäßige Überweisungen vom Mietkonto auf dein privates Konto. Sie mindern den Vermögenswert des Objekts (das Geld liegt danach privat) und haben steuerlich keine
          Bedeutung.
        </p>
        {(p.withdrawals ?? []).length > 0 && (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>ab (erste Entnahme)</th>
                  <th>bis</th>
                  <th className="num">pro Monat (€)</th>
                  <th>Notiz</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(p.withdrawals ?? []).map((w) => {
                  const setW = (patch: Partial<Withdrawal>) => set({ withdrawals: (p.withdrawals ?? []).map((x) => (x.id === w.id ? { ...x, ...patch } : x)) });
                  return (
                    <tr key={w.id}>
                      <td>
                        <input type="date" aria-label="erste Entnahme" value={w.from} onChange={(e) => setW({ from: e.target.value })} />
                      </td>
                      <td>
                        <input type="date" aria-label="letzte Entnahme" value={w.to ?? ""} onChange={(e) => setW({ to: e.target.value || null })} />
                      </td>
                      <td className="num">
                        <NumberInput ariaLabel="Betrag pro Monat" value={w.monthly} onChange={(monthly) => setW({ monthly })} />
                      </td>
                      <td>
                        <input aria-label="Notiz" value={w.note} onChange={(e) => setW({ note: e.target.value })} />
                      </td>
                      <td>
                        <button className="ghost" onClick={() => set({ withdrawals: (p.withdrawals ?? []).filter((x) => x.id !== w.id) })}>
                          Entfernen
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <button
          style={{ marginTop: 8 }}
          onClick={() => set({ withdrawals: [...(p.withdrawals ?? []), { id: uid(), from: todayISO(), to: null, monthly: 0, note: "" }] })}
        >
          + Entnahme
        </button>
      </div>

      <div className="card">
        <h2>Finanzierung</h2>
        <p className="hint">Restschuld und Rate stehen im letzten Kontoauszug des Darlehens. Die Zinsen sind Werbungskosten, die Tilgung nicht.</p>
        {p.loans.length > 0 && (
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th className="num">Darlehen (€)</th>
                  <th className="num">Restschuld (€)</th>
                  <th className="num">Zins (% p. a.)</th>
                  <th className="num">Rate / Monat (€)</th>
                  <th>Zinsbindung bis</th>
                  <th>Auszahlung</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.loans.map((l) => (
                  <tr key={l.id}>
                    <td style={{ minWidth: 130 }}><input value={l.lender} onChange={(e) => setLoan(l.id, { lender: e.target.value })} aria-label="Bank" /></td>
                    <td style={{ minWidth: 110 }}><NumberInput value={l.principal} onChange={(principal) => setLoan(l.id, { principal })} ariaLabel="Darlehensbetrag" /></td>
                    <td style={{ minWidth: 110 }}><NumberInput value={l.balance} onChange={(balance) => setLoan(l.id, { balance })} ariaLabel="Restschuld" /></td>
                    <td style={{ minWidth: 80 }}><NumberInput value={l.interestRate} onChange={(interestRate) => setLoan(l.id, { interestRate })} ariaLabel="Zinssatz" /></td>
                    <td style={{ minWidth: 100 }}><NumberInput value={l.monthlyPayment} onChange={(monthlyPayment) => setLoan(l.id, { monthlyPayment })} ariaLabel="Monatsrate" /></td>
                    <td><input type="date" value={l.fixedUntil ?? ""} onChange={(e) => setLoan(l.id, { fixedUntil: e.target.value || null })} aria-label="Zinsbindung bis" /></td>
                    <td><input type="date" value={l.startDate ?? ""} onChange={(e) => setLoan(l.id, { startDate: e.target.value || null })} aria-label="Auszahlung bzw. Übernahme" /></td>
                    <td><button className="ghost" onClick={() => set({ loans: p.loans.filter((x) => x.id !== l.id) })} aria-label="Darlehen entfernen">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          onClick={() =>
            set({ loans: [...p.loans, { id: uid(), lender: "", principal: 0, balance: 0, interestRate: 0, monthlyPayment: 0, fixedUntil: null, startDate: p.purchaseDate }] })
          }
        >
          + Darlehen
        </button>
      </div>

      <div className="card">
        <h2>Laufende Kosten, die du selbst trägst</h2>
        <p className="hint">Diese Kosten sind nicht auf die Mieter umlegbar und mindern deine Rendite. Umlagefähige Betriebskosten erfasst du in der jährlichen Abrechnung.</p>
        <div className="grid">
          {p.type === "etw" && (
            <>
              <Field label="Hausgeld gesamt / Monat (€)" hint="laut aktuellem Wirtschaftsplan der WEG">
                <NumberInput value={p.hausgeldMonthly} onChange={(hausgeldMonthly) => set({ hausgeldMonthly })} />
              </Field>
              <Field label="davon Verwaltervergütung / Monat (€)" hint="nicht umlagefähig, steuerlich abziehbar">
                <NumberInput value={p.hausgeldManagementMonthly} onChange={(hausgeldManagementMonthly) => set({ hausgeldManagementMonthly })} />
              </Field>
              <Field label="davon Erhaltungsrücklage / Monat (€)" hint="nicht umlagefähig, steuerlich erst bei Verwendung abziehbar">
                <NumberInput value={p.hausgeldReserveMonthly} onChange={(hausgeldReserveMonthly) => set({ hausgeldReserveMonthly })} />
              </Field>
            </>
          )}
          <Field label="Instandhaltung / Reparaturen p. a. (€)" hint={p.type === "etw" ? "für dein Sondereigentum" : "Faustwert: 10–15 € je m² Wohnfläche"}>
            <NumberInput value={p.maintenanceAnnual} onChange={(maintenanceAnnual) => set({ maintenanceAnnual })} />
          </Field>
          <Field label="Verwaltung p. a. (€)" hint={p.type === "etw" ? "z. B. Sondereigentumsverwaltung" : "Hausverwaltung, Kontoführung"}>
            <NumberInput value={p.managementAnnual} onChange={(managementAnnual) => set({ managementAnnual })} />
          </Field>
          <Field label="Sonstige Kosten p. a. (€)" hint="z. B. Rechtsschutz, Fahrtkosten, Leerstandskosten">
            <NumberInput value={p.otherCostsAnnual} onChange={(otherCostsAnnual) => set({ otherCostsAnnual })} />
          </Field>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        {!valid && <span className="small muted">Bezeichnung und Wohnfläche aller Einheiten sind Pflicht.</span>}
        <a className="btn" href={back}>Abbrechen</a>
        <button className="primary" disabled={!valid} onClick={save}>Speichern</button>
      </div>
    </>
  );
}

export const ACQUISITION_OPTIONS: { value: AcquisitionType; label: string; text: string }[] = [
  { value: "purchase", label: "Kauf", text: "Du hast das Objekt gekauft." },
  { value: "gift", label: "Schenkung", text: "Du hast das Objekt geschenkt bekommen, z. B. von den Eltern." },
  { value: "inheritance", label: "Erbschaft", text: "Du hast das Objekt geerbt." },
];

/** Angaben zum Erwerb – je nach Art (Kauf, Schenkung, Erbschaft) */
export function AcquisitionFields({ p, set }: { p: Property; set: (patch: Partial<Property>) => void }) {
  const type = p.acquisitionType ?? "purchase";
  const free = type !== "purchase";
  return (
    <div className="stack">
      <div className="choice-row">
        {ACQUISITION_OPTIONS.map((o) => (
          <button key={o.value} type="button" className={`choice ${type === o.value ? "selected" : ""}`} onClick={() => set({ acquisitionType: o.value })}>
            <strong>{o.label}</strong>
            <span className="small muted">{o.text}</span>
          </button>
        ))}
      </div>
      <div className="grid">
        <Field label={free ? `Datum der ${type === "gift" ? "Schenkung" : "Erbschaft"} (Übergang Nutzen/Lasten)` : "Kaufdatum (Übergang Nutzen/Lasten)"}>
          <input type="date" value={p.purchaseDate ?? ""} onChange={(e) => set({ purchaseDate: e.target.value || null })} />
        </Field>
        <Field
          label={free ? "Verkehrswert zum Erwerbszeitpunkt (€)" : "Kaufpreis (€)"}
          hint={free ? "z. B. Wert laut Schenkungsvertrag oder Gutachten; ersatzweise der Grundsteuerwert als Untergrenze" : undefined}
        >
          <NumberInput value={p.purchasePrice || undefined} onChange={(purchasePrice) => set({ purchasePrice })} />
        </Field>
        <Field label={free ? `${type === "gift" ? "Schenkung" : "Erbschaft"}steuer (€)` : "Grunderwerbsteuer (€)"} hint={free ? "oft 0 € dank Freibetrag (Kinder: 400.000 €)" : "3,5–6,5 % je nach Bundesland"}>
          <NumberInput value={p.transferTax} onChange={(transferTax) => set({ transferTax })} />
        </Field>
        <Field label="Notar und Grundbuch (€)" hint="nur Eigentumserwerb, ohne Grundschuld">
          <NumberInput value={p.notaryCosts} onChange={(notaryCosts) => set({ notaryCosts })} />
        </Field>
        {!free && (
          <Field label="Maklerprovision (€)">
            <NumberInput value={p.brokerFee} onChange={(brokerFee) => set({ brokerFee })} />
          </Field>
        )}
      </div>
      {free && (
        <div className="grid">
          <Field
            label="Grundsteuerwert (€)"
            hint="aus dem Feststellungsbescheid des Finanzamts (Stichtag 01.01.2022) – auch für die Grundsteuer-Kontrolle"
          >
            <NumberInput value={p.propertyTaxValue ?? undefined} onChange={(v) => set({ propertyTaxValue: v || null })} />
          </Field>
          <div className="stack">
            {!!p.propertyTaxValue && p.purchasePrice !== p.propertyTaxValue && (
              <button type="button" className="btn" onClick={() => set({ purchasePrice: p.propertyTaxValue! })}>
                Grundsteuerwert als Verkehrswert übernehmen
              </button>
            )}
            {!!p.propertyTaxValue && p.purchasePrice === p.propertyTaxValue && (
              <p className="hint">
                Als Startwert wird der Grundsteuerwert verwendet. Er ist ein pauschal ermittelter Wert und liegt meist unter dem Marktwert – trage unter „Aktueller Wert“
                eine realistische Schätzung ein, sobald du eine hast.
              </p>
            )}
          </div>
        </div>
      )}
      {free && (
        <div className="grid">
          <Field
            label={`Anschaffungskosten ${type === "gift" ? "des Schenkers" : "des Erblassers"} (€)`}
            hint="Kaufpreis + Nebenkosten bei deren Erwerb. Du führst deren Abschreibung fort (§ 11d EStDV) – weder der Wert bei Schenkung noch der Grundsteuerwert zählen dafür."
          >
            <NumberInput value={p.predecessorCost ?? undefined} onChange={(v) => set({ predecessorCost: v || null })} />
          </Field>
          <Field label="deren Erwerbsjahr" hint="bestimmt, wie lange die Abschreibung noch läuft">
            <input
              type="number"
              value={p.predecessorYear ?? ""}
              onChange={(e) => set({ predecessorYear: e.target.value ? Math.round(Number(e.target.value)) : null })}
              placeholder="z. B. 2009"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
