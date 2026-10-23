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
import { UploadButtons } from "./components/UploadButtons";
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
  ["einstellungen", "Einstellungen"],
];

export default function App() {
  const [data, update, replace, sync] = useAppData();
  const { parts } = useHashRoute();
  const [section = "", id, sub] = parts;
  const [menuOpen, setMenuOpen] = useState(false);
  const access = aiAccess(data.settings);
  const portfolio = portfolioOn(data.settings);

  // Belegeingang: verarbeitet im Hintergrund weiter, auch wenn die Seite gewechselt wird
  const upload = (files: File[]) => {
    if (!access) return;
    setMenuOpen(false);
    void import("./lib/inbox").then(({ processUpload }) => processUpload(files, access, data, update));
    if (section !== "belege") window.location.hash = "#/belege";
  };
  const processing = (data.documents ?? []).filter((d) => d.status === "processing").length;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [section, id, sub]);

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
  else page = <Dashboard data={data} update={update} replace={replace} />;

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <button type="button" className="brand" aria-label="Hauptmenü" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <Logo />
            {processing > 0 && <span className="brand-badge" title="Belege werden verarbeitet">{processing}</span>}
          </button>
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
        </div>
      </header>
      {menuOpen && (
        <div className="main-menu-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
          <nav className="main-menu" aria-label="Hauptmenü">
            <div className="main-menu-section">
              <div className="main-menu-label">Belege erfassen</div>
              {access ? (
                <UploadButtons onFiles={upload} />
              ) : (
                <a className="main-menu-hint" href="#/einstellungen?f=belegerkennung">Für die Belegerkennung zuerst Einladungscode oder API-Schlüssel eintragen →</a>
              )}
            </div>
            <a href="#/belege" className={section === "belege" ? "active" : ""}>
              <span aria-hidden>🗂️</span> Belegablage
              {(data.documents?.length ?? 0) > 0 && <span className="main-menu-count">{data.documents!.length}</span>}
            </a>
            <a href="#/"><span aria-hidden>🏠</span> {portfolio ? "Portfolio" : "Objekte"}</a>
            <a href="#/mieter"><span aria-hidden>👥</span> Mieter</a>
            <a href="#/abrechnungen"><span aria-hidden>🧾</span> Abrechnungen</a>
            <a href="#/einstellungen"><span aria-hidden>⚙️</span> Einstellungen</a>
          </nav>
        </div>
      )}
      <main>{page}</main>
    </>
  );
}
