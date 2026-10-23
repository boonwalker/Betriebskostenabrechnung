import { useState } from "react";
import { NumberInput, type PageProps } from "../components/ui";
import { todayISO } from "../lib/dates";
import { depreciationRate } from "../lib/finance";
import { formatEUR, formatPct } from "../lib/format";
import { newProperty, portfolioOn, PROPERTY_TYPE_LABELS, uid } from "../lib/model";
import type { Loan, Property, PropertyType } from "../lib/types";
import { AcquisitionFields, Field } from "./PropertyEditor";

type StepKey = "objekt" | "erwerb" | "finanzierung" | "wohnungen" | "kosten" | "wert";
const STEP_LABELS: Record<StepKey, string> = {
  objekt: "Objekt",
  erwerb: "Erwerb",
  finanzierung: "Finanzierung",
  wohnungen: "Wohnungen",
  kosten: "Laufende Kosten",
  wert: "Aktueller Wert",
};
const ALL_STEPS: StepKey[] = ["objekt", "erwerb", "finanzierung", "wohnungen", "kosten", "wert"];
/** Was die Betriebskostenabrechnung braucht – der Rest dient nur Vermögen, Rendite und Finanzierung */
const BASIC_STEPS: StepKey[] = ["objekt", "wohnungen"];

/**
 * Geführte Anlage eines neuen Objekts: fragt nacheinander alles ab, was für Vermögensentwicklung,
 * Rendite, Abschreibung und Betriebskostenabrechnung gebraucht wird. Die Vermögensangaben lassen sich überspringen;
 * ohne Portfolio fragt der Assistent nur Objekt und Wohnungen ab.
 */
export default function PropertyWizard({ data, update }: PageProps) {
  const portfolio = portfolioOn(data.settings);
  // nur Objekt und Wohnungen abfragen (ohne Portfolio oder nach „alle Vermögensangaben überspringen“)
  const [basic, setBasic] = useState(!portfolio);
  const steps = basic ? BASIC_STEPS : ALL_STEPS;
  const [p, setP] = useState<Property>(() => ({ ...newProperty(), acquisitionType: "purchase" }));
  const [step, setStep] = useState(0);
  const [hasLoan, setHasLoan] = useState<boolean | null>(null);
  const [currentValue, setCurrentValue] = useState(0);
  const set = (patch: Partial<Property>) => setP((x) => ({ ...x, ...patch }));
  const setLoan = (id: string, patch: Partial<Loan>) => set({ loans: p.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const free = (p.acquisitionType ?? "purchase") !== "purchase";

  const key = steps[step];
  const valid: Record<StepKey, boolean> = {
    objekt: p.name.trim().length > 0,
    erwerb: !!p.purchaseDate && p.purchasePrice > 0,
    finanzierung:
      hasLoan === false || (hasLoan === true && p.loans.length > 0 && p.loans.every((l) => l.principal > 0 && l.monthlyPayment > 0 && l.startDate)),
    wohnungen: p.units.length > 0 && p.units.every((u) => u.name.trim() && u.area > 0),
    kosten: true,
    wert: true,
  };
  const last = step === steps.length - 1;
  const wealthStep = key === "erwerb" || key === "finanzierung" || key === "kosten" || key === "wert";

  /** Schritt ohne Angaben verlassen: Unvollständiges wird verworfen, später unter „Objektdaten bearbeiten“ nachtragbar */
  const skip = () => {
    if (key === "erwerb" && !valid.erwerb) set({ purchaseDate: null, purchasePrice: 0 });
    if (key === "finanzierung") setHasLoan(false);
    if (key === "wert") setCurrentValue(0);
    if (last) finish(key === "wert" ? 0 : currentValue);
    else setStep(step + 1);
  };

  /** Alle Vermögensangaben überspringen: weiter mit den Wohnungen, danach anlegen */
  const skipAll = () => {
    if (!valid.erwerb) set({ purchaseDate: null, purchasePrice: 0 });
    setHasLoan(false);
    setCurrentValue(0);
    setBasic(true);
    setStep(BASIC_STEPS.indexOf("wohnungen"));
  };

  function finish(value = currentValue) {
    const today = todayISO();
    const valuations = value > 0 ? [{ id: uid(), date: today, value, note: "bei Anlage geschätzt" }] : [];
    // Ohne eingetragene Restschuld gilt zunächst der Darlehensbetrag; der Verlauf folgt dem Tilgungsplan
    const loans = hasLoan ? p.loans.map((l) => ({ ...l, balance: l.balance || l.principal })) : [];
    const saved = { ...p, loans, valuations };
    update((d) => ({ ...d, properties: [...d.properties, saved] }));
    window.location.hash = `#/objekte/${saved.id}`;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/" className="small">← {portfolio ? "Portfolio" : "Objekte"}</a>
          <h1>Neues Objekt</h1>
        </div>
      </div>
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <span key={s} className={i === step ? "active" : i < step ? "done" : ""}>
            {i + 1}. {STEP_LABELS[s]}
          </span>
        ))}
      </div>

      <div className="card stack">
        {key === "objekt" && (
          <>
            <h2>Um welches Objekt geht es?</h2>
            <div className="choice-row">
              {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((t) => (
                <button key={t} type="button" className={`choice ${p.type === t ? "selected" : ""}`} onClick={() => set({ type: t })}>
                  <strong>{PROPERTY_TYPE_LABELS[t]}</strong>
                </button>
              ))}
            </div>
            <div className="grid">
              <Field label="Bezeichnung">
                <input value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder="z. B. ETW Lindenstraße" autoFocus />
              </Field>
              <Field label="Anschrift">
                <input value={p.address} onChange={(e) => set({ address: e.target.value })} placeholder="Straße Nr., PLZ Ort" />
              </Field>
              <Field label="Baujahr (Fertigstellung)" hint={basic ? "optional" : `Abschreibung ${formatPct(depreciationRate(p.yearBuilt))} p. a.`}>
                <input
                  type="number"
                  value={p.yearBuilt ?? ""}
                  onChange={(e) => set({ yearBuilt: e.target.value ? Math.round(Number(e.target.value)) : null })}
                  placeholder="z. B. 2008"
                />
              </Field>
            </div>
          </>
        )}

        {key === "erwerb" && (
          <>
            <h2>Wie hast du das Objekt erworben?</h2>
            <p className="hint">Ab diesem Datum und Wert rechnet die App deine Vermögensentwicklung – wie den Einstand einer Aktie im Depot.</p>
            <AcquisitionFields p={p} set={set} />
            <div className="grid">
              <Field label="Anteil Grund und Boden (%)" hint="nicht abschreibbar; steht im Kaufvertrag oder lässt sich mit der Arbeitshilfe des BMF ermitteln">
                <NumberInput value={p.landShare} onChange={(landShare) => set({ landShare: Math.min(100, Math.max(0, landShare)) })} />
              </Field>
            </div>
          </>
        )}

        {key === "finanzierung" && (
          <>
            <h2>{free ? "Hast du ein Darlehen übernommen oder aufgenommen?" : "Wie hast du den Kauf finanziert?"}</h2>
            <div className="choice-row">
              <button type="button" className={`choice ${hasLoan === false ? "selected" : ""}`} onClick={() => setHasLoan(false)}>
                <strong>{free ? "Kein Darlehen" : "Ohne Darlehen"}</strong>
                <span className="small muted">{free ? "Das Objekt ist schuldenfrei." : "Komplett aus Eigenkapital bezahlt."}</span>
              </button>
              <button
                type="button"
                className={`choice ${hasLoan === true ? "selected" : ""}`}
                onClick={() => {
                  setHasLoan(true);
                  if (p.loans.length === 0) {
                    set({ loans: [{ id: uid(), lender: "", principal: 0, balance: 0, interestRate: 0, monthlyPayment: 0, fixedUntil: null, startDate: p.purchaseDate }] });
                  }
                }}
              >
                <strong>Mit Darlehen</strong>
                <span className="small muted">Die App rechnet den Tilgungsverlauf Monat für Monat.</span>
              </button>
            </div>
            {hasLoan &&
              p.loans.map((l, i) => (
                <div key={l.id} className="card" style={{ marginBottom: 0 }}>
                  <div className="row">
                    <h3 style={{ margin: 0 }}>Darlehen {i + 1}</h3>
                    <span className="spacer" />
                    {p.loans.length > 1 && (
                      <button className="ghost" onClick={() => set({ loans: p.loans.filter((x) => x.id !== l.id) })}>Entfernen</button>
                    )}
                  </div>
                  <div className="grid" style={{ marginTop: 8 }}>
                    <Field label="Bank">
                      <input value={l.lender} onChange={(e) => setLoan(l.id, { lender: e.target.value })} />
                    </Field>
                    <Field label={free ? "Betrag bei Übernahme (€)" : "Darlehensbetrag (€)"}>
                      <NumberInput value={l.principal || undefined} onChange={(principal) => setLoan(l.id, { principal })} />
                    </Field>
                    <Field label={free ? "Übernommen am" : "Auszahlung am"}>
                      <input type="date" value={l.startDate ?? ""} onChange={(e) => setLoan(l.id, { startDate: e.target.value || null })} />
                    </Field>
                    <Field label="Sollzins (% p. a.)">
                      <NumberInput value={l.interestRate || undefined} onChange={(interestRate) => setLoan(l.id, { interestRate })} />
                    </Field>
                    <Field label="Monatliche Rate (€)" hint="Zins + Tilgung">
                      <NumberInput value={l.monthlyPayment || undefined} onChange={(monthlyPayment) => setLoan(l.id, { monthlyPayment })} />
                    </Field>
                    <Field label="Zinsbindung bis">
                      <input type="date" value={l.fixedUntil ?? ""} onChange={(e) => setLoan(l.id, { fixedUntil: e.target.value || null })} />
                    </Field>
                    <Field label="Aktuelle Restschuld (€, optional)" hint="laut letztem Kontoauszug; sonst rechnet die App sie aus">
                      <NumberInput value={l.balance || undefined} onChange={(balance) => setLoan(l.id, { balance })} />
                    </Field>
                  </div>
                  {l.principal > 0 && l.interestRate > 0 && l.monthlyPayment > 0 && (
                    <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
                      Anfängliche Tilgung: {formatPct(((l.monthlyPayment * 12) - (l.principal * l.interestRate) / 100) / l.principal)} p. a. · Zinsen im ersten Monat{" "}
                      {formatEUR((l.principal * l.interestRate) / 1200)}
                    </p>
                  )}
                </div>
              ))}
            {hasLoan && (
              <button
                onClick={() =>
                  set({ loans: [...p.loans, { id: uid(), lender: "", principal: 0, balance: 0, interestRate: 0, monthlyPayment: 0, fixedUntil: null, startDate: p.purchaseDate }] })
                }
              >
                + weiteres Darlehen
              </button>
            )}
          </>
        )}

        {key === "wohnungen" && (
          <>
            <h2>Welche Wohnungen gehören dazu?</h2>
            <p className="hint">Die Wohnfläche ist Grundlage der Umlage. Bei einer Eigentumswohnung zusätzlich der Miteigentumsanteil laut Teilungserklärung.</p>
            {p.units.map((u) => (
              <div className="grid" key={u.id}>
                <Field label="Bezeichnung">
                  <input value={u.name} onChange={(e) => set({ units: p.units.map((x) => (x.id === u.id ? { ...x, name: e.target.value } : x)) })} />
                </Field>
                <Field label="Wohnfläche (m²)">
                  <NumberInput value={u.area || undefined} onChange={(area) => set({ units: p.units.map((x) => (x.id === u.id ? { ...x, area } : x)) })} />
                </Field>
                {p.type === "etw" && (
                  <Field label="Miteigentumsanteil (Zähler)" hint="z. B. 49 bei 49/1.000">
                    <NumberInput value={u.mea} onChange={(mea) => set({ units: p.units.map((x) => (x.id === u.id ? { ...x, mea: mea || undefined } : x)) })} />
                  </Field>
                )}
              </div>
            ))}
            {p.type !== "etw" && <button onClick={() => set({ units: [...p.units, { id: uid(), name: `Wohnung ${p.units.length + 1}`, area: 0 }] })}>+ Wohnung</button>}
            {p.type === "etw" && (
              <div className="grid">
                <Field label="Hausverwaltung">
                  <input value={p.wegManager} onChange={(e) => set({ wegManager: e.target.value })} />
                </Field>
                <Field label="Einheiten der WEG">
                  <NumberInput value={p.wegUnitsCount ?? undefined} onChange={(n) => set({ wegUnitsCount: n || null })} />
                </Field>
                <Field label="Miteigentumsanteile gesamt">
                  <NumberInput value={p.wegMeaTotal ?? undefined} onChange={(n) => set({ wegMeaTotal: n || null })} />
                </Field>
                <Field label="Wohnfläche der WEG gesamt (m²)">
                  <NumberInput value={p.wegAreaTotal ?? undefined} onChange={(n) => set({ wegAreaTotal: n || null })} />
                </Field>
              </div>
            )}
          </>
        )}

        {key === "kosten" && (
          <>
            <h2>Welche laufenden Kosten trägst du?</h2>
            <p className="hint">Diese Beträge gehen jeden Monat von deinem Cashflow ab. Umlagefähige Kosten bezahlen deine Mieter über die Vorauszahlungen.</p>
            <div className="grid">
              {p.type === "etw" && (
                <>
                  <Field label="Hausgeld gesamt / Monat (€)" hint="laut Wirtschaftsplan">
                    <NumberInput value={p.hausgeldMonthly || undefined} onChange={(hausgeldMonthly) => set({ hausgeldMonthly })} />
                  </Field>
                  <Field label="davon Verwaltervergütung / Monat (€)">
                    <NumberInput value={p.hausgeldManagementMonthly || undefined} onChange={(v) => set({ hausgeldManagementMonthly: v })} />
                  </Field>
                  <Field label="davon Erhaltungsrücklage / Monat (€)">
                    <NumberInput value={p.hausgeldReserveMonthly || undefined} onChange={(v) => set({ hausgeldReserveMonthly: v })} />
                  </Field>
                </>
              )}
              <Field label="Instandhaltung p. a. (€)" hint={p.type === "etw" ? "für dein Sondereigentum" : "Faustwert 10–15 € je m²"}>
                <NumberInput value={p.maintenanceAnnual || undefined} onChange={(maintenanceAnnual) => set({ maintenanceAnnual })} />
              </Field>
              <Field label="Verwaltung p. a. (€)">
                <NumberInput value={p.managementAnnual || undefined} onChange={(managementAnnual) => set({ managementAnnual })} />
              </Field>
              <Field label="Sonstige Kosten p. a. (€)">
                <NumberInput value={p.otherCostsAnnual || undefined} onChange={(otherCostsAnnual) => set({ otherCostsAnnual })} />
              </Field>
            </div>
          </>
        )}

        {key === "wert" && (
          <>
            <h2>Was ist das Objekt heute wert?</h2>
            <p className="hint">
              Optional – z. B. aus Immobilienportalen, Bodenrichtwert oder einem Gutachten. Ohne Angabe gilt der {free ? "Wert bei Erwerb" : "Kaufpreis"} (
              {formatEUR(p.purchasePrice)}). Du kannst den Wert später jederzeit aktualisieren.
            </p>
            <div className="grid">
              <Field label="Geschätzter Marktwert heute (€)">
                <NumberInput value={currentValue || undefined} onChange={setCurrentValue} />
              </Field>
            </div>
          </>
        )}

        {wealthStep && (
          <p className="small muted wizard-skip-hint">
            Nur für Vermögen, Rendite und Finanzierung nötig – für die Betriebskostenabrechnung kannst du das{" "}
            <button type="button" className="link" onClick={skipAll}>
              alles überspringen
            </button>{" "}
            und später unter „Objektdaten bearbeiten“ nachtragen.
          </p>
        )}

        <div className="row" style={{ marginTop: 8 }}>
          {step > 0 && <button onClick={() => setStep(step - 1)}>Zurück</button>}
          <span className="spacer" />
          {!valid[key] && <span className="small muted">{key === "finanzierung" ? "Bitte auswählen und Darlehensdaten ergänzen." : "Bitte die Pflichtangaben ausfüllen."}</span>}
          {wealthStep && (
            <button className="ghost" onClick={skip}>
              Überspringen
            </button>
          )}
          {!last ? (
            <button className="primary" disabled={!valid[key]} onClick={() => setStep(step + 1)}>Weiter</button>
          ) : (
            <button className="primary" disabled={!valid[key]} onClick={() => finish()}>Objekt anlegen</button>
          )}
        </div>
      </div>
    </>
  );
}
