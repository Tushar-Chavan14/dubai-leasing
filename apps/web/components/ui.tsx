import Link from "next/link";
import type { ReactNode } from "react";
import { daysUntil, relativeDays, stateLabel } from "../lib/format";
import { IconChevronLeft } from "../lib/icons";

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
  issued: "good",
  error: "bad",
};

export function Status({ value, label }: { value: string; label?: string }) {
  const tone = TONES[value];
  return (
    <span className="status" {...(tone ? { "data-tone": tone } : {})}>
      {label ?? stateLabel(value)}
    </span>
  );
}

/** "in 9 days" — saffron inside two weeks, brick when overdue. */
export function Due({ today, on, warnWithin = 14 }: { today: string; on: string; warnWithin?: number }) {
  const n = daysUntil(today, on);
  const tone = n < 0 ? "bad" : n <= warnWithin ? "warn" : undefined;
  return (
    <span className="due" {...(tone ? { "data-tone": tone } : {})}>
      {relativeDays(today, on)}
    </span>
  );
}

export function PageHead({
  title,
  lede,
  actions,
  back,
  badge,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  badge?: ReactNode;
}) {
  return (
    <>
      {back && (
        <Link href={back.href} className="back">
          <IconChevronLeft size={16} />
          {back.label}
        </Link>
      )}
      <header className="page-head">
        <div>
          <div className="title-row">
            <h1>{title}</h1>
            {badge}
          </div>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </header>
    </>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "empty compact" : "empty"}>
      {icon && <div className="glyph">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Drawn when a unit has no photo yet: a simple floor plan that changes with the bedroom count. */
export function PlanPlaceholder({ bedrooms, label }: { bedrooms: number | null; label?: string }) {
  const rooms = Math.max(1, Math.min(4, bedrooms ?? 1));
  const w = 120 / rooms;
  return (
    <div className="plan-placeholder" aria-hidden="true">
      <svg viewBox="0 0 200 130" fill="none" stroke="currentColor" strokeWidth="2.5">
        <rect x="6" y="6" width="188" height="118" rx="3" />
        <path d="M126 6v70M126 96v28M6 76h70M96 76h30" />
        {Array.from({ length: rooms - 1 }, (_, i) => (
          <path key={i} d={`M${6 + w * (i + 1)} 76v48`} />
        ))}
        <path d="M150 124a18 18 0 0 1 18-18" strokeWidth="1.5" />
        <path d="M140 30h40M140 44h40" strokeWidth="1.5" opacity=".6" />
      </svg>
      {label && <span>{label}</span>}
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
