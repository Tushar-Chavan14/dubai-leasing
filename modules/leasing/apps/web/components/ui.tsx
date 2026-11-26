import { daysUntil, relativeDays, stateLabel } from "../lib/format";
import { Pill } from "@platform/ui/pill";

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

export { PlanPlaceholder } from "@platform/ui/media/plan-placeholder";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
