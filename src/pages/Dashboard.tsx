import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import type { AppData } from "../lib/types";

export default function Dashboard({ data }: { data: AppData }) {
  const today = todayISO();
  const activeTenants = data.tenants.filter((t) => !t.moveOut || t.moveOut >= today);
  const unitCount = data.properties.reduce((a, p) => a + p.units.length, 0);
  const lastYear = String(new Date().getFullYear() - 1);

  const steps = [
    { done: !!data.settings.landlord.name, label: <>Deine Vermieterdaten in den <a href="#/einstellungen">Einstellungen</a> hinterlegen</> },
    { done: data.properties.length > 0, label: <>Ein <a href="#/objekte">Objekt</a> mit seinen Wohnungen und Wohnflächen anlegen</> },
    { done: data.tenants.length > 0, label: <><a href="#/mieter">Mieter</a> mit Einzugsdatum, Personenzahl und Vorauszahlung erfassen</> },
    { done: data.statements.length > 0, label: <>Eine <a href="#/abrechnungen">Abrechnung</a> anlegen und die Belege des Jahres hochladen</> },
  ];

  const missingLastYear = data.properties.filter(
    (p) => !data.statements.some((s) => s.propertyId === p.id && s.periodStart.startsWith(lastYear)),
  );

  return (
    <>
      <h1>Übersicht</h1>
      <div className="grid" style={{ marginBottom: 16 }}>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">Objekte</div>
          <div className="stat">{data.properties.length}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">Wohneinheiten</div>
          <div className="stat">{unitCount}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">Aktuelle Mieter</div>
          <div className="stat">{activeTenants.length}</div>
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="muted small">Abrechnungen</div>
          <div className="stat">{data.statements.length}</div>
        </div>
      </div>

      {steps.some((s) => !s.done) && (
        <div className="card">
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

      {missingLastYear.length > 0 && data.tenants.length > 0 && (
        <div className="card">
          <h2>Offene Abrechnungen {lastYear}</h2>
          <p>Für folgende Objekte gibt es noch keine Abrechnung für {lastYear}. Sie muss den Mietern bis spätestens 31.12.{Number(lastYear) + 1} zugehen:</p>
          <ul>
            {missingLastYear.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
          <a className="btn primary" href="#/abrechnungen">Abrechnung erstellen</a>
        </div>
      )}

      {data.statements.length > 0 && (
        <div className="card">
          <h2>Letzte Abrechnungen</h2>
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
      )}
    </>
  );
}
