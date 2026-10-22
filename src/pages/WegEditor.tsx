import { focusElement } from "../lib/nav";
import PositionsTable, { newPosition } from "../components/PositionsTable";
import { Kpi, NumberInput, type PageProps } from "../components/ui";
import { applyRules } from "../lib/classify";
import { formatEUR, formatPct } from "../lib/format";
import { newStatement, uid } from "../lib/model";
import { fromCents, sumCents, toCents } from "../lib/money";
import type { AppData, EconomicPlan, HeatingBill, WegAnnualStatement } from "../lib/types";
import { BarList, BudgetMeter, Checkpoints, SplitBar } from "../components/Charts";
import { formatSignedPct } from "../lib/format";
import {
  budgetUsage,
  checkAnnual,
  checkPlan,
  compareYears,
  comparePlanActual,
  costDrivers,
  explainDrivers,
  forecastForTenant,
  planCheckpoints,
  planSplit,
  summarizeAnnual,
  summarizePlan,
  transferToStatement,
} from "../lib/weg";

type Doc = WegAnnualStatement | EconomicPlan;

function useDoc(data: AppData, update: PageProps["update"], kind: Doc["kind"], id: string) {
  const list = kind === "annual" ? data.wegAnnuals : data.economicPlans;
  const doc = (list as Doc[]).find((d) => d.id === id);
  const set = (patch: Partial<Doc>) =>
    update((d) =>
      kind === "annual"
        ? { ...d, wegAnnuals: d.wegAnnuals.map((x) => (x.id === id ? ({ ...x, ...patch } as WegAnnualStatement) : x)) }
        : { ...d, economicPlans: d.economicPlans.map((x) => (x.id === id ? ({ ...x, ...patch } as EconomicPlan) : x)) },
    );
  return [doc, set] as const;
}

export default function WegEditor({ data, update, kind, id }: PageProps & { kind: Doc["kind"]; id: string }) {
  const [doc, set] = useDoc(data, update, kind, id);
  if (!doc) return <div className="card empty">Dokument nicht gefunden.</div>;
  const property = data.properties.find((p) => p.id === doc.propertyId);
  const unit = property?.units.find((u) => u.id === doc.unitId);

  const remove = () => {
    if (!confirm("Dieses Dokument mit allen erfassten Positionen löschen?")) return;
    update((d) =>
      kind === "annual" ? { ...d, wegAnnuals: d.wegAnnuals.filter((x) => x.id !== id) } : { ...d, economicPlans: d.economicPlans.filter((x) => x.id !== id) },
    );
    window.location.hash = `#/objekte/${doc.propertyId}`;
  };

  return (
    <>
      <div className="page-head">
        <div>
          <a href={`#/objekte/${doc.propertyId}`} className="small">← {property?.name ?? "Objekt"}</a>
          <h1>
            {doc.kind === "annual" ? "WEG-Jahresabrechnung" : "Wirtschaftsplan"} {doc.year} · {unit?.name}
          </h1>
          <div className="row" style={{ gap: 6 }}>
            {doc.kind === "annual" ? (
              <span className="badge neutral">Ist-Kosten · Ebene Eigentümer ↔ WEG</span>
            ) : (
              <span className="badge warn">Prognose · keine Grundlage für Mieterabrechnungen</span>
            )}
            {doc.documents.length > 0 && <span className="small muted">Quelle: {doc.documents.join(", ")}</span>}
          </div>
        </div>
        <button className="danger" onClick={remove}>Löschen</button>
      </div>

      <div className="card">
        <div className="grid">
          <label className="field">
            Jahr
            <input type="number" value={doc.year} onChange={(e) => set({ year: Number(e.target.value) })} />
          </label>
          <label className="field">
            Wohnung
            <select value={doc.unitId} onChange={(e) => set({ unitId: e.target.value })}>
              {property?.units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          {doc.kind === "annual" ? (
            <>
              <label className="field">
                Bewirtschaftungskosten Ist (€)
                <NumberInput value={doc.managementCostsActual ?? undefined} onChange={(v) => set({ managementCostsActual: v })} />
              </label>
              <label className="field">
                Bewirtschaftungskosten Soll laut Plan (€)
                <NumberInput value={doc.managementCostsPlan ?? undefined} onChange={(v) => set({ managementCostsPlan: v })} />
              </label>
              <label className="field">
                Gesamtkosten der WEG laut Abrechnung (€)
                <NumberInput value={doc.buildingTotal ?? undefined} onChange={(v) => set({ buildingTotal: v || null })} />
              </label>
              <label className="field">
                Zuführung Erhaltungsrücklage (€)
                <NumberInput value={doc.reserveContribution} onChange={(v) => set({ reserveContribution: v })} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                Hausgeld pro Jahr laut Plan (€)
                <NumberInput value={doc.annualHausgeld ?? undefined} onChange={(v) => set({ annualHausgeld: v })} />
              </label>
              <label className="field">
                Hausgeld pro Monat laut Plan (€)
                <NumberInput value={doc.monthlyHausgeld ?? undefined} onChange={(v) => set({ monthlyHausgeld: v })} />
              </label>
              <label className="field">
                davon monatlich Rücklage (€)
                <NumberInput value={doc.monthlyReserve ?? undefined} onChange={(v) => set({ monthlyReserve: v || null })} />
              </label>
              <label className="field">
                davon monatlich Kostentragung (€)
                <NumberInput value={doc.monthlyCosts ?? undefined} onChange={(v) => set({ monthlyCosts: v || null })} />
              </label>
            </>
          )}
        </div>
      </div>

      {doc.kind === "annual" ? <AnnualSummaryCard data={data} update={update} annual={doc} /> : <PlanSummaryCard data={data} plan={doc} />}

      <div className="card" id="positionen">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Positionen</h2>
          <span className="spacer" />
          <button onClick={() => set({ positions: doc.positions.map((p) => applyRules(p, doc.year)) })} title="Regelvorschläge für alle nicht manuell bewerteten Positionen neu berechnen">
            Vorschläge neu berechnen
          </button>
          <button
            onClick={() => set({ positions: doc.positions.map((p) => (p.classification === "review" ? p : { ...p, reviewed: true })) })}
            title="Alle eindeutig bewerteten Positionen als geprüft bestätigen"
          >
            Eindeutige bestätigen
          </button>
          <button className="primary" onClick={() => set({ positions: [...doc.positions, newPosition(doc.year)] })}>+ Position</button>
        </div>
        <p className="hint">
          Die Bewertung ist ein Vorschlag nach BetrKV. Prüfe sie anhand deines Mietvertrags: Nur dort vereinbarte Kostenarten dürfen umgelegt werden, „sonstige
          Betriebskosten“ nur, wenn sie namentlich genannt sind.
        </p>
        <PositionsTable
          positions={doc.positions}
          year={doc.year}
          showDeclared={doc.kind === "plan"}
          highlight={doc.kind === "annual" ? new Set(checkAnnual(doc).filter((f) => f.positionId).map((f) => f.positionId!)) : undefined}
          onChange={(positions) => set({ positions })}
        />
      </div>

      {doc.kind === "annual" && <HeatingCard annual={doc} onChange={(heating) => set({ heating })} />}
    </>
  );
}

function AnnualSummaryCard({ data, update, annual }: { data: AppData; update: PageProps["update"]; annual: WegAnnualStatement }) {
  const s = summarizeAnnual(annual);
  const budget = budgetUsage(annual);
  const findings = checkAnnual(annual);
  const statement = data.statements.find((st) => st.propertyId === annual.propertyId && st.periodStart.startsWith(String(annual.year)));

  const toStatement = () => {
    if (statement?.status === "released") {
      alert("Die Mieterabrechnung ist für alle Mieter freigegeben. Hebe eine Freigabe auf, wenn du sie ändern willst.");
      return;
    }
    const base = statement ?? newStatement(annual.propertyId, `${annual.year}-01-01`, `${annual.year}-12-31`);
    const property = data.properties.find((p) => p.id === annual.propertyId)!;
    const { items, skipped } = transferToStatement(annual, base, { property, tenants: data.tenants });
    const next = { ...base, costs: [...base.costs, ...items] };
    update((d) => ({ ...d, statements: statement ? d.statements.map((x) => (x.id === next.id ? next : x)) : [...d.statements, next] }));
    const notTaken = skipped.filter((x) => x.reason !== "bereits übernommen" && x.reason !== "nicht umlagefähig");
    alert(
      `${items.length} Position(en) übernommen.` +
        (notTaken.length ? `\n\nNicht übernommen:\n${notTaken.map((x) => `• ${x.position.label}: ${x.reason}`).join("\n")}` : ""),
    );
    window.location.hash = `#/abrechnungen/${next.id}`;
  };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Kontrollsumme</h2>
        <span className="spacer" />
        {s.matchesDeclared === true && <span className="badge ok">✓ stimmt mit den Bewirtschaftungskosten überein</span>}
        {s.matchesDeclared === false && <span className="badge danger">✗ Differenz {formatEUR(s.difference!)}</span>}
      </div>
      <div className="kpi-row">
        <Kpi label="umlagefähig (vorläufig)" value={formatEUR(s.allocable)} />
        <Kpi label="nicht umlagefähig" value={formatEUR(s.nonAllocable)} />
        <Kpi label="Prüfung erforderlich" value={formatEUR(s.review)} />
        <Kpi label="Summe Positionen" value={formatEUR(s.total)} hint={s.declared !== null ? `laut Abrechnung ${formatEUR(s.declared)}` : "Bewirtschaftungskosten fehlen"} />
      </div>
      <div className="alert info small" style={{ marginTop: 14 }}>
        <strong>Nur zwischen dir und der WEG:</strong>{" "}
        {s.ownerOverUnderCoverage !== null &&
          `${s.ownerOverUnderCoverage >= 0 ? "Überdeckung" : "Unterdeckung"} gegenüber dem Plan ${formatEUR(Math.abs(s.ownerOverUnderCoverage))}. `}
        Zuführung zur Erhaltungsrücklage {formatEUR(s.reserveContribution)}. Beides ist kein Guthaben und keine Kostenposition des Mieters.
      </div>
      {budget && (
        <div className="stack" style={{ marginTop: 16, gap: 8 }}>
          <h3 style={{ margin: 0 }}>Budgetauslastung Bewirtschaftungskosten {annual.year}</h3>
          <div className="kpi-row">
            <Kpi label="geplant (Soll)" value={formatEUR(budget.plan)} />
            <Kpi label="tatsächlich (Ist)" value={formatEUR(budget.actual)} />
            <Kpi label="Auslastung" value={formatPct(budget.usage)} />
            <Kpi
              label="Abweichung zum Wirtschaftsplan"
              value={`${budget.difference > 0 ? "+" : ""}${formatEUR(budget.difference)}`}
              hint={`${formatSignedPct(budget.differencePct)} · ${budget.difference <= 0 ? "unter Plan" : "über Plan"}`}
            />
          </div>
          <BudgetMeter usage={budget.usage} label="Budgetauslastung" />
          <p className="hint" style={{ margin: 0 }}>Gesamte Bewirtschaftungskosten einschließlich nicht umlagefähiger Anteile, ohne die gesonderte Erhaltungsrücklage.</p>
        </div>
      )}
      {findings.length > 0 && (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i} className={`${f.level} ${f.positionId ? "clickable" : ""}`} onClick={f.positionId ? () => focusElement(`pos-${f.positionId}`) : undefined}>
              {f.level === "error" ? "✗ " : f.level === "warning" ? "⚠ " : "ⓘ "}
              {f.text}
              {f.positionId && <span className="fix"> Zur Position →</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <span className="small muted">
          In die Mieterabrechnung gelangen nur Positionen, die umlagefähig und als geprüft bestätigt sind.
        </span>
        <span className="spacer" />
        <button className="primary" onClick={toStatement}>
          {statement ? "In Mieterabrechnung übernehmen" : `Mieterabrechnung ${annual.year} erstellen`}
        </button>
      </div>
    </div>
  );
}

function PlanSummaryCard({ data, plan }: { data: AppData; plan: EconomicPlan }) {
  const s = summarizePlan(plan);
  const findings = checkPlan(plan);
  const ours = (c: string) => fromCents(sumCents(plan.positions.filter((p) => p.classification === c).map((p) => toCents(p.amount))));
  const annuals = data.wegAnnuals.filter((a) => a.propertyId === plan.propertyId && a.unitId === plan.unitId).sort((a, b) => b.year - a.year);
  const comparison = annuals.find((a) => a.year === plan.year) ?? annuals.find((a) => a.year < plan.year) ?? null;
  const rows = comparePlanActual(plan, comparison);
  const drivers = explainDrivers(rows);

  // Prognose für den Mieter der Wohnung im Planjahr (zeitanteilig, nach Mietvertrag)
  const property = data.properties.find((p) => p.id === plan.propertyId)!;
  const tenant = data.tenants
    .filter((t) => t.unitId === plan.unitId && t.moveIn <= `${plan.year}-12-31` && (!t.moveOut || t.moveOut >= `${plan.year}-01-01`))
    .sort((a, b) => b.moveIn.localeCompare(a.moveIn))[0];
  const forecast = tenant ? forecastForTenant(plan, property, tenant) : null;
  const expected = ours("allocable");
  const uncertain = ours("review");
  const split = planSplit(plan);
  const years = comparison ? compareYears(plan, comparison) : null;
  const drivers2 = costDrivers(plan);
  const checkpoints = planCheckpoints(plan, data.wegAnnuals);

  return (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Prüfpunkte</h2>
          <span className="spacer" />
          <span className="badge warn">Prognose {plan.year}</span>
        </div>
        <Checkpoints items={checkpoints} />
      </div>

      <div className="card">
        <h2>Summen</h2>
        <div className="kpi-row">
          <Kpi label="laut Verwaltung umlagefähig" value={formatEUR(s.declaredAllocable)} />
          <Kpi label="laut Verwaltung nicht umlagefähig (inkl. Rücklage)" value={formatEUR(s.declaredNonAllocable)} />
          <Kpi
            label="Hausgeld pro Jahr"
            value={formatEUR(s.total)}
            hint={s.matchesAnnualHausgeld === false ? `⚠ Plan nennt ${formatEUR(plan.annualHausgeld!)}` : s.matchesAnnualHausgeld ? "✓ wie im Plan" : undefined}
          />
          <Kpi
            label="Hausgeld pro Monat"
            value={formatEUR(s.monthly)}
            hint={s.matchesMonthlyHausgeld === false ? `⚠ Plan nennt ${formatEUR(plan.monthlyHausgeld!)}` : s.matchesMonthlyHausgeld ? "✓ wie im Plan" : undefined}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <SplitBar
            parts={[
              { label: "geplant umlagefähig", value: split.allocable, hint: `${formatEUR(split.allocable)} · ${formatEUR(split.allocableMonthly)} pro Monat` },
              { label: "Eigentümeranteil inkl. Rücklage", value: split.owner, hint: `${formatEUR(split.owner)} · ${formatEUR(split.ownerMonthly)} pro Monat` },
            ]}
          />
          <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
            Einstufung laut Kennzeichnung der Verwaltung – sie muss anhand des Mietvertrags und der Kostenart geprüft werden.
          </p>
        </div>
        {s.undeclared > 0 && <p className="small muted" style={{ marginTop: 8 }}>Ohne Kennzeichnung der Verwaltung: {formatEUR(s.undeclared)}</p>}
        {findings.length > 0 && (
          <ul className="findings">
            {findings.map((f, i) => (
              <li key={i} className={`${f.level} ${f.positionId ? "clickable" : ""}`} onClick={f.positionId ? () => focusElement(`pos-${f.positionId}`) : undefined}>
                {f.level === "error" ? "✗ " : f.level === "warning" ? "⚠ " : "ⓘ "}
                {f.text}
                {f.positionId && <span className="fix"> Zur Position →</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="small" style={{ marginTop: 10 }}>
          Eigene Bewertung: umlagefähig {formatEUR(expected)} · nicht umlagefähig {formatEUR(ours("non_allocable"))} · zu prüfen {formatEUR(uncertain)}
        </p>
      </div>

      <div className="card">
        <h2>Prognose für die Mieterabrechnung {plan.year}</h2>
        <div className="alert warn small">
          Prognose auf Basis des Wirtschaftsplans – keine Abrechnung. Die tatsächliche Abrechnung erfolgt erst mit der Jahresabrechnung {plan.year}. Heizkosten werden nach
          der Heizkostenabrechnung verteilt und können vom Plan deutlich abweichen.
        </div>
        {!forecast ? (
          <p className="muted">Für {plan.year} ist kein Mieter dieser Wohnung erfasst.</p>
        ) : (
          <>
            <div className="kpi-row">
              <Kpi
                label={`erwartete Kosten ${tenant!.name}`}
                value={formatEUR(forecast.expectedShare)}
                hint={`${formatEUR(forecast.expectedYear)} pro Jahr${forecast.charges.length ? ` (inkl. ${forecast.charges.map((c) => `${c.label} ${formatEUR(c.share)}`).join(", ")} anteilig)` : ""} × ${forecast.days}/${forecast.yearDays} Tage${forecast.uncertainShare ? `, zzgl. bis zu ${formatEUR(forecast.uncertainShare)} ungeklärt` : ""}`}
              />
              <Kpi label="Vorauszahlungen im Zeitraum" value={formatEUR(forecast.prepayments)} hint={tenant!.lease ? "laut Mietvertrag" : "laut Mietverlauf"} />
              <Kpi
                label="voraussichtliches Ergebnis"
                value={formatEUR(Math.abs(forecast.result))}
                hint={forecast.result > 0 ? "Nachzahlung (Prognose)" : "Guthaben (Prognose)"}
              />
              <Kpi label="kostendeckende Vorauszahlung / Monat" value={formatEUR(Math.ceil(forecast.expectedYear / 12))} hint="Anpassung nur nach einer Abrechnung (§ 560 Abs. 4 BGB)" />
            </div>
            <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
              {tenant!.lease ? "Nur im Mietvertrag vereinbarte Kosten, nach dem vertraglichen Umlagemaßstab. " : "Ohne erfassten Mietvertrag: alle als umlagefähig bewerteten Kosten. "}
              Zeitanteilig gerechnet – Heizkosten hängen tatsächlich vom Verbrauch in der Mietzeit ab.
            </p>
          </>
        )}
      </div>

      {years && (
        <div className="card">
          <h2>
            Vergleich Ist {years.actualYear} ↔ Plan {years.planYear}
          </h2>
          <div className="two-col">
            <div className="table-wrap">
              <table className="compact fin-table">
                <thead>
                  <tr>
                    <th>Kennzahl</th>
                    <th className="num">{years.actualYear} Ist</th>
                    <th className="num">{years.planYear} Plan</th>
                    <th className="num">Veränderung</th>
                  </tr>
                </thead>
                <tbody>
                  {years.rows.map((r) => (
                    <tr key={r.label} className={r.strong ? "sum" : ""}>
                      <td>{r.label}</td>
                      <td className="num">{formatEUR(r.actual)}</td>
                      <td className="num">{formatEUR(r.plan)}</td>
                      <td className="num">
                        {r.difference > 0 ? "+" : ""}
                        {formatEUR(r.difference)} <span className="muted">({formatSignedPct(r.differencePct)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <strong>Umlagefähige Betriebskosten</strong>
              <BarList
                items={[
                  { label: `${years.actualYear} Ist`, value: years.rows[3].actual, hint: "eigene Bewertung" },
                  { label: `${years.planYear} Plan`, value: years.rows[3].plan, forecast: true, hint: "Kennzeichnung der Verwaltung" },
                ]}
              />
              <p className="hint" style={{ margin: 0 }}>
                Rechnerische Veränderung {years.rows[3].difference > 0 ? "+" : ""}
                {formatEUR(years.rows[3].difference)} ({formatSignedPct(years.rows[3].differencePct)}). Kein abschließend geprüfter Vergleich: Der Plan verteilt nach MEA, das
                Ist nach Verbrauch und Heizkostenabrechnung; offene Positionen sind im Ist nicht enthalten.
              </p>
              {years.previousPlan && (
                <p className="small" style={{ margin: 0 }}>
                  Plan mit Plan: Das Hausgeld steigt von {formatEUR(years.previousPlan.total)} ({years.previousPlan.year}) auf {formatEUR(years.previousPlan.next)} (
                  {formatSignedPct(years.previousPlan.differencePct)}) – aussagekräftiger für die Budgetentwicklung als Ist mit Plan.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {drivers2.length > 0 && (
        <div className="card">
          <h2>Kostentreiber {plan.year}</h2>
          <p className="hint">Größte umlagefähige Positionen des Wirtschaftsplans (Anteil der Wohnung), Summe {formatEUR(split.allocable)}.</p>
          <BarList
            items={drivers2.map((d) => ({ label: d.label, value: d.amount, forecast: true, hint: d.members ? d.members.join(", ") : undefined }))}
          />
        </div>
      )}

      <div className="card">
        <h2>Plan-Ist-Vergleich {comparison ? `(Plan ${plan.year} ↔ Ist ${comparison.year})` : ""}</h2>
        {!comparison ? (
          <p className="muted">Erfasse eine WEG-Jahresabrechnung dieser Wohnung, um Plan und Ist zu vergleichen.</p>
        ) : (
          <>
            {drivers.length > 0 && (
              <ul className="findings">
                {drivers.map((d) => (
                  <li key={d} className="info">{d}</li>
                ))}
              </ul>
            )}
            <div className="table-wrap">
              <table className="compact">
                <thead>
                  <tr>
                    <th>Kostengruppe</th>
                    <th className="num">Plan {plan.year}</th>
                    <th className="num">Ist {comparison.year}</th>
                    <th className="num">Differenz</th>
                    <th className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num">{formatEUR(r.plan)}</td>
                      <td className="num">{r.actual !== null ? formatEUR(r.actual) : "–"}</td>
                      <td className="num">{r.difference !== null ? (r.difference > 0 ? "+" : "") + formatEUR(r.difference) : "–"}</td>
                      <td className="num">{formatPct(r.differencePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>
              Heizung: Im Plan sind Energie- und Wartungskosten der Anlage nach Miteigentumsanteil budgetiert, im Ist stehen die Heizkosten laut Heizkostenabrechnung.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function HeatingCard({ annual, onChange }: { annual: WegAnnualStatement; onChange: (h: HeatingBill | null) => void }) {
  const h = annual.heating;
  if (!h) {
    return (
      <div className="card">
        <h2>Heiz- und Warmwasserkostenabrechnung</h2>
        <p className="muted">Die Heizkostenabrechnung des Messdienstes belegt die Heizkosten der Wohnung und ihre Verteilung nach HeizkostenV.</p>
        <button
          onClick={() =>
            onChange({
              heatSource: "",
              buildingTotal: null,
              unitShare: annual.positions.find((p) => p.heating === "total")?.amount ?? 0,
              baseSharePct: 30,
              areaTotal: null,
              consumptionHeatingKwh: null,
              consumptionWaterKwh: null,
              components: [],
              co2Applicable: true,
              co2Cost: null,
              co2Kg: null,
            })
          }
        >
          Heizkostenabrechnung erfassen
        </button>
      </div>
    );
  }
  const set = (patch: Partial<HeatingBill>) => onChange({ ...h, ...patch });
  const compSum = fromCents(sumCents(h.components.map((c) => toCents(c.amount))));
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Heiz- und Warmwasserkostenabrechnung</h2>
        <span className="spacer" />
        <button className="ghost" onClick={() => confirm("Heizkostenabrechnung entfernen?") && onChange(null)}>Entfernen</button>
      </div>
      <div className="grid">
        <label className="field">
          Wärmeerzeugung
          <input value={h.heatSource} onChange={(e) => set({ heatSource: e.target.value })} placeholder="z. B. Gas, Fernwärme, Wärmepumpe" />
        </label>
        <label className="field">
          Gesamtheizkosten der WEG (€)
          <NumberInput value={h.buildingTotal ?? undefined} onChange={(v) => set({ buildingTotal: v })} />
        </label>
        <label className="field">
          Anteil der Wohnung (€)
          <NumberInput value={h.unitShare} onChange={(v) => set({ unitShare: v })} />
        </label>
        <label className="field">
          Grundkostenanteil (%)
          <NumberInput value={h.baseSharePct ?? undefined} onChange={(v) => set({ baseSharePct: v })} />
        </label>
        <label className="field">
          Fläche für die Verteilung (m²)
          <NumberInput value={h.areaTotal ?? undefined} onChange={(v) => set({ areaTotal: v })} />
        </label>
        <label className="field">
          Verbrauch Heizung (kWh)
          <NumberInput value={h.consumptionHeatingKwh ?? undefined} onChange={(v) => set({ consumptionHeatingKwh: v })} />
        </label>
        <label className="field">
          Verbrauch Warmwasser (kWh)
          <NumberInput value={h.consumptionWaterKwh ?? undefined} onChange={(v) => set({ consumptionWaterKwh: v })} />
        </label>
      </div>
      <h3 style={{ marginTop: 16 }}>Enthaltene Kosten der Liegenschaft</h3>
      <p className="hint">Kostenaufstellung der Heizkostenabrechnung (z. B. Brennstoff/Wärmestrom, Heizungswartung). Daran erkennt die App, welche Positionen der Jahresabrechnung schon in den Heizkosten stecken.</p>
      <table className="compact">
        <tbody>
          {(h.includedCosts ?? []).map((c) => (
            <tr key={c.id}>
              <td>
                <input
                  value={c.label}
                  onChange={(e) => set({ includedCosts: (h.includedCosts ?? []).map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })}
                  aria-label="enthaltene Kostenart"
                />
              </td>
              <td style={{ width: 140 }}>
                <NumberInput
                  value={c.amount}
                  onChange={(amount) => set({ includedCosts: (h.includedCosts ?? []).map((x) => (x.id === c.id ? { ...x, amount } : x)) })}
                  ariaLabel="Betrag"
                />
              </td>
              <td style={{ width: 40 }}>
                <button className="ghost" onClick={() => set({ includedCosts: (h.includedCosts ?? []).filter((x) => x.id !== c.id) })} aria-label="entfernen">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={{ marginTop: 8 }} onClick={() => set({ includedCosts: [...(h.includedCosts ?? []), { id: uid(), label: "", amount: 0 }] })}>+ enthaltene Kosten</button>

      <h3 style={{ marginTop: 16 }}>Anteil der Wohnung – Bestandteile</h3>
      <table className="compact">
        <tbody>
          {h.components.map((c) => (
            <tr key={c.id}>
              <td>
                <input value={c.label} onChange={(e) => set({ components: h.components.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })} aria-label="Bestandteil" />
              </td>
              <td style={{ width: 140 }}>
                <NumberInput value={c.amount} onChange={(amount) => set({ components: h.components.map((x) => (x.id === c.id ? { ...x, amount } : x)) })} ariaLabel="Betrag" />
              </td>
              <td style={{ width: 40 }}>
                <button className="ghost" onClick={() => set({ components: h.components.filter((x) => x.id !== c.id) })} aria-label="entfernen">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              Summe{" "}
              {h.components.length > 0 &&
                (toCents(compSum) === toCents(h.unitShare) ? <span className="badge ok">✓ = Anteil der Wohnung</span> : <span className="badge danger">✗ ≠ {formatEUR(h.unitShare)}</span>)}
            </td>
            <td className="num">{formatEUR(compSum)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <button style={{ marginTop: 8 }} onClick={() => set({ components: [...h.components, { id: uid(), label: "", amount: 0 }] })}>+ Bestandteil</button>
      <div className="grid" style={{ marginTop: 16 }}>
        <label className="row small">
          <input type="checkbox" checked={h.co2Applicable} onChange={(e) => set({ co2Applicable: e.target.checked })} />
          CO2-Kostenaufteilung anwenden (Öl, Gas, Fernwärme – nicht bei Wärmepumpe mit Strom)
        </label>
        {h.co2Applicable && (
          <>
            <label className="field">
              CO2-Kosten Anteil Wohnung (€)
              <NumberInput value={h.co2Cost ?? undefined} onChange={(v) => set({ co2Cost: v })} />
            </label>
            <label className="field">
              CO2-Ausstoß der Liegenschaft (kg)
              <NumberInput value={h.co2Kg ?? undefined} onChange={(v) => set({ co2Kg: v })} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
