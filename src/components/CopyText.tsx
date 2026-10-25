import { useRef, useState, type ReactNode } from "react";
import { Modal } from "./ui";

/** Fertiger Text (Erinnerung, Schreiben) zum Kopieren; die Zwischenablage kann in der Vorschau gesperrt sein – dann markieren */
export function CopyTextModal({ title, text, children, onClose }: { title: string; text: string; children?: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ref.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {children}
        <textarea ref={ref} className="copy-text" readOnly value={text} rows={Math.min(24, text.split("\n").length + 2)} onFocus={(e) => e.target.select()} />
        <div className="row">
          <span className="spacer" />
          <button onClick={onClose}>Schließen</button>
          <button className="primary" onClick={copy}>{copied ? "✓ Kopiert" : "Text kopieren"}</button>
        </div>
      </div>
    </Modal>
  );
}
