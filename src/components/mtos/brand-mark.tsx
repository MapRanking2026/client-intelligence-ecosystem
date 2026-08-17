export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <path d="M8 29h24" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M9 24.5 16 17l5 4.5L30.5 12"
        stroke="var(--accent)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="30.5" cy="12" r="3.2" fill="var(--accent)" />
    </svg>
  );
}
