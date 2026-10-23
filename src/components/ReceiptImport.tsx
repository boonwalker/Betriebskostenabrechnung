import { useState } from "react";
import { COST_CATEGORIES, KEY_LABELS } from "../lib/betrkv";
import { formatDate } from "../lib/dates";
import type { Extraction } from "../lib/extract";
import { isSupportedFile } from "../lib/files";
import { formatEUR } from "../lib/format";
import { uid } from "../lib/store";
import type { AllocationKey, CostItem, Property, Statement } from "../lib/types";
import { PROXY_URL, type AiAccess } from "../lib/aiAccess";
import { Modal, NumberInput } from "./ui";

interface Job {
  id: string;
  file: File;
  status: "running" | "done" | "error";
  error?: string;
  extraction?: Extraction;
  items: (CostItem & { include: boolean })[];
}

export default function ReceiptImport({
  access,
  statement,
  property,
  onClose,
  onAdd,
}: {
  access: AiAccess | null;
  statement: Statement;
  property: Property;
  onClose: () => void;
  /** notices: hochgeladene Bescheide der Gemeinde – werden als Anlage fürs Mieterschreiben übernommen */
  onAdd: (items: CostItem[], notices: File[]) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);

  const patchJob = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const period = `${formatDate(statement.periodStart)} bis ${formatDate(statement.periodEnd)}`;
    for (const file of Array.from(files)) {
      const job: Job = { id: uid(), file, status: "running", items: [] };
      if (!isSupportedFile(file)) {
        job.status = "error";
        job.error = "Dateityp wird nicht unterstützt (PDF, JPG, PNG, WebP, GIF).";
        setJobs((js) => [...js, job]);
        continue;
      }
      setJobs((js) => [...js, job]);
      import("../lib/extract")
        .then(({ extractInvoice }) => extractInvoice(file, access!, period))
        .then((extraction) =>
          patchJob(job.id, {
            status: "done",
            extraction,
            items: extraction.items.map((it) => ({
              id: uid(),
              include: it.allocableAmount !== 0,
              category: it.category,
              label: it.description || COST_CATEGORIES.find((c) => c.no === it.category)?.label || "",
              amount: it.allocableAmount,
              key: it.recommendedKey,
              note: it.reasoning,
              ...(it.laborKind !== "none" && it.laborCost > 0 ? { laborCost: it.laborCost, laborKind: it.laborKind } : {}),
              ...(it.co2Cost > 0 ? { co2Cost: it.co2Cost, co2Kg: it.co2Kg || undefined } : {}),
              source: file.name,
            })),
          }),
        )
        .catch((e: unknown) => patchJob(job.id, { status: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const setItem = (jobId: string, itemId: string, patch: Partial<Job["items"][number]>) =>
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, items: j.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : j)));

  const selected = jobs.flatMap((j) => j.items.filter((i) => i.include));
  const running = jobs.some((j) => j.status === "running");

  const commit = () => {
    onAdd(
      selected.map(({ include: _include, ...item }) => ({
        ...item,
        consumption: item.key === "consumption" || item.key === "heating" ? {} : undefined,
        directUnitId: item.key === "direct" ? property.units[0]?.id : undefined,
      })),
      jobs.filter((j) => j.status === "done" && j.extraction?.isMunicipalNotice).map((j) => j.file),
    );
    onClose();
  };

  if (!access) {
    return (
      <Modal title="Belege hochladen" onClose={onClose}>
        <p>
          Zum automatischen Auslesen von Rechnungen und Bescheiden nutzt die App die KI Claude von Anthropic.{" "}
          {PROXY_URL
            ? "Dafür brauchst du einen Einladungscode oder einen eigenen API-Schlüssel."
            : <>Dafür brauchst du einen eigenen API-Schlüssel (erhältlich unter <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>).</>}
        </p>
        <a className="btn primary" href="#/einstellungen?f=belegerkennung">{PROXY_URL ? "Einladungscode eintragen" : "API-Schlüssel in den Einstellungen hinterlegen"}</a>
      </Modal>
    );
  }

  return (
    <Modal title="Belege hochladen" onClose={onClose}>
      <div className="stack">
        <label
          className={`dropzone ${over ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <input type="file" multiple accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
          <strong>Rechnungen, Bescheide oder Fotos hierher ziehen</strong>
          <div className="small">oder klicken zum Auswählen · PDF, JPG, PNG</div>
        </label>
        <p className="muted small">
          Die Belege werden zur Auswertung an die Anthropic-API gesendet. Bitte prüfe jede erkannte Position – insbesondere die Trennung umlagefähiger und nicht
          umlagefähiger Kosten.
        </p>

        {jobs.map((job) => (
          <div key={job.id} className="card" style={{ marginBottom: 0 }}>
            <div className="row">
              <strong>{job.file.name}</strong>
              <span className="spacer" />
              {job.status === "running" && <span className="badge neutral">wird ausgelesen …</span>}
              {job.status === "error" && <span className="badge danger">Fehler</span>}
              {job.status === "done" && <span className="badge ok">erkannt</span>}
            </div>
            {job.error && <div className="alert danger" style={{ marginTop: 8 }}>{job.error}</div>}
            {job.extraction && (
              <>
                <div className="muted small" style={{ margin: "4px 0 8px" }}>
                  {job.extraction.vendor}
                  {job.extraction.invoiceDate && ` · ${formatDate(job.extraction.invoiceDate)}`}
                  {job.extraction.servicePeriodStart &&
                    ` · Leistungszeitraum ${formatDate(job.extraction.servicePeriodStart)} – ${formatDate(job.extraction.servicePeriodEnd)}`}
                  {` · Rechnungsbetrag ${formatEUR(job.extraction.totalAmount)}`}
                </div>
                {job.extraction.notes && <div className="alert info small">{job.extraction.notes}</div>}
                <div className="table-wrap">
                  <table className="compact">
                    <thead>
                      <tr>
                        <th />
                        <th>Kostenart</th>
                        <th>Bezeichnung</th>
                        <th className="num">umlagefähig (€)</th>
                        <th>Schlüssel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.items.map((it, idx) => {
                        const raw = job.extraction!.items[idx];
                        return (
                          <tr key={it.id}>
                            <td>
                              <input type="checkbox" checked={it.include} onChange={(e) => setItem(job.id, it.id, { include: e.target.checked })} aria-label="übernehmen" />
                            </td>
                            <td>
                              <select value={it.category} onChange={(e) => setItem(job.id, it.id, { category: Number(e.target.value) })}>
                                {COST_CATEGORIES.map((c) => (
                                  <option key={c.no} value={c.no}>{c.no}. {c.label}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input value={it.label} onChange={(e) => setItem(job.id, it.id, { label: e.target.value })} />
                              <div className="muted small">
                                {raw.reasoning}
                                {raw.nonAllocableAmount > 0 && ` · nicht umlagefähig: ${formatEUR(raw.nonAllocableAmount)}`}
                                {raw.laborCost > 0 && ` · § 35a: ${formatEUR(raw.laborCost)}`}
                                {raw.co2Cost > 0 && ` · CO2: ${formatEUR(raw.co2Cost)}`}
                              </div>
                            </td>
                            <td style={{ width: 120 }}>
                              <NumberInput value={it.amount} onChange={(amount) => setItem(job.id, it.id, { amount })} />
                            </td>
                            <td>
                              <select value={it.key} onChange={(e) => setItem(job.id, it.id, { key: e.target.value as AllocationKey })}>
                                {Object.entries(KEY_LABELS).map(([k, l]) => (
                                  <option key={k} value={k}>{l}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        ))}

        <div className="row">
          <span className="spacer" />
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={running || selected.length === 0} onClick={commit}>
            {selected.length} Position{selected.length === 1 ? "" : "en"} übernehmen
          </button>
        </div>
      </div>
    </Modal>
  );
}
