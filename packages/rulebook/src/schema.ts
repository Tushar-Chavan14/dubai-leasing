import { type CalendarDate, isCalendarDate } from "@leasing/core";
import { z } from "zod";
import { maxIncreasePercent } from "./rules.ts";
import type { Rulebook } from "./types.ts";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * The fields an admin may edit in a rulebook draft (decision D23). Structural checks keep every
 * valid set usable by the pure functions in `rules.ts`: bands in order, milestones in order.
 */
export const RulebookValues = z
  .strictObject({
    renewalNoticeDays: int(1, 365),
    renewalSendAtDays: int(1, 365),
    repossessionNoticeMonths: int(1, 36),
    ownUseLockYears: z.strictObject({ residential: int(1, 10), commercial: int(1, 10) }),
    lateRentDaysAfterFormalReminder: int(1, 365),
    rentCapBands: z
      .array(z.strictObject({ gapUpTo: int(0, 100), maxIncrease: int(0, 100) }))
      .min(1)
      .max(10),
    aboveLastBandMaxIncrease: int(0, 100),
    renewalSchedule: z.strictObject({
      landlordIntentMonthsBefore: int(1, 36),
      assessMonthsBefore: int(1, 36),
      draftNoticeMonthsBefore: int(1, 36),
    }),
    sources: z.array(z.string().trim().min(1).max(300)).max(20),
  })
  .superRefine((v, c) => {
    const issue = (path: (string | number)[], message: string) => c.addIssue({ code: "custom", path, message });
    v.rentCapBands.forEach((b, i) => {
      const prev = v.rentCapBands[i - 1];
      if (prev && b.gapUpTo <= prev.gapUpTo)
        issue(["rentCapBands", i, "gapUpTo"], "bands must be in strictly ascending order of gap");
    });
    if (v.renewalSendAtDays < v.renewalNoticeDays)
      issue(["renewalSendAtDays"], "the company send day can't be later than the legal notice deadline");
    const s = v.renewalSchedule;
    if (s.landlordIntentMonthsBefore <= s.assessMonthsBefore)
      issue(["renewalSchedule", "landlordIntentMonthsBefore"], "landlord intent must come before the assessment");
    if (s.assessMonthsBefore <= s.draftNoticeMonthsBefore)
      issue(["renewalSchedule", "assessMonthsBefore"], "the assessment must come before the notice draft");
    // A span of N calendar months is never shorter than 28 × N days, so this keeps the draft
    // milestone strictly before the send day for every lease end (renewalMilestones order).
    if (s.draftNoticeMonthsBefore * 28 <= v.renewalSendAtDays)
      issue(
        ["renewalSchedule", "draftNoticeMonthsBefore"],
        "the notice draft must fall before the send day (draft months × 28 must exceed send days)",
      );
    // The landlord's answer must arrive while a repossession notice can still be served.
    if (s.landlordIntentMonthsBefore <= v.repossessionNoticeMonths)
      issue(
        ["renewalSchedule", "landlordIntentMonthsBefore"],
        "landlord intent must be asked before the repossession notice deadline",
      );
  });
export type RulebookValues = z.infer<typeof RulebookValues>;

export const ReferenceRule = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and dashes"),
  title: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
});
/** A company-authored note (slug id, unique within the version). */
export type ReferenceRule = z.infer<typeof ReferenceRule>;

export const ReferenceRules = z
  .array(ReferenceRule)
  .max(50)
  .superRefine((rules, c) => {
    const seen = new Set<string>();
    rules.forEach((r, i) => {
      if (seen.has(r.id)) c.addIssue({ code: "custom", path: [i, "id"], message: `duplicate id ${r.id}` });
      seen.add(r.id);
    });
  });

/** The editable values of a rulebook (what a draft stores in `rulebooks.values`). */
export function rulebookValues(r: Rulebook): RulebookValues {
  return {
    renewalNoticeDays: r.renewalNoticeDays,
    renewalSendAtDays: r.renewalSendAtDays,
    repossessionNoticeMonths: r.repossessionNoticeMonths,
    ownUseLockYears: { ...r.ownUseLockYears },
    lateRentDaysAfterFormalReminder: r.lateRentDaysAfterFormalReminder,
    rentCapBands: r.rentCapBands.map((b) => ({ gapUpTo: b.gapUpTo, maxIncrease: b.maxIncrease })),
    aboveLastBandMaxIncrease: r.aboveLastBandMaxIncrease,
    renewalSchedule: { ...r.renewalSchedule },
    sources: [...r.sources],
  };
}

export interface Loosened {
  field: string;
  base: unknown;
  value: unknown;
}

const SRI = 1_000_000;
/** Gaps 0, 0.5, 1 … 99.5 %: band edges are whole percents, so this covers every interval. */
const GAPS = Array.from({ length: 200 }, (_, i) => i / 2);

/**
 * Fields where `values` protects tenants less than `base`: shorter notices or locks, fewer
 * late-rent days, or a higher allowed increase for any gap below the SRI average.
 * A non-empty result means publishing needs a confirmed legal review.
 */
export function loosenedVsBase(values: RulebookValues, base: Rulebook): Loosened[] {
  const out: Loosened[] = [];
  const lower = (field: string, b: number, v: number) => {
    if (v < b) out.push({ field, base: b, value: v });
  };
  lower("renewalNoticeDays", base.renewalNoticeDays, values.renewalNoticeDays);
  lower("repossessionNoticeMonths", base.repossessionNoticeMonths, values.repossessionNoticeMonths);
  lower("ownUseLockYears.residential", base.ownUseLockYears.residential, values.ownUseLockYears.residential);
  lower("ownUseLockYears.commercial", base.ownUseLockYears.commercial, values.ownUseLockYears.commercial);
  lower(
    "lateRentDaysAfterFormalReminder",
    base.lateRentDaysAfterFormalReminder,
    values.lateRentDaysAfterFormalReminder,
  );
  const candidate = { ...base, ...values } as Rulebook;
  for (const gap of GAPS) {
    const b = maxIncreasePercent(SRI - gap * 10_000, SRI, base);
    const v = maxIncreasePercent(SRI - gap * 10_000, SRI, candidate);
    if (v > b) {
      out.push({ field: "rentCapBands", base: `${b}% at a ${gap}% gap`, value: `${v}% at a ${gap}% gap` });
      break;
    }
  }
  if (values.aboveLastBandMaxIncrease > base.aboveLastBandMaxIncrease)
    out.push({
      field: "aboveLastBandMaxIncrease",
      base: base.aboveLastBandMaxIncrease,
      value: values.aboveLastBandMaxIncrease,
    });
  return out;
}

export interface RulebookRow {
  version: string;
  emirate: "dubai";
  effectiveFrom: string;
  values: unknown;
  referenceRules: unknown;
}

/** A validated, deep-frozen Rulebook from a stored row. Throws on invalid content. */
export function rulebookFromRow(row: RulebookRow): Rulebook {
  if (!/^[a-z]+-\d{4}-\d{2}(?:-\d{2})?$/.test(row.version)) throw new Error(`invalid rulebook version: ${row.version}`);
  if (!isCalendarDate(row.effectiveFrom)) throw new Error(`invalid effectiveFrom: ${row.effectiveFrom}`);
  const values = RulebookValues.parse(row.values);
  const referenceRules: ReferenceRule[] = ReferenceRules.parse(row.referenceRules);
  return deepFreeze({
    version: row.version,
    emirate: row.emirate,
    effectiveFrom: row.effectiveFrom as CalendarDate,
    ...values,
    referenceRules,
  });
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

/** Structural equality for plain JSON-like data (key order ignored). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
