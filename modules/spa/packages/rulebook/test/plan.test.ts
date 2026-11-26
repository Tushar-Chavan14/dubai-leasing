import { describe, expect, test } from "bun:test";
import type { PaymentPlan } from "@spa/core";
import { dubaiSales2026_01, validatePlan } from "../src/index.ts";

const plan = (...shares: number[]): PaymentPlan => ({
  instalments: shares.map((shareBps, i) => ({ label: `I${i + 1}`, shareBps, dueOn: `2027-0${i + 1}-01` as never })),
});

describe("validatePlan", () => {
  test("amounts follow the shares", () => {
    expect(validatePlan(plan(1000, 4000, 5000), 150_000_000, dubaiSales2026_01, { primary: true })).toEqual({
      ok: true,
      amountsFils: [15_000_000, 60_000_000, 75_000_000],
    });
  });
  test("the rounding remainder goes to the last instalment so amounts add up to the price", () => {
    const r = validatePlan(plan(3333, 3333, 3334), 100_001, dubaiSales2026_01, { primary: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.amountsFils.reduce((a, b) => a + b, 0)).toBe(100_001);
    expect(r.amountsFils).toEqual([33_330, 33_330, 33_341]);
  });
  test("a primary booking below the rulebook minimum is refused; a resale's first instalment isn't a booking", () => {
    expect(validatePlan(plan(500, 9500), 100_000_000, dubaiSales2026_01, { primary: true })).toEqual({
      ok: false,
      reasons: ["The booking (5%) is below the minimum (10%)."],
    });
    expect(validatePlan(plan(500, 9500), 100_000_000, dubaiSales2026_01, { primary: false }).ok).toBe(true);
  });
  test("shares that don't add up and a bad price are refused", () => {
    expect(validatePlan(plan(5000, 4000), 100, dubaiSales2026_01, { primary: false }).ok).toBe(false);
    expect(validatePlan(plan(10_000), 0, dubaiSales2026_01, { primary: false }).ok).toBe(false);
  });
});
