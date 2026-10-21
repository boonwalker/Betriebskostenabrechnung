import { useState } from "react";
import { KEY_LABELS } from "../lib/betrkv";
import { releasedResult } from "../lib/release";
import { calculateStatement, type Co2Result, type DistributionKey, type ItemShare, type TenantResult } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR, formatNum } from "../lib/format";
import { rentAt } from "../lib/model";
import type { AppData, Property, Statement } from "../lib/types";

const BASIS_UNIT: Record<DistributionKey, string> = {
  area: "m²",
  persons: "Pers.",
  units: "WE",
  consumption: "Einh.",
  direct: "",
};

export default function PrintView({ data, statementId }: { data: AppData; statementId: string }) {
  const statement = data.statements.find((s) => s.id === statementId);
  const property = data.properties.find((p) => p.id === statement?.propertyId);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [suggestAdjustment, setSuggestAdjustment] = useState(false);

  if (!statement || !property) return <div className="card empty">Abrechnung nicht gefunden.</div>;
  const released = statement.status === "released";
  // Freigegebene Abrechnungen zeigen den eingefrorenen Stand, nicht die aktuelle Neuberechnung
  const result = (released && releasedResult(statement)) || calculateStatement(statement, property, data.tenants);
  const isSelected = (r: TenantResult) => !selected || selected.has(r.tenant.id);
  const landlordMissing = !data.settings.landlord.name || !data.settings.landlord.address;

  return (
    <>
      <div className="print-toolbar card">
        <div className="row">
          <a href={`#/abrechnungen/${statement.id}`} className="small">← zurück zur Abrechnung</a>
          <span className="spacer" />
          <button className="primary" onClick={() => window.print()}>Drucken / als PDF speichern</button>
        </div>
        {!released && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            <strong>Entwurf – nicht versenden.</strong> Die Abrechnung ist noch nicht freigegeben; das Ergebnis ist vorläufig. Offene Punkte findest du in der{" "}
            <a href={`#/abrechnungen/${statement.id}`}>Abrechnung</a>.
          </div>
        )}
        {landlordMissing && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            Bitte hinterlege in den <a href="#/einstellungen">Einstellungen</a> deinen Namen, deine Anschrift und deine Bankverbindung als Vermieter.
          </div>
        )}
        <div className="row small" style={{ marginTop: 12 }}>
          {result.tenants.map((r) => (
            <label key={r.tenant.id} className="row">
              <input
                type="checkbox"
                checked={isSelected(r)}
                onChange={(e) => {
                  const next = new Set(selected ?? result.tenants.map((t) => t.tenant.id));
                  if (e.target.checked) next.add(r.tenant.id);
                  else next.delete(r.tenant.id);
                  setSelected(next);
                }}
              />
              {r.tenant.name}
            </label>
          ))}
        </div>
        <label className="row small" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={suggestAdjustment} onChange={(e) => setSuggestAdjustment(e.target.checked)} />
          Anpassung der monatlichen Vorauszahlung (§ 560 Abs. 4 BGB) aufnehmen
        </label>
      </div>

      {result.tenants.filter(isSelected).map((r) => (
        <Letter
          key={r.tenant.id + r.start}
          data={data}
          property={property}
          statement={statement}
          r={r}
          periodDays={result.periodDays}
          co2={result.co2}
          suggestAdjustment={suggestAdjustment}
          draft={!released}
        />
      ))}
    </>
  );
}

const formatBasis = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n);

function shareText(item: ItemShare, r: TenantResult, periodDays: number): string {
  if (item.key === "direct") return r.days < periodDays ? `${r.days}/${periodDays} Tage` : "100 %";
  const raw = (item.basisShare * periodDays) / r.days;
  const base = `${formatNum(raw)} ${BASIS_UNIT[item.key]}`;
  return r.days < periodDays ? `${base} × ${r.days}/${periodDays} Tage` : base;
}

function Letter({
  data,
  property,
  statement,
  r,
  periodDays,
  co2,
  suggestAdjustment,
  draft,
}: {
  data: AppData;
  property: Property;
  statement: Statement;
  r: TenantResult;
  periodDays: number;
  co2: Co2Result[];
  suggestAdjustment: boolean;
  draft: boolean;
}) {
  const { landlord } = data.settings;
  const address = r.tenant.mailingAddress.trim() || `${r.unit.name}\n${property.address.replace(/,\s*/g, "\n")}`;
  const stillLiving = !r.tenant.moveOut || r.tenant.moveOut > statement.periodEnd;
  // Hochrechnung auf 12 Monate, aufgerundet auf volle Euro
  const newMonthly = Math.ceil((r.totalCosts / r.days) * periodDays / 12);
  const current = rentAt(r.tenant, statement.periodEnd);
  const currentMonthly = (current?.prepaymentOperating ?? 0) + (current?.prepaymentHeating ?? 0);
  const overridden = statement.prepaymentOverrides[r.tenant.id] !== undefined;
  const labor = r.labor35a.service + r.labor35a.craftsman;

  // Herkunft der Positionen: Anteile laut WEG-Einzelabrechnung folgen dem WEG-Schlüssel (§ 556a Abs. 3 BGB)
  const sourceOf = (costId: string) => {
    const cost = statement.costs.find((c) => c.id === costId);
    const annual = cost?.sourceAnnualId ? data.wegAnnuals.find((a) => a.id === cost.sourceAnnualId) : undefined;
    return { cost, annual, position: annual?.positions.find((p) => p.id === cost?.sourcePositionId) };
  };
  const keyText = (item: ItemShare) => {
    const { annual, position } = sourceOf(item.costId);
    if (item.key === "direct" && annual) return position?.wegBasis?.unit === "cbm" ? "Verbrauch" : position?.wegKey ?? "WEG-Schlüssel";
    return KEY_LABELS[item.key];
  };
  // Bei Wohnungseigentum: Gesamtkosten der WEG und Anteil nach WEG-Schlüssel ausweisen, soweit bekannt
  const wegTotal = (item: ItemShare) => {
    const { position } = sourceOf(item.costId);
    return position?.totalAmount ? formatEUR(position.totalAmount) : null;
  };
  const wegShare = (item: ItemShare) => {
    const { annual, position } = sourceOf(item.costId);
    if (!annual) return null;
    const time = r.days < periodDays ? ` × ${r.days}/${periodDays} Tage` : "";
    if (position?.heating === "total") return { total: "–", share: `lt. Heizkosten\u00ADabrechnung${time}` };
    // Nur die im Dokument ausgewiesene Schlüsselbasis zeigen – nichts aus dem Namen des Schlüssels ableiten
    if (position?.wegBasis) {
      const b = position.wegBasis;
      return { total: `${formatBasis(b.total)} ${b.unit}`, share: `${formatBasis(b.share)} ${b.unit}${time}` };
    }
    return { total: "–", share: `lt. Einzel\u00ADabrechnung${time}` };
  };
  const fromWeg = r.items.some((i) => sourceOf(i.costId).annual);
  const heatingNotes = r.items.flatMap((item) => {
    const { annual, position } = sourceOf(item.costId);
    return annual?.heating && position?.heating === "total" ? [{ costId: item.costId, amount: item.amount, heating: annual.heating }] : [];
  });

  return (
    <div className="letter">
      {draft && <div className="watermark">ENTWURF</div>}
      <div className="sender">{[landlord.name, landlord.address.replace(/\n/g, ", ")].filter(Boolean).join(" · ")}</div>
      <div className="address-block">{`${r.tenant.name}\n${address}`}</div>
      <div className="meta">{formatDate(statement.release?.releasedAt.slice(0, 10) ?? todayISO())}</div>

      <h2>Betriebskostenabrechnung für den Zeitraum {formatDate(statement.periodStart)} bis {formatDate(statement.periodEnd)}</h2>
      <p>Guten Tag {r.tenant.name},</p>
      <p>
        hiermit erhalten Sie die Abrechnung der Betriebskosten für die von Ihnen gemietete Wohnung <strong>{r.unit.name}</strong> im Objekt {property.address || property.name}.
      </p>
      <table style={{ marginBottom: "4mm" }}>
        <tbody>
          <tr><td>Ihr Abrechnungszeitraum</td><td>{formatDate(r.start)} – {formatDate(r.end)} ({r.days} von {periodDays} Tagen)</td></tr>
          <tr>
            <td>Wohnfläche Ihrer Wohnung</td>
            <td>
              {formatNum(r.unit.area)} m² von{" "}
              {formatNum(property.type === "etw" && property.wegAreaTotal ? property.wegAreaTotal : property.units.reduce((a, u) => a + u.area, 0))} m² gesamt
            </td>
          </tr>
          {property.type === "etw" && r.unit.mea && property.wegMeaTotal && (
            <tr>
              <td>Miteigentumsanteil</td>
              <td>{formatNum(r.unit.mea)} / {formatNum(property.wegMeaTotal)}</td>
            </tr>
          )}
          <tr><td>Personen in Ihrem Haushalt</td><td>{r.tenant.persons}</td></tr>
        </tbody>
      </table>

      <table>
        <thead>
          <tr>
            <th>Kostenart</th>
            <th className="num">Gesamtkosten</th>
            <th>Verteilung nach</th>
            <th className="num">Gesamt</th>
            <th className="num">Ihr Anteil</th>
            <th className="num">Ihre Kosten</th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((item) => (
            <tr key={item.costId + item.label}>
              <td>{item.label}</td>
              <td className="num">{wegTotal(item) ?? formatEUR(item.total)}</td>
              <td>{keyText(item)}</td>
              <td className="num">{wegShare(item)?.total ?? (item.key === "direct" ? "–" : `${formatNum(item.basisTotal)} ${BASIS_UNIT[item.key]}`)}</td>
              <td className="num">{wegShare(item)?.share ?? shareText(item, r, periodDays)}</td>
              <td className="num">{formatEUR(item.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Summe Ihrer Betriebskosten</td>
            <td className="num">{formatEUR(r.totalCosts)}</td>
          </tr>
          {overridden || !r.prepaymentsCalculated.heating ? (
            <tr>
              <td colSpan={5} style={{ fontWeight: 400 }}>abzüglich Ihrer geleisteten Vorauszahlungen</td>
              <td className="num" style={{ fontWeight: 400 }}>− {formatEUR(r.prepayments)}</td>
            </tr>
          ) : (
            <>
              <tr>
                <td colSpan={5} style={{ fontWeight: 400 }}>abzüglich Ihrer Vorauszahlungen auf die Betriebskosten</td>
                <td className="num" style={{ fontWeight: 400 }}>− {formatEUR(r.prepaymentsCalculated.operating)}</td>
              </tr>
              <tr>
                <td colSpan={5} style={{ fontWeight: 400 }}>abzüglich Ihrer Vorauszahlungen auf die Heizkosten</td>
                <td className="num" style={{ fontWeight: 400 }}>− {formatEUR(r.prepaymentsCalculated.heating)}</td>
              </tr>
            </>
          )}
        </tfoot>
      </table>
      {r.items.some((i) => i.key === "persons") && (
        <p className="small" style={{ marginTop: "2mm" }}>
          Bei der Verteilung nach Personen ist „Gesamt“ die zeitanteilige Personenzahl im Abrechnungszeitraum (Personentage ÷ {periodDays}).
        </p>
      )}

      {fromWeg && (
        <p className="small">
          Die Kosten sind nach den in der Wohnungseigentümergemeinschaft geltenden Verteilungsschlüsseln auf Ihre Wohnung verteilt (§ 556a Abs. 3 BGB);
          Grundlage ist die Jahresabrechnung der Hausverwaltung{property.wegManager ? ` (${property.wegManager})` : ""}. Nicht umlagefähige Kosten wie Verwaltung,
          Instandhaltung und die Erhaltungsrücklage sind nicht enthalten.
        </p>
      )}
      {heatingNotes.map((n) => (
        <p className="small" key={n.costId}>
          <strong>Heiz- und Warmwasserkosten:</strong> Die Kosten von {formatEUR(n.amount)} stammen aus der Heizkostenabrechnung
          {n.heating.heatSource ? ` (${n.heating.heatSource})` : ""}
          {n.heating.buildingTotal ? `; Gesamtkosten der Liegenschaft ${formatEUR(n.heating.buildingTotal)}` : ""}
          {n.heating.baseSharePct !== null ? `; Verteilung ${n.heating.baseSharePct} % nach Fläche, ${100 - n.heating.baseSharePct} % nach Verbrauch (HeizkostenV)` : ""}.{" "}
          {n.heating.components.map((c) => `${c.label} ${formatEUR(c.amount)}`).join(", ")}
          {n.heating.consumptionHeatingKwh !== null ? `. Ihr Verbrauch: Heizung ${formatNum(n.heating.consumptionHeatingKwh)} kWh` : ""}
          {n.heating.consumptionWaterKwh !== null ? `, Warmwasser ${formatNum(n.heating.consumptionWaterKwh)} kWh` : ""}.
          {r.days < periodDays && " Für Ihren Nutzungszeitraum ist zeitanteilig abgerechnet."}
        </p>
      ))}
      {co2.map((c) => {
        const tenantCo2 = r.items.filter((i) => i.costId === c.costId).reduce((a, i) => a + i.co2Amount, 0);
        return (
          <p className="small" key={c.costId}>
            <strong>CO2-Kosten ({c.label}):</strong> Im Abrechnungszeitraum sind CO2-Kosten von {formatEUR(c.co2Cost)} bei einem Ausstoß von{" "}
            {formatNum(c.co2Kg)} kg CO2 angefallen ({formatNum(c.kgPerM2Year)} kg je m² Wohnfläche und Jahr). Nach dem Stufenmodell des CO2KostAufG
            (Stufe {c.stage}) trägt der Vermieter {c.landlordPct} % ({formatEUR(c.landlordAmount)}); dieser Anteil ist oben bereits abgezogen. Ihr Anteil an
            den CO2-Kosten beträgt {formatEUR(tenantCo2)}.
          </p>
        );
      })}
      {labor > 0 && (
        <p className="small">
          <strong>Steuerermäßigung nach § 35a EStG:</strong> In Ihren Kosten sind Arbeitskosten enthalten für haushaltsnahe Dienstleistungen (Abs. 2){" "}
          {formatEUR(r.labor35a.service)} und für Handwerkerleistungen (Abs. 3) {formatEUR(r.labor35a.craftsman)}. Sie können 20 % davon in Ihrer
          Einkommensteuererklärung geltend machen.
        </p>
      )}

      <div className="result">
        {draft && "Vorläufig (Entwurf) – "}
        {r.balance > 0 ? `Nachzahlung: ${formatEUR(r.balance)}` : r.balance < 0 ? `Guthaben: ${formatEUR(-r.balance)}` : "Die Abrechnung ist ausgeglichen."}
      </div>
      {r.balance > 0 && (
        <p>
          Bitte überweisen Sie den Nachzahlungsbetrag innerhalb von 30 Tagen nach Erhalt dieser Abrechnung
          {landlord.iban ? <> auf das Konto IBAN {landlord.iban}</> : null} unter Angabe des Verwendungszwecks „Betriebskosten {statement.periodStart.slice(0, 4)}, {r.unit.name}“.
        </p>
      )}
      {r.balance < 0 && <p>Das Guthaben überweisen wir Ihnen in den nächsten Tagen auf Ihr bekanntes Konto.</p>}
      {suggestAdjustment && stillLiving && newMonthly !== currentMonthly && (
        <p>
          Auf Grundlage dieser Abrechnung werden Ihre monatlichen Vorauszahlungen auf die Betriebs- und Heizkosten gemäß § 560 Abs. 4 BGB ab dem
          übernächsten Monat nach Zugang dieses Schreibens von insgesamt {formatEUR(currentMonthly)} auf {formatEUR(newMonthly)} angepasst.
        </p>
      )}
      <p className="small">
        Die Rechnungen und Belege zu dieser Abrechnung können Sie nach vorheriger Terminabsprache gerne einsehen. Einwendungen gegen die Abrechnung
        können Sie bis zum Ablauf des zwölften Monats nach Zugang dieser Abrechnung mitteilen (§ 556 Abs. 3 BGB).
      </p>
      <p style={{ marginTop: "8mm" }}>
        Mit freundlichen Grüßen
        <br />
        <br />
        {landlord.name}
      </p>
    </div>
  );
}
