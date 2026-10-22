import { go } from "../lib/nav";
import type { IssueTarget } from "../lib/release";

/** Hinweise und Blocker; ein Klick führt zur Stelle, an der der Eintrag zu pflegen ist */
export function IssueList({
  errors = [],
  warnings = [],
  targets,
  onFix,
  style,
}: {
  errors?: string[];
  warnings?: string[];
  targets: Record<string, IssueTarget>;
  onFix?: (fix: NonNullable<IssueTarget["fix"]>) => void;
  style?: React.CSSProperties;
}) {
  const item = (text: string, level: "error" | "warning") => {
    const t = targets[text];
    return (
      <li key={text} className={`${level} ${t ? "clickable" : ""}`} onClick={t ? () => go(t.href) : undefined} title={t ? t.label : undefined}>
        {level === "error" ? "✗ " : "⚠ "}
        {text}
        {t && (
          <>
            {" "}
            {t.fix && onFix ? (
              <button
                className="fix"
                onClick={(e) => {
                  e.stopPropagation();
                  onFix(t.fix!);
                  go(t.href);
                }}
              >
                {t.label}
              </button>
            ) : (
              <a
                className="fix"
                href={t.href}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  go(t.href);
                }}
              >
                {t.label} →
              </a>
            )}
          </>
        )}
      </li>
    );
  };
  if (!errors.length && !warnings.length) return null;
  return (
    <ul className="findings" style={style}>
      {errors.map((e) => item(e, "error"))}
      {warnings.map((w) => item(w, "warning"))}
    </ul>
  );
}
