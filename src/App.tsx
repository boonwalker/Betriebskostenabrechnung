import { focusElement, parseHash } from "./lib/nav";
import { useEffect, useState } from "react";
import { useAppData } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import PropertyDetail from "./pages/PropertyDetail";
import PropertyEditor from "./pages/PropertyEditor";
import PropertyWizard from "./pages/PropertyWizard";
import WegEditor from "./pages/WegEditor";
import Tenants from "./pages/Tenants";
import Statements from "./pages/Statements";
import StatementEditor from "./pages/StatementEditor";
import PrintView from "./pages/PrintView";
import SettingsPage from "./pages/Settings";

function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => {
      const next = parseHash();
      setRoute(next);
      // mit Sprungziel (?f=…) dorthin scrollen, sonst an den Seitenanfang
      if (next.params.f) focusElement(next.params.f);
      else window.scrollTo(0, 0);
    };
    if (parseHash().params.f) focusElement(parseHash().params.f);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

const NAV = [
  ["", "Portfolio"],
  ["mieter", "Mieter"],
  ["abrechnungen", "Abrechnungen"],
  ["einstellungen", "Einstellungen"],
] as const;

export default function App() {
  const [data, update, replace, sync] = useAppData();
  const { parts } = useHashRoute();
  const [section = "", id, sub] = parts;

  let page;
  if (section === "objekte" && id === "neu") page = <PropertyWizard key="neu" data={data} update={update} />;
  else if (section === "objekte" && id && sub === "bearbeiten") page = <PropertyEditor key={id} data={data} update={update} propertyId={id} />;
  else if (section === "objekte" && id) page = <PropertyDetail key={id} data={data} update={update} propertyId={id} />;
  else if (section === "weg" && (id === "jahresabrechnung" || id === "wirtschaftsplan") && sub)
    page = <WegEditor key={sub} data={data} update={update} kind={id === "jahresabrechnung" ? "annual" : "plan"} id={sub} />;
  else if (section === "mieter") page = <Tenants data={data} update={update} />;
  else if (section === "abrechnungen" && id && sub === "druck") page = <PrintView data={data} statementId={id} />;
  else if (section === "abrechnungen" && id) page = <StatementEditor data={data} update={update} statementId={id} />;
  else if (section === "abrechnungen") page = <Statements data={data} update={update} />;
  else if (section === "einstellungen") page = <SettingsPage data={data} update={update} replace={replace} />;
  else page = <Dashboard data={data} />;

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="#/">Immobilien &amp; Betriebskosten</a>
          <nav className="nav">
            {NAV.map(([path, label]) => (
              <a key={path} href={`#/${path}`} className={section === path || (path === "" && (section === "objekte" || section === "weg")) ? "active" : ""}>
                {label}
              </a>
            ))}
          </nav>
          {sync !== "local" && (
            <span className={`sync-status ${sync}`} title="Speicherort deiner Daten">
              {sync === "loading" ? "Lade Daten …" : sync === "saving" ? "Speichert …" : sync === "saved" ? "✓ Gespeichert" : "⚠ Nicht gespeichert"}
            </span>
          )}
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}
