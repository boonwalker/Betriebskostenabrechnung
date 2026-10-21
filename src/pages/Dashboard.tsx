import Sparkline from "../components/Sparkline";
import { Delta, Kpi } from "../components/ui";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { portfolioMetrics, propertyMetrics, type PropertyMetrics } from "../lib/finance";
import { wealthSeries, type WealthSeries } from "../lib/wealth";
import { formatEUR0, formatPct, formatSignedEUR0 } from "../lib/format";
import { missingInfo, PROPERTY_TYPE_LABELS } from "../lib/model";
import type { AppData, Property } from "../lib/types";

export default function Dashboard({ data }: { data: AppData }) {
  const today = todayISO();
  const lastYear = String(new Date().getFullYear() - 1);
  const metrics = data.properties.map((p) => ({
    p,
    m: propertyMetrics(p, data.tenants, today, data.settings.marginalTaxRate),
    w: wealthSeries(p, data, today),
  }));
  // Vermögenswert je Objekt: Marktwert − Restschuld + aufsummierter Cashflow (ohne Erwerbsdaten nur Marktwert − Restschuld)
  const wealthOf = (x: (typeof metrics)[number]) => x.w?.current.wealth ?? x.m.netWorth;
  const totalWealth = metrics.reduce((a, x) => a + wealthOf(x), 0);
  const withSeries = metrics.filter((x) => x.w);
  const totalGain = withSeries.reduce((a, x) => a + x.w!.gain, 0);
  const totalBaseline = withSeries.reduce((a, x) => a + x.w!.baseline, 0);
  const totalCumulative = withSeries.reduce((a, x) => a + x.w!.current.cumulative, 0);
  const portfolio = portfolioMetrics(
    metrics.map((x) => x.m),
    data.properties.reduce((a, p) => a + p.purchasePrice, 0),
  );

  const steps = [
    { done: !!data.settings.landlord.name, label: <>Deine Vermieterdaten in den <a href="#/einstellungen">Einstellungen</a> hinterlegen</> },
    { done: data.properties.length > 0, label: <>Ein <a href="#/objekte/neu">Objekt</a> mit Wohnungen, Kaufdaten und Finanzierung anlegen</> },
    { done: data.tenants.length > 0, label: <><a href="#/mieter">Mieter</a> mit Kaltmiete, Vorauszahlungen und Personenzahl erfassen</> },
    { done: data.statements.length > 0, label: <>Eine <a href="#/abrechnungen">Abrechnung</a> anlegen und die Belege des Jahres hochladen</> },
  ];

  const openStatement = (p: Property) =>
    data.tenants.some((t) => t.propertyId === p.id) && !data.statements.some((s) => s.propertyId === p.id && s.periodStart.startsWith(lastYear));

  return (
    <>
      <div className="page-head">
        <h1>Mein Immobilien-Portfolio</h1>
        <a className="btn primary" href="#/objekte/neu">+ Objekt hinzufügen</a>
      </div>

      {data.properties.length > 0 && (
        <div className="card portfolio-head">
          <div>
            <div className="muted small">Vermögenswert (Marktwert − Restschuld + Cashflow seit Erwerb)</div>
            <div className="hero">{formatEUR0(totalWealth)}</div>
            {withSeries.length > 0 && (
              <Delta value={totalGain} pct={totalBaseline > 0 ? totalGain / totalBaseline : null} suffix={`ggü. Einstand · Cashflow bisher ${formatSignedEUR0(totalCumulative)}`} />
            )}
          </div>
          <div className="kpi-row">
            <Kpi label="Marktwert gesamt" value={formatEUR0(portfolio.marketValue)} />
            <Kpi label="Restschuld" value={formatEUR0(portfolio.loanBalance)} hint={`Beleihung ${formatPct(portfolio.loanToValue)}`} />
            <Kpi label="Kaltmiete p. a." value={formatEUR0(portfolio.annualColdRent)} hint={`Mietrendite ${formatPct(portfolio.grossYield)}`} />
            <Kpi
              label="Cashflow / Monat"
              value={formatSignedEUR0(portfolio.cashflowAfterTax / 12)}
              hint={`vor Steuern ${formatSignedEUR0(portfolio.cashflowBeforeTax / 12)}`}
            />
          </div>
        </div>
      )}

      <div className="tiles">
        {metrics.map(({ p, m, w }) => (
          <PropertyTile key={p.id} p={p} m={m} w={w} missing={missingInfo(p, data.tenants).length} needsStatement={openStatement(p)} lastYear={lastYear} />
        ))}
        <a className="tile tile-add" href="#/objekte/neu">
          <span className="tile-add-plus">+</span>
          <span>Objekt hinzufügen</span>
        </a>
      </div>

      {steps.some((s) => !s.done) && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Erste Schritte</h2>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={s.done ? "done" : ""}>{s.label}</li>
            ))}
          </ol>
          {data.properties.length === 0 && (
            <p className="muted small" style={{ marginTop: 12 }}>
              Erst mal ausprobieren? In den <a href="#/einstellungen">Einstellungen</a> kannst du Beispieldaten laden.
            </p>
          )}
        </div>
      )}

      {data.statements.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Letzte Abrechnungen</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {[...data.statements]
                  .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
                  .slice(0, 5)
                  .map((s) => {
                    const p = data.properties.find((x) => x.id === s.propertyId);
                    if (!p) return null;
                    const r = calculateStatement(s, p, data.tenants);
                    return (
                      <tr key={s.id}>
                        <td><a href={`#/abrechnungen/${s.id}`}>{p.name}</a></td>
                        <td>{formatDate(s.periodStart)} – {formatDate(s.periodEnd)}</td>
                        <td className="muted small">Frist: {formatDate(r.deadline)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}


function PropertyTile({
  p,
  m,
  w,
  missing,
  needsStatement,
  lastYear,
}: {
  p: Property;
  m: PropertyMetrics;
  w: WealthSeries | null;
  missing: number;
  needsStatement: boolean;
  lastYear: string;
}) {
  return (
    <a className="tile" href={`#/objekte/${p.id}`}>
      <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div style={{ minWidth: 0 }}>
          <div className="tile-title">{p.name}</div>
          <div className="muted small ellipsis">{p.address || "Keine Anschrift"}</div>
        </div>
        <span className="spacer" />
        <span className="badge neutral">{PROPERTY_TYPE_LABELS[p.type]}</span>
      </div>

      <div className="muted small" style={{ marginTop: 12 }}>Vermögenswert</div>
      <div className="tile-value" style={{ marginTop: 0 }}>{formatEUR0(w?.current.wealth ?? m.netWorth)}</div>
      {w ? (
        <Delta value={w.gain} pct={w.baseline > 0 ? w.gain / w.baseline : null} />
      ) : (
        <div className="muted small">Erwerbsdatum und -wert fehlen</div>
      )}
      <div className="muted small">
        Marktwert {formatEUR0(m.marketValue)}
        {m.loanBalance > 0 && ` · Restschuld ${formatEUR0(m.loanBalance)}`}
        {w && ` · Cashflow ${formatSignedEUR0(w.current.cumulative)}`}
      </div>
      <div className="tile-chart">
        {w && w.points.length >= 2 ? (
          <Sparkline points={w.points.map((x) => ({ date: x.date, value: x.wealth }))} label={`Vermögensentwicklung ${p.name}`} />
        ) : (
          <div className="muted small">Der Verlauf erscheint ab dem zweiten Monat nach Erwerb.</div>
        )}
      </div>

      <div className="tile-stats">
        <div>
          <span className="muted small">Mietrendite</span>
          <strong>{formatPct(m.grossYield)}</strong>
        </div>
        <div>
          <span className="muted small">Cashflow / Monat</span>
          <strong>{formatSignedEUR0(m.cashflowAfterTax / 12)}</strong>
        </div>
        <div>
          <span className="muted small">Vermietet</span>
          <strong>{m.unitsLet} / {m.unitsTotal}</strong>
        </div>
      </div>

      {(needsStatement || missing > 0) && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {needsStatement && <span className="badge warn">⚠ Abrechnung {lastYear} offen</span>}
          {missing > 0 && <span className="badge neutral">ⓘ {missing} Angabe{missing === 1 ? "" : "n"} fehlen</span>}
        </div>
      )}
    </a>
  );
}
