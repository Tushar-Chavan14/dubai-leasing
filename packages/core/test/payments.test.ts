import { describe, expect, test } from "bun:test";
import { calendarDate as d, paymentSchedule } from "../src/index.ts";

describe("paymentSchedule", () => {
  test("4 cheques over a year: months 0, 3, 6, 9; amounts sum to the rent", () => {
    const s = paymentSchedule({ startOn: d("2026-06-01"), endOn: d("2027-05-31"), annualRentFils: 8_500_000, cheques: 4 });
    expect(s.map((i) => i.dueOn) as string[]).toEqual(["2026-06-01", "2026-09-01", "2026-12-01", "2027-03-01"]);
    expect(s.map((i) => i.amountFils)).toEqual([2_125_000, 2_125_000, 2_125_000, 2_125_000]);
    expect(s.map((i) => i.n)).toEqual([1, 2, 3, 4]);
  });

  test("uneven split: remainder fils go to the first cheques; total is exact", () => {
    const s = paymentSchedule({ startOn: d("2026-01-15"), endOn: d("2027-01-14"), annualRentFils: 10_000_001, cheques: 3 });
    expect(s.map((i) => i.amountFils)).toEqual([3_333_334, 3_333_334, 3_333_333]);
    expect(s.reduce((a, i) => a + i.amountFils, 0)).toBe(10_000_001);
    expect(s.map((i) => i.dueOn) as string[]).toEqual(["2026-01-15", "2026-05-15", "2026-09-15"]);
  });

  test("1 and 12 cheques; month-end dates clamp", () => {
    expect(
      paymentSchedule({ startOn: d("2026-01-31"), endOn: d("2027-01-30"), annualRentFils: 120_000_00, cheques: 1 }).map(
        (i) => i.dueOn as string,
      ),
    ).toEqual(["2026-01-31"]);
    const monthly = paymentSchedule({ startOn: d("2026-01-31"), endOn: d("2027-01-30"), annualRentFils: 120_000_00, cheques: 12 });
    expect(monthly).toHaveLength(12);
    expect(monthly[1]!.dueOn as string).toBe("2026-02-28");
  });

  test("a six-month term spreads 2 cheques over its own months", () => {
    const s = paymentSchedule({ startOn: d("2026-03-01"), endOn: d("2026-08-31"), annualRentFils: 6_000_000, cheques: 2 });
    expect(s.map((i) => i.dueOn) as string[]).toEqual(["2026-03-01", "2026-06-01"]);
  });

  test.each([0, 13, 2.5])("refuses %p cheques", (cheques) => {
    expect(() => paymentSchedule({ startOn: d("2026-01-01"), endOn: d("2026-12-31"), annualRentFils: 1, cheques })).toThrow();
  });
});
