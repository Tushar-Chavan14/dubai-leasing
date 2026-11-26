/**
 * Drawn for a unit with no photo yet: a faint floor plan that changes with the bedroom count, on a quiet tile.
 * Fills its parent and sets the height.
 */
export function PlanPlaceholder({ bedrooms, label }: { bedrooms: number | null; label?: string }) {
  const rooms = Math.max(1, Math.min(4, bedrooms ?? 1));
  const w = 120 / rooms;
  return (
    <div aria-hidden="true" className="relative grid h-full w-full place-items-center bg-raised text-line">
      <svg viewBox="0 0 200 130" fill="none" stroke="currentColor" strokeWidth="3" className="h-2/5 max-h-36 w-auto">
        <rect x="6" y="6" width="188" height="118" rx="6" />
        <path d="M126 6v70M126 96v28M6 76h70M96 76h30" />
        {Array.from({ length: rooms - 1 }, (_, i) => (
          <path key={i} d={`M${6 + w * (i + 1)} 76v48`} />
        ))}
        <path d="M150 124a18 18 0 0 1 18-18" strokeWidth="2" />
      </svg>
      {label && <span className="absolute bottom-2.5 left-3.5 font-sans text-xs text-muted">{label}</span>}
    </div>
  );
}
