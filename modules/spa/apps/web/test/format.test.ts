import { expect, test } from "bun:test";
import { ageLabel, dubaiDateTime, formatMoneyFils, shareLabel, shortDate } from "../lib/format";

test("money is integer fils shown as AED, fils only when not a whole dirham", () => {
  expect(formatMoneyFils(150_000_000)).toBe("AED 1,500,000");
  expect(formatMoneyFils(12_345)).toBe("AED 123.45");
  expect(formatMoneyFils(5)).toBe("AED 0.05");
  expect(formatMoneyFils(0)).toBe("AED 0");
  expect(formatMoneyFils(-250_000)).toBe("-AED 2,500");
});

test("a share in basis points is an exact percentage, no float noise", () => {
  expect(shareLabel(10_000)).toBe("100%");
  expect(shareLabel(5000)).toBe("50%");
  expect(shareLabel(3333)).toBe("33.33%");
  expect(shareLabel(3350)).toBe("33.5%");
  expect(shareLabel(null)).toBeNull();
});

test("dates read '4 Dec 2026' and times are UAE time", () => {
  expect(shortDate("2026-12-04")).toBe("4 Dec 2026");
  expect(shortDate("2026-12-04T22:30:00.000Z")).toBe("5 Dec 2026");
  expect(dubaiDateTime("2026-12-04T06:00:00.000Z")).toBe("4 Dec 2026, 10:00");
  expect(shortDate("not a date")).toBe("");
});

test("an age is in days, in words", () => {
  expect(ageLabel(0)).toBe("Today");
  expect(ageLabel(1)).toBe("1 day");
  expect(ageLabel(12)).toBe("12 days");
});
