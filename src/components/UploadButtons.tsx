/** Zwei Wege in den Belegeingang: Kamera (ein Foto) und Dateiauswahl (beliebig viele Fotos/PDFs) */
export function UploadButtons({
  onFiles,
  disabled,
  compact,
  labels = ["Unterlagen fotografieren", "Fotos / PDFs hochladen"],
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  labels?: [string, string];
}) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Kopie, bevor das Feld zurückgesetzt wird – sonst ist die Liste leer
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length) onFiles(files);
  };
  return (
    <div className={`upload-buttons ${compact ? "compact" : ""}`}>
      <label className={`btn primary upload-btn ${disabled ? "disabled" : ""}`}>
        <span aria-hidden>📷</span> {labels[0]}
        <input type="file" accept="image/*" capture="environment" hidden disabled={disabled} onChange={pick} />
      </label>
      <label className={`btn upload-btn ${disabled ? "disabled" : ""}`}>
        <span aria-hidden>📄</span> {labels[1]}
        <input type="file" accept="application/pdf,image/*" multiple hidden disabled={disabled} onChange={pick} />
      </label>
    </div>
  );
}
