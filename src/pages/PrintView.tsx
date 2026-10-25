import { useState } from "react";
import { includedAttachments, SheetImage } from "../components/Attachments";
import { ATTACHMENT_SHORT_LABELS, attachmentLabel } from "../lib/attachments";
import { KEY_LABELS } from "../lib/betrkv";
import { releasedTenant } from "../lib/release";
import { calculateStatement, type Co2Result, type DistributionKey, type ItemShare, type TenantResult } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR, formatIban, formatNum } from "../lib/format";
import { rentAt } from "../lib/model";
import { landlordFor } from "../lib/release";
import type { AppData, Attachment, CostItem, Property, Statement } from "../lib/types";
import { wegShareAlways } from "../lib/lease";

const BASIS_UNIT: Record<DistributionKey, string> = {
  time: "Tage",
  degreedays: "‰",
  reading: "Einh.",
  area: "m²",
  persons: "Pers.",
  units: "WE",
  consumption: "Einh.",
  direct: "",
};

/** „Ort, TT.MM.JJJJ“ – der Ort aus der letzten Zeile der Absenderanschrift (ohne Postleitzahl) */
function placeDate(address: string, iso: string): string {
  const lastLine = address.trim().split(/\n|,/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
  const place = lastLine.replace(/^\d{4,5}\s+/, "");
  const date = formatDate(iso);
  return place && place !== lastLine ? `${place}, ${date}` : date;
}

export default function PrintView({ data, statementId }: { data: AppData; statementId: string }) {
  const statement = data.statements.find((s) => s.id === statementId);
  const property = data.properties.find((p) => p.id === statement?.propertyId);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [suggestAdjustment, setSuggestAdjustment] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);

  if (!statement || !property) return <div className="card empty">Abrechnung nicht gefunden.</div>;
  const live = calculateStatement(statement, property, data.tenants);
  // Freigegebene Mietverhältnisse zeigen den eingefrorenen Stand, nicht die aktuelle Neuberechnung
  const letters = live.tenants.map((r) => {
    const frozen = releasedTenant(statement, r.tenant.id);
    return frozen
      ? {
          r: frozen.result,
          periodDays: frozen.periodDays,
          co2: frozen.co2,
          draft: false,
          releasedAt: statement.releases[r.tenant.id].releasedAt,
        }
      : {
          r,
          periodDays: live.periodDays,
          co2: live.co2,
          draft: true,
          releasedAt: null as string | null,
        };
  });
  const anyDraft = letters.some((l) => l.draft && (!selected || selected.has(l.r.tenant.id)));
  const isSelected = (r: TenantResult) => !selected || selected.has(r.tenant.id);
  const landlordMissing = !data.settings.landlord.name || !data.settings.landlord.address;
  const availableAttachments = includedAttachments(data, property.id, Number(statement.periodStart.slice(0, 4)));
  const chosenAttachments = availableAttachments.filter((a) => !skipped.has(a.id));

  const makePdf = async () => {
    const nodes = [...document.querySelectorAll<HTMLElement>(".letter")];
    if (!nodes.length) return;
    setPdfBusy(true);
    setPdfMessage(null);
    try {
      const { lettersToPdf, deliverPdf } = await import("../lib/pdf");
      const chosen = letters.filter((l) => isSelected(l.r));
      const who = chosen.length === 1 ? chosen[0].r.tenant.name : property.name;
      // Schlichter Dateiname: Browser verwerfen manche Sonderzeichen und speichern sonst als „download“
      const safe = (t: string) =>
        t
          .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
          .replace(/[^A-Za-z0-9.]+/g, "-")
          .replace(/^-+|-+$/g, "");
      const filename = `${safe(`Betriebskostenabrechnung ${statement.periodStart.slice(0, 4)} ${who}${anyDraft ? " Entwurf" : ""}`)}.pdf`;
      const items = nodes.map((el) => ({
        el,
        attachments: chosenAttachments.flatMap((a) => a.pages.filter((p) => p.include).map((page) => ({ page, label: attachmentLabel(a), tenantId: el.dataset.tenant ?? null }))),
      }));
      const outcome = await deliverPdf(await lettersToPdf(items), filename);
      if (outcome === "downloaded") setPdfMessage(`„${filename}“ wurde heruntergeladen.`);
    } catch (e) {
      setPdfMessage(`Das PDF konnte nicht erstellt werden: ${(e as Error).message}`);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <div className="print-toolbar card">
        <div className="row">
          <a href={`#/abrechnungen/${statement.id}`} className="small">
            ← zurück zur Abrechnung
          </a>
          <span className="spacer" />
          <button onClick={() => window.print()}>Drucken</button>
          <button className="primary" disabled={pdfBusy} onClick={makePdf}>
            {pdfBusy ? "PDF wird erstellt …" : "PDF erstellen"}
          </button>
        </div>
        {pdfMessage && <div className="alert info small" style={{ marginTop: 12 }}>{pdfMessage}</div>}
        {anyDraft && (
          <div className="alert danger" style={{ marginTop: 12 }}>
            <strong>Entwurf – nicht versenden.</strong> Mindestens ein ausgewähltes Anschreiben ist noch nicht freigegeben; sein Ergebnis ist vorläufig. Offene Punkte
            findest du in der <a href={`#/abrechnungen/${statement.id}`}>Abrechnung</a>.
          </div>
        )}
        {landlordMissing && (
          <div className="alert warn" style={{ marginTop: 12 }}>
            Bitte hinterlege in den <a href="#/einstellungen">Einstellungen</a> deinen Namen, deine Anschrift und deine Bankverbindung als Vermieter.
          </div>
        )}
        <div className="print-options">
          <div className="print-options-group">
            <span className="print-options-title">Schreiben</span>
            {letters.map(({ r, draft }) => (
              <label key={r.tenant.id} className="check">
                <input
                  type="checkbox"
                  checked={isSelected(r)}
                  onChange={(e) => {
                    const next = new Set<string>(selected ?? letters.map((l) => l.r.tenant.id));
                    if (e.target.checked) next.add(r.tenant.id);
                    else next.delete(r.tenant.id);
                    setSelected(next);
                  }}
                />
                <span>
                  {r.tenant.name} <span className={`badge ${draft ? "status-draft" : "status-released"}`}>{draft ? "Entwurf" : "freigegeben"}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="print-options-group">
            <span className="print-options-title">Anlagen</span>
            {availableAttachments.length > 0 ? (
              availableAttachments.map((a) => (
                <label key={a.id} className="check">
                  <input
                    type="checkbox"
                    checked={!skipped.has(a.id)}
                    onChange={(e) => setSkipped((s) => { const n = new Set(s); if (e.target.checked) n.delete(a.id); else n.add(a.id); return n; })}
                  />
                  <span>
                    {ATTACHMENT_SHORT_LABELS[a.kind]} {a.year} <span className="muted nowrap">· {a.pages.filter((p) => p.include).length} S.</span>
                  </span>
                </label>
              ))
            ) : (
              <span className="muted">
                Heizkostenabrechnung, Bescheid usw. fügst du in der <a href={`#/abrechnungen/${statement.id}?f=anlagen`}>Abrechnung</a> hinzu.
              </span>
            )}
          </div>
          <div className="print-options-group">
            <span className="print-options-title">Optionen</span>
            <label className="check">
              <input type="checkbox" checked={suggestAdjustment} onChange={(e) => setSuggestAdjustment(e.target.checked)} />
              <span>Vorauszahlung anpassen (§ 560 Abs. 4 BGB)</span>
            </label>
          </div>
        </div>
      </div>

      {letters
        .filter((l) => isSelected(l.r))
        .map((l) => (
          <Letter
            key={l.r.tenant.id + l.r.start}
            data={data}
            property={property}
            statement={statement}
            r={l.r}
            periodDays={l.periodDays}
            co2={l.co2}
            suggestAdjustment={suggestAdjustment}
            draft={l.draft}
            releasedAt={l.releasedAt}
            attachments={chosenAttachments}
          />
        ))
        .flatMap((letter, i) => [letter, <AttachmentPages key={`anl-${i}`} attachments={chosenAttachments} tenantId={String(letter.props.r.tenant.id)} />])}
    </>
  );
}

const formatBasis = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(n);

const RAW_KEY_LABELS: Partial<Record<DistributionKey, string>> = {
  time: "Zeit",
  degreedays: "Gradtagzahlen",
  reading: "Zwischenablesung",
};

function shareText(item: ItemShare, r: TenantResult, periodDays: number): string {
  if (item.basisUnit) return `${formatBasis(item.basisShare)} ${item.basisUnit}`;
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
  releasedAt,
  attachments,
}: {
  data: AppData;
  property: Property;
  statement: Statement;
  r: TenantResult;
  periodDays: number;
  co2: Co2Result[];
  suggestAdjustment: boolean;
  draft: boolean;
  releasedAt: string | null;
  attachments: Attachment[];
}) {
  const landlord = landlordFor(r.tenant, data);
  const rule = r.tenant.lease?.allocationRule ?? "weg";
  // Postanschrift: nach Auszug die hinterlegte neue Anschrift, sonst die Anschrift des Objekts (ohne Wohnungsbezeichnung)
  const address = r.tenant.mailingAddress.trim() || property.address.replace(/,\s*/g, "\n");
  // Anrede je Mietverhältnis: du oder Sie
  const du = !!r.tenant.informal;
  const w = (sie: string, duText: string) => (du ? duText : sie);
  const firstName = r.tenant.name.trim().split(/\s+/)[0];
  const stillLiving = !r.tenant.moveOut || r.tenant.moveOut > statement.periodEnd;
  // Hochrechnung auf 12 Monate, aufgerundet auf volle Euro
  const newMonthly = Math.ceil(((r.totalCosts / r.days) * periodDays) / 12);
  const current = rentAt(r.tenant, statement.periodEnd);
  const currentMonthly = (current?.prepaymentOperating ?? 0) + (current?.prepaymentHeating ?? 0);
  const overridden = statement.prepaymentOverrides[r.tenant.id] !== undefined;
  const labor = r.labor35a.service + r.labor35a.craftsman;

  // Herkunft der Positionen: Anteile laut WEG-Einzelabrechnung folgen dem WEG-Schlüssel (§ 556a Abs. 3 BGB)
  const sourceOf = (costId: string) => {
    const cost = statement.costs.find((c) => c.id === costId);
    const annual = cost?.sourceAnnualId ? data.wegAnnuals.find((a) => a.id === cost.sourceAnnualId) : undefined;
    return {
      cost,
      annual,
      position: annual?.positions.find((p) => p.id === cost?.sourcePositionId),
    };
  };
  // Schlüssel dieses Mieters für eine Kostenposition – oder der WEG-Schlüssel, wenn das Objekt es für die Kostenart so festlegt
  const leaseBasis = (cost: CostItem | undefined) =>
    (cost && wegShareAlways(property, cost.label) ? cost.leaseAmounts?.weg?.basis : cost?.leaseAmounts?.[rule]?.basis) ?? cost?.basis;
  const keyText = (item: ItemShare) => {
    const { annual, position } = sourceOf(item.costId);
    const { cost } = sourceOf(item.costId);
    const ruleBasis = leaseBasis(cost);
    if (item.key === "direct" && ruleBasis) return ruleBasis.label;
    if (item.key === "direct" && annual) return position?.wegBasis?.unit === "cbm" ? "Verbrauch" : (position?.wegKey ?? "WEG-Schlüssel");
    return KEY_LABELS[item.key as keyof typeof KEY_LABELS];
  };
  // Bei Wohnungseigentum: Gesamtkosten der WEG und Anteil nach WEG-Schlüssel ausweisen, soweit bekannt
  const wegTotal = (item: ItemShare) => {
    const { cost, position } = sourceOf(item.costId);
    const total = cost?.totalAmount ?? position?.totalAmount;
    return total ? formatEUR(total) : null;
  };
  const wegShare = (item: ItemShare) => {
    const { annual, position } = sourceOf(item.costId);
    if (!annual) return null;
    const time = r.days < periodDays ? ` × ${r.days}/${periodDays} Tage` : "";
    if (position?.heating === "total") return { total: "–", share: `lt. Heizkosten\u00ADabrechnung${time}` };
    const cost = sourceOf(item.costId).cost;
    const own = leaseBasis(cost);
    if (own)
      return {
        total: `${formatBasis(own.total)} ${own.unit}`,
        share: `${formatBasis(own.share)} ${own.unit}${time}`,
      };
    // Nur die im Dokument ausgewiesene Schlüsselbasis zeigen – nichts aus dem Namen des Schlüssels ableiten
    if (position?.wegBasis) {
      const b = position.wegBasis;
      return {
        total: `${formatBasis(b.total)} ${b.unit}`,
        share: `${formatBasis(b.share)} ${b.unit}${time}`,
      };
    }
    return { total: "–", share: `lt. Einzel\u00ADabrechnung${time}` };
  };
  const fromWeg = r.items.some((i) => sourceOf(i.costId).annual);
  const heatingNotes = r.items.flatMap((item) => {
    const { annual, position } = sourceOf(item.costId);
    return annual?.heating && position?.heating === "total" ? [{ costId: item.costId, amount: item.amount, heating: annual.heating }] : [];
  });

  const result =
    r.balance > 0 ? { kind: "due", label: w("Ihre Nachzahlung", "Deine Nachzahlung"), amount: r.balance } : r.balance < 0 ? { kind: "credit", label: w("Ihr Guthaben", "Dein Guthaben"), amount: -r.balance } : null;
  const year = statement.periodStart.slice(0, 4);
  const prepaymentRows =
    overridden || !r.prepaymentsCalculated.heating
      ? [
          {
            label: w("abzüglich Ihrer geleisteten Vorauszahlungen", "abzüglich deiner geleisteten Vorauszahlungen"),
            amount: r.prepayments,
          },
        ]
      : [
          {
            label: w("abzüglich Ihrer Vorauszahlungen auf die Betriebskosten", "abzüglich deiner Vorauszahlungen auf die Betriebskosten"),
            amount: r.prepaymentsCalculated.operating,
          },
          {
            label: w("abzüglich Ihrer Vorauszahlungen auf die Heizkosten", "abzüglich deiner Vorauszahlungen auf die Heizkosten"),
            amount: r.prepaymentsCalculated.heating,
          },
        ];
  // Verteilung als zweite Zeile unter der Kostenart: Schlüssel · Gesamt · Ihr Anteil
  const distribution = (item: ItemShare) => {
    const key = item.basisUnit ? (RAW_KEY_LABELS[item.key] ?? KEY_LABELS[item.key as keyof typeof KEY_LABELS]) : keyText(item);
    const total = item.basisUnit
      ? `${formatBasis(item.basisTotal)} ${item.basisUnit}`
      : (wegShare(item)?.total ?? (item.key === "direct" ? null : `${formatNum(item.basisTotal)} ${BASIS_UNIT[item.key]}`));
    const share = item.basisUnit ? shareText(item, r, periodDays) : (wegShare(item)?.share ?? shareText(item, r, periodDays));
    const cost = sourceOf(item.costId).cost;
    const own = leaseBasis(cost);
    if (item.key === "direct" && !item.basisUnit && own) {
      const time = r.days < periodDays ? ` × ${r.days}/${periodDays} Tage` : "";
      return `nach ${own.label} · gesamt ${formatBasis(own.total)} ${own.unit} · ${w("Ihr", "dein")} Anteil ${formatBasis(own.share)} ${own.unit}${time}`;
    }
    if (item.key === "direct" && !item.basisUnit && !wegShare(item)) {
      const direct = `direkt ${w("Ihrer", "deiner")} Wohnung zugeordnet`;
      return r.days < periodDays ? `${direct} · ${w("Ihr", "dein")} Anteil ${share}` : direct;
    }
    return [`nach ${key}`, total && total !== "–" ? `gesamt ${total}` : null, `${w("Ihr", "dein")} Anteil ${share}`].filter(Boolean).join(" · ");
  };
  const houseTotal = (item: ItemShare) => (item.basisUnit ? formatEUR(item.total) : (wegTotal(item) ?? formatEUR(item.total)));
  const paymentText =
    r.tenant.lease?.paymentTerm === "endOfNextMonth"
      ? "bis zum Ende des auf den Zugang dieser Abrechnung folgenden Kalendermonats"
      : "innerhalb von 30 Tagen nach Erhalt dieser Abrechnung";

  return (
    <div className={`letter ${draft ? "is-draft" : ""}`} data-tenant={r.tenant.id}>
      {draft && <div className="watermark">ENTWURF</div>}
      <div className="letter-band" />
      {/* Briefkopf: Absender oben rechts, Empfänger links tiefer im Anschriftfeld */}
      <div className="letter-head">
        <div className="letter-recipient">
          {/* Rücksendeangabe für Fensterumschläge */}
          <div className="letter-return">{[landlord.name, landlord.address.replace(/\n/g, ", ")].filter(Boolean).join(", ")}</div>
          <strong>{r.tenant.name}</strong>
          <div>{address}</div>
        </div>
        <div className="letter-sender">
          <strong>{landlord.name}</strong>
          {landlord.address && <div>{landlord.address}</div>}
          {landlord.iban && <div className="letter-muted">IBAN {formatIban(landlord.iban)}</div>}
        </div>
        {/* Ort und Datum rechtsbündig, eine Zeile unter der letzten Empfängerzeile */}
        <div className="letter-date">{placeDate(landlord.address, releasedAt?.slice(0, 10) ?? todayISO())}</div>
      </div>

      <div className="letter-title">
        <h1>Betriebskostenabrechnung {year}</h1>
        <div className="letter-sub">{draft ? "Entwurf · vorläufig · nicht versenden" : `Wohnung ${r.unit.name} · ${property.address || property.name}`}</div>
      </div>

      <p>{du ? `Hallo ${firstName},` : `Guten Tag ${r.tenant.name},`}</p>
      <p>
        {w("hiermit erhalten Sie die Abrechnung der Betriebskosten für die von Ihnen gemietete Wohnung", "hiermit erhältst du die Abrechnung der Betriebskosten für die von dir gemietete Wohnung")}{" "}
        <strong>{r.unit.name}</strong> im Objekt{" "}
        {property.address || property.name} für den Zeitraum {formatDate(r.start)} bis {formatDate(r.end)}.
      </p>

      <div className="letter-summary">
        <table className="letter-facts">
          <tbody>
            <tr>
              <th>{w("Ihr", "Dein")} Abrechnungszeitraum</th>
              <td>
                {formatDate(r.start)} – {formatDate(r.end)} ({r.days} von {periodDays} Tagen)
              </td>
            </tr>
            <tr>
              <th>Wohnfläche</th>
              <td>
                {formatNum(r.unit.area)} m² von{" "}
                {formatNum(property.type === "etw" && property.wegAreaTotal ? property.wegAreaTotal : property.units.reduce((a, u) => a + u.area, 0))} m²
              </td>
            </tr>
            {property.type === "etw" && r.unit.mea && property.wegMeaTotal && (
              <tr>
                <th>Miteigentumsanteil</th>
                <td>
                  {formatNum(r.unit.mea)} / {formatNum(property.wegMeaTotal)}
                </td>
              </tr>
            )}
            <tr>
              <th>Personen im Haushalt</th>
              <td>{r.tenant.persons}</td>
            </tr>
          </tbody>
        </table>
        <div className={`letter-result ${result?.kind ?? "even"}`}>
          <div className="letter-result-label">{draft ? "Vorläufiges Ergebnis" : "Ergebnis"}</div>
          <div className="letter-result-value">{result ? `${result.label}: ${formatEUR(result.amount)}` : "ausgeglichen"}</div>
          <div className="letter-result-calc">
            Kosten {formatEUR(r.totalCosts)} − Vorauszahlungen {formatEUR(r.prepayments)}
          </div>
        </div>
      </div>

      <h2>
        <span className="letter-num">1</span> {w("Ihre", "Deine")} Kosten im Einzelnen
      </h2>
      <table className="letter-costs">
        <thead>
          <tr>
            <th>Kostenart und Verteilung</th>
            <th className="num">Kosten gesamt</th>
            <th className="num">{w("Ihr", "Dein")} Anteil</th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((item) => (
            <tr key={item.costId + item.label}>
              <td>
                {item.label}
                <div className="letter-key">{distribution(item)}</div>
              </td>
              <td className="num">{houseTotal(item)}</td>
              <td className="num">{formatEUR(item.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="letter-subtotal">
            <td colSpan={2}>Summe {w("Ihrer", "deiner")} Betriebskosten</td>
            <td className="num">{formatEUR(r.totalCosts)}</td>
          </tr>
          {prepaymentRows.map((p) => (
            <tr key={p.label} className="letter-plain">
              <td colSpan={2}>{p.label}</td>
              <td className="num">− {formatEUR(p.amount)}</td>
            </tr>
          ))}
          <tr className="letter-total">
            <td colSpan={2}>{result ? result.label : "Ergebnis"}</td>
            <td className="num">{formatEUR(result?.amount ?? 0)}</td>
          </tr>
        </tfoot>
      </table>

      <h2>
        <span className="letter-num">2</span> Erläuterungen
      </h2>
      <div className="letter-notes">
        {fromWeg && r.tenant.lease?.allocationRule === "consumption_mea" ? (
          <p>
            Die Kosten sind gemäß Mietvertrag
            {r.tenant.lease.reference ? ` (${r.tenant.lease.reference})` : ""} nach dem erfassten Verbrauch, im Übrigen nach dem Verhältnis der Miteigentumsanteile
            verteilt; die Heizkosten nach der Heizkostenverordnung. Grundlage ist die Jahresabrechnung der Hausverwaltung. Nicht umlagefähige Kosten wie Verwaltung,
            Instandhaltung und die Erhaltungsrücklage sind nicht enthalten.
          </p>
        ) : fromWeg ? (
          <p>
            Die Kosten sind nach den in der Wohnungseigentümergemeinschaft geltenden Verteilungsschlüsseln auf {w("Ihre", "deine")} Wohnung verteilt (§ 556a Abs. 3 BGB); Grundlage ist
            die Jahresabrechnung der Hausverwaltung
            {property.wegManager ? ` (${property.wegManager})` : ""}. Nicht umlagefähige Kosten wie Verwaltung, Instandhaltung und die Erhaltungsrücklage sind nicht
            enthalten.
          </p>
        ) : (
          <p>Abgerechnet sind die im Mietvertrag vereinbarten Betriebskosten nach § 2 BetrKV. Direkt zugeordnete Kosten betreffen allein {w("Ihre", "deine")} Wohnung.</p>
        )}
        {r.days < periodDays && (
          <p>
            {w("Sie haben", "Du hast")} die Wohnung nur einen Teil des Jahres gemietet; die Kosten sind deshalb zeitanteilig ({r.days} von {periodDays} Tagen) berechnet.
          </p>
        )}
        {r.items.some((i) => i.key === "persons") && (
          <p>Bei der Verteilung nach Personen ist „gesamt“ die zeitanteilige Personenzahl im Abrechnungszeitraum (Personentage ÷ {periodDays}).</p>
        )}
        {heatingNotes.map((n) => (
          <p key={n.costId}>
            <strong>Heiz- und Warmwasserkosten:</strong> Die Kosten von {formatEUR(n.amount)} stammen aus der Heizkostenabrechnung
            {n.heating.heatSource ? ` (${n.heating.heatSource})` : ""}
            {n.heating.buildingTotal ? `; Gesamtkosten der Liegenschaft ${formatEUR(n.heating.buildingTotal)}` : ""}
            {n.heating.baseSharePct !== null
              ? `; Verteilung ${n.heating.baseSharePct} % nach Fläche, ${100 - n.heating.baseSharePct} % nach Verbrauch (HeizkostenV)`
              : ""}
            . {n.heating.components.map((c) => `${c.label} ${formatEUR(c.amount)}`).join(", ")}
            {n.heating.consumptionHeatingKwh !== null ? `. ${w("Ihr", "Dein")} Verbrauch: Heizung ${formatNum(n.heating.consumptionHeatingKwh)} kWh` : ""}
            {n.heating.consumptionWaterKwh !== null ? `, Warmwasser ${formatNum(n.heating.consumptionWaterKwh)} kWh` : ""}.
          </p>
        ))}
        {co2.map((c) => {
          const tenantCo2 = r.items.filter((i) => i.costId === c.costId).reduce((a, i) => a + i.co2Amount, 0);
          return (
            <p key={c.costId}>
              <strong>CO2-Kosten ({c.label}):</strong> Im Abrechnungszeitraum sind CO2-Kosten von {formatEUR(c.co2Cost)} bei einem Ausstoß von {formatNum(c.co2Kg)} kg CO2
              angefallen ({formatNum(c.kgPerM2Year)} kg je m² Wohnfläche und Jahr). Nach dem Stufenmodell des CO2KostAufG (Stufe {c.stage}) trägt der Vermieter{" "}
              {c.landlordPct} % ({formatEUR(c.landlordAmount)}); dieser Anteil ist oben bereits abgezogen. {w("Ihr", "Dein")} Anteil an den CO2-Kosten beträgt {formatEUR(tenantCo2)}.
            </p>
          );
        })}
        {labor > 0 && (
          <p>
            <strong>Steuerermäßigung nach § 35a EStG:</strong> In {w("Ihren", "deinen")} Kosten sind Arbeitskosten enthalten für haushaltsnahe Dienstleistungen (Abs. 2){" "}
            {formatEUR(r.labor35a.service)} und für Handwerkerleistungen (Abs. 3) {formatEUR(r.labor35a.craftsman)}. {w("Sie können", "Du kannst")} 20 % davon in{" "}
            {w("Ihrer", "deiner")} Einkommensteuererklärung geltend machen.
          </p>
        )}
      </div>

      <h2>
        <span className="letter-num">3</span> {result?.kind === "due" ? "Zahlung" : result?.kind === "credit" ? "Auszahlung" : "Ergebnis"}
      </h2>
      {result?.kind === "due" && (
        <p>
          {w("Bitte überweisen Sie", "Bitte überweise")} den Nachzahlungsbetrag von <strong>{formatEUR(result.amount)}</strong> {paymentText}
          {landlord.iban ? <> auf das Konto IBAN {formatIban(landlord.iban)}</> : null} unter Angabe des Verwendungszwecks „Betriebskosten {year}, {r.unit.name}“.
        </p>
      )}
      {result?.kind === "credit" && (
        <p>
          Das Guthaben von <strong>{formatEUR(result.amount)}</strong> {w("überweise ich Ihnen", "überweise ich dir")}{" "}
          {r.tenant.lease?.paymentTerm === "endOfNextMonth" ? "bis zum Ende des auf den Zugang dieser Abrechnung folgenden Kalendermonats" : "in den nächsten Tagen"} auf{" "}
          {w("Ihr", "dein")} bekanntes Konto.
        </p>
      )}
      {!result && <p>{w("Ihre", "Deine")} Vorauszahlungen decken die Kosten genau; es ist nichts zu zahlen.</p>}
      {suggestAdjustment && stillLiving && newMonthly !== currentMonthly && (
        <p>
          Auf Grundlage dieser Abrechnung werden {w("Ihre", "deine")} monatlichen Vorauszahlungen auf die Betriebs- und Heizkosten gemäß § 560 Abs. 4 BGB ab dem übernächsten Monat nach
          Zugang dieses Schreibens von insgesamt {formatEUR(currentMonthly)} auf {formatEUR(newMonthly)} angepasst.
        </p>
      )}
      <div className="letter-closing">
        <p className="letter-small">
          {/* mit Anlagen: Verweis darauf, sonst Angebot zur Belegeinsicht */}
          {attachments.length > 0
            ? `Die Rechnungen und Belege zu dieser Abrechnung ${w("finden Sie", "findest du")} im Anhang.`
            : `Die Rechnungen und Belege zu dieser Abrechnung ${w("können Sie", "kannst du")} nach vorheriger Terminabsprache gerne einsehen.`}{" "}
          Einwendungen gegen die Abrechnung{" "}
          {w("können Sie", "kannst du")} bis zum Ablauf des zwölften Monats nach Zugang dieser Abrechnung mitteilen (§ 556 Abs. 3 BGB).
        </p>
        <p className="letter-sign">
          {/* bei einer Nachzahlung mit Dank */}
          {result?.kind === "due" ? w("Vielen Dank und freundliche Grüße", "Danke und viele Grüße") : w("Freundliche Grüße", "Viele Grüße")}
          <br />
          {landlord.name}
        </p>
        {attachments.length > 0 && (
          <p className="letter-attachments">
            <strong>Anlage{attachments.length === 1 ? "" : "n"}</strong>
            {attachments.map((a) => (
              <span key={a.id}>{attachmentLabel(a)}</span>
            ))}
          </p>
        )}
      </div>
      <div className="letter-foot">
        <span>
          Betriebskostenabrechnung {year} · {r.unit.name}
          {draft ? " · Entwurf" : ""}
        </span>
        <span>{property.address || property.name}</span>
      </div>
    </div>
  );
}

/** Beigefügte Seiten hinter einem Anschreiben – je Seite ein Blatt, mit den Schwärzungen für diesen Mieter */
function AttachmentPages({ attachments, tenantId }: { attachments: Attachment[]; tenantId: string }) {
  return (
    <>
      {attachments.flatMap((a) => {
        const pages = a.pages.filter((p) => p.include);
        return pages.map((p, i) => (
          <div key={p.id} className="attachment-sheet">
            <div className="attachment-caption">
              Anlage: {attachmentLabel(a)}
              {pages.length > 1 ? ` · Seite ${i + 1} von ${pages.length}` : ""}
            </div>
            <SheetImage page={p} tenantId={tenantId} maxHeight="250mm" />
          </div>
        ));
      })}
    </>
  );
}
