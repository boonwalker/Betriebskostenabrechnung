import { Logo } from "../components/Logo";
import type { PageProps } from "../components/ui";
import { UploadButtons } from "../components/UploadButtons";
import { aiAccess, PROXY_URL } from "../lib/aiAccess";
import { demoData } from "../lib/demo";
import { DOCUMENT_KIND_LABELS } from "../lib/inbox";
import type { AppData } from "../lib/types";

/** Startseite unter dem Logo: Begrüßung, Belege erfassen und was zuletzt erkannt wurde */
export default function Home({ data, replace, onUpload }: PageProps & { replace: (d: AppData) => void; onUpload: (files: File[]) => void }) {
  const access = aiAccess(data.settings);
  const empty = data.properties.length === 0 && data.tenants.length === 0 && data.statements.length === 0;
  const recent = [...(data.documents ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <Logo size={64} />
        <h1>Willkommen bei ImmoFriend</h1>
        <p>
          Behalte deine vermieteten Wohnungen wie ein Depot im Blick und erstelle die jährliche Betriebskostenabrechnung – mit Nachzahlung oder Guthaben je Mieter und
          fertigem Anschreiben.
        </p>
        {empty && (
          <div className="welcome-actions">
            <a className="btn primary" href="#/objekte/neu">
              Erstes Objekt anlegen
            </a>
            <button onClick={() => replace({ ...demoData(), settings: { ...demoData().settings, inviteCode: data.settings.inviteCode } })}>
              Mit Beispieldaten ausprobieren
            </button>
          </div>
        )}
      </div>

      <div className="card home-upload">
        <h2>Belege erfassen</h2>
        {access ? (
          <UploadButtons onFiles={onUpload} />
        ) : (
          <div className="alert info small" style={{ marginBottom: 0 }}>
            Zum Erkennen brauchst du {PROXY_URL ? "einen Einladungscode oder " : ""}einen API-Schlüssel – trage ihn in den{" "}
            <a href="#/einstellungen?f=belegerkennung">Einstellungen</a> ein.
          </div>
        )}
        <p className="small muted home-upload-hint">
          Mietvertrag, WEG-Abrechnung, Wirtschaftsplan, Heizkostenabrechnung, Grundsteuerbescheid oder Rechnungen – gern mehrere gemischt. ImmoFriend erkennt die
          Dokumente, trägt sie an der richtigen Stelle ein und legt sie in der Belegablage ab.
        </p>
        {recent.length > 0 && (
          <div className="home-recent">
            {recent.map((doc) => (
              <a key={doc.id} className={`home-recent-row ${doc.status}`} href={doc.link ?? "#/belege"}>
                <span className={`badge ${doc.status === "error" ? "danger" : doc.status === "processing" ? "warn" : "neutral"}`}>
                  {doc.status === "processing" ? "in Arbeit" : DOCUMENT_KIND_LABELS[doc.kind]}
                </span>
                <span className="home-recent-text">
                  <strong>{doc.title}</strong>
                  {(doc.error || doc.result) && <span className="small muted">{doc.error ?? doc.result}</span>}
                </span>
              </a>
            ))}
            <a className="small" href="#/belege">
              Alle Belege in der Ablage →
            </a>
          </div>
        )}
      </div>

      {empty && (
        <div className="welcome-points">
          <div>
            <strong>🔒 Deine Daten bleiben bei dir</strong>
            <span>Alles wird nur auf diesem Gerät gespeichert – kein Konto, kein Server. Sichere regelmäßig unter Einstellungen.</span>
          </div>
          <div>
            <strong>📱 Als App auf den Homebildschirm</strong>
            <span>iPhone: in Safari auf Teilen → „Zum Home-Bildschirm“. Android: im Chrome-Menü „App installieren“.</span>
          </div>
          <div>
            <strong>🧾 Belege per Foto</strong>
            <span>Optional liest eine KI Rechnungen und Bescheide aus – mit einem Einladungscode oder eigenem API-Schlüssel (Einstellungen).</span>
          </div>
        </div>
      )}
    </div>
  );
}
