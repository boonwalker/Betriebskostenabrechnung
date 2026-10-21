import { useEffect, useState } from "react";
import { useAppData } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import PropertyDetail from "./pages/PropertyDetail";
import PropertyEditor from "./pages/PropertyEditor";
import Tenants from "./pages/Tenants";
import Statements from "./pages/Statements";
import StatementEditor from "./pages/StatementEditor";
import PrintView from "./pages/PrintView";
import SettingsPage from "./pages/Settings";

function useHashRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
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
  const [data, update, replace] = useAppData();
  const [section = "", id, sub] = useHashRoute();

  let page;
  if (section === "objekte" && id === "neu") page = <PropertyEditor key="neu" data={data} update={update} propertyId={null} />;
  else if (section === "objekte" && id && sub === "bearbeiten") page = <PropertyEditor key={id} data={data} update={update} propertyId={id} />;
  else if (section === "objekte" && id) page = <PropertyDetail key={id} data={data} update={update} propertyId={id} />;
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
              <a key={path} href={`#/${path}`} className={section === path || (path === "" && section === "objekte") ? "active" : ""}>
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}
