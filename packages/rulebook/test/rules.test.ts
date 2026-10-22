import { describe, expect, test } from "bun:test";
import { aed, calendarDate as d } from "@leasing/core";
import {
  canSendRenewalNotice,
  dubai2025_01 as r,
  evictionEligibleDate,
  getRulebook,
  isRenewalRentAllowed,
  maxIncreasePercent,
  maxRenewalRent,
  noticeSentInTime,
  ownUseRelistAllowedFrom,
  renewalMilestones,
  renewalNoticeDeadline,
  repossessionNoticeDeadline,
} from "../src/index.ts";

const SRI = aed(100_000);
/** Current rent that is exactly `gapPct` percent below SRI = 100,000 AED. */
const below = (gapPct: number) => aed(100_000 - gapPct * 1_000);

describe("registry", () => {
  test("looks up by version", () => {
    expect(getRulebook("dubai-2025-01")).toBe(r);
  });
  test("unknown version throws", () => {
    expect(() => getRulebook("dubai-1999-01")).toThrow();
  });
  test("config is frozen", () => {
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.rentCapBands)).toBe(true);
  });
  test("legal values", () => {
    expect(r.renewalNoticeDays).toBe(90);
    expect(r.renewalSendAtDays).toBe(100);
    expect(r.repossessionNoticeMonths).toBe(12);
    expect(r.ownUseLockYears).toEqual({ residential: 2, commercial: 3 });
    expect(r.lateRentDaysAfterFormalReminder).toBe(30);
  });
});

describe("maxIncreasePercent — band edges", () => {
  const cases: [string, number, number][] = [
    ["rent above SRI", aed(110_000), 0],
    ["rent equals SRI", aed(100_000), 0],
    ["gap 5%", below(5), 0],
    ["gap exactly 10%", below(10), 0],
    ["gap 10.001%", aed(89_999), 5],
    ["gap 11%", below(11), 5],
    ["gap exactly 20%", below(20), 5],
    ["gap 20.001%", aed(79_999), 10],
    ["gap exactly 30%", below(30), 10],
    ["gap 30.001%", aed(69_999), 15],
    ["gap exactly 40%", below(40), 15],
    ["gap 40.001%", aed(59_999), 20],
    ["gap 60%", below(60), 20],
  ];
  for (const [name, current, expected] of cases) {
    test(name, () => expect(maxIncreasePercent(current, SRI, r)).toBe(expected));
  }

  test("rejects non-integer or non-positive fils", () => {
    expect(() => maxIncreasePercent(100.5, SRI, r)).toThrow();
    expect(() => maxIncreasePercent(0, SRI, r)).toThrow();
    expect(() => maxIncreasePercent(aed(1), 0, r)).toThrow();
  });
});

describe("maxRenewalRent", () => {
  test("0% band keeps rent", () => expect(maxRenewalRent(below(10), SRI, r)).toBe(below(10)));
  test("5% band", () => expect(maxRenewalRent(below(15), SRI, r)).toBe(aed(89_250)));
  test("10% band", () => expect(maxRenewalRent(below(25), SRI, r)).toBe(aed(82_500)));
  test("15% band", () => expect(maxRenewalRent(below(35), SRI, r)).toBe(aed(74_750)));
  test("20% band", () => expect(maxRenewalRent(below(50), SRI, r)).toBe(aed(60_000)));
  test("rounds down to whole fils", () => {
    // 5% of 8,999,999 fils = 449,999.95 → 449,999
    expect<number>(maxRenewalRent(8_999_999, 10_600_000, r)).toBe(8_999_999 + 449_999);
  });
});

describe("isRenewalRentAllowed", () => {
  test("within cap", () => expect(isRenewalRentAllowed(below(15), aed(89_250), SRI, r)).toBe(true));
  test("one fil over cap", () => expect(isRenewalRentAllowed(below(15), aed(89_250) + 1, SRI, r)).toBe(false));
  test("no SRI: same rent allowed", () => expect(isRenewalRentAllowed(aed(80_000), aed(80_000), null, r)).toBe(true));
  test("no SRI: any increase refused", () =>
    expect(isRenewalRentAllowed(aed(80_000), aed(80_000) + 1, null, r)).toBe(false));
  test("decrease allowed", () => expect(isRenewalRentAllowed(aed(80_000), aed(75_000), SRI, r)).toBe(true));
  test("zero or fractional refused", () => {
    expect(isRenewalRentAllowed(aed(80_000), 0, SRI, r)).toBe(false);
    expect(isRenewalRentAllowed(aed(80_000), 1.5, SRI, r)).toBe(false);
  });
});

describe("renewal notice dates", () => {
  const end = d("2026-12-31");
  test("deadline is T−90", () => expect(renewalNoticeDeadline(end, r)).toBe(d("2026-10-02")));
  test("sending on T−90 is allowed", () => expect(canSendRenewalNotice(d("2026-10-02"), end, r)).toBe(true));
  test("sending on T−89 is not", () => expect(canSendRenewalNotice(d("2026-10-03"), end, r)).toBe(false));
  test("sending early is allowed", () => expect(canSendRenewalNotice(d("2026-06-01"), end, r)).toBe(true));
  test("deadline across a leap day", () => expect(renewalNoticeDeadline(d("2028-05-01"), r)).toBe(d("2028-02-01")));
});

describe("noticeSentInTime", () => {
  const end = d("2026-12-31"); // T−90 = 2026-10-02
  test("sent on T−90 in Dubai counts", () =>
    expect(noticeSentInTime(new Date("2026-10-02T19:59:00Z"), end, r)).toBe(true));
  test("20:00 UTC on T−90 is already T−89 in Dubai", () =>
    expect(noticeSentInTime(new Date("2026-10-02T20:00:00Z"), end, r)).toBe(false));
  test("21:00 UTC the day before T−90 is T−90 in Dubai", () =>
    expect(noticeSentInTime(new Date("2026-10-01T21:00:00Z"), end, r)).toBe(true));
});

describe("renewalMilestones", () => {
  test("standard lease end", () => {
    const m = Object.fromEntries(renewalMilestones(d("2026-12-31"), r).map((x) => [x.id, x.dueOn]));
    expect(m).toEqual({
      landlord_intent: d("2025-11-30"),
      renewal_assess: d("2026-07-31"),
      notice_draft: d("2026-08-31"),
      notice_send: d("2026-09-22"),
      notice_deadline: d("2026-10-02"),
      lease_end: d("2026-12-31"),
    });
  });
  test("month-end clamping (end 2027-07-31 → T−5m = 2027-02-28)", () => {
    const m = Object.fromEntries(renewalMilestones(d("2027-07-31"), r).map((x) => [x.id, x.dueOn]));
    expect(m.renewal_assess).toBe(d("2027-02-28"));
    expect(m.notice_draft).toBe(d("2027-03-31"));
  });
  test("T−100 and T−90 across a leap day", () => {
    const a = Object.fromEntries(renewalMilestones(d("2028-03-10"), r).map((x) => [x.id, x.dueOn]));
    expect(a.notice_send).toBe(d("2027-12-01"));
    expect(a.notice_deadline).toBe(d("2027-12-11"));
    const b = Object.fromEntries(renewalMilestones(d("2029-02-28"), r).map((x) => [x.id, x.dueOn]));
    expect(b.notice_send).toBe(d("2028-11-20"));
    expect(b.notice_deadline).toBe(d("2028-11-30"));
    const c = Object.fromEntries(renewalMilestones(d("2028-02-29"), r).map((x) => [x.id, x.dueOn]));
    expect(c.notice_send).toBe(d("2027-11-21"));
    expect(c.notice_deadline).toBe(d("2027-12-01"));
    expect(c.renewal_assess).toBe(d("2027-09-29"));
  });
  test("milestones are in chronological order", () => {
    for (const end of ["2026-01-15", "2027-03-01", "2028-02-29", "2026-12-31"]) {
      const dates = renewalMilestones(d(end), r).map((x) => x.dueOn);
      expect(dates.toSorted()).toEqual(dates);
    }
  });
  test("send date leaves the 10-day margin before the legal deadline", () => {
    const ms = renewalMilestones(d("2026-12-31"), r);
    const send = ms.find((x) => x.id === "notice_send")?.dueOn;
    expect(send && canSendRenewalNotice(send, d("2026-12-31"), r)).toBe(true);
  });
});

describe("repossessionNoticeDeadline", () => {
  test("12 months before end", () => expect(repossessionNoticeDeadline(d("2027-06-30"), r)).toBe(d("2026-06-30")));
  test("from a leap day", () => expect(repossessionNoticeDeadline(d("2028-02-29"), r)).toBe(d("2027-02-28")));
});

describe("evictionEligibleDate", () => {
  test("formal reminder + 30 days", () => expect(evictionEligibleDate(d("2026-01-15"), r)).toBe(d("2026-02-14")));
  test("across month and leap year", () => expect(evictionEligibleDate(d("2028-02-10"), r)).toBe(d("2028-03-11")));
});

describe("ownUseRelistAllowedFrom", () => {
  test("residential 2 years", () =>
    expect(ownUseRelistAllowedFrom(d("2026-05-10"), "residential", r)).toBe(d("2028-05-10")));
  test("commercial 3 years", () =>
    expect(ownUseRelistAllowedFrom(d("2026-05-10"), "commercial", r)).toBe(d("2029-05-10")));
  test("29 Feb rounds up to 1 March", () =>
    expect(ownUseRelistAllowedFrom(d("2028-02-29"), "residential", r)).toBe(d("2030-03-01")));
  test("29 Feb to a leap year stays", () =>
    expect(
      ownUseRelistAllowedFrom(d("2028-02-29"), "residential", {
        ...r,
        ownUseLockYears: { residential: 4, commercial: 3 },
      }),
    ).toBe(d("2032-02-29")));
});
