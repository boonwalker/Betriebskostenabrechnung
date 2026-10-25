import { IssueList } from "../components/IssueList";
import { useMemo, useState, type ReactNode } from "react";
import { Balance, NumberInput, type PageProps } from "../components/ui";
import ReceiptImport from "../components/ReceiptImport";
import { COST_CATEGORIES, isHeatingCategory, KEY_LABELS } from "../lib/betrkv";
import { co2Stage } from "../lib/co2";
import { buildSegments, calculateStatement } from "../lib/calc";
import { AttachmentsCard } from "../components/Attachments";
import { autoAttach } from "../lib/attachments";
import { aiAccess } from "../lib/aiAccess";
import { meterDates, METER_LABELS, segmentConsumption } from "../lib/meters";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR, formatNum } from "../lib/format";
import { changedSinceRelease, releaseTenant, revokeRelease, statementReadiness } from "../lib/release";
import { uid } from "../lib/store";
import { transferToStatement } from "../lib/weg";
import type { AllocationKey, CostItem, MeterKind, Property, Section35aKind, Statement } from "../lib/types";
import { askConfirm, showMessage } from "../components/dialog";

export default function StatementEditor({ data, update, statementId }: PageProps & { statementId: string }) {
  const statement = data.statements.find((s) => s.id === statementId);
  const property = data.properties.find((p) => p.id === statement?.propertyId);
  const [importing, setImporting] = useState(false);
  const result = useMemo(
    () => (statement && property ? calculateStatement(statement, property, data.tenants) : null),
    [statement, property, data.tenants],
  );

  if (!statement || !property || !result) {
    return (
      <div className="card empty">
        <p>Abrechnung nicht gefunden.</p>
        <a className="btn" href="#/abrechnungen">Zur Übersicht</a>
      </div>
    );
  }

  const set = (patch: Partial<Statement>) =>
    update((d) => ({ ...d, statements: d.statements.map((s) => (s.id === statement.id ? { ...s, ...patch } : s)) }));
  const setCost = (id: string, patch: Partial<CostItem>) =>
    set({ costs: statement.costs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addCost = () =>
    set({
      costs: [
        ...statement.costs,
        property.type === "etw"
          ? { id: uid(), category: 1, label: "Grundsteuer", amount: 0, key: "direct", directUnitId: property.units[0]?.id }
          : { id: uid(), category: 1, label: "Grundsteuer", amount: 0, key: "area" },
      ],
    });
  // Fehlende Abgaben der Gemeinde mit einem Klick als Position anlegen (Jahresbetrag laut Bescheid, direkt der Wohnung)
  const applyFix = (fix: { kind: "tax" | "waste"; amount: number }) =>
    set({
      costs: [
        ...statement.costs,
        fix.kind === "tax"
          ? { id: uid(), category: 1, label: "Grundsteuer", amount: fix.amount, key: "direct", directUnitId: property.units[0]?.id, source: "Bescheid der Gemeinde" }
          : {
              id: uid(),
              category: 8,
              label: "Müllbeseitigung (Bescheid der Gemeinde)",
              amount: fix.amount,
              key: "direct",
              directUnitId: property.units[0]?.id,
              source: "Bescheid der Gemeinde",
            },
      ],
    });
  const setOverride = (tenantId: string, value: number | null) => {
    const next = { ...statement.prepaymentOverrides };
    if (value === null) delete next[tenantId];
    else next[tenantId] = value;
    set({ prepaymentOverrides: next });
  };

  const readiness = statementReadiness(statement, data);
  // Zählerstände je Wohnung: mit Nutzerwechsel an jedem Stichtag (für die Aufteilung nötig), sonst nur Anfang und Ende (zur Kontrolle)
  const allSegs = buildSegments(property.units, data.tenants.filter((t) => t.propertyId === property.id), statement.periodStart, statement.periodEnd);
  const meterUnits = property.units
    .map((unit) => ({ unit, segs: allSegs.filter((sg) => sg.unitId === unit.id) }))
    .filter((x) => x.segs.some((sg) => sg.tenantId));
  // Anfangsstand = Endstand der Vorjahresabrechnung
  const previous = data.statements
    .filter((s) => s.propertyId === property.id && s.periodEnd < statement.periodStart)
    .sort((x, y) => y.periodEnd.localeCompare(x.periodEnd))[0];
  const carried = (unitId: string, meter: MeterKind) => {
    const row = previous?.meterReadings?.[unitId]?.[meter];
    const last = row?.[row.length - 1];
    return last === null || last === undefined ? undefined : last;
  };
  // Gesperrt erst, wenn alle Mietverhältnisse freigegeben sind; einzelne Freigaben bleiben eingefroren
  const released = statement.status === "released";
  const year = Number(statement.periodStart.slice(0, 4));
  const annuals = data.wegAnnuals.filter((a) => a.propertyId === property.id && a.year === year);

  const takeOverWeg = async () => {
    // Noch ungeprüfte, eindeutig als umlagefähig eingestufte Positionen gleich hier bestätigen lassen
    const transferred = new Set(statement.costs.map((c) => c.sourcePositionId).filter(Boolean));
    const open = annuals.flatMap((a) =>
      a.positions.filter((p) => !p.reviewed && p.classification === "allocable" && p.amount !== 0 && p.heating !== "component" && !transferred.has(p.id)),
    );
    let sources = annuals;
    if (open.length) {
      const confirmed = await askConfirm(
        `${open.length} Position${open.length === 1 ? " ist" : "en sind"} in der WEG-Jahresabrechnung ${year} noch nicht geprüft. Die App stuft sie als umlagefähig ein:\n\n` +
          open.map((p) => `• ${p.label}: ${formatEUR(p.amount)}`).join("\n") +
          "\n\nEinstufung bestätigen und übernehmen?",
        { confirmLabel: "Bestätigen und übernehmen" },
      );
      if (confirmed) {
        const ids = new Set(open.map((p) => p.id));
        sources = annuals.map((a) => ({ ...a, positions: a.positions.map((p) => (ids.has(p.id) ? { ...p, reviewed: true } : p)) }));
      }
    }
    let costs = statement.costs;
    const notes: string[] = [];
    let added = 0;
    for (const a of sources) {
      const { items, skipped } = transferToStatement(a, { ...statement, costs }, { property, tenants: data.tenants });
      costs = [...costs, ...items];
      added += items.length;
      for (const sk of skipped) if (!["bereits übernommen", "nicht umlagefähig", "Betrag 0"].includes(sk.reason)) notes.push(`• ${sk.position.label}: ${sk.reason}`);
    }
    // Bestätigte Einstufungen in der WEG-Abrechnung festhalten, Positionen in die Abrechnung schreiben
    update((d) => ({
      ...d,
      wegAnnuals: d.wegAnnuals.map((w) => sources.find((s) => s.id === w.id) ?? w),
      statements: d.statements.map((s) => (s.id === statement.id ? { ...s, costs } : s)),
    }));
    void showMessage(
      `${added} Position${added === 1 ? "" : "en"} übernommen.` +
        (notes.length ? `\n\nNicht übernommen:\n${notes.join("\n")}\n\nPrüfen kannst du sie in der WEG-Jahresabrechnung ${year}.` : ""),
    );
  };

  const save = (next: Statement) => update((d) => ({ ...d, statements: d.statements.map((s) => (s.id === next.id ? next : s)) }));
  const release = (tenantId: string) => {
    try {
      save(releaseTenant(statement, data, tenantId));
    } catch (e) {
      void showMessage(e instanceof Error ? e.message : String(e));
    }
  };
  const revoke = async (tenantId: string, name: string) =>
    (await askConfirm(`Freigabe für ${name} aufheben? Das Anschreiben wird wieder zum Entwurf.`, { confirmLabel: "Aufheben" })) &&
    save(revokeRelease(statement, data, tenantId));

  const today = todayISO();
  const daysLeft = Math.round((Date.parse(result.deadline) - Date.parse(today)) / 86_400_000);

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/abrechnungen" className="small">← Abrechnungen</a>
          <h1>Betriebskostenabrechnung {property.name}</h1>
          <span className={`badge ${statement.status === "draft" ? "status-draft" : "status-released"}`}>
            {statement.status === "released" ? "✓ vollständig freigegeben" : statement.status === "partial" ? "teilweise freigegeben" : "Entwurf"}
          </span>
        </div>
        <a className="btn primary" href={`#/abrechnungen/${statement.id}/druck`}>Abrechnungen drucken / PDF</a>
      </div>

      <div className="card">
        <h2>{readiness.ready ? "Bereit zur Freigabe" : released ? "Freigegeben" : "Freigabe"}</h2>
        {(readiness.general.length > 0 || readiness.generalHints.length > 0) && (
          <>
            <div className="small muted" style={{ marginBottom: 4 }}>Betrifft alle Mietverhältnisse:</div>
            <IssueList errors={readiness.general} warnings={readiness.generalHints} targets={readiness.targets} onFix={applyFix} style={{ marginTop: 0 }} />
          </>
        )}
        {readiness.tenants.map((t) => {
          const rel = statement.releases[t.tenantId];
          const changed = rel && changedSinceRelease(statement, data, t.tenantId);
          return (
            <div key={t.tenantId} className="tenant-release">
              <div className="row">
                <strong>{t.name}</strong>
                {rel ? (
                  <span className="badge status-released">✓ freigegeben am {formatDate(rel.releasedAt.slice(0, 10))}</span>
                ) : (
                  <span className={`badge ${t.ready ? "ok" : "status-draft"}`}>{t.ready ? "bereit" : "Entwurf"}</span>
                )}
                <span className="spacer" />
                {rel ? (
                  <button className="ghost" onClick={() => revoke(t.tenantId, t.name)}>Freigabe aufheben</button>
                ) : (
                  <button className="primary" disabled={!t.ready} onClick={() => release(t.tenantId)} title={t.ready ? "Ergebnis einfrieren und als versandfertig markieren" : "Erst die offenen Punkte klären"}>
                    Freigeben
                  </button>
                )}
              </div>
              {changed && (
                <div className="alert danger small" style={{ marginTop: 6, marginBottom: 0 }}>
                  Seit der Freigabe würde sich das Ergebnis geändert haben. Das Anschreiben zeigt weiterhin den freigegebenen Stand – hebe die Freigabe auf, um neu zu
                  berechnen.
                </div>
              )}
              {!rel && (t.blockers.length > 0 || t.hints.length > 0) && (
                <IssueList errors={t.blockers} warnings={t.hints} targets={readiness.targets} onFix={applyFix} style={{ marginTop: 6 }} />
              )}
            </div>
          );
        })}
        {!readiness.ready && !released && (
          <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Jedes Mietverhältnis lässt sich freigeben, sobald die allgemeinen und seine eigenen Punkte erledigt sind. Nicht freigegebene Anschreiben werden nur als Entwurf gedruckt.
          </p>
        )}
        {statement.status === "partial" && (
          <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Freigegebene Anschreiben sind eingefroren. Änderungen an gemeinsamen Kosten wirken nur auf die übrigen Mietverhältnisse.
          </p>
        )}
      </div>

      <fieldset className="plain-fieldset" disabled={released}>
      {daysLeft < 0 ? (
        <div className="alert danger">
          Die Abrechnungsfrist ist am {formatDate(result.deadline)} abgelaufen. Nachforderungen sind in der Regel ausgeschlossen (§ 556 Abs. 3 BGB), Guthaben müssen trotzdem ausgezahlt werden.
        </div>
      ) : daysLeft <= 90 ? (
        <div className="alert warn">
          Noch {daysLeft} Tage: Die Abrechnung muss den Mietern spätestens am {formatDate(result.deadline)} zugehen.
        </div>
      ) : null}


      <div className="card">
        <div className="grid">
          <label className="field">
            Abrechnungszeitraum von
            <input type="date" value={statement.periodStart} onChange={(e) => e.target.value && set({ periodStart: e.target.value })} />
          </label>
          <label className="field">
            bis
            <input type="date" value={statement.periodEnd} onChange={(e) => e.target.value && set({ periodEnd: e.target.value })} />
          </label>
          <div>
            <div className="muted small">Umlagefähige Gesamtkosten</div>
            <div className="stat">{formatEUR(result.totalCosts)}</div>
          </div>
          <div>
            <div className="muted small">davon trägst du (Leerstand, CO2)</div>
            <div className="stat">{formatEUR(result.landlordShare)}</div>
          </div>
        </div>
      </div>

      <div className="card" id="kosten">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Kostenpositionen</h2>
          <span className="spacer" />
          {annuals.length > 0 && (
            <button className="wrap" onClick={takeOverWeg} title="Geprüfte, umlagefähige Positionen der WEG-Jahresabrechnung übernehmen">Aus WEG-Jahresabrechnung {year} übernehmen</button>
          )}
          <button onClick={() => setImporting(true)}>📄 Belege hochladen</button>
          <button className="primary" onClick={addCost}>+ Position</button>
        </div>
        {statement.costs.length === 0 ? (
          <div className="empty">
            <p>Noch keine Kosten erfasst. Lade deine Rechnungen und Bescheide hoch oder trage die Beträge selbst ein.</p>
          </div>
        ) : (
          <>
            <div className="cost-cards">
              {statement.costs.map((c, i) => (
                <CostRow key={c.id} index={i + 1} cost={c} property={property} onChange={(patch) => setCost(c.id, patch)} onRemove={() => set({ costs: statement.costs.filter((x) => x.id !== c.id) })} />
              ))}
            </div>
            <div className="cost-sum">
              <span>Summe</span>
              <strong>{formatEUR(result.totalCosts)}</strong>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Ergebnis je Mieter</h2>
        {result.tenants.length === 0 ? (
          <p className="muted">Im Abrechnungszeitraum wohnten keine Mieter in diesem Objekt.</p>
        ) : (
          <div className="table-wrap">
            <table className="transposed">
              <thead>
                <tr>
                  <th />
                  {result.tenants.map((r) => (
                    <th key={r.tenant.id + r.start} scope="col" className="num">
                      <span className="tenant-name">{r.tenant.name}</span>
                      <span className="muted small">{r.unit.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Zeitraum</th>
                  {result.tenants.map((r) => (
                    <td key={r.tenant.id + r.start} className="num">
                      {formatDate(r.start)} –<br />
                      {formatDate(r.end)}
                      <div className="muted small">{r.days} Tage</div>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Kostenanteil</th>
                  {result.tenants.map((r) => (
                    <td key={r.tenant.id + r.start} className="num">{formatEUR(r.totalCosts)}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Vorauszahlungen</th>
                  {result.tenants.map((r) => {
                    const overridden = statement.prepaymentOverrides[r.tenant.id] !== undefined;
                    return (
                      <td key={r.tenant.id + r.start} className="num wrap" id={`vz-${r.tenant.id}`}>
                        <NumberInput
                          value={r.prepayments}
                          onChange={(v) => setOverride(r.tenant.id, v)}
                          style={{ width: "100%", maxWidth: 140 }}
                          ariaLabel={`Vorauszahlungen ${r.tenant.name}`}
                        />
                        <div className="muted small">
                          {overridden ? (
                            <button className="ghost small" onClick={() => setOverride(r.tenant.id, null)}>
                              Soll: {formatEUR(r.prepaymentsCalculated.total)} übernehmen
                            </button>
                          ) : (
                            <>BK {formatEUR(r.prepaymentsCalculated.operating)}<br />HK {formatEUR(r.prepaymentsCalculated.heating)}</>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">tatsächlich gezahlt?</th>
                  {result.tenants.map((r) => (
                    <td key={r.tenant.id + r.start} className="num">
                      <label className="row small" style={{ flexWrap: "nowrap", justifyContent: "flex-end" }}>
                        <input
                          type="checkbox"
                          checked={statement.prepaymentsConfirmed[r.tenant.id] === true}
                          onChange={(e) => set({ prepaymentsConfirmed: { ...statement.prepaymentsConfirmed, [r.tenant.id]: e.target.checked } })}
                        />
                        bestätigt
                      </label>
                    </td>
                  ))}
                </tr>
                <tr className="actions">
                  <th scope="row">Ergebnis</th>
                  {result.tenants.map((r) => (
                    <td key={r.tenant.id + r.start} className="num wrap">
                      {!statement.releases[r.tenant.id] && !readiness.tenants.find((x) => x.tenantId === r.tenant.id)?.ready && (
                        <div className="small muted">vorläufig</div>
                      )}
                      <Balance value={r.balance} />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          Vergleiche die Vorauszahlungen mit deinen Kontoauszügen. Weicht der gezahlte Betrag vom Mietvertrag ab (z. B. Rückstände), trage ihn ein und bestätige ihn erst dann.
        </p>
        {(result.vacancies.length > 0 || result.co2.length > 0 || result.landlordItems.length > 0) && (
          <>
            <h3 id="vermieteranteil" style={{ marginTop: 16 }}>Trägst du als Vermieter</h3>
            <table className="compact">
              <tbody>
                {result.vacancies.map((v) => (
                  <tr key={v.unit.id + v.start}>
                    <td>Leerstand {v.unit.name}</td>
                    <td>{formatDate(v.start)} – {formatDate(v.end)} ({v.days} Tage)</td>
                    <td className="num">{formatEUR(v.amount)}</td>
                  </tr>
                ))}
                {result.landlordItems.map((x, i) => (
                  <tr key={x.costId + i}>
                    <td>{x.label}</td>
                    <td>{x.reason}</td>
                    <td className="num">{formatEUR(x.amount)}</td>
                  </tr>
                ))}
                {result.co2.map((c) => (
                  <tr key={c.costId}>
                    <td>CO2-Kosten {c.label}</td>
                    <td>
                      {formatNum(c.kgPerM2Year)} kg CO2/m²/Jahr → Stufe {c.stage}: {c.landlordPct} % Vermieter (CO2KostAufG)
                    </td>
                    <td className="num">{formatEUR(c.landlordAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {meterUnits.length > 0 && (
        <div className="card" id="zaehler">
          <h2>Zählerstände</h2>
          {meterUnits.map(({ unit, segs }) => {
            const dates = meterDates(segs);
            const change = segs.length > 1;
            const stored = statement.meterReadings?.[unit.id] ?? {};
            // Leerer Anfangsstand wird aus dem Endstand der Vorjahresabrechnung übernommen
            const rowOf = (meter: MeterKind) => {
              const row = [...(stored[meter] ?? [])];
              while (row.length < dates.length) row.push(null);
              const carry = carried(unit.id, meter);
              const fromPrevious = (row[0] === null || row[0] === undefined) && carry !== undefined;
              if (fromPrevious) row[0] = carry;
              return { row, fromPrevious };
            };
            const values = Object.fromEntries((Object.keys(METER_LABELS) as MeterKind[]).map((m) => [m, rowOf(m).row]));
            const effective = { ...statement, meterReadings: { ...statement.meterReadings, [unit.id]: values } };
            const setValue = (meter: MeterKind, i: number, v: number | null) => {
              const row = [...values[meter]];
              row[i] = v;
              set({ meterReadings: { ...statement.meterReadings, [unit.id]: { ...stored, [meter]: row } } });
            };
            const who = (sg: (typeof segs)[number]) => (sg.tenantId ? data.tenants.find((t) => t.id === sg.tenantId)?.name : "Leerstand");
            const meters = (Object.keys(METER_LABELS) as MeterKind[]).map((meter) => {
              const consumption = segmentConsumption(effective, unit.id, segs, meter);
              const { row: raw, fromPrevious } = rowOf(meter);
              return { meter, raw, fromPrevious, consumption, invalid: raw.every((v) => v !== null && v !== undefined) && !consumption };
            });
            const anyCarried = meters.some((m) => m.fromPrevious);
            return (
              <div key={unit.id} className="meter-unit">
                {property.units.length > 1 && <h3>{unit.name}</h3>}
                <p className={`meter-mode ${change ? "change" : ""}`}>
                  {change ? (
                    <>
                      <strong>Mieterwechsel am {formatDate(segs[1].start)}</strong> – mit den Ständen zum Wechsel wird der Verbrauch auf die Mieter aufgeteilt.
                    </>
                  ) : (
                    <>
                      <strong>Kein Mieterwechsel {year}</strong> – die Kosten der Wohnung gehen vollständig an {who(segs.find((sg) => sg.tenantId)!)}. Die Stände dienen
                      nur der Kontrolle des Verbrauchs{anyCarried ? "; trag einfach den Endstand ein." : "."}
                    </>
                  )}
                </p>
                <div className="table-wrap">
                  <table className="transposed meters">
                    <thead>
                      <tr>
                        <th />
                        {meters.map(({ meter }) => (
                          <th key={meter} scope="col" className="num">{METER_SHORT[meter]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dates.map((d, i) => (
                        <tr key={d + i}>
                          <th scope="row">
                            {i === 0 ? "Beginn" : i === dates.length - 1 ? "Ende" : "Wechsel"}
                            <div>{formatDate(d)}</div>
                          </th>
                          {meters.map(({ meter, raw, fromPrevious }) => (
                            <td key={meter} className="num">
                              <NumberInput
                                value={raw[i] ?? undefined}
                                allowEmpty
                                className={i === 0 && fromPrevious ? "carried" : undefined}
                                onChange={(v) => setValue(meter, i, Number.isFinite(v) ? v : null)}
                                ariaLabel={`${METER_LABELS[meter]} ${formatDate(d)}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                      {segs.map((sg, si) => (
                        <tr key={si} className={si === 0 ? "meter-sum first" : "meter-sum"}>
                          <th scope="row">{change ? `Verbrauch ${who(sg)}` : "Verbrauch"}</th>
                          {meters.map(({ meter, consumption, invalid }) => (
                            <td key={meter} className="num wrap">
                              {invalid ? (
                                si === 0 && <span className="badge danger">Stände fallen – Tippfehler oder Zählertausch?</span>
                              ) : consumption ? (
                                <strong>{formatNum(consumption[si])}</strong>
                              ) : (
                                <span className="muted">–</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint" style={{ marginTop: 10 }}>
                  {anyCarried && <>Kursive Anfangsstände stammen aus der Abrechnung {previous!.periodStart.slice(0, 4)} – überschreibbar. </>}
                  {change ? (
                    <>
                      Stände z. B. aus dem Übergabeprotokoll und der Heizkosten- bzw. Wasserabrechnung („Ablesewert alt/neu“). Ohne Stände gilt § 9b Abs. 2 HeizkostenV
                      (Heizung nach Gradtagzahlen, sonst nach Zeit). Kennst du nur den Verbrauch je Mieter (z. B. aus der Nutzerwechsel-Abrechnung des Messdienstes), trage
                      Beginn 0, beim Wechsel den Verbrauch des ersten Mieters und am Ende die Summe ein.
                    </>
                  ) : (
                    <>Der Endstand wird im nächsten Jahr automatisch zum Anfangsstand.</>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}

      </fieldset>

      <AttachmentsCard
        data={data}
        update={update}
        property={property}
        year={year}
        tenants={result.tenants.map((r) => r.tenant).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)}
      />

      {importing && (
        <ReceiptImport
          access={aiAccess(data.settings)}
          statement={statement}
          property={property}
          onClose={() => setImporting(false)}
          onAdd={(items, notices) => {
            set({ costs: [...statement.costs, ...items] });
            // Grundsteuer-/Abgabenbescheid gleich als Anlage fürs Mieterschreiben übernehmen
            if (notices.length)
              void import("../lib/pages")
                .then(({ filesToPages }) => filesToPages(notices))
                .then((pages) => update((d) => autoAttach(d, property.id, year, "propertyTax", pages)))
                .catch(() => undefined);
          }}
        />
      )}
    </>
  );
}

/** Kurze Spaltenköpfe für die Zählertabelle */
const METER_SHORT: Record<MeterKind, ReactNode> = {
  heating: <>Heizung <em className="unit">kWh</em></>,
  water: <>Warmwasser <em className="unit">kWh</em></>,
  coldWater: <>Kaltwasser <em className="unit">m³</em></>,
};

function CostRow({ index, cost, property, onChange, onRemove }: { index: number; cost: CostItem; property: Property; onChange: (p: Partial<CostItem>) => void; onRemove: () => void }) {
  const heating = isHeatingCategory(cost.category);
  const [open, setOpen] = useState(!!(cost.laborCost || cost.co2Cost));
  const totalArea = property.units.reduce((a, u) => a + u.area, 0);
  const stage = cost.co2Kg && totalArea ? co2Stage(cost.co2Kg / totalArea) : null;
  const needsConsumption = cost.key === "consumption" || cost.key === "heating";

  return (
    <div className="cost-card">
      <div className="cost-card-head">
        <span className="cost-card-no">{index}</span>
        <strong>{cost.label || "Neue Position"}</strong>
        <span className="spacer" />
        <span className="cost-card-amount">{formatEUR(cost.amount || 0)}</span>
        <button className="ghost small" onClick={onRemove} aria-label="Position entfernen">✕</button>
      </div>
      <div className="cost-fields">
        <span className="cost-field-label">Kostenart</span>
        <div>
          <select
            value={cost.category}
            onChange={(e) => {
              const cat = COST_CATEGORIES.find((c) => c.no === Number(e.target.value))!;
              const labelWasDefault = COST_CATEGORIES.some((c) => c.label === cost.label) || !cost.label;
              // Eigentumswohnung: Grundsteuer laut Einzelbescheid gehört direkt zur Wohnung
              const direct = cat.no === 1 && property.type === "etw";
              onChange({
                category: cat.no,
                key: direct ? "direct" : cat.defaultKey,
                ...(direct ? { directUnitId: property.units[0]?.id } : {}),
                ...(labelWasDefault ? { label: cat.label } : {}),
              });
            }}
            aria-label="Kostenart"
          >
            {COST_CATEGORIES.map((c) => (
              <option key={c.no} value={c.no}>{c.no}. {c.label}</option>
            ))}
          </select>
        </div>
        <span className="cost-field-label">Bezeichnung</span>
        <div>
          <input value={cost.label} onChange={(e) => onChange({ label: e.target.value })} aria-label="Bezeichnung" />
          {cost.sourceAnnualId ? (
            <div className="muted small" title={cost.note}>
              aus <a href={`#/weg/jahresabrechnung/${cost.sourceAnnualId}`}>WEG-Jahresabrechnung</a>, Anteil der Wohnung
            </div>
          ) : (
            cost.source && <div className="muted small" title={cost.note}>aus Beleg: {cost.source}</div>
          )}
        </div>
        <span className="cost-field-label">Betrag (€)</span>
        <div>
          <NumberInput value={cost.amount} onChange={(amount) => onChange({ amount })} ariaLabel="Betrag" />
        </div>
        <span className="cost-field-label">Umlageschlüssel</span>
        <div>
          <select value={cost.key} onChange={(e) => onChange({ key: e.target.value as AllocationKey })} aria-label="Umlageschlüssel">
            {Object.entries(KEY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        {cost.key === "direct" && (
          <>
            <span className="cost-field-label">Betrifft Einheit</span>
            <div>
              <select value={cost.directUnitId ?? ""} onChange={(e) => onChange({ directUnitId: e.target.value })}>
                <option value="">– bitte wählen –</option>
                {property.units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      {needsConsumption && (
        <div className="cost-extra">
            {cost.key === "heating" && (
              <label className="row small muted" style={{ marginBottom: 6 }}>
                Verbrauchsanteil (HeizkostenV 50–70 %):
                <NumberInput
                  value={cost.consumptionShare ?? 70}
                  onChange={(v) => onChange({ consumptionShare: v })}
                  style={{ width: 70 }}
                  ariaLabel="Verbrauchsanteil in Prozent"
                />
                % · Rest als Grundkosten nach Wohnfläche
              </label>
            )}
            <div className="small muted" style={{ marginBottom: 4 }}>Verbrauch je Einheit (kWh, m³ oder Einheiten laut Heizkostenverteiler bzw. Messdienst):</div>
            <div className="row">
              {property.units.map((u) => (
                <label key={u.id} className="field" style={{ width: 130 }}>
                  {u.name}
                  <NumberInput value={cost.consumption?.[u.id]} onChange={(v) => onChange({ consumption: { ...cost.consumption, [u.id]: v } })} />
                </label>
              ))}
              <span className="small muted">Summe: {formatNum(property.units.reduce((a, u) => a + (cost.consumption?.[u.id] ?? 0), 0))}</span>
            </div>
        </div>
      )}
      <button className="ghost small cost-details-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title="§ 35a, CO2, Notiz">
        {open ? "▾" : "▸"} Details (§ 35a, CO2, Notiz)
      </button>
      {open && (
        <div className="cost-extra">
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
              <label className="field">
                Arbeitskosten § 35a EStG (€)
                <NumberInput value={cost.laborCost} onChange={(laborCost) => onChange({ laborCost, laborKind: cost.laborKind ?? "service" })} />
              </label>
              <label className="field">
                Art der Leistung
                <select value={cost.laborKind ?? "service"} onChange={(e) => onChange({ laborKind: e.target.value as Section35aKind })}>
                  <option value="service">haushaltsnahe Dienstleistung</option>
                  <option value="craftsman">Handwerkerleistung</option>
                </select>
              </label>
              {heating && (
                <>
                  <label className="field">
                    darin CO2-Kosten (€)
                    <NumberInput value={cost.co2Cost} onChange={(co2Cost) => onChange({ co2Cost })} />
                  </label>
                  <label className="field">
                    CO2-Ausstoß des Gebäudes (kg)
                    <NumberInput value={cost.co2Kg} onChange={(co2Kg) => onChange({ co2Kg })} />
                  </label>
                </>
              )}
            </div>
            <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
              § 35a: Nur Lohn-, Maschinen- und Fahrtkosten (ohne Material) – deine Mieter können 20 % davon von der Steuer abziehen.
              {heating && " CO2-Kosten und Ausstoß stehen auf der Brennstoff- bzw. Wärmerechnung (Pflichtangabe)."}
              {stage && ` → ${formatNum(cost.co2Kg! / totalArea)} kg/m²: Stufe ${stage.stage}, du trägst ${stage.landlordPct} % der CO2-Kosten.`}
            </p>
            <label className="field" style={{ marginTop: 8 }}>
              Notiz
              <input value={cost.note ?? ""} onChange={(e) => onChange({ note: e.target.value })} />
            </label>
        </div>
      )}
    </div>
  );
}
