/** Brand mark: a leaf on a stem, drawn in the accent colour. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="7" fill="var(--accent)" />
      <path d="M12 19V9.5" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 12.5c-3.2 0-5-2-5-5 3.2 0 5 1.8 5 5Z" fill="var(--accent-ink)" opacity=".9" />
      <path d="M12 10.5c3.2 0 5-2 5-5-3.2 0-5 1.8-5 5Z" fill="var(--accent-ink)" />
    </svg>
  );
}
