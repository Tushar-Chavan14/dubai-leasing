import { describe, expect, test } from "bun:test";
import { discountCheck } from "../src/index.ts";

describe("discountCheck", () => {
  test("exactly at the limit is allowed; one fil more is not", () => {
    expect(discountCheck(100_000_000, 95_000_000, 500)).toEqual({
      ok: true,
      discountBps: 500,
      discountFils: 5_000_000,
    });
    const over = discountCheck(100_000_000, 94_999_999, 500);
    expect(over.ok).toBe(false);
    expect(over.discountFils).toBe(5_000_001);
  });
  test("no discount is fine; a price above the list is refused", () => {
    expect(discountCheck(100_000_000, 100_000_000, 500)).toEqual({ ok: true, discountBps: 0, discountFils: 0 });
    expect(discountCheck(100_000_000, 100_000_001, 500)).toMatchObject({
      ok: false,
      reasons: ["The agreed price is above the list price."],
    });
  });
  test("a missing list price is refused", () => {
    expect(discountCheck(0, 1, 500).ok).toBe(false);
  });
});
