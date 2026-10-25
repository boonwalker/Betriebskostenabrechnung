import { useState } from "react";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { effectiveAfter, rentIncreaseCheck, rentIncreaseLetter } from "../lib/rentIncrease";
import type { AppData, RentReview, Tenant } from "../lib/types";
import { CopyTextModal } from "./CopyText";
import { NumberInput, type PageProps } from "./ui";

const EMPTY: RentReview = { comparableRentPerSqm: null, source: "", capPercent: 20 };
const perSqm = (rent: number, area: number) => (area ? `${(rent / area).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/m²` : "");

/** Mieterhöhung bis zur ortsüblichen Vergleichsmiete (§ 558 BGB) im Mieterprofil */
export function RentIncreaseSection({ data, update, tenant }: { data: AppData; update: PageProps["update"]; tenant: Tenant }) {
  const property = data.properties.find((p) => p.id === tenant.propertyId);
  const today = todayISO();
  const review = { ...EMPTY, ...tenant.rentReview };
  const [letter, setLetter] = useState<{ rent: number; delivered: string } | null>(null);
  if (!property) return null;
  const c = rentIncreaseCheck(tenant, property, today, review);
  if (!c) return null;
  const set = (patch: Partial<RentReview>) =>
    update((d) => ({ ...d, tenants: d.tenants.map((t) => (t.id === tenant.id ? { ...t, rentReview: { ...review, ...patch } } : t)) }));
  const landlord = tenant.landlord?.name || data.settings.landlord.name;

  return (
    <section className="rent-increase">
      <h3>Mieterhöhung prüfen (§ 558 BGB)</h3>
      <label className="row small">
        <input type="checkbox" checked={!!review.excluded} onChange={(e) => set({ excluded: e.target.checked })} />
        Staffel- oder Indexmiete vereinbart
      </label>
      {review.excluded ? (
        <p className="small muted" style={{ margin: "6px 0 0" }}>Bei Staffel- oder Indexmiete gibt es keine Erhöhung auf die Vergleichsmiete – es gilt die Vereinbarung im Vertrag.</p>
      ) : (
        <>
          <div className="grid rent-increase-inputs">
            <label className="field">
              Vergleichsmiete €/m² (netto kalt)
              <NumberInput value={review.comparableRentPerSqm ?? undefined} allowEmpty onChange={(n) => set({ comparableRentPerSqm: Number.isNaN(n) ? null : n })} placeholder="z. B. 7,20" />
            </label>
            <label className="field">
              Kappungsgrenze in 3 Jahren
              <select value={review.capPercent} onChange={(e) => set({ capPercent: Number(e.target.value) as 15 | 20 })}>
                <option value={20}>20 %</option>
                <option value={15}>15 % (Gebiet mit Verordnung)</option>
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              Begründung (Quelle der Vergleichsmiete)
              <input value={review.source} onChange={(e) => set({ source: e.target.value })} placeholder="z. B. Mietspiegel der Stadt Heinsberg 2025, Baujahr 2010–2019, 40–60 m²" />
            </label>
          </div>
          <dl className="profile-facts" style={{ marginTop: 10 }}>
            <dt>Kaltmiete seit</dt>
            <dd>{formatDate(c.lastChange)}: {formatEUR(c.currentRent)} <span className="muted small">{perSqm(c.currentRent, c.area)}</span></dd>
            <dt>Verlangen ab</dt>
            <dd>{c.earliestRequest <= today ? "sofort möglich" : formatDate(c.earliestRequest)}</dd>
            <dt>Wirksam ab</dt>
            <dd>frühestens {formatDate(c.effectiveFrom)}</dd>
            <dt>Kappungsgrenze</dt>
            <dd>{formatEUR(c.baseRent3y)} + {c.capPercent} % = {formatEUR(c.capLimit)}</dd>
            <dt>Vergleichsmiete</dt>
            <dd>{c.comparableLimit !== null ? `${c.area.toLocaleString("de-DE")} m² × ${review.comparableRentPerSqm!.toLocaleString("de-DE")} € = ${formatEUR(c.comparableLimit)}` : <span className="muted">noch nicht erfasst</span>}</dd>
            {c.maxRent !== null && (
              <>
                <dt>Neue Kaltmiete</dt>
                <dd>
                  {c.increase! > 0 ? (
                    <>
                      höchstens <strong>{formatEUR(c.maxRent)}</strong> <span className="ok-text">(+ {formatEUR(c.increase!)})</span>
                    </>
                  ) : (
                    <span className="muted">keine Erhöhung möglich – die Miete liegt bereits auf oder über der Grenze</span>
                  )}
                </dd>
              </>
            )}
          </dl>
          {c.maxRent !== null && c.increase! > 0 && (
            <button style={{ marginTop: 10 }} onClick={() => setLetter({ rent: c.maxRent!, delivered: c.earliestRequest })}>
              Erhöhungsverlangen erstellen
            </button>
          )}
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            Der Mieter muss bis zum Ende des zweiten Monats nach Zugang zustimmen und hat ein Sonderkündigungsrecht (§ 561 BGB). Modernisierungsumlagen
            (§ 559) sind hier nicht berücksichtigt.
          </p>
        </>
      )}
      {letter && (
        <CopyTextModal
          title="Mieterhöhungsverlangen"
          text={rentIncreaseLetter({ tenant, property, check: c, review, newRent: letter.rent, delivered: letter.delivered, landlordName: landlord })}
          onClose={() => setLetter(null)}
        >
          <div className="grid">
            <label className="field">
              Neue Kaltmiete (höchstens {formatEUR(c.maxRent ?? 0)})
              <NumberInput value={letter.rent} onChange={(rent) => setLetter({ ...letter, rent: Math.min(rent, c.maxRent ?? rent) })} />
            </label>
            <label className="field">
              Zugang beim Mieter (frühestens {formatDate(c.earliestRequest)})
              <input type="date" value={letter.delivered} min={c.earliestRequest} onChange={(e) => e.target.value >= c.earliestRequest && setLetter({ ...letter, delivered: e.target.value })} />
            </label>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Wirksam ab {formatDate(effectiveAfter(c, letter.delivered))}. Textform genügt (E-Mail oder Brief); wenn die Erhöhung gilt, trage sie als neue Zeile unter
            „Miete und Vorauszahlungen“ ein.
          </p>
        </CopyTextModal>
      )}
    </section>
  );
}
