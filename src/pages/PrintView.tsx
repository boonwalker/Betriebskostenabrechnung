import { useState } from "react";
import { KEY_LABELS } from "../lib/betrkv";
import { calculateStatement, type ItemShare, type TenantResult } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR, formatNum } from "../lib/format";
import type { AllocationKey, AppData, Property, Statement } from "../lib/types";

const BASIS_UNIT: Record<AllocationKey, string> = {
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
  const result = calculateStatement(statement, property, data.tenants);
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
          suggestAdjustment={suggestAdjustment}
        />
      ))}
    </>
  );
}

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
  suggestAdjustment,
}: {
  data: AppData;
  property: Property;
  statement: Statement;
  r: TenantResult;
  periodDays: number;
  suggestAdjustment: boolean;
}) {
  const { landlord } = data.settings;
  const address = r.tenant.mailingAddress.trim() || `${r.unit.name}\n${property.address.replace(/,\s*/g, "\n")}`;
  const stillLiving = !r.tenant.moveOut || r.tenant.moveOut > statement.periodEnd;
  // Hochrechnung auf 12 Monate, aufgerundet auf volle Euro
  const newMonthly = Math.ceil((r.totalCosts / r.days) * periodDays / 12);

  return (
    <div className="letter">
      <div className="sender">{[landlord.name, landlord.address.replace(/\n/g, ", ")].filter(Boolean).join(" · ")}</div>
      <div className="address-block">{`${r.tenant.name}\n${address}`}</div>
      <div className="meta">{formatDate(todayISO())}</div>

      <h2>Betriebskostenabrechnung für den Zeitraum {formatDate(statement.periodStart)} bis {formatDate(statement.periodEnd)}</h2>
      <p>Guten Tag {r.tenant.name},</p>
      <p>
        hiermit erhalten Sie die Abrechnung der Betriebskosten für die von Ihnen gemietete Wohnung <strong>{r.unit.name}</strong> im Objekt {property.address || property.name}.
      </p>
      <table style={{ marginBottom: "4mm" }}>
        <tbody>
          <tr><td>Ihr Abrechnungszeitraum</td><td>{formatDate(r.start)} – {formatDate(r.end)} ({r.days} von {periodDays} Tagen)</td></tr>
          <tr><td>Wohnfläche Ihrer Wohnung</td><td>{formatNum(r.unit.area)} m² von {formatNum(property.units.reduce((a, u) => a + u.area, 0))} m² gesamt</td></tr>
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
            <tr key={item.costId}>
              <td>{item.label}</td>
              <td className="num">{formatEUR(item.total)}</td>
              <td>{KEY_LABELS[item.key]}</td>
              <td className="num">{item.key === "direct" ? "–" : `${formatNum(item.basisTotal)} ${BASIS_UNIT[item.key]}`}</td>
              <td className="num">{shareText(item, r, periodDays)}</td>
              <td className="num">{formatEUR(item.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Summe Ihrer Betriebskosten</td>
            <td className="num">{formatEUR(r.totalCosts)}</td>
          </tr>
          <tr>
            <td colSpan={5} style={{ fontWeight: 400 }}>abzüglich Ihrer geleisteten Vorauszahlungen</td>
            <td className="num" style={{ fontWeight: 400 }}>− {formatEUR(r.prepayments)}</td>
          </tr>
        </tfoot>
      </table>
      {r.items.some((i) => i.key === "persons") && (
        <p className="small" style={{ marginTop: "2mm" }}>
          Bei der Verteilung nach Personen ist „Gesamt“ die zeitanteilige Personenzahl im Abrechnungszeitraum (Personentage ÷ {periodDays}).
        </p>
      )}

      <div className="result">
        {r.balance > 0 ? `Nachzahlung: ${formatEUR(r.balance)}` : r.balance < 0 ? `Guthaben: ${formatEUR(-r.balance)}` : "Die Abrechnung ist ausgeglichen."}
      </div>
      {r.balance > 0 && (
        <p>
          Bitte überweisen Sie den Nachzahlungsbetrag innerhalb von 30 Tagen nach Erhalt dieser Abrechnung
          {landlord.iban ? <> auf das Konto IBAN {landlord.iban}</> : null} unter Angabe des Verwendungszwecks „Betriebskosten {statement.periodStart.slice(0, 4)}, {r.unit.name}“.
        </p>
      )}
      {r.balance < 0 && <p>Das Guthaben überweisen wir Ihnen in den nächsten Tagen auf Ihr bekanntes Konto.</p>}
      {suggestAdjustment && stillLiving && newMonthly !== r.tenant.monthlyPrepayment && (
        <p>
          Auf Grundlage dieser Abrechnung wird die monatliche Betriebskostenvorauszahlung gemäß § 560 Abs. 4 BGB ab dem übernächsten Monat
          nach Zugang dieses Schreibens von {formatEUR(r.tenant.monthlyPrepayment)} auf {formatEUR(newMonthly)} angepasst.
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
