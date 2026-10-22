/**
 * Navigation über den Hash: `#/pfad/teil?f=elementId&t=mieterId`.
 * `f` scrollt nach dem Laden zu dem Element mit dieser id und hebt es kurz hervor,
 * `t` öffnet auf der Objektseite das Formular eines Mieters.
 */
export interface HashRoute {
  parts: string[];
  params: Record<string, string>;
}

export function parseHash(hash = window.location.hash): HashRoute {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  return { parts: path.split("/").filter(Boolean), params: Object.fromEntries(new URLSearchParams(query)) };
}

/** Ziel eines Hinweises: wohin ein Klick führt */
export interface Target {
  href: string;
  label: string;
}

export const link = (path: string, params: Record<string, string | undefined> = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return `#/${path}${q ? `?${q}` : ""}`;
};

/** Element mit der id in den Blick rücken und kurz hervorheben; wartet, bis die Seite gerendert ist */
export function focusElement(id: string, tries = 20) {
  const el = document.getElementById(id);
  if (!el) {
    if (tries > 0) setTimeout(() => focusElement(id, tries - 1), 50);
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1800);
}

/** Zu einem Ziel springen – auch wenn der Hash schon gleich ist (dann nur fokussieren) */
export function go(href: string) {
  if (window.location.hash === href) {
    const f = parseHash(href).params.f;
    if (f) focusElement(f);
  } else {
    window.location.hash = href;
  }
}
