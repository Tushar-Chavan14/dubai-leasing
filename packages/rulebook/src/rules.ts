import { addDays, addMonths, addYears, type CalendarDate, type Fils, fils, toDubaiDate } from "@leasing/core";
import type { Milestone, Rulebook } from "./types.ts";

/**
 * Max rent increase in whole percent for a renewal. The gap is how far current rent is below the
 * SRI average. Compared with integer cross-multiplication so 10.0% and 10.01% never get
 * confused by float rounding: gap ≤ N% ⇔ (sri − current) × 100 ≤ N × sri.
 */
export function maxIncreasePercent(currentFils: number, sriAvgFils: number, r: Rulebook): number {
  assertPositiveInt(currentFils, "current rent");
  assertPositiveInt(sriAvgFils, "SRI average");
  const below = sriAvgFils - currentFils;
  if (below <= 0) return r.rentCapBands[0]?.maxIncrease ?? 0;
  for (const band of r.rentCapBands) {
    if (below * 100 <= band.gapUpTo * sriAvgFils) return band.maxIncrease;
  }
  return r.aboveLastBandMaxIncrease;
}

/** Highest legal renewal rent, rounded down to a whole fil. */
export function maxRenewalRent(currentFils: number, sriAvgFils: number, r: Rulebook): Fils {
  const pct = maxIncreasePercent(currentFils, sriAvgFils, r);
  return fils(currentFils + Math.floor((currentFils * pct) / 100));
}

/** True if `proposedFils` is within the legal cap for this renewal. */
export function isRenewalRentAllowed(
  currentFils: number,
  proposedFils: number,
  sriAvgFils: number | null,
  r: Rulebook,
): boolean {
  if (!Number.isSafeInteger(proposedFils) || proposedFils <= 0) return false;
  // Without an SRI value, only "no increase" is provably within the cap.
  if (sriAvgFils === null) return proposedFils <= currentFils;
  return proposedFils <= maxRenewalRent(currentFils, sriAvgFils, r);
}

/** The last calendar date a rent-increase notice may be sent: lease end − 90 days. */
export function renewalNoticeDeadline(leaseEnd: CalendarDate, r: Rulebook): CalendarDate {
  return addDays(leaseEnd, -r.renewalNoticeDays);
}

/** Whether a rent-increase notice sent on `sendOn` meets the legal minimum notice. */
export function canSendRenewalNotice(sendOn: CalendarDate, leaseEnd: CalendarDate, r: Rulebook): boolean {
  return sendOn <= renewalNoticeDeadline(leaseEnd, r);
}

/**
 * Whether a rent-increase notice that left on `sentAt` (an instant) counts as given in time.
 * The Dubai calendar date of the send is what matters: 21:00 UTC on T−91 is already T−90.
 * CONFIRM WITH LEGAL: we treat SMTP acceptance as "sent"; receipt may be the legal trigger.
 */
export function noticeSentInTime(sentAt: Date, leaseEnd: CalendarDate, r: Rulebook): boolean {
  return canSendRenewalNotice(toDubaiDate(sentAt), leaseEnd, r);
}

/** Latest date a 12-month repossession notice can be served for this lease end. */
export function repossessionNoticeDeadline(leaseEnd: CalendarDate, r: Rulebook): CalendarDate {
  return addMonths(leaseEnd, -r.repossessionNoticeMonths);
}

/** Renewal milestones for a lease ending on `leaseEnd` (T), as Asia/Dubai calendar dates. */
export function renewalMilestones(leaseEnd: CalendarDate, r: Rulebook): Milestone[] {
  const s = r.renewalSchedule;
  return [
    {
      id: "landlord_intent",
      dueOn: addMonths(leaseEnd, -s.landlordIntentMonthsBefore),
      description: "Ask landlord: sell, own use, major works or demolition?",
    },
    {
      id: "renewal_assess",
      dueOn: addMonths(leaseEnd, -s.assessMonthsBefore),
      description: "Renewal assessment: SRI average and legal cap",
    },
    {
      id: "notice_draft",
      dueOn: addMonths(leaseEnd, -s.draftNoticeMonthsBefore),
      description: "Draft renewal notice for approval",
    },
    {
      id: "notice_send",
      dueOn: addDays(leaseEnd, -r.renewalSendAtDays),
      description: "Send approved renewal notice (company margin)",
    },
    {
      id: "notice_deadline",
      dueOn: renewalNoticeDeadline(leaseEnd, r),
      description: "Legal notice deadline; fall back to same-rent renewal",
    },
    { id: "lease_end", dueOn: leaseEnd, description: "Lease end" },
  ];
}

/** Eviction proceedings may start on this date at the earliest. */
export function evictionEligibleDate(formalReminderSent: CalendarDate, r: Rulebook): CalendarDate {
  return addDays(formalReminderSent, r.lateRentDaysAfterFormalReminder);
}

/**
 * First date a unit repossessed for own use may be re-let. When the anniversary falls on
 * 29 February in a non-leap year we use 1 March, never the day before.
 */
export function ownUseRelistAllowedFrom(
  vacatedOn: CalendarDate,
  kind: "residential" | "commercial",
  r: Rulebook,
): CalendarDate {
  const years = r.ownUseLockYears[kind];
  const anniversary = addYears(vacatedOn, years);
  return vacatedOn.endsWith("-02-29") && !anniversary.endsWith("-02-29") ? addDays(anniversary, 1) : anniversary;
}

function assertPositiveInt(v: number, label: string) {
  if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`${label} must be a positive integer (fils), got ${v}`);
}
