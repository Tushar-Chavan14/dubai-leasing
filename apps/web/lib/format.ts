import {
  type CalendarDate,
  canDecideGate,
  diffDays,
  formatAed,
  type GateId,
  isCalendarDate,
  type StaffRole,
} from "@leasing/core";

export { formatAed };

export const ROLE_LABELS: Record<string, string> = {
  leasing_officer: "Leasing officer",
  leasing_manager: "Leasing manager",
  finance: "Finance",
  admin: "Admin",
};
export const roleLabel = (r: string) => ROLE_LABELS[r] ?? r;

/** AED without fils when they're zero: "AED 85,000". */
export function aedShort(fils: number | null | undefined): string {
  if (fils === null || fils === undefined) return "—";
  const s = formatAed(fils);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

/** Proposal values: `*Fils` keys as AED, everything else as text. */
export function proposalValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key.endsWith("Fils") && typeof value === "number") return formatAed(value);
  if (key.endsWith("Percent") && typeof value === "number") return `${value}%`;
  if (typeof value === "string" && isCalendarDate(value)) return longDate(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const KEY_LABELS: Record<string, string> = {
  sriAverageFils: "SRI average",
  leaseRef: "Lease",
  leaseId: "Lease id",
  newTermStartOn: "New term starts",
  newTermEndOn: "New term ends",
  leaseEndOn: "Lease ends",
  legalDeadline: "Legal notice deadline",
  sendOn: "Company send date",
  proposedRentFils: "Proposed annual rent",
  currentRentFils: "Current annual rent",
  askingRentFils: "Asking rent",
  rangeMinFils: "Company range from",
  rangeMaxFils: "Company range to",
  rulesVersion: "Rules version",
  servedOn: "Served on",
  deliveryMethod: "Delivered by",
  maxRentFils: "Legal maximum rent",
  maxIncreasePercent: "Maximum increase",
  sriLabel: "SRI basis",
  policyVersion: "Company policy version",
  fullNameEn: "Name (as on the document)",
  emiratesIdNo: "Emirates ID number",
  idExpiresOn: "Emirates ID expiry",
  passportNo: "Passport number",
  passportExpiresOn: "Passport expiry",
  visaNo: "Visa file number",
  visaExpiresOn: "Visa expiry",
  tradeLicenceNo: "Trade licence number",
  tradeLicenceExpiresOn: "Trade licence expiry",
  annualRentFils: "Annual rent",
  depositFils: "Deposit",
  reservationFils: "Reservation",
  rentFreeDays: "Rent-free days",
  moveInOn: "Move-in",
  startOn: "Term starts",
  endOn: "Term ends",
  expiresOn: "Offer open until",
  version: "Contract version",
  reference: "Contract reference",
  submissionApprovalId: "Submission approval",
};

export function humanise(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const s = key
    .replace(/Fils$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const tz = { timeZone: "Asia/Dubai" } as const;
const fmtDay = new Intl.DateTimeFormat("en-GB", { ...tz, day: "numeric", month: "short", year: "numeric" });
const fmtDayNoYear = new Intl.DateTimeFormat("en-GB", { ...tz, day: "numeric", month: "short" });
const fmtWeekday = new Intl.DateTimeFormat("en-GB", {
  ...tz,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const fmtDateTime = new Intl.DateTimeFormat("en-GB", {
  ...tz,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Calendar dates are Dubai dates; render them at Dubai noon so no timezone can shift the day. */
const atNoon = (d: string) => new Date(`${d}T08:00:00Z`);

export const longDate = (d: string) => fmtDay.format(atNoon(d));
export const shortDate = (d: string) => fmtDayNoYear.format(atNoon(d));
export const weekdayDate = (d: string) => fmtWeekday.format(atNoon(d));
export const dateTime = (iso: string) => fmtDateTime.format(new Date(iso));
const fmtViewing = new Intl.DateTimeFormat("en-GB", {
  ...tz,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
/** A viewing appointment, e.g. "Sunday 1 November at 4:30 pm" (Dubai time). */
export const viewingTime = (iso: string) => fmtViewing.format(new Date(iso));

const fmtDubaiDay = new Intl.DateTimeFormat("en-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtClock = new Intl.DateTimeFormat("en-GB", { ...tz, hour: "2-digit", minute: "2-digit", hour12: false });

/** "Today, 14:05", "Yesterday", "3 days ago", then a date. `today` is the engine's Dubai calendar day. */
export function relativeTime(today: string, iso: string): string {
  const day = fmtDubaiDay.format(new Date(iso));
  const n = today ? diffDays(day as CalendarDate, today as CalendarDate) : 99;
  if (n === 0) return `Today, ${fmtClock.format(new Date(iso))}`;
  if (n === 1) return "Yesterday";
  if (n > 1 && n < 7) return `${n} days ago`;
  return dateTime(iso);
}

/** Whole days from `today` to `d` (negative when overdue). */
export const daysUntil = (today: string, d: string) => diffDays(today as CalendarDate, d as CalendarDate);

export function relativeDays(today: string, d: string): string {
  const n = daysUntil(today, d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days overdue`;
}

const MILESTONE_LABELS: Record<string, string> = {
  landlord_intent: "Ask landlord about sale or own use",
  renewal_assess: "Renewal window opens",
  notice_draft: "Draft renewal notice",
  notice_send: "Send renewal notice",
  notice_deadline: "Legal notice deadline",
  lease_end: "Lease ends",
  offer_expiry: "Offer lapses",
};
export const MILESTONE_SHORT: Record<string, string> = {
  landlord_intent: "Landlord",
  renewal_assess: "T−5m",
  notice_draft: "Draft",
  notice_send: "T−100",
  notice_deadline: "T−90",
  lease_end: "End",
};

export const milestoneId = (m: string) => m.split("@")[0] ?? m;
export const milestoneLabel = (m: string) => MILESTONE_LABELS[milestoneId(m)] ?? humanise(milestoneId(m));

/**
 * What a milestone key's suffix refers to: lease milestones carry the term's end date
 * (`renewal_assess@2027-04-01`), offer milestones the offer revision (`offer_expiry@1`).
 */
export function milestoneScope(m: string): string {
  const suffix = m.split("@")[1]?.split("#")[0] ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) return `term ending ${longDate(suffix)}`;
  if (/^\d+$/.test(suffix)) return `offer revision ${suffix}`;
  return suffix;
}

const EVENT_LABELS: Record<string, string> = {
  IMPORTED: "Imported",
  UNIT_CREATED: "Unit created",
  UNIT_UPDATED: "Details updated",
  UNIT_PHOTO_ADDED: "Photo added",
  UNIT_PHOTO_REMOVED: "Photo removed",
  UNIT_PHOTOS_REORDERED: "Photos reordered",
  PRICE_APPROVED: "Asking rent approved",
  MARK_READY: "Marked ready",
  PUBLISH: "Published",
  WITHDRAW: "Withdrawn",
  LEASE_ACTIVATED: "Lease started",
  LEASE_CLOSED: "Lease closed",
  MILESTONE_FIRED: "Milestone reached",
  MILESTONE_SKIPPED: "Milestone skipped",
  VIEWING_REQUESTED: "Viewing requested",
  OFFER_HELD: "Offer ready to send",
  OFFER_SENT: "Offer sent",
  CONTRACT_PREP_HELD: "Contract ready to prepare",
  APPROVAL_REQUESTED: "Sent for approval",
  APPROVAL_DECIDED: "Approval decided",
  APPROVAL_CANCELLED: "Approval cancelled",
  TASK_CREATED: "Task created",
  RENEWAL_WINDOW_OPENED: "Renewal window opened",
  RENEWED: "Renewed",
  TENANT_VACATE_NOTICE: "Tenant gave notice",
  TERMINATED: "Ended by landlord",
  SETTLED: "Settled",
  APPLICATION_CREATED: "Application created",
  APPLIED: "Screening started",
  VIEWING_BOOKED: "Viewing booked",
  VIEWING_NO_SHOW: "No-show at viewing",
  DOCUMENTS_REQUESTED: "New documents requested",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_REMOVED: "Document removed",
  DOCUMENT_VIEWED: "Document viewed",
  INBOUND_RECEIVED: "Form received",
  HELPER_RAN: "Helper ran",
  KYC_VERIFIED: "Identity verified",
  KYC_FAILED: "Rejected at checks",
  OFFER_MADE: "Offer made",
  OFFER_REVISED: "Offer revised",
  OFFER_ANSWERED: "Applicant answered",
  OFFER_ACCEPTED: "Reserved",
  OFFER_DECLINED: "Declined",
  OFFER_EXPIRED: "Offer lapsed",
  RESERVATION_RECORDED: "Reservation recorded",
  LEASE_CREATED: "Lease created",
  EMAIL_SENT: "Email sent",
  EMAIL_FAILED: "Email failed",
  CONTRACT_PREPARED: "Contract prepared",
  CONTRACT_SUPERSEDED: "Contract replaced",
  CONTRACT_REJECTED: "Contract not approved",
  CONTRACT_SENT: "Sent for signature",
  CONTRACT_SIGNED_BY: "Signed by a party",
  CONTRACT_SIGNED: "Contract signed",
  SIGN_LINK_RESENT: "Signing link re-sent",
  EJARI_SUBMISSION_QUEUED: "Sent to Ejari",
  EJARI_REJECTED: "Ejari rejected",
  EJARI_AUTOFIX: "Ejari detail corrected",
  EJARI_ISSUED: "Registered in Ejari",
  EJARI_SUBMISSION_FAILED: "Ejari unreachable",
  MOVE_IN_COMPLETED: "Moved in",
  RULEBOOK_DRAFT_CREATED: "Draft created",
  RULEBOOK_DRAFT_UPDATED: "Draft edited",
  RULEBOOK_DRAFT_DELETED: "Draft deleted",
  RULEBOOK_PUBLISHED: "Rules published",
};
export const eventLabel = (t: string) => EVENT_LABELS[t] ?? humanise(t.toLowerCase());

export function actorLabel(actor: string): string {
  if (actor === "system") return "Engine";
  if (actor.startsWith("system:")) return `Engine (${actor.slice(7).replace(/-/g, " ")})`;
  if (actor === "import") return "Import";
  if (actor === "demo") return "Demo data";
  if (actor.startsWith("user:")) return "Staff";
  if (actor.startsWith("tenant:")) return "Tenant";
  if (actor.startsWith("landlord:")) return "Landlord";
  if (actor.startsWith("copilot:")) return "Copilot";
  if (actor.startsWith("helper:")) return `Helper ${actor.slice(7)}`;
  return actor;
}

export const STATE_LABELS: Record<string, string> = {
  scheduled: "Due",
  paid: "Paid",
  overdue: "Overdue",
  bounced: "Bounced",
  triaging: "Being read",
  review: "Needs triage",
  escalated: "Escalated",
  ticketed: "Ticket open",
  in_progress: "In progress",
  closed: "Closed",
  bot: "With the bot",
  handoff: "Needs an officer",
  PREP: "In preparation",
  READY: "Ready",
  LISTED: "Listed",
  OCCUPIED: "Occupied",
  CONTRACT: "Contract",
  REGISTRATION: "Registration",
  MOVE_IN: "Move-in",
  ACTIVE: "Active",
  RENEWAL: "Renewal",
  MOVE_OUT: "Move-out",
  DISPUTE: "Dispute",
  CLOSED: "Closed",
  ENQUIRY: "Enquiry",
  VIEWING: "Viewing",
  SCREENING: "Checking documents",
  OFFER: "Offer out",
  RESERVED: "Reserved",
  CONVERTED: "Lease created",
  WITHDRAWN: "Withdrawn",
  REJECTED: "Rejected",
  pending: "Waiting",
  approved: "Approved",
  edited: "Approved with edits",
  rejected: "Rejected",
  cancelled: "Cancelled",
  done: "Done",
  skipped: "Skipped",
  failed: "Failed",
  open: "Open",
  upcoming: "Upcoming",
  pending_approval: "Waiting for approval",
  sent: "Out for signature",
  signed: "Signed",
  superseded: "Replaced",
  queued: "Queued",
  sending: "Sending",
  issued: "Issued",
  error: "Failed",
};
export const stateLabel = (s: string) => STATE_LABELS[s] ?? s;

export const bedroomsLabel = (n: number | null) => (n === null ? "—" : n === 0 ? "Studio" : `${n} bed`);

/** Same rule as the engine: the right role, and never your own (or your copilot's) proposal. */
export function canDecideApproval(
  a: { gate: string; proposedBy: string },
  me: { id: string; role: string } | null | undefined,
): boolean {
  if (!me) return false;
  if (a.proposedBy === `user:${me.id}` || a.proposedBy === `copilot:${me.id}`) return false;
  return canDecideGate(a.gate as GateId, me.role as StaffRole);
}
