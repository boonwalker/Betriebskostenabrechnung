/** Bildmarke von ImmoFriend: ein Haus mit Schornstein, dessen Fenster und Tür ein freundliches Gesicht bilden */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo-mark">
      <rect width="64" height="64" rx="16" fill="#2f6b73" />
      <rect x="40" y="13" width="6" height="11" rx="1.5" fill="#fff" />
      <path d="M12 31 32 13l20 18" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 29v18a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V29" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="27" cy="35" r="2.6" fill="#fff" />
      <circle cx="37" cy="35" r="2.6" fill="#fff" />
      <path d="M25.5 41.5q6.5 6 13 0" fill="none" stroke="#ffd27a" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

/** Bildmarke mit Schriftzug */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">
        Immo<span>Friend</span>
      </span>
    </span>
  );
}
