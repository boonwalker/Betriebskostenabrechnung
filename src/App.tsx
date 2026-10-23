import { focusElement, parseHash } from "./lib/nav";
import { Logo } from "./components/Logo";
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
import Documents from "./pages/Documents";
import Home from "./pages/Home";
import { aiAccess } from "./lib/aiAccess";
import { portfolioOn } from "./lib/model";

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

const NAV = (portfolio: boolean) => [
  ["", portfolio ? "Portfolio" : "Objekte"],
  ["mieter", "Mieter"],
  ["abrechnungen", "Abrechnungen"],
];

export default function App() {
  const [data, update, replace, sync] = useAppData();
  const { parts } = useHashRoute();
  const [section = "", id, sub] = parts;
  const access = aiAccess(data.settings);
  const portfolio = portfolioOn(data.settings);

  // Belegeingang: verarbeitet im Hintergrund weiter, auch wenn die Seite gewechselt wird
  const upload = (files: File[]) => {
    if (!access) return;
    // Ergebnis erscheint auf der Startseite bzw. in der Belegablage
    void import("./lib/inbox").then(({ processUpload }) => processUpload(files, access, data, update));
  };
  const processing = (data.documents ?? []).filter((d) => d.status === "processing").length;


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
  else if (section === "belege") page = <Documents data={data} update={update} onUpload={upload} />;
  else if (section === "start" || (section === "" && data.properties.length === 0 && data.tenants.length === 0 && data.statements.length === 0))
    page = <Home data={data} update={update} replace={replace} onUpload={upload} />;
  else page = <Dashboard data={data} />;

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <a className={`brand ${section === "start" ? "active" : ""}`} href="#/start" aria-label="Startseite">
            <Logo />
            {processing > 0 && <span className="brand-badge" title="Belege werden verarbeitet">{processing}</span>}
          </a>
          <nav className="nav">
            {NAV(portfolio).map(([path, label]) => (
              <a key={path} href={`#/${path}`} className={section === path || (path === "" && (section === "objekte" || section === "weg")) ? "active" : ""}>
                {label}
              </a>
            ))}
          </nav>
          {sync !== "local" && (
            <span className={`sync-status ${sync}`} title="Speicherort deiner Daten">
              <span aria-hidden="true">{sync === "loading" || sync === "saving" ? "…" : sync === "saved" ? "✓" : "⚠"}</span>
              <span className="sync-text">
                {sync === "loading" ? " Lade Daten" : sync === "saving" ? " Speichert" : sync === "saved" ? " Gespeichert" : " Nicht gespeichert"}
              </span>
            </span>
          )}
          <a className={`nav-profile ${section === "einstellungen" ? "active" : ""}`} href="#/einstellungen" aria-label="Einstellungen" title="Einstellungen">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 20.5c.9-3.9 4-6 7.5-6s6.6 2.1 7.5 6" />
            </svg>
          </a>
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}
