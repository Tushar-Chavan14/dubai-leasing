import { describe, expect, test } from "bun:test";
import { bpsOfFloor } from "../src/index.ts";

const exact = (amount: number, bps: number) => Number((BigInt(amount) * BigInt(bps)) / 10_000n);

describe("bpsOfFloor (integer maths, C16)", () => {
  test("rounds down to a whole fil", () => {
    expect(bpsOfFloor(12_345, 400)).toBe(493);
    expect(bpsOfFloor(1, 400)).toBe(0);
    expect(bpsOfFloor(150_000_000, 400)).toBe(6_000_000);
    expect(bpsOfFloor(0, 400)).toBe(0);
    expect(bpsOfFloor(10_000, 10_000)).toBe(10_000);
  });
  test("no float error where amount x bps passes 2^53 (10^12 fils)", () => {
    // The floating-point product 999_999_000_001 x 9_999 isn't exact, and Math.floor of it was one fil too high.
    expect(Number.isSafeInteger(999_999_000_001 * 9_999)).toBe(false);
    expect(bpsOfFloor(999_999_000_001, 9_999)).toBe(999_899_000_100);
    expect(bpsOfFloor(999_999_006_667, 9_997)).toBe(999_699_006_964);
    expect(bpsOfFloor(999_999_008_889, 9_991)).toBe(999_099_009_780);
    for (const [a, b] of [
      [999_999_999_999, 9_999],
      [123_456_789_012, 7_777],
    ] as const)
      expect(bpsOfFloor(a, b)).toBe(exact(a, b));
    expect(bpsOfFloor(1_000_000_000_001, 25)).toBe(2_500_000_000);
    expect(bpsOfFloor(1_000_000_000_001, 1)).toBe(100_000_000);
  });
  test("refuses a value that isn't a non-negative whole number", () => {
    expect(() => bpsOfFloor(1.5, 400)).toThrow();
    expect(() => bpsOfFloor(100, 0.5)).toThrow();
    expect(() => bpsOfFloor(-1, 400)).toThrow();
    expect(() => bpsOfFloor(Number.NaN, 400)).toThrow();
  });
});
