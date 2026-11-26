import Link from "next/link";
import { buttonClass } from "@platform/ui/button";

/** A stack of record cards with a pointer on the front one: "pick one on the left". Colours follow the theme. */
function PickIllustration() {
  return (
    <svg viewBox="0 0 240 170" fill="none" aria-hidden="true" className="h-auto w-[220px]">
      <ellipse cx="120" cy="156" rx="86" ry="9" className="fill-line/70" />
      <rect
        x="58"
        y="22"
        width="132"
        height="92"
        rx="14"
        className="fill-raised stroke-line"
        strokeWidth="1.5"
        transform="rotate(-6 124 68)"
      />
      <rect x="50" y="34" width="140" height="100" rx="14" className="fill-page stroke-line" strokeWidth="1.5" />
      <circle cx="74" cy="60" r="12" className="fill-accent" />
      <path d="M69 60h10" className="stroke-primary" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="94" y="52" width="66" height="7" rx="3.5" className="fill-ink/80" />
      <rect x="94" y="64" width="44" height="6" rx="3" className="fill-line" />
      <rect x="64" y="86" width="112" height="6" rx="3" className="fill-line" />
      <rect x="64" y="99" width="84" height="6" rx="3" className="fill-line" />
      <rect x="64" y="114" width="40" height="10" rx="5" className="fill-primary" />
      <rect x="110" y="114" width="30" height="10" rx="5" className="fill-accent" />
      <circle cx="166" cy="34" r="15" className="fill-success" />
      <path d="m159 34 5 5 9-10" className="stroke-page" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M171 112l-2 30 8-8 7 13 6-3-7-13 11-2z"
        className="fill-cta stroke-page"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The detail pane before a record is chosen. */
export function EmptyPane({ newHref }: { newHref: string }) {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <div className="grid max-w-[380px] justify-items-center gap-4 text-center">
        <PickIllustration />
        <h2 className="m-0 font-sans text-xl font-bold tracking-[-0.02em] text-ink">Select a record to get started</h2>
        <p className="m-0 text-sm text-muted">
          Click any application or lease in the list on the left to see where it stands, its activity, and the next step
          waiting on you.
        </p>
        <Link href={newHref} className={buttonClass("ghost", "sm")}>
          Or start a new application
        </Link>
      </div>
    </div>
  );
}
