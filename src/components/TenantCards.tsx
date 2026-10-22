import type { ReactNode } from "react";
import { calculateStatement } from "../lib/calc";
import { formatDate, todayISO } from "../lib/dates";
import { formatEUR } from "../lib/format";
import { rentAt, warmRent } from "../lib/model";
import { releasedTenant } from "../lib/release";
import type { AppData, Property, Tenant } from "../lib/types";
import { Balance, Modal } from "./ui";

const AVATAR_COLORS = ["#2f6b73", "#1f3347", "#4f7d5c", "#7a5c8f", "#9a6b3a", "#3d6f9e"];

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join("") || "?";

/** Runder Platzhalter fürs Profilbild: Initialen, Farbe fest aus dem Namen abgeleitet */
export function Avatar({ name, size = 52, muted = false }: { name: string; size?: number; muted?: boolean }) {
  const hash = [...name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      className="avatar"
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.38, background: muted ? "var(--muted)" : AVATAR_COLORS[hash % AVATAR_COLORS.length] }}
    >
      {initials(name)}
    </span>
  );
}

const isFormer = (t: Tenant, today: string) => !!t.moveOut && t.moveOut < today;

export function StatusBadge({ tenant, today = todayISO() }: { tenant: Tenant; today?: string }) {
  if (isFormer(tenant, today)) return <span className="badge neutral">ausgezogen</span>;
  if (tenant.moveIn > today) return <span className="badge warn">zieht ein</span>;
  return <span className="badge ok">aktuell</span>;
}

/** Rahmen in Hausform: Dach mit dem Objekt, darunter die Wohnungen als Stockwerke */
export function HouseFrame({ property, children }: { property: Property; children: ReactNode }) {
  return (
    <section className="house">
      <div className="house-roof">
        <span className="house-chimney" />
        <a className="house-name" href={`#/objekte/${property.id}`}>
          <strong>{property.name}</strong>
          {property.address && <span>{property.address.split("\n")[0]}</span>}
        </a>
      </div>
      <div className="house-body">{children}</div>
    </section>
  );
}

export function HouseFloor({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="house-floor">
      {label && <div className="house-floor-label">{label}</div>}
      <div className="tenant-grid">{children}</div>
    </div>
  );
}

/** Profilkachel eines Mieters mit den wichtigsten Angaben */
export function TenantCard({ tenant, onOpen }: { tenant: Tenant; onOpen: () => void }) {
  const today = todayISO();
  const former = isFormer(tenant, today);
  const r = rentAt(tenant, former ? tenant.moveOut! : today);
  return (
    <button type="button" className={`tenant-card${former ? " former" : ""}`} onClick={onOpen}>
      <div className="tenant-card-head">
        <Avatar name={tenant.name} muted={former} />
        <div className="tenant-card-title">
          <strong>{tenant.name || "Ohne Namen"}</strong>
          <StatusBadge tenant={tenant} today={today} />
        </div>
      </div>
      <div className="tenant-card-rent">
        <span>{formatEUR(warmRent(r))}</span>
        <small>Warmmiete im Monat</small>
      </div>
      <dl className="tenant-card-facts">
        <div className={former ? "wide" : undefined}>
          <dt>{former ? "Mietzeit" : "seit"}</dt>
          <dd>{former ? `${formatDate(tenant.moveIn)} – ${formatDate(tenant.moveOut)}` : formatDate(tenant.moveIn)}</dd>
        </div>
        <div>
          <dt>Kaltmiete</dt>
          <dd>{formatEUR(r?.coldRent ?? 0)}</dd>
        </div>
        {(r?.surcharge ?? 0) > 0 && (
          <div>
            <dt>Stellplatz</dt>
            <dd>{formatEUR(r!.surcharge!)}</dd>
          </div>
        )}
        <div>
          <dt>Vorauszahlung</dt>
          <dd>{formatEUR((r?.prepaymentOperating ?? 0) + (r?.prepaymentHeating ?? 0))}</dd>
        </div>
        <div>
          <dt>Personen</dt>
          <dd>{tenant.persons}</dd>
        </div>
      </dl>
      {former && !tenant.mailingAddress.trim() && <span className="badge danger">⚠ neue Anschrift fehlt</span>}
      <span className="tenant-card-more">Details ›</span>
    </button>
  );
}

/** Freie Wohnung als Platzhalterkachel */
export function VacantCard({ onRent }: { onRent: () => void }) {
  return (
    <button type="button" className="tenant-card vacant" onClick={onRent}>
      <span className="avatar vacant-avatar" aria-hidden>+</span>
      <strong>frei</strong>
      <span className="muted small">Mieter eintragen</span>
    </button>
  );
}

/** Profil mit allen Angaben, Mietentwicklung und Abrechnungen; von hier aus wird bearbeitet */
export function TenantProfile({
  data,
  tenant,
  onEdit,
  onRemove,
  onClose,
}: {
  data: AppData;
  tenant: Tenant;
  onEdit: (focus?: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const today = todayISO();
  const former = isFormer(tenant, today);
  const property = data.properties.find((p) => p.id === tenant.propertyId);
  const unit = property?.units.find((u) => u.id === tenant.unitId);
  const r = rentAt(tenant, former ? tenant.moveOut! : today);
  const history = [...tenant.rentHistory].sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const statements = property
    ? data.statements
        .filter((s) => s.propertyId === property.id)
        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
        .flatMap((s) => {
          const released = releasedTenant(s, tenant.id);
          const res = released?.result ?? calculateStatement(s, property, data.tenants).tenants.find((x) => x.tenant.id === tenant.id);
          return res ? [{ s, balance: res.balance, released: !!released }] : [];
        })
    : [];
  const address = former ? tenant.mailingAddress.trim() : tenant.mailingAddress.trim() || property?.address;

  return (
    <Modal title="Mieterprofil" onClose={onClose}>
      <div className="profile-head">
        <Avatar name={tenant.name} size={72} muted={former} />
        <div>
          <h2 style={{ margin: 0 }}>{tenant.name}</h2>
          <div className="row small muted" style={{ gap: 8, marginTop: 4 }}>
            <StatusBadge tenant={tenant} today={today} />
            <span>
              {property?.name}
              {property && property.units.length > 1 && unit ? ` · ${unit.name}` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="profile-rent">
        <div>
          <small>Warmmiete im Monat</small>
          <strong>{formatEUR(warmRent(r))}</strong>
        </div>
        <ul>
          <li><span>Kaltmiete</span><span>{formatEUR(r?.coldRent ?? 0)}</span></li>
          {(r?.surcharge ?? 0) > 0 && <li><span>Stellplatz</span><span>{formatEUR(r!.surcharge!)}</span></li>}
          <li><span>BK-Vorauszahlung</span><span>{formatEUR(r?.prepaymentOperating ?? 0)}</span></li>
          <li><span>HK-Vorauszahlung</span><span>{formatEUR(r?.prepaymentHeating ?? 0)}</span></li>
        </ul>
      </div>

      <div className="profile-grid">
        <section>
          <h3>Mietverhältnis</h3>
          <dl className="profile-facts">
            <dt>Einzug</dt>
            <dd>{formatDate(tenant.moveIn)}</dd>
            <dt>Auszug</dt>
            <dd>{tenant.moveOut ? formatDate(tenant.moveOut) : "–"}</dd>
            <dt>Personen</dt>
            <dd>{tenant.persons}</dd>
            <dt>Kaution</dt>
            <dd>{tenant.deposit ? formatEUR(tenant.deposit) : "–"}</dd>
            <dt>Anrede</dt>
            <dd>{tenant.informal ? "du" : "Sie"}</dd>
            <dt>Vermieter</dt>
            <dd>{tenant.landlord?.name || data.settings.landlord.name || "–"}</dd>
          </dl>
        </section>
        <section>
          <h3>{former ? "Neue Postanschrift" : "Postanschrift"}</h3>
          {address ? (
            <p style={{ whiteSpace: "pre-line", margin: 0 }}>{address}</p>
          ) : (
            <button className="badge danger" style={{ border: 0, cursor: "pointer" }} onClick={() => onEdit("anschrift")}>
              ⚠ fehlt – eintragen
            </button>
          )}
        </section>
        <section>
          <h3>Mietentwicklung</h3>
          <ul className="profile-list">
            {history.map((h) => (
              <li key={h.id}>
                <span>ab {formatDate(h.validFrom)}</span>
                <span>{formatEUR(warmRent(h))}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Betriebskostenabrechnungen</h3>
          {statements.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>Noch keine Abrechnung.</p>
          ) : (
            <ul className="profile-list">
              {statements.map(({ s, balance, released }) => (
                <li key={s.id}>
                  <a href={`#/abrechnungen/${s.id}`} onClick={onClose}>
                    {s.periodStart.slice(0, 4)}
                    {!released && <span className="muted small"> (Entwurf)</span>}
                  </a>
                  <Balance value={balance} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="ghost danger-text" onClick={onRemove}>Löschen</button>
        <span className="spacer" />
        <button className="primary" onClick={() => onEdit()}>Bearbeiten</button>
      </div>
    </Modal>
  );
}
