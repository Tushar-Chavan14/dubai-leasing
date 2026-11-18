import type { Rulebook } from "../types.ts";

/**
 * Dubai rules effective with the Smart Rental Index (January 2025).
 * CONFIRM WITH LEGAL before real use: the middle rent-cap bands follow Decree 43 of 2013; the
 * business guide states only the two ends (0% within 10%, 20% above 40%).
 */
export const dubai2025_01: Rulebook = Object.freeze({
  version: "dubai-2025-01",
  emirate: "dubai",
  effectiveFrom: "2025-01-01",
  renewalNoticeDays: 90,
  renewalSendAtDays: 100,
  repossessionNoticeMonths: 12,
  ownUseLockYears: Object.freeze({ residential: 2, commercial: 3 }),
  lateRentDaysAfterFormalReminder: 30,
  rentCapBands: Object.freeze([
    Object.freeze({ gapUpTo: 10, maxIncrease: 0 }),
    Object.freeze({ gapUpTo: 20, maxIncrease: 5 }),
    Object.freeze({ gapUpTo: 30, maxIncrease: 10 }),
    Object.freeze({ gapUpTo: 40, maxIncrease: 15 }),
  ]),
  aboveLastBandMaxIncrease: 20,
  renewalSchedule: Object.freeze({
    landlordIntentMonthsBefore: 13,
    assessMonthsBefore: 5,
    draftNoticeMonthsBefore: 4,
  }),
  sources: Object.freeze([
    "Law No. 26 of 2007 as amended by Law No. 33 of 2008 (Art. 14: 90-day notice; Art. 25: 12-month repossession notice)",
    "Decree No. 43 of 2013 (rent increase bands)",
    "Smart Rental Index (DLD, January 2025)",
  ]),
  referenceRules: Object.freeze([]),
});
