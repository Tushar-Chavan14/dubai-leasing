import type { ReferenceRule } from "./schema.ts";

/** A versioned set of legal rules for one emirate (docs/architecture.md §4). */
export interface Rulebook {
  /** e.g. "dubai-2025-01" */
  version: string;
  emirate: "dubai";
  /** ISO date the version applies from. */
  effectiveFrom: string;
  /** Legal minimum notice before lease end for a rent increase (days). */
  renewalNoticeDays: number;
  /** Company margin: send the approved notice this many days before lease end. */
  renewalSendAtDays: number;
  /** Repossession (sale, own use, major works, demolition) notice, in months. */
  repossessionNoticeMonths: number;
  ownUseLockYears: { residential: number; commercial: number };
  /** Eviction can start only this many days after a formal late-payment reminder. */
  lateRentDaysAfterFormalReminder: number;
  /**
   * Rent cap bands. `gapUpTo` is how far current rent is below the SRI average, in whole
   * percent. Bands are checked in order; the first band with gap ≤ gapUpTo applies; a gap above
   * the last band gets `aboveLastBandMaxIncrease`.
   */
  rentCapBands: readonly { gapUpTo: number; maxIncrease: number }[];
  aboveLastBandMaxIncrease: number;
  /** Renewal milestones before lease end (company schedule built on the legal rules). */
  renewalSchedule: {
    landlordIntentMonthsBefore: number;
    assessMonthsBefore: number;
    draftNoticeMonthsBefore: number;
  };
  /** Notes for reviewers; shown with the rule in the UI. */
  sources: readonly string[];
  /**
   * Company-authored reference notes (admin-edited, shown to staff and the copilot). Data only:
   * no code reads them to decide anything. The code base version has none.
   */
  referenceRules: readonly ReferenceRule[];
}

export type MilestoneId =
  | "landlord_intent"
  | "renewal_assess"
  | "notice_draft"
  | "notice_send"
  | "notice_deadline"
  | "lease_end"
  /** Engine-scheduled, not a legal milestone: chase an unacknowledged notice. */
  | "notice_ack_followup";

export interface Milestone {
  id: MilestoneId;
  dueOn: import("@leasing/core").CalendarDate;
  description: string;
}
