import ValueChart from "../components/ValueChart";
import { Delta, Kpi, type PageProps } from "../components/ui";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { portfolioMetrics, propertyMetrics, type PropertyMetrics } from "../lib/finance";
import { wealthSeries, type WealthSeries } from "../lib/wealth";
import { formatEUR0, formatPct, formatSignedEUR0 } from "../lib/format";
import { missingInfo, portfolioOn, PROPERTY_TYPE_LABELS } from "../lib/model";
import type { AppData, Property } from "../lib/types";
import { Logo } from "../components/Logo";
import { backupDue } from "../lib/backup";
import { demoData } from "../lib/demo";

export default function Dashboard({ data, update, replace }: PageProps & { replace: (d: AppData) => void }) {
  const today = todayISO();
  const showPortfolio = portfolioOn(data.settings);
  const lastYear = String(new Date().getFullYear() - 1);
  const metrics = data.properties.map((p) => ({
    p,
    m: propertyMetrics(p, data.tenants, today, data.settings.marginalTaxRate, data.economicPlans),
    w: wealthSeries(p, data, today),
  }));
  // Vermögenswert je Objekt: Marktwert − Restschuld + aufsummierter Cashflow (ohne Erwerbsdaten nur Marktwert − Restschuld)
  const wealthOf = (x: (typeof metrics)[number]) => x.w?.current.wealth ?? x.m.netWorth;
  const totalWealth = metrics.reduce((a, x) => a + wealthOf(x), 0);
  const withSeries = metrics.filter((x) => x.w);
  const totalGain = withSeries.reduce((a, x) => a + x.w!.gain, 0);
  const totalBaseline = withSeries.reduce((a, x) => a + x.w!.baseline, 0);
  const totalCumulative = withSeries.reduce((a, x) => a + x.w!.current.cumulative, 0);
  const totalWithdrawn = withSeries.reduce((a, x) => a + x.w!.current.withdrawn, 0);
  const portfolio = portfolioMetrics(
    metrics.map((x) => x.m),
    data.properties.reduce((a, p) => a + p.purchasePrice, 0),
  );

  const steps = [
    { done: !!data.settings.landlord.name, label: <>Deine Vermieterdaten in den <a href="#/einstellungen">Einstellungen</a> hinterlegen</> },
    { done: data.properties.length > 0, label: <>Ein <a href="#/objekte/neu">Objekt</a> mit Wohnungen{showPortfolio ? ", Kaufdaten und Finanzierung" : ""} anlegen</> },
    { done: data.tenants.length > 0, label: <><a href="#/mieter">Mieter</a> mit Kaltmiete, Vorauszahlungen und Personenzahl erfassen</> },
    { done: data.statements.length > 0, label: <>Eine <a href="#/abrechnungen">Abrechnung</a> anlegen und die Belege des Jahres hochladen</> },
  ];

  const openStatement = (p: Property) =>
    data.tenants.some((t) => t.propertyId === p.id) && !data.statements.some((s) => s.propertyId === p.id && s.periodStart.startsWith(lastYear));

  // Erster Start ohne Daten: Begrüßung statt leerem Portfolio
  if (data.properties.length === 0 && data.tenants.length === 0 && data.statements.length === 0) {
    return (
      <div className="welcome">
        <div className="welcome-hero">
          <Logo size={64} />
          <h1>Willkommen bei ImmoFriend</h1>
          <p>
            Behalte deine vermieteten Wohnungen wie ein Depot im Blick und erstelle die jährliche Betriebskostenabrechnung – mit Nachzahlung oder Guthaben je Mieter und
            fertigem Anschreiben.
          </p>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Wofür möchtest du ImmoFriend nutzen? Ohne Portfolio entfallen Kaufpreis, Finanzierung und Wertentwicklung – umstellen kannst du das jederzeit in den
            Einstellungen.
          </p>
          <div className="welcome-actions">
            <a className="btn primary" href="#/objekte/neu" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, portfolio: true } }))}>
              Portfolio und Abrechnung
            </a>
            <a className="btn" href="#/objekte/neu" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, portfolio: false } }))}>
              Nur Betriebskostenabrechnung
            </a>
            <button onClick={() => replace({ ...demoData(), settings: { ...demoData().settings, inviteCode: data.settings.inviteCode } })}>Mit Beispieldaten ausprobieren</button>
          </div>
        </div>
        <div className="welcome-points">
          <div>
            <strong>🔒 Deine Daten bleiben bei dir</strong>
            <span>Alles wird nur auf diesem Gerät gespeichert – kein Konto, kein Server. Sichere regelmäßig unter Einstellungen.</span>
          </div>
          <div>
            <strong>📱 Als App auf den Homebildschirm</strong>
            <span>iPhone: in Safari auf Teilen → „Zum Home-Bildschirm“. Android: im Chrome-Menü „App installieren“.</span>
          </div>
          <div>
            <strong>🧾 Belege per Foto</strong>
            <span>Optional liest eine KI Rechnungen und Bescheide aus – mit einem Einladungscode oder eigenem API-Schlüssel (Einstellungen).</span>
          </div>
        </div>
      </div>
    );
  }

  // Nur für eigene Daten erinnern – Beispieldaten muss niemand sichern
  const remindBackup = !import.meta.env.VITE_SHOWCASE && data.properties.some((p) => !p.id.startsWith("demo-")) && backupDue();

  return (
    <>
      {remindBackup && (
        <a className="backup-reminder" href="#/einstellungen?f=sicherung">
          💾 <span><strong>Zeit für eine Sicherung:</strong> Deine Daten liegen nur auf diesem Gerät. Lade unter Einstellungen eine Sicherungsdatei herunter.</span>
        </a>
      )}
      <div className="page-head">
        <h1>{showPortfolio ? "Mein Immobilien-Portfolio" : "Meine Objekte"}</h1>
        <a className="btn primary" href="#/objekte/neu">+ Objekt hinzufügen</a>
      </div>

      {showPortfolio && data.properties.length > 0 && (
        <div className="card portfolio-head">
          <div>
            <div className="muted small">Vermögenswert (Marktwert − Restschuld + Cashflow seit Erwerb)</div>
            <div className="hero">{formatEUR0(totalWealth)}</div>
            {withSeries.length > 0 && (
              <Delta value={totalGain} pct={totalBaseline > 0 ? totalGain / totalBaseline : null} suffix={`ggü. Einstand · Cashflow bisher ${formatSignedEUR0(totalCumulative)}${totalWithdrawn ? ` · entnommen ${formatEUR0(totalWithdrawn)}` : ""}`} />
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
          <PropertyTile
            key={p.id}
            p={p}
            m={m}
            w={showPortfolio ? w : undefined}
            data={data}
            missing={missingInfo(p, data.tenants, data.economicPlans, showPortfolio).length}
            needsStatement={openStatement(p)}
            lastYear={lastYear}
          />
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
  data,
}: {
  p: Property;
  m: PropertyMetrics;
  /** undefined = ohne Portfolio: nur Vermietung und Abrechnungen */
  w: WealthSeries | null | undefined;
  data: AppData;
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

      {w === undefined ? (
        <SimpleTileBody p={p} m={m} data={data} />
      ) : (
        <>
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
            {w && w.current.withdrawn > 0 && ` · entnommen ${formatEUR0(w.current.withdrawn)}`}
          </div>
          <div className="tile-chart">
            {w && w.points.length >= 2 ? (
              <ValueChart compact points={w.points.map((x) => ({ date: x.date, value: x.wealth }))} label={`Vermögensentwicklung ${p.name}`} />
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
        </>
      )}

      {(needsStatement || missing > 0) && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {needsStatement && <span className="badge warn">⚠ Abrechnung {lastYear} offen</span>}
          {missing > 0 && <span className="badge neutral">ⓘ {missing} Angabe{missing === 1 ? "" : "n"} fehlen</span>}
        </div>
      )}
    </a>
  );
}

/** Kachelinhalt ohne Portfolio: Mieter und Stand der Abrechnungen */
function SimpleTileBody({ p, m, data }: { p: Property; m: PropertyMetrics; data: AppData }) {
  const today = todayISO();
  const tenants = data.tenants.filter((t) => t.propertyId === p.id && (!t.moveOut || t.moveOut >= today));
  const last = data.statements.filter((s) => s.propertyId === p.id).sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
  return (
    <>
      <div className="muted small" style={{ marginTop: 12 }}>Mieter</div>
      <div className="tile-tenants">{tenants.length ? tenants.map((t) => t.name).join(", ") : <span className="muted">noch keine</span>}</div>
      <div className="tile-stats two">
        <div>
          <span className="muted small">Vermietet</span>
          <strong>{m.unitsLet} / {m.unitsTotal}</strong>
        </div>
        <div>
          <span className="muted small">Letzte Abrechnung</span>
          <strong>{last ? `${last.periodStart.slice(0, 4)} · ${last.status === "released" ? "freigegeben" : "Entwurf"}` : "–"}</strong>
        </div>
      </div>
    </>
  );
}
