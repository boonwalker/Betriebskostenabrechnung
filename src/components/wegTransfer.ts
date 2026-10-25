import { formatEUR } from "../lib/format";
import { transferToStatement } from "../lib/weg";
import type { AppData, Statement, WegAnnualStatement } from "../lib/types";
import { askConfirm, showMessage } from "./dialog";

/**
 * WEG-Jahresabrechnung(en) in eine Mieterabrechnung übernehmen. Noch ungeprüfte, eindeutig als umlagefähig
 * eingestufte Positionen werden zuerst aufgelistet und nach Bestätigung als geprüft übernommen.
 * `statement` darf neu sein (noch nicht in den Daten) – dann wird sie angelegt.
 */
export async function takeOverAnnuals(
  data: AppData,
  update: (fn: (d: AppData) => AppData) => void,
  statement: Statement,
  annuals: WegAnnualStatement[],
): Promise<void> {
  const year = statement.periodStart.slice(0, 4);
  const transferred = new Set(statement.costs.map((c) => c.sourcePositionId).filter(Boolean));
  const open = annuals.flatMap((a) =>
    a.positions.filter((p) => !p.reviewed && p.classification === "allocable" && p.amount !== 0 && p.heating !== "component" && !transferred.has(p.id)),
  );
  let sources = annuals;
  if (open.length) {
    const confirmed = await askConfirm(
      `${open.length} Position${open.length === 1 ? " ist" : "en sind"} in der WEG-Jahresabrechnung ${year} noch nicht geprüft. Die App stuft sie als umlagefähig ein:\n\n` +
        open.map((p) => `• ${p.label}: ${formatEUR(p.amount)}`).join("\n") +
        "\n\nEinstufung bestätigen und übernehmen?",
      { confirmLabel: "Bestätigen und übernehmen" },
    );
    if (confirmed) {
      const ids = new Set(open.map((p) => p.id));
      sources = annuals.map((a) => ({ ...a, positions: a.positions.map((p) => (ids.has(p.id) ? { ...p, reviewed: true } : p)) }));
    }
  }
  const property = data.properties.find((p) => p.id === statement.propertyId)!;
  let costs = statement.costs;
  const notes: string[] = [];
  let added = 0;
  for (const a of sources) {
    const { items, skipped } = transferToStatement(a, { ...statement, costs }, { property, tenants: data.tenants });
    costs = [...costs, ...items];
    added += items.length;
    for (const sk of skipped) if (!["bereits übernommen", "nicht umlagefähig", "Betrag 0"].includes(sk.reason)) notes.push(`• ${sk.position.label}: ${sk.reason}`);
  }
  // Bestätigte Einstufungen in der WEG-Abrechnung festhalten, Positionen in die Abrechnung schreiben
  const next = { ...statement, costs };
  update((d) => ({
    ...d,
    wegAnnuals: d.wegAnnuals.map((w) => sources.find((s) => s.id === w.id) ?? w),
    statements: d.statements.some((s) => s.id === next.id) ? d.statements.map((s) => (s.id === next.id ? next : s)) : [...d.statements, next],
  }));
  await showMessage(
    `${added} Position${added === 1 ? "" : "en"} übernommen.` +
      (notes.length ? `\n\nNicht übernommen:\n${notes.join("\n")}\n\nPrüfen kannst du sie in der WEG-Jahresabrechnung ${year}.` : ""),
  );
}
