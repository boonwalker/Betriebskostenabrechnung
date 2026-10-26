import { useEffect, useState, type ReactNode } from "react";
import { attachTenantSheet, autoAttach, heatingSourcePages } from "../lib/attachments";
import { go, parseHash } from "../lib/nav";
import ValueChart from "../components/ValueChart";
import { Balance, Delta, Kpi, NumberInput, type PageProps } from "../components/ui";
import { calculateStatement } from "../lib/calc";
import { addMonths, formatDate, todayISO } from "../lib/dates";
import { isCurrentTenant, propertyMetrics } from "../lib/finance";
import { formatEUR, formatEUR0, formatNum, formatPct, formatSignedEUR0 } from "../lib/format";
import { ensureStatement, missingInfo, PROPERTY_TYPE_LABELS, rentAt, uid, warmRent } from "../lib/model";
import type { EconomicPlan, Property, Tenant, WegAnnualStatement } from "../lib/types";
import { wealthSeries, type WealthSeries } from "../lib/wealth";
import { accountLedger } from "../lib/account";
import { anlageV, anlageVYears } from "../lib/anlageV";
import { reserveOverview } from "../lib/reserve";
import { CopyTextModal } from "../components/CopyText";
import { planCheckpoints, planSplit, summarizeAnnual, summarizePlan } from "../lib/weg";
import { Checkpoints } from "../components/Charts";
import WegImport from "../components/WegImport";
import { notMovedOut, newTenant, saveTenant, TenantForm, TenantTable } from "./Tenants";
import { askConfirm } from "../components/dialog";

export default function PropertyDetail({ data, update, propertyId }: PageProps & { propertyId: string }) {
  const p = data.properties.find((x) => x.id === propertyId);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  // Sprung aus einem Hinweis: ?t=<Mieter> öffnet dessen Formular (bei jedem Klick erneut)
  useEffect(() => {
    const open = () => {
      const id = parseHash().params.t;
      const t = id ? data.tenants.find((x) => x.id === id) : undefined;
      if (t) setEditingTenant(structuredClone(t));
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeTenant = () => {
    setEditingTenant(null);
    // Mieter-Parameter entfernen, damit derselbe Hinweis das Formular wieder öffnen kann
    if (parseHash().params.t) history.replaceState(null, "", `#/objekte/${propertyId}`);
  };
  const [valDate, setValDate] = useState(todayISO());
  const [valValue, setValValue] = useState(0);
  const [valNote, setValNote] = useState("");
  const [showFormer, setShowFormer] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!p) {
    return (
      <div className="card empty">
        <p>Objekt nicht gefunden.</p>
        <a className="btn" href="#/">Zum Portfolio</a>
      </div>
    );
  }

  const today = todayISO();
  const taxRate = data.settings.marginalTaxRate;
  const m = propertyMetrics(p, data.tenants, today, taxRate, data.economicPlans);
  const w = wealthSeries(p, data, today);
  const missing = missingInfo(p, data.tenants, data.economicPlans);
  const tenants = data.tenants.filter((t) => t.propertyId === p.id).sort((a, b) => a.moveIn.localeCompare(b.moveIn));
  const shownTenants = tenants.filter((t) => showFormer || notMovedOut(t, today));
  const statements = data.statements.filter((s) => s.propertyId === p.id).sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const wegDocs: (WegAnnualStatement | EconomicPlan)[] = [...data.wegAnnuals, ...data.economicPlans]
    .filter((d) => d.propertyId === p.id)
    .sort((a, b) => b.year - a.year || a.kind.localeCompare(b.kind));

  const remove = async () => {
    if (!(await askConfirm(`„${p.name}“ mit ${tenants.length} Mietern und ${statements.length} Abrechnungen löschen?`, { confirmLabel: "Löschen", danger: true }))) return;
    update((d) => ({
      ...d,
      properties: d.properties.filter((x) => x.id !== p.id),
      tenants: d.tenants.filter((t) => t.propertyId !== p.id),
      statements: d.statements.filter((s) => s.propertyId !== p.id),
    }));
    window.location.hash = "#/";
  };

  const setValuations = (valuations: typeof p.valuations) =>
    update((d) => ({ ...d, properties: d.properties.map((x) => (x.id === p.id ? { ...x, valuations } : x)) }));

  const addValuation = () => {
    if (!valValue || !valDate) return;
    setValuations([...p.valuations, { id: uid(), date: valDate, value: valValue, note: valNote }]);
    setValValue(0);
    setValNote("");
  };

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/" className="small">← Portfolio</a>
          <h1>{p.name}</h1>
          <div className="muted small">
            {p.address} · {PROPERTY_TYPE_LABELS[p.type]}
            {p.yearBuilt ? ` · Baujahr ${p.yearBuilt}` : ""} · {formatNum(p.units.reduce((a, u) => a + u.area, 0))} m²
          </div>
        </div>
        <div className="row">
          <a className="btn" href={`#/objekte/${p.id}/bearbeiten`}>Objektdaten bearbeiten</a>
          <button className="danger" onClick={remove}>Löschen</button>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="alert info">
          <strong>Für eine vollständige Auswertung fehlen noch:</strong>
          <ul className="checklist missing-list">
            {missing.map((x) => (
              <li key={x.text}>
                <a
                  href={x.href}
                  onClick={(e) => {
                    e.preventDefault();
                    go(x.href);
                  }}
                >
                  {x.text} →
                </a>
              </li>
            ))}
          </ul>
          <span className="small">Ein Klick führt direkt zur passenden Eingabe.</span>
        </div>
      )}

      <div className="card portfolio-head">
        <div>
          <div className="muted small">Marktwert{m.marketValueDate ? ` (Stand ${formatDate(m.marketValueDate)})` : ""}</div>
          <div className="hero">{formatEUR0(m.marketValue)}</div>
          {m.invested > 0 && <Delta value={m.valueGain} pct={m.valueGainPct} suffix={`ggü. Einstand ${formatEUR0(m.invested)}`} />}
          {m.appreciationPa !== null && <div className="muted small">Wertentwicklung {formatPct(m.appreciationPa)} pro Jahr seit Kauf</div>}
        </div>
        <div className="kpi-row">
          <Kpi label="Eigenkapital im Objekt" value={formatEUR0(m.netWorth)} hint={`Restschuld ${formatEUR0(m.loanBalance)}`} />
          <Kpi label="Mietrendite brutto / netto" value={`${formatPct(m.grossYield)} / ${formatPct(m.netYield)}`} hint={`Kaltmiete ${formatEUR0(m.annualColdRent)} p. a.`} />
          <Kpi
            label="Cashflow / Monat nach Steuern"
            value={formatSignedEUR0(m.cashflowAfterTax / 12)}
            hint={`vor Steuern ${formatSignedEUR0(m.cashflowBeforeTax / 12)} · Steuersatz ${formatNum(taxRate)} %${
              m.annualDepreciation === 0 ? " · ohne Abschreibung" : ""
            }`}
          />
          <Kpi label="Eigenkapitalrendite p. a." value={formatPct(m.equityReturn)} hint="Cashflow n. St. + Tilgung, ohne Wertänderung" />
        </div>
      </div>

      {w ? (
        <div className="card">
          <h2>Vermögensentwicklung seit {ACQ_LABEL[p.acquisitionType ?? "purchase"]} ({formatDate(p.purchaseDate)})</h2>
          <div className="kpi-row" style={{ marginBottom: 12 }}>
            <Kpi
              label="Vermögenswert heute"
              value={formatEUR0(w.current.wealth)}
              hint={w.current.withdrawn ? "Marktwert − Restschuld + Cashflow − Entnahmen" : "Marktwert − Restschuld + Cashflow"}
            />
            <Kpi
              label="Einstand"
              value={formatEUR0(w.baseline)}
              hint={p.acquisitionType && p.acquisitionType !== "purchase" ? "Wert bei Erwerb + Nebenkosten − Darlehen" : "Kaufpreis + Nebenkosten − Darlehen"}
            />
            <Kpi label="Cashflow seit Erwerb" value={formatSignedEUR0(w.current.cumulative)} hint="Miete + Vorauszahlungen − Hausgeld − Kosten − Raten" />
            {w.current.withdrawn > 0 && (
              <Kpi
                label="Entnommen seit Erwerb"
                value={formatEUR0(w.current.withdrawn)}
                hint={`Überschuss nach Entnahmen ${formatSignedEUR0(w.current.cumulative - w.current.withdrawn)}`}
              />
            )}
            <Kpi label="Zuwachs" value={formatSignedEUR0(w.gain)} hint={w.baseline > 0 ? formatPct(w.gain / w.baseline) : undefined} />
          </div>
          {w.points.length >= 2 && <ValueChart points={w.points.map((x) => ({ date: x.date, value: x.wealth }))} label={`Vermögensentwicklung ${p.name}`} />}
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="compact">
              <thead>
                <tr>
                  <th>Jahr</th>
                  <th className="num">Marktwert</th>
                  <th className="num">Restschuld</th>
                  <th className="num">Cashflow im Jahr</th>
                  {w.current.withdrawn > 0 && <th className="num">Entnahmen</th>}
                  <th className="num">Vermögenswert</th>
                </tr>
              </thead>
              <tbody>
                {yearRows(w).map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}{y.partial ? " (bis heute)" : ""}</td>
                    <td className="num">{formatEUR0(y.value)}</td>
                    <td className="num">{formatEUR0(y.debt)}</td>
                    <td className="num">{formatSignedEUR0(y.cashflow)}</td>
                    {w.current.withdrawn > 0 && <td className="num">{formatEUR0(-y.withdrawn)}</td>}
                    <td className="num"><strong>{formatEUR0(y.wealth)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {w.loanDeviation !== null && (
            <div className="alert warn small" style={{ marginTop: 10 }}>
              Die eingetragene Restschuld weicht um {formatEUR0(w.loanDeviation)} vom berechneten Tilgungsplan ab (z. B. Sondertilgung oder geänderte Rate). Für heute gilt die
              eingetragene Restschuld.
            </div>
          )}
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Monatlich: Miete{p.type === "etw" ? " und Betriebskostenvorauszahlungen" : ""} wie vereinbart
            {p.type === "etw" ? ", abzüglich Hausgeld (laut Wirtschaftsplan des Jahres) sowie Grundsteuer und Müll laut Bescheid ab dem Jahr, ab dem du sie trägst" : ""},
            eigener Kosten und Kreditraten; Ergebnisse freigegebener Abrechnungen im Monat der Freigabe; Entnahmen vom Mietkonto mindern den Wert. Marktwert linear zwischen
            den Bewertungen. Vor Steuern.
          </p>
        </div>
      ) : (
        <div className="alert info">
          Für die Vermögensentwicklung fehlen Erwerbsdatum und Kaufpreis bzw. Wert bei Schenkung. <a href={`#/objekte/${p.id}/bearbeiten`}>Erwerb erfassen</a>
        </div>
      )}

      <AccountCard data={data} update={update} property={p} />
      <ReserveCard data={data} property={p} />

      <div className="card" id="wertentwicklung">
        <h2>Wertentwicklung</h2>
        {m.history.length >= 2 ? (
          <ValueChart points={m.history} height={200} label={`Wertverlauf ${p.name}`} />
        ) : (
          <p className="muted small">Trage unten eine aktuelle Schätzung ein, dann erscheint hier der Verlauf.</p>
        )}
        <ul className="account-list">
          {p.purchaseDate && p.purchasePrice > 0 && (
            <li>
              <div className="account-what">
                <span>{p.acquisitionType && p.acquisitionType !== "purchase" ? "Wert beim Erwerb" : "Kaufpreis"}</span>
                <span className="small muted">{formatDate(p.purchaseDate)}</span>
              </div>
              <div className="account-amount">
                <span className="out">{formatEUR0(p.purchasePrice)}</span>
              </div>
            </li>
          )}
          {[...p.valuations]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((v) => (
              <li key={v.id}>
                <div className="account-what">
                  <span>{v.note || "Bewertung"}</span>
                  <span className="small muted">{formatDate(v.date)}</span>
                </div>
                <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                  <div className="account-amount">
                    <span className="out">{formatEUR0(v.value)}</span>
                  </div>
                  <button className="ghost" onClick={() => setValuations(p.valuations.filter((x) => x.id !== v.id))} aria-label="Bewertung löschen">
                    ✕
                  </button>
                </div>
              </li>
            ))}
        </ul>
        <div className="valuation-form">
          <div className="account-label">Neue Bewertung</div>
          <div className="valuation-fields">
            <label className="field">
              Datum
              <input type="date" value={valDate} onChange={(e) => setValDate(e.target.value)} />
            </label>
            <label className="field">
              Marktwert (€)
              <NumberInput value={valValue || undefined} onChange={setValValue} placeholder="135.000" />
            </label>
            <label className="field valuation-note">
              Quelle / Notiz
              <input value={valNote} onChange={(e) => setValNote(e.target.value)} placeholder="z. B. BORIS.NRW, Gutachten, Vergleichsangebote" />
            </label>
            <button className="primary valuation-add" disabled={!valValue} onClick={addValuation}>
              Erfassen
            </button>
          </div>
          <p className="small muted" style={{ margin: "8px 0 0" }}>Aktualisiere den Marktwert etwa einmal im Jahr – wie den Kurs einer Aktie im Depot.</p>
        </div>
      </div>

      <div className="card" id="mieter">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Einheiten und Mieter</h2>
          <span className="spacer" />
          <label className="row small muted">
            <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} /> ehemalige anzeigen
          </label>
          <button className="primary" onClick={() => setEditingTenant(newTenant(data, p.id))}>+ Mieter</button>
        </div>
        {(() => {
          const cols = p.units.map((u) => {
            const t = tenants.find((x) => x.unitId === u.id && isCurrentTenant(x, today));
            return { u, t, r: t ? rentAt(t, today) : undefined };
          });
          const row = (label: string, cell: (c: (typeof cols)[number]) => ReactNode) => (
            <tr>
              <th scope="row">{label}</th>
              {cols.map((c) => (
                <td key={c.u.id} className="num">{cell(c)}</td>
              ))}
            </tr>
          );
          return (
            <div className="table-wrap" style={{ marginBottom: 16 }}>
              <table className="transposed">
                <thead>
                  <tr>
                    <th />
                    {cols.map(({ u }) => (
                      <th key={u.id} scope="col" className="num"><span className="tenant-name">{u.name}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row("Fläche", ({ u }) => `${formatNum(u.area)} m²`)}
                  {row("Aktueller Mieter", ({ u, t }) =>
                    t ? (
                      t.name
                    ) : (
                      <>
                        <span className="badge neutral">frei</span>{" "}
                        <button className="ghost small" onClick={() => setEditingTenant(newTenant(data, p.id, u.id))}>vermieten</button>
                      </>
                    ),
                  )}
                  {row("Kaltmiete", ({ r }) => (r ? formatEUR(r.coldRent) : "–"))}
                  {row("Stellplatz", ({ r }) => (r ? formatEUR(r.surcharge ?? 0) : "–"))}
                  {row("Kaltmiete je m²", ({ u, r }) => (r && u.area ? formatEUR(r.coldRent / u.area) : "–"))}
                  {row("Warmmiete", ({ r }) => (r ? <strong>{formatEUR(warmRent(r))}</strong> : "–"))}
                </tbody>
              </table>
            </div>
          );
        })()}
        {shownTenants.length > 0 && <TenantTable data={data} tenants={shownTenants} onEdit={(t) => setEditingTenant(structuredClone(t))} />}
      </div>

      {p.type === "etw" && <CostOverview data={data} property={p} />}

      {p.type === "etw" && (
        <div className="card" id="weg-unterlagen">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>WEG-Unterlagen</h2>
            <span className="spacer" />
            <button className="primary" onClick={() => setImporting(true)}>+ Jahresabrechnung / Wirtschaftsplan</button>
          </div>
          <p className="hint">
            Jahresabrechnung (Ist) und Wirtschaftsplan (Plan) der Hausverwaltung. Aus der geprüften Jahresabrechnung entsteht die Mieterabrechnung, der Wirtschaftsplan dient
            nur der Prognose.
          </p>
          {wegDocs.length === 0 ? (
            <p className="muted">Noch keine Unterlagen erfasst.</p>
          ) : (
            <div className="table-wrap">
              <table className="compact">
                <tbody>
                  {wegDocs.map((d) => {
                    const unitName = p.units.find((u) => u.id === d.unitId)?.name;
                    const annualSummary = d.kind === "annual" ? summarizeAnnual(d) : null;
                    const openReview = d.positions.filter((x) => x.classification === "review").length;
                    return (
                      <tr key={d.id}>
                        <td>
                          <a href={`#/weg/${d.kind === "annual" ? "jahresabrechnung" : "wirtschaftsplan"}/${d.id}`}>
                            {d.kind === "annual" ? "Jahresabrechnung" : "Wirtschaftsplan"} {d.year}
                          </a>{" "}
                          <span className="muted small">{unitName}</span>
                        </td>
                        <td>{d.kind === "annual" ? <span className="badge neutral">Ist</span> : <span className="badge warn">Plan</span>}</td>
                        <td className="num">
                          {annualSummary
                            ? `umlagefähig ${formatEUR(annualSummary.allocable)}`
                            : `Hausgeld ${formatEUR(summarizePlan(d as EconomicPlan).total)}`}
                        </td>
                        <td>
                          {annualSummary?.matchesDeclared === false && <span className="badge danger">✗ Kontrollsumme</span>}{" "}
                          {openReview > 0 && <span className="badge warn">⚠ {openReview} zu prüfen</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <h2>Wirtschaftlichkeit p. a.</h2>
          <table className="compact fin-table">
            <tbody>
              <Line label="Nettokaltmiete (aktuell × 12)" value={m.annualColdRent} />
              <Line
                label={`− nicht umlagefähige Kosten${m.hausgeldPlanYear ? ` (Hausgeld laut Wirtschaftsplan ${m.hausgeldPlanYear}, inkl. Rücklage ${formatEUR0(m.reserve)})` : ""}`}
                value={-m.nonAllocableCosts}
              />
              <Line label="= Reinertrag" value={m.annualColdRent - m.nonAllocableCosts} sum />
              <Line label="− Zinsen" value={-m.annualInterest} />
              <Line label="− Tilgung" value={-m.annualPrincipal} />
              <Line label="= Cashflow vor Steuern" value={m.cashflowBeforeTax} sum />
              <Line label={m.taxEffect >= 0 ? "− Einkommensteuer" : "+ Steuerersparnis"} value={-m.taxEffect} />
              <Line label="= Cashflow nach Steuern" value={m.cashflowAfterTax} sum />
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 8 }}>
            Umlagefähige Betriebskosten sind durchlaufende Posten und hier nicht enthalten. Die Tilgung baut Vermögen auf und zählt zur Eigenkapitalrendite.
          </p>
        </div>

        <AnlageVCard data={data} property={p} taxRate={taxRate} />
      </div>

      {p.loans.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Finanzierung</h2>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th className="num">Restschuld</th>
                  <th className="num">Zins</th>
                  <th className="num">Rate / Monat</th>
                  <th>Zinsbindung bis</th>
                </tr>
              </thead>
              <tbody>
                {p.loans.map((l) => {
                  const soon = l.fixedUntil && l.fixedUntil <= addMonths(today, 24);
                  return (
                    <tr key={l.id}>
                      <td>{l.lender || "Darlehen"}</td>
                      <td className="num">{formatEUR0(l.balance)}</td>
                      <td className="num">{formatNum(l.interestRate)} %</td>
                      <td className="num">{formatEUR(l.monthlyPayment)}</td>
                      <td>
                        {formatDate(l.fixedUntil) || "–"} {soon && <span className="badge warn">⚠ Anschlussfinanzierung planen</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Betriebskostenabrechnungen</h2>
          <span className="spacer" />
          <a className="btn primary" href="#/abrechnungen">+ Abrechnung</a>
        </div>
        {statements.length === 0 ? (
          <p className="muted">Noch keine Abrechnung für dieses Objekt.</p>
        ) : (
          <div className="table-wrap">
            <table className="compact">
              <tbody>
                {statements.map((s) => {
                  const r = calculateStatement(s, p, data.tenants);
                  const sum = r.tenants.reduce((a, t) => a + t.balance, 0);
                  return (
                    <tr key={s.id}>
                      <td><a href={`#/abrechnungen/${s.id}`}>{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</a></td>
                      <td className="num">{formatEUR(r.totalCosts)}</td>
                      <td className="num"><Balance value={sum} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importing && (
        <WegImport
          data={data}
          property={p}
          onClose={() => setImporting(false)}
          onCreate={(doc) => {
            update((d) =>
              doc.kind === "annual"
                ? // Abrechnung des Jahres anlegen, falls noch keine da ist, und die Heizkostenabrechnung gleich als Anlage übernehmen
                  autoAttach(ensureStatement({ ...d, wegAnnuals: [...d.wegAnnuals, doc] }, doc.propertyId, doc.year).data, doc.propertyId, doc.year, "heating", heatingSourcePages(doc))
                : { ...d, economicPlans: [...d.economicPlans, doc] },
            );
            if (doc.kind === "annual") void attachTenantSheet(update, doc).catch(() => undefined);
            setImporting(false);
            window.location.hash = `#/weg/${doc.kind === "annual" ? "jahresabrechnung" : "wirtschaftsplan"}/${doc.id}`;
          }}
        />
      )}

      {editingTenant && (
        <TenantForm
          data={data}
          update={update}
          initial={editingTenant}
          onClose={closeTenant}
          onSave={(t) => {
            saveTenant(update, t);
            closeTenant();
          }}
        />
      )}
    </>
  );
}


function Line({ label, value, sum, note, cents }: { label: string; value: number; sum?: boolean; note?: string; cents?: boolean }) {
  return (
    <tr className={sum ? "sum" : undefined}>
      <td>
        {label}
        {note && <div className="small muted">{note}</div>}
      </td>
      <td className="num">{(cents ? formatEUR : formatEUR0)(value === 0 ? 0 : value) /* kein „-0 €“ */}</td>
    </tr>
  );
}

const ACQ_LABEL: Record<NonNullable<Property["acquisitionType"]>, string> = { purchase: "Kauf", gift: "Schenkung", inheritance: "Erbschaft" };

/** Jahresübersicht: Stand am Jahresende bzw. heute, Cashflow des Jahres */
function yearRows(w: WealthSeries) {
  const years = new Map<number, { year: number; value: number; debt: number; wealth: number; cashflow: number; withdrawn: number; partial: boolean }>();
  for (const pt of w.points) {
    const year = Number(pt.date.slice(0, 4));
    const row = years.get(year) ?? { year, value: 0, debt: 0, wealth: 0, cashflow: 0, withdrawn: 0, partial: false };
    row.value = pt.value;
    row.debt = pt.debt;
    row.wealth = pt.wealth;
    row.cashflow += pt.cashflow;
    row.withdrawn += pt.withdrawal;
    row.partial = !pt.date.endsWith("-12-31");
    years.set(year, row);
  }
  return [...years.values()];
}

/** Betriebskostenübersicht einer Eigentumswohnung: letztes Ist, aktueller Plan und Prüfpunkte */
function CostOverview({ data, property }: { data: PageProps["data"]; property: Property }) {
  const annual = data.wegAnnuals.filter((a) => a.propertyId === property.id).sort((a, b) => b.year - a.year)[0];
  const plan = data.economicPlans.filter((x) => x.propertyId === property.id).sort((a, b) => b.year - a.year)[0];
  if (!annual && !plan) return null;
  const split = plan ? planSplit(plan) : null;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Betriebskostenübersicht</h2>
        <span className="spacer" />
        {plan && <span className="badge warn">Prognose {plan.year}</span>}
      </div>
      <div className="kpi-row">
        {annual && <Kpi label={`letzte bekannte Ist-Kosten ${annual.year} (umlagefähig)`} value={formatEUR(summarizeAnnual(annual).allocable)} />}
        {split && <Kpi label={`geplante umlagefähige Kosten ${plan!.year}`} value={formatEUR(split.allocable)} hint={`${formatEUR(split.allocableMonthly)} pro Monat`} />}
        {split && <Kpi label="Eigentümeranteil inkl. Rücklage" value={`${formatEUR(split.ownerMonthly)} / Monat`} hint={`${formatEUR(split.owner)} pro Jahr, trägst du selbst`} />}
      </div>
      {plan && (
        <>
          <h3 style={{ marginTop: 16 }}>Automatisch erkannte Prüfpunkte</h3>
          <Checkpoints items={planCheckpoints(plan, data.wegAnnuals).filter((f) => f.level !== "info" || f.title?.startsWith("Jahresabrechnung"))} />
          <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
            <a href={`#/weg/wirtschaftsplan/${plan.id}`}>Wirtschaftsplan {plan.year} mit Jahresvergleich und Kostentreibern öffnen →</a>
          </p>
        </>
      )}
    </div>
  );
}

/** Vorschlag für die Anlage V eines Jahres – Einnahmen und Werbungskosten aus den erfassten Daten */
function AnlageVCard({ data, property, taxRate }: { data: PageProps["data"]; property: Property; taxRate: number }) {
  const today = todayISO();
  const years = anlageVYears(property, today);
  const [year, setYear] = useState(() => years.find((y) => y < Number(today.slice(0, 4))) ?? years[0]);
  const [copy, setCopy] = useState(false);
  const av = year ? anlageV(property, data, year) : null;
  if (!av) return null;
  const text = [
    `Anlage V ${av.year} – ${property.name}, ${property.address}${av.from.slice(5) !== "01-01" ? ` (ab ${formatDate(av.from)})` : ""}`,
    "",
    "Einnahmen",
    ...av.income.map((l) => `  ${l.label}: ${formatEUR(l.amount)}${l.note ? ` (${l.note})` : ""}`),
    `  Summe: ${formatEUR(av.incomeTotal)}`,
    "",
    "Werbungskosten",
    ...av.costs.map((l) => `  ${l.label}: ${formatEUR(l.amount)}${l.note ? ` (${l.note})` : ""}`),
    `  Summe: ${formatEUR(av.costsTotal)}`,
    "",
    `${av.result >= 0 ? "Überschuss" : "Verlust"}: ${formatEUR(av.result)}`,
    ...(av.hints.length ? ["", ...av.hints.map((h) => `Hinweis: ${h}`)] : []),
  ].join("\n");
  return (
    <div className="card" style={{ marginBottom: 0 }} id="anlage-v">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Steuer – Anlage V</h2>
        <span className="spacer" />
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jahr">
          {years.map((y) => (
            <option key={y} value={y}>{y}{y === Number(today.slice(0, 4)) ? " (bisher geplant)" : ""}</option>
          ))}
        </select>
      </div>
      <table className="compact fin-table">
        <tbody>
          {av.income.map((l) => (
            <Line key={l.label} label={l.label} note={l.note} value={l.amount} cents />
          ))}
          <Line label="= Einnahmen" value={av.incomeTotal} sum cents />
          {av.costs.map((l) => (
            <Line key={l.label} label={`− ${l.label}`} note={l.note} value={-l.amount} cents />
          ))}
          <Line label={av.result >= 0 ? "= Überschuss" : "= Verlust (mindert dein Einkommen)"} value={av.result} sum cents />
          <Line label={`Steuerwirkung bei ${formatNum(taxRate)} % Grenzsteuersatz`} value={-(av.result * taxRate) / 100} />
        </tbody>
      </table>
      {av.hints.length > 0 && (
        <ul className="hint anlage-v-hints">
          {av.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <p className="hint" style={{ margin: 0, flex: 1 }}>
          Vorschlag aus deinen Daten {av.from.slice(5) !== "01-01" ? `ab ${formatDate(av.from)} ` : ""}– mit Kontoauszügen, Zinsbescheinigung und WEG-Abrechnung abgleichen. Keine
          Steuerberatung.
        </p>
        <button onClick={() => setCopy(true)}>Als Text</button>
      </div>
      {copy && <CopyTextModal title={`Anlage V ${av.year}`} text={text} onClose={() => setCopy(false)} />}
    </div>
  );
}

/** Erhaltungsrücklage: deine Zuführungen über das Hausgeld je Jahr, abgeglichen mit der Jahresabrechnung */
function ReserveCard({ data, property }: { data: PageProps["data"]; property: Property }) {
  const today = todayISO();
  const o = reserveOverview(property, data, today);
  if (!o) return null;
  const thisYear = Number(today.slice(0, 4));
  return (
    <div className="card" id="ruecklage">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Erhaltungsrücklage</h2>
        <span className="spacer" />
        <span className="small muted">deine Zuführung seit Erwerb</span>
        <strong>{formatEUR(o.total)}</strong>
      </div>
      {o.balance && (
        <div className="reserve-balance">
          <span className="small muted">Dein Anteil an der Rücklage am {formatDate(o.balance.date)}</span>
          <strong>{formatEUR(o.balance.share)}</strong>
          {o.balance.total !== null && (
            <span className="small muted">
              {o.balance.computed ? "berechnet aus" : "von"} {formatEUR(o.balance.total)} der Gemeinschaft
            </span>
          )}
        </div>
      )}
      <ul className="reserve-list">
        {o.years.map((y) => (
          <li key={y.year}>
            <div>
              <strong>{y.year}</strong>
              {y.year === thisYear && <span className="small muted"> bis heute</span>}
              <div className="small muted">
                {y.months} × {formatEUR(y.monthly)} im Hausgeld
              </div>
            </div>
            <div className="num">
              <strong>{formatEUR(y.paid)}</strong>
              <div className="small muted">
                {y.annualTotal === null
                  ? "Abrechnung fehlt noch"
                  : `laut Abrechnung ${formatEUR(y.annualOwn!)}${y.months < 12 ? ` (von ${formatEUR(y.annualTotal)} fürs Jahr)` : ""}`}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="hint" style={{ margin: "8px 0 0" }}>
        Zuführung = Rücklagenanteil im Hausgeld laut Wirtschaftsplan × Monate in deinem Eigentum. „Laut Abrechnung“ ist die Zuführung aus der WEG-Jahresabrechnung
        (Zuführung der Gemeinschaft × Miteigentumsanteil), zeitanteilig für deine Monate. Steuerlich zählt die Rücklage erst, wenn die WEG sie für Erhaltung ausgibt.
      </p>
    </div>
  );
}

/** Soll-Kontostand des Mietkontos zu einem Stichtag, mit Abgleich und Kontoauszug */
function AccountCard({ data, update, property }: { data: PageProps["data"]; update: PageProps["update"]; property: Property }) {
  // Der echte Kontostand wird mit seinem Stichtag am Objekt gespeichert und beim nächsten Öffnen wieder angezeigt
  const saved = property.accountCheck ?? null;
  const [date, setDate] = useState(saved?.date ?? todayISO());
  const [actual, setActualState] = useState<number>(saved?.actual ?? NaN);
  const store = (check: Property["accountCheck"]) =>
    update((d) => ({ ...d, properties: d.properties.map((x) => (x.id === property.id ? { ...x, accountCheck: check } : x)) }));
  const setActual = (v: number) => {
    setActualState(v);
    store(Number.isNaN(v) ? null : { date: date || todayISO(), actual: v });
  };
  const changeDate = (d: string) => {
    setDate(d);
    if (!Number.isNaN(actual) && d) store({ date: d, actual });
  };
  const [showAll, setShowAll] = useState(false);
  const ledger = accountLedger(property, data, date || todayISO());
  if (!ledger) return null;
  const diff = Number.isNaN(actual) ? null : Math.round((actual - ledger.balance) * 100) / 100;
  const shown = showAll ? [...ledger.bookings].reverse() : [...ledger.bookings].reverse().slice(0, 6);
  return (
    <div className="card account-card">
      <div className="account-head">
        <h2>Mietkonto</h2>
        <span className="small muted">Soll-Stand bei pünktlichen Zahlungen</span>
      </div>

      <div className="account-panel">
        <div className="account-balance">
          <span className="account-label">Soll-Kontostand am</span>
          <input
            id="account-date"
            className="account-date"
            type="date"
            aria-label="Stichtag"
            value={date}
            max="2100-12-31"
            onChange={(e) => changeDate(e.target.value)}
          />
          <strong>{formatEUR(ledger.balance)}</strong>
          <span className="account-flow">
            <span className="in">+{formatEUR0(ledger.incoming)}</span> ein · <span className="out">{formatEUR0(ledger.outgoing)}</span> aus
          </span>
        </div>
        <label className="account-check">
          <span className="account-label">Dein echter Kontostand</span>
          <NumberInput allowEmpty value={actual} onChange={setActual} placeholder="0,00" ariaLabel="Tatsächlicher Kontostand" />
          {diff === null ? (
            <span className="account-diff neutral">zum Abgleich eintragen</span>
          ) : Math.abs(diff) < 0.01 ? (
            <span className="account-diff ok">✓ stimmt überein</span>
          ) : (
            <span className="account-diff warn">
              {diff > 0 ? "+" : ""}
              {formatEUR(diff)} {diff > 0 ? "mehr als erwartet" : "weniger als erwartet"}
            </span>
          )}
        </label>
      </div>
      {diff !== null && Math.abs(diff) >= 0.01 && (
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          {diff > 0
            ? "Mögliche Gründe: Anfangsbestand, Kaution auf dem Konto, Erstattung der WEG oder eine noch nicht abgebuchte Zahlung."
            : "Mögliche Gründe: ausstehende Miete, Sonderumlage, eine Rechnung oder eine zusätzliche Entnahme."}
        </p>
      )}

      <ul className="account-list">
        {shown.map((b, i) => (
          <li key={`${b.date}-${b.label}-${i}`}>
            <div className="account-what">
              <span>{b.label}</span>
              <span className="small muted">{formatDate(b.date)}</span>
            </div>
            <div className="account-amount">
              <span className={b.amount > 0 ? "in" : "out"}>
                {b.amount > 0 ? "+" : ""}
                {formatEUR(b.amount)}
              </span>
              <span className="small muted">{formatEUR(b.balance)}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 8 }}>
        {ledger.bookings.length > 6 && (
          <button className="ghost" onClick={() => setShowAll((x) => !x)}>
            {showAll ? "Weniger anzeigen" : `Alle ${ledger.bookings.length} Buchungen`}
          </button>
        )}
        <span className="spacer" />
        <span className="small muted">
          Start {formatEUR(ledger.opening.amount)} am {formatDate(ledger.opening.date)}
        </span>
      </div>
    </div>
  );
}
