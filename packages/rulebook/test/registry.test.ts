import { afterEach, describe, expect, test } from "bun:test";
import { calendarDate as d } from "@leasing/core";
import {
  activeRulesVersion,
  baseRulebooks,
  deepEqual,
  dubai2025_01 as base,
  getRulebook,
  loosenedVsBase,
  maxIncreasePercent,
  ReferenceRules,
  registerRulebook,
  renewalMilestones,
  resetRulebookRegistry,
  rulebookFromRow,
  RulebookValues,
  rulebookValues,
  rulebookVersions,
  rulesVersionForTerm,
} from "../src/index.ts";

const v = () => rulebookValues(base);
/** Paths of the issues a value set fails with. */
const issues = (values: unknown) => {
  const r = RulebookValues.safeParse(values);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};
const row = (version: string, effectiveFrom: string, values: unknown = v(), referenceRules: unknown = []) => ({
  version,
  emirate: "dubai" as const,
  effectiveFrom,
  values,
  referenceRules,
});

afterEach(() => resetRulebookRegistry());

describe("RulebookValues", () => {
  test("the code base is valid", () => expect(issues(v())).toEqual([]));
  test("non-integers are refused", () =>
    expect(issues({ ...v(), renewalNoticeDays: 90.5 })).toEqual(["renewalNoticeDays"]));
  test("zero or negative values are refused", () => {
    expect(issues({ ...v(), lateRentDaysAfterFormalReminder: 0 })).toEqual(["lateRentDaysAfterFormalReminder"]);
    expect(issues({ ...v(), ownUseLockYears: { residential: -1, commercial: 3 } })).toEqual([
      "ownUseLockYears.residential",
    ]);
  });
  test("unknown fields are refused", () => expect(issues({ ...v(), extra: 1 })).toEqual([""]));
  test("at least one band and at most ten", () => {
    expect(issues({ ...v(), rentCapBands: [] })).toEqual(["rentCapBands"]);
    const many = Array.from({ length: 11 }, (_, i) => ({ gapUpTo: i * 5, maxIncrease: i }));
    expect(issues({ ...v(), rentCapBands: many })).toEqual(["rentCapBands"]);
  });
  test("band gaps must be strictly ascending", () => {
    const bands = [
      { gapUpTo: 10, maxIncrease: 0 },
      { gapUpTo: 10, maxIncrease: 5 },
    ];
    expect(issues({ ...v(), rentCapBands: bands })).toEqual(["rentCapBands.1.gapUpTo"]);
    expect(
      issues({ ...v(), rentCapBands: bands.toReversed().map((b, i) => ({ ...b, gapUpTo: 20 - i * 10 })) }),
    ).toEqual(["rentCapBands.1.gapUpTo"]);
  });
  test("band values stay within 0..100", () => {
    expect(issues({ ...v(), rentCapBands: [{ gapUpTo: 101, maxIncrease: 0 }] })).toEqual(["rentCapBands.0.gapUpTo"]);
    expect(issues({ ...v(), rentCapBands: [{ gapUpTo: 10, maxIncrease: 101 }] })).toEqual([
      "rentCapBands.0.maxIncrease",
    ]);
    expect(issues({ ...v(), aboveLastBandMaxIncrease: 101 })).toEqual(["aboveLastBandMaxIncrease"]);
  });
  test("send day can't be after the legal deadline", () =>
    expect(issues({ ...v(), renewalSendAtDays: 89 })).toEqual(["renewalSendAtDays"]));
  test("schedule months must be ordered landlord intent > assess > draft", () => {
    expect(issues({ ...v(), renewalSchedule: { ...v().renewalSchedule, assessMonthsBefore: 13 } })).toEqual([
      "renewalSchedule.landlordIntentMonthsBefore",
    ]);
    expect(issues({ ...v(), renewalSchedule: { ...v().renewalSchedule, draftNoticeMonthsBefore: 5 } })).toEqual([
      "renewalSchedule.assessMonthsBefore",
    ]);
  });
  test("the draft milestone must fall before the send day", () => {
    // 3 months × 28 = 84 days ≤ 100: the draft could land after the send day.
    expect(issues({ ...v(), renewalSchedule: { ...v().renewalSchedule, draftNoticeMonthsBefore: 3 } })).toEqual([
      "renewalSchedule.draftNoticeMonthsBefore",
    ]);
  });
  test("landlord intent must be asked before the repossession notice deadline", () =>
    expect(issues({ ...v(), repossessionNoticeMonths: 13 })).toEqual(["renewalSchedule.landlordIntentMonthsBefore"]));
  test("sources: non-empty strings, at most 20", () => {
    expect(issues({ ...v(), sources: [" "] })).toEqual(["sources.0"]);
    expect(issues({ ...v(), sources: Array.from({ length: 21 }, () => "x") })).toEqual(["sources"]);
  });
  test("milestones stay in order for edge-of-valid schedules", () => {
    const tight = {
      ...v(),
      renewalNoticeDays: 1,
      renewalSendAtDays: 27,
      repossessionNoticeMonths: 1,
      renewalSchedule: { landlordIntentMonthsBefore: 3, assessMonthsBefore: 2, draftNoticeMonthsBefore: 1 },
    };
    const wide = {
      ...v(),
      renewalNoticeDays: 365,
      renewalSendAtDays: 365,
      renewalSchedule: { landlordIntentMonthsBefore: 16, assessMonthsBefore: 15, draftNoticeMonthsBefore: 14 },
    };
    for (const vals of [tight, wide]) {
      expect(issues(vals)).toEqual([]);
      const r = rulebookFromRow(row("dubai-2030-01", "2030-01-01", vals));
      for (const end of ["2027-03-01", "2027-03-31", "2028-02-29", "2026-12-31", "2027-05-31", "2026-01-15"]) {
        const dates = renewalMilestones(d(end), r).map((x) => x.dueOn);
        expect(dates.toSorted()).toEqual(dates);
      }
    }
  });
});

describe("ReferenceRules", () => {
  const rule = { id: "pets", title: "Pets", text: "Small pets need landlord consent." };
  test("valid", () => expect(ReferenceRules.safeParse([rule]).success).toBe(true));
  test("id must be a slug", () => expect(ReferenceRules.safeParse([{ ...rule, id: "Pets!" }]).success).toBe(false));
  test("title 1..120 and text 1..2000", () => {
    expect(ReferenceRules.safeParse([{ ...rule, title: "" }]).success).toBe(false);
    expect(ReferenceRules.safeParse([{ ...rule, title: "x".repeat(121) }]).success).toBe(false);
    expect(ReferenceRules.safeParse([{ ...rule, text: "x".repeat(2001) }]).success).toBe(false);
  });
  test("ids are unique", () => expect(ReferenceRules.safeParse([rule, rule]).success).toBe(false));
  test("at most 50", () =>
    expect(ReferenceRules.safeParse(Array.from({ length: 51 }, (_, i) => ({ ...rule, id: `r-${i}` }))).success).toBe(
      false,
    ));
});

describe("loosenedVsBase", () => {
  const fields = (values: RulebookValues) => loosenedVsBase(values, base).map((l) => l.field);
  test("same values: nothing loosened", () => expect(fields(v())).toEqual([]));
  test("stricter values: nothing loosened", () =>
    expect(
      fields({
        ...v(),
        renewalNoticeDays: 100,
        repossessionNoticeMonths: 12,
        ownUseLockYears: { residential: 3, commercial: 4 },
        lateRentDaysAfterFormalReminder: 45,
        rentCapBands: v().rentCapBands.map((b) => ({ ...b, maxIncrease: Math.max(0, b.maxIncrease - 1) })),
        aboveLastBandMaxIncrease: 15,
      }),
    ).toEqual([]));
  test("shorter renewal notice", () =>
    expect(loosenedVsBase({ ...v(), renewalNoticeDays: 60 }, base)).toEqual([
      { field: "renewalNoticeDays", base: 90, value: 60 },
    ]));
  test("shorter repossession notice", () =>
    expect(
      fields({
        ...v(),
        repossessionNoticeMonths: 6,
      }),
    ).toEqual(["repossessionNoticeMonths"]));
  test("shorter own-use lock, each kind", () => {
    expect(fields({ ...v(), ownUseLockYears: { residential: 1, commercial: 3 } })).toEqual([
      "ownUseLockYears.residential",
    ]);
    expect(fields({ ...v(), ownUseLockYears: { residential: 2, commercial: 2 } })).toEqual([
      "ownUseLockYears.commercial",
    ]);
  });
  test("fewer late-rent days", () =>
    expect(fields({ ...v(), lateRentDaysAfterFormalReminder: 15 })).toEqual(["lateRentDaysAfterFormalReminder"]));
  test("a band allowing a higher increase", () => {
    const bands = v().rentCapBands.map((b, i) => (i === 1 ? { ...b, maxIncrease: 7 } : b));
    expect(fields({ ...v(), rentCapBands: bands })).toEqual(["rentCapBands"]);
  });
  test("a band edge moved so a gap gets a higher band", () => {
    // 0% now only up to a 9% gap: a 9.5% gap gets 5% instead of 0%.
    const bands = v().rentCapBands.map((b, i) => (i === 0 ? { ...b, gapUpTo: 9 } : b));
    const l = loosenedVsBase({ ...v(), rentCapBands: bands }, base);
    expect(l).toEqual([{ field: "rentCapBands", base: "0% at a 9.5% gap", value: "5% at a 9.5% gap" }]);
  });
  test("fewer bands, so the above-last increase applies sooner", () =>
    expect(fields({ ...v(), rentCapBands: v().rentCapBands.slice(0, 2) })).toEqual(["rentCapBands"]));
  test("a higher above-last-band increase", () =>
    expect(fields({ ...v(), aboveLastBandMaxIncrease: 25 })).toEqual(["rentCapBands", "aboveLastBandMaxIncrease"]));
  test("rent above the SRI average uses the first band", () => {
    const bands = v().rentCapBands.map((b, i) => (i === 0 ? { ...b, maxIncrease: 2 } : b));
    expect(fields({ ...v(), rentCapBands: bands })).toEqual(["rentCapBands"]);
    expect(maxIncreasePercent(120, 100, { ...base, rentCapBands: bands })).toBe(2);
  });
});

describe("rulebookFromRow", () => {
  test("validated and deep-frozen", () => {
    const r = rulebookFromRow(
      row("dubai-2026-10-01", "2026-11-01", v(), [{ id: "pets", title: "Pets", text: "Consent needed." }]),
    );
    expect(r.version).toBe("dubai-2026-10-01");
    expect(r.referenceRules).toHaveLength(1);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.rentCapBands[0])).toBe(true);
    expect(Object.isFrozen(r.referenceRules[0])).toBe(true);
    expect(Object.isFrozen(r.renewalSchedule)).toBe(true);
  });
  test("the base round-trips to equal content", () =>
    expect(deepEqual(rulebookFromRow(row(base.version, base.effectiveFrom)), base)).toBe(true));
  test("invalid values throw", () =>
    expect(() => rulebookFromRow(row("dubai-2026-10-01", "2026-11-01", { ...v(), renewalNoticeDays: -1 }))).toThrow());
  test("invalid reference rules throw", () =>
    expect(() => rulebookFromRow(row("dubai-2026-10-01", "2026-11-01", v(), [{ id: "x" }]))).toThrow());
  test("invalid version or date throws", () => {
    expect(() => rulebookFromRow(row("Dubai 2026", "2026-11-01"))).toThrow("invalid rulebook version");
    expect(() => rulebookFromRow(row("dubai-2026-10-01", "2026-02-30"))).toThrow("invalid effectiveFrom");
  });
});

describe("deepEqual", () => {
  test("key order is ignored, values and array order are not", () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe("registry", () => {
  const next = (from = "2026-11-01", version = "dubai-2026-10-01", values = v()) =>
    rulebookFromRow(row(version, from, values));
  test("starts with the code base versions only", () => {
    expect(rulebookVersions()).toEqual(baseRulebooks.map((r) => r.version));
  });
  test("registers a new version", () => {
    registerRulebook(next());
    expect(getRulebook("dubai-2026-10-01").effectiveFrom).toBe(d("2026-11-01"));
    expect(rulebookVersions()).toEqual(["dubai-2025-01", "dubai-2026-10-01"]);
  });
  test("same content again is a no-op", () => {
    registerRulebook(next());
    registerRulebook(next());
    registerRulebook(rulebookFromRow(row(base.version, base.effectiveFrom)));
    expect(rulebookVersions()).toEqual(["dubai-2025-01", "dubai-2026-10-01"]);
  });
  test("different content under an existing version is refused", () => {
    registerRulebook(next());
    expect(() => registerRulebook(next("2026-12-01"))).toThrow("different content");
    expect(() => registerRulebook({ ...base, renewalNoticeDays: 60 })).toThrow("different content");
  });
  test("reset drops registered versions", () => {
    registerRulebook(next());
    resetRulebookRegistry();
    expect(() => getRulebook("dubai-2026-10-01")).toThrow("unknown rulebook version");
  });
});

describe("activeRulesVersion", () => {
  test("base only", () => expect(activeRulesVersion(d("2026-10-22"))).toBe("dubai-2025-01"));
  test("none before the first effective date", () => expect(activeRulesVersion(d("2024-12-31"))).toBeNull());
  test("other emirates have none", () =>
    expect(activeRulesVersion(d("2026-10-22"), "abu-dhabi" as "dubai")).toBeNull());
  test("a future version is not active until its date", () => {
    registerRulebook(rulebookFromRow(row("dubai-2026-10-01", "2026-11-01")));
    expect(activeRulesVersion(d("2026-10-31"))).toBe("dubai-2025-01");
    expect(activeRulesVersion(d("2026-11-01"))).toBe("dubai-2026-10-01");
  });
  test("latest effective date wins regardless of registration order", () => {
    registerRulebook(rulebookFromRow(row("dubai-2026-10-02", "2027-01-01")));
    registerRulebook(rulebookFromRow(row("dubai-2026-10-01", "2026-11-01")));
    expect(activeRulesVersion(d("2026-12-01"))).toBe("dubai-2026-10-01");
    expect(activeRulesVersion(d("2027-01-01"))).toBe("dubai-2026-10-02");
  });
  test("a tie on the effective date goes to the version registered last", () => {
    registerRulebook(rulebookFromRow(row("dubai-2026-10-01", "2026-11-01")));
    registerRulebook(rulebookFromRow(row("dubai-2026-10-02", "2026-11-01")));
    expect(activeRulesVersion(d("2026-11-01"))).toBe("dubai-2026-10-02");
  });
});

describe("rulesVersionForTerm", () => {
  test("pins to the version in force on the term's start date, not today", () => {
    registerRulebook(rulebookFromRow(row("dubai-2026-10-01", "2026-11-01")));
    expect(rulesVersionForTerm(d("2026-06-01"))).toBe("dubai-2025-01");
    expect(rulesVersionForTerm(d("2026-10-31"))).toBe("dubai-2025-01");
    expect(rulesVersionForTerm(d("2026-11-01"))).toBe("dubai-2026-10-01");
    expect(rulesVersionForTerm(d("2027-06-01"))).toBe("dubai-2026-10-01");
  });
  test("a term starting before every version gets the code base", () =>
    expect(rulesVersionForTerm(d("2023-03-01"))).toBe("dubai-2025-01"));
  test("unknown emirate throws", () =>
    expect(() => rulesVersionForTerm(d("2026-10-22"), "abu-dhabi" as "dubai")).toThrow());
});
