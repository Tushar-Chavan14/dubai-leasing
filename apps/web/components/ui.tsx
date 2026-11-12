import { daysUntil, relativeDays, stateLabel } from "../lib/format";
import { Pill } from "./ui/pill";

const TONES: Record<string, "good" | "warn" | "bad" | "quiet" | undefined> = {
  // units
  PREP: "quiet",
  LISTED: "good",
  // leases
  CONTRACT: "warn",
  REGISTRATION: "warn",
  MOVE_IN: "good",
  ACTIVE: "good",
  RENEWAL: "warn",
  MOVE_OUT: "warn",
  DISPUTE: "bad",
  CLOSED: "quiet",
  // applications
  SCREENING: "warn",
  OFFER: "warn",
  RESERVED: "good",
  CONVERTED: "good",
  REJECTED: "bad",
  WITHDRAWN: "quiet",
  // rent payments
  scheduled: "quiet",
  paid: "good",
  overdue: "warn",
  bounced: "bad",
  // complaints and tickets
  triaging: "quiet",
  review: "warn",
  escalated: "bad",
  ticketed: "warn",
  in_progress: "warn",
  closed: "quiet",
  // enquiry conversations
  bot: "quiet",
  handoff: "warn",
  // approvals, deadlines, tasks
  pending: "warn",
  approved: "good",
  edited: "good",
  rejected: "bad",
  cancelled: "quiet",
  done: "good",
  skipped: "quiet",
  failed: "bad",
  // contracts and Ejari attempts
  pending_approval: "warn",
  sent: "warn",
  signed: "good",
  superseded: "quiet",
  queued: "quiet",
  sending: "warn",
  awaiting_manual: "warn",
  issued: "good",
  error: "bad",
};

const STATUS_TONE = {
  good: "accent",
  warn: "waiting",
  bad: "danger",
  quiet: "neutral",
} as const;

export function Status({ value, label }: { value: string; label?: string }) {
  const tone = TONES[value];
  return <Pill tone={tone ? STATUS_TONE[tone] : "neutral"}>{label ?? stateLabel(value)}</Pill>;
}

/** "in 9 days" — saffron inside two weeks, brick when overdue. */
export function Due({ today, on, warnWithin = 14 }: { today: string; on: string; warnWithin?: number }) {
  const n = daysUntil(today, on);
  const tone = n < 0 ? "bad" : n <= warnWithin ? "warn" : undefined;
  return (
    <span
      className={`whitespace-nowrap text-[13px] tabular-nums ${tone === "bad" ? "font-semibold text-danger" : tone === "warn" ? "font-medium text-warning" : "text-muted"}`}
      {...(tone ? { "data-tone": tone } : {})}
    >
      {relativeDays(today, on)}
    </span>
  );
}

/**
 * Drawn when a unit has no photo yet: a faint floor plan that changes with the bedroom count, on a quiet tile.
 * Fills its parent, which sets the height.
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

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
