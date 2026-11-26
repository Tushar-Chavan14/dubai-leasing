import { describe, expect, test } from "bun:test";
import { dubaiSales2026_01, registrationFee, type SalesRulebook } from "../src/index.ts";

const confirmed = (over: Partial<SalesRulebook> = {}): SalesRulebook => ({
  ...dubaiSales2026_01,
  pending: [],
  ...over,
});

describe("registrationFee", () => {
  test("4% of the price, rounded down to a fil", () => {
    expect(registrationFee(150_000_000, confirmed())).toEqual({
      ok: true,
      totalFils: 6_000_000,
      buyerFils: 6_000_000,
      sellerFils: 0,
    });
    expect(registrationFee(1, confirmed())).toMatchObject({ ok: true, totalFils: 0 });
    expect(registrationFee(12_345, confirmed())).toMatchObject({ ok: true, totalFils: 493 });
  });
  test("a split adds up exactly; the seller gets the lower half", () => {
    expect(registrationFee(12_345, confirmed({ registrationFeePayer: "split" }))).toEqual({
      ok: true,
      totalFils: 493,
      buyerFils: 247,
      sellerFils: 246,
    });
    expect(registrationFee(150_000_000, confirmed({ registrationFeePayer: "seller" }))).toMatchObject({
      buyerFils: 0,
      sellerFils: 6_000_000,
    });
  });
  test("refuses while who pays awaits legal confirmation", () => {
    expect(registrationFee(150_000_000, dubaiSales2026_01)).toEqual({
      ok: false,
      reasons: ["registrationFeePayer awaits legal confirmation"],
    });
  });
  test("refuses a price that isn't a positive whole number of fils", () => {
    for (const p of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) expect(registrationFee(p, confirmed()).ok).toBe(false);
  });
});
