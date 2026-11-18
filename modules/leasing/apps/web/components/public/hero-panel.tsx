import { rentShort } from "../../lib/listings";
import { CalendarCheckIcon, BuildingsIcon } from "@phosphor-icons/react/dist/ssr";

/** A drawn skyline in the ink colour at low strength, pinned to the bottom of a filled panel. Decorative. */
export function Skyline({ className = "h-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 220"
      preserveAspectRatio="xMidYMax meet"
      className={`pointer-events-none absolute inset-x-0 bottom-0 ${className} w-full text-on-accent`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor" opacity="0.10">
        <rect x="10" y="120" width="52" height="100" rx="3" />
        <rect x="74" y="70" width="44" height="150" rx="3" />
        <rect x="130" y="100" width="60" height="120" rx="3" />
        <rect x="204" y="30" width="46" height="190" rx="3" />
        <rect x="264" y="84" width="58" height="136" rx="3" />
        <rect x="336" y="56" width="42" height="164" rx="3" />
        <rect x="390" y="112" width="80" height="108" rx="3" />
      </g>
      <g fill="currentColor" opacity="0.16">
        <rect x="22" y="136" width="8" height="10" rx="1" />
        <rect x="40" y="136" width="8" height="10" rx="1" />
        <rect x="86" y="90" width="8" height="10" rx="1" />
        <rect x="102" y="90" width="8" height="10" rx="1" />
        <rect x="216" y="52" width="8" height="10" rx="1" />
        <rect x="232" y="52" width="8" height="10" rx="1" />
        <rect x="348" y="76" width="8" height="10" rx="1" />
        <rect x="406" y="130" width="8" height="10" rx="1" />
      </g>
    </svg>
  );
}

/**
 * The hero's right side when no listing has a photo (the demo units have none). A drawn skyline on the brand's
 * soft green with two plain facts from the listings, so the space reads as designed, not as a missing image.
 */
export function HeroPanel({ count, from, areas }: { count: number; from: string | undefined; areas: number }) {
  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-accent p-6 text-on-accent">
      <Skyline />
      <div className="relative flex items-center gap-2 text-sm font-semibold">
        <BuildingsIcon size={18} aria-hidden="true" />
        Homes across the UAE, ready to view
      </div>
      <dl className="relative m-0 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-page/80 p-4 text-ink backdrop-blur">
          <dt className="text-xs text-muted">Open for site visits</dt>
          <dd className="m-0 mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {count}
            <span className="ml-1.5 text-sm font-normal text-muted">
              {count === 1 ? "property" : "properties"}
              {areas > 1 ? ` in ${areas} areas` : ""}
            </span>
          </dd>
        </div>
        <div className="rounded-2xl bg-page/80 p-4 text-ink backdrop-blur">
          <dt className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarCheckIcon size={13} aria-hidden="true" />
            Rent from
          </dt>
          <dd className="m-0 mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {from ? rentShort(from) : "-"}
            <span className="ml-1 text-sm font-normal text-muted">/yr</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
