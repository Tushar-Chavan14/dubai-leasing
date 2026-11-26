import { describe, expect, test } from "bun:test";
import {
  allowedAskingRange,
  applyContractRule,
  askingRentWithinRange,
  defaultCompanyPolicy,
  propertyUsageFor,
  type RentRuleBounds,
  type SriBasis,
} from "../src/index.ts";

const res = { category: "residential" as const, areaSqft: 850 };
const sri = (avg: number | null, perSqft: number | null = null): SriBasis => ({
  avgAnnualRentFils: avg,
  avgAnnualRentPerSqftFils: perSqft,
  label: "test",
});
const rule = (over: Partial<RentRuleBounds> = {}): RentRuleBounds => ({
  minPctBp: -500,
  maxPctBp: 1000,
  minRentFils: null,
  maxRentFils: null,
  ...over,
});

describe("allowedAskingRange", () => {
  test("residential band", () => {
    const r = allowedAskingRange(res, sri(10_000_000), rule());
    expect(r).toMatchObject({ min: 9_500_000, max: 11_000_000 });
  });
  test("band intersected with AED bounds", () => {
    expect(allowedAskingRange(res, sri(10_000_000), rule({ maxRentFils: 10_500_000 }))?.max).toBe(10_500_000);
  });
  test("rounds toward the narrower range", () => {
    const r = allowedAskingRange(res, sri(3_333_333), rule({ minPctBp: -333, maxPctBp: 333 }));
    expect(r?.min).toBe(Math.ceil((3_333_333 * 9_667) / 10_000));
    expect(r?.max).toBe(Math.floor((3_333_333 * 10_333) / 10_000));
  });
  test("no SRI gives AED bounds only", () => {
    const r = allowedAskingRange(res, null, rule({ minRentFils: 5_000_000, maxRentFils: 9_000_000 }));
    expect(r).toMatchObject({ min: 5_000_000, max: 9_000_000 });
  });
  test("no SRI and no AED gives null; rule null gives null", () => {
    expect(allowedAskingRange(res, null, rule())).toBeNull();
    expect(allowedAskingRange(res, sri(10_000_000), null)).toBeNull();
  });
  test("empty intersection gives null", () => {
    expect(allowedAskingRange(res, sri(10_000_000), rule({ minRentFils: 12_000_000 }))).toBeNull();
  });
  test("commercial uses per-sqft times area", () => {
    const r = allowedAskingRange(
      { category: "commercial", areaSqft: 1_000 },
      sri(null, 12_000),
      rule({ minPctBp: 0, maxPctBp: 1000 }),
    );
    expect(r).toMatchObject({ min: 12_000_000, max: 13_200_000 });
  });
  test("commercial without area uses AED bounds only", () => {
    const r = allowedAskingRange(
      { category: "commercial", areaSqft: null },
      sri(null, 12_000),
      rule({ maxRentFils: 20_000_000 }),
    );
    expect(r).toMatchObject({ min: 0, max: 20_000_000 });
  });
});

describe("allowedAskingRange: edge branches", () => {
  test("commercial with no area and no AED bounds gives null", () => {
    expect(allowedAskingRange({ category: "commercial", areaSqft: null }, sri(null, 12_000), rule())).toBeNull();
  });
  test("a non-positive area gives no SRI band", () => {
    const zero = { category: "commercial" as const, areaSqft: 0 };
    expect(allowedAskingRange(zero, sri(null, 12_000), rule())).toBeNull();
    const r = allowedAskingRange(zero, sri(null, 12_000), rule({ maxRentFils: 20_000_000 }));
    expect(r).toMatchObject({ min: 0, max: 20_000_000 });
    expect(r?.basis).toMatchObject({ sriFils: null, bandMin: null, bandMax: null });
  });
  test("a one-sided AED bound leaves the other side open", () => {
    const r = allowedAskingRange(res, null, rule({ minRentFils: 5_000_000 }));
    expect(r).toMatchObject({ min: 5_000_000, max: Number.MAX_SAFE_INTEGER });
    expect(r?.basis).toMatchObject({ aedMin: 5_000_000, aedMax: null });
  });
  test("a residential SRI with only a per-sqft rate gives AED only or null", () => {
    expect(allowedAskingRange(res, sri(null, 12_000), rule())).toBeNull();
    expect(allowedAskingRange(res, sri(null, 12_000), rule({ maxRentFils: 9_000_000 }))).toMatchObject({
      min: 0,
      max: 9_000_000,
    });
  });
});

describe("askingRentWithinRange", () => {
  const range = allowedAskingRange(res, sri(10_000_000), rule());
  test("inclusive edges, false outside", () => {
    expect(askingRentWithinRange({ askingRentFils: 9_500_000 }, range)).toBe(true);
    expect(askingRentWithinRange({ askingRentFils: 11_000_000 }, range)).toBe(true);
    expect(askingRentWithinRange({ askingRentFils: 9_499_999 }, range)).toBe(false);
    expect(askingRentWithinRange({ askingRentFils: 11_000_001 }, range)).toBe(false);
  });
  test("false for null rent or null range", () => {
    expect(askingRentWithinRange({ askingRentFils: null }, range)).toBe(false);
    expect(askingRentWithinRange({ askingRentFils: 10_000_000 }, null)).toBe(false);
  });
});

describe("applyContractRule", () => {
  test("overrides limits and clamps the default cheques", () => {
    const p = { ...defaultCompanyPolicy, offerDefaultCheques: 4 };
    const out = applyContractRule(p, { minCheques: 6, maxCheques: 12 });
    expect(out).toMatchObject({ minCheques: 6, maxCheques: 12, offerDefaultCheques: 6 });
    expect(applyContractRule(p, { minCheques: 1, maxCheques: 2 }).offerDefaultCheques).toBe(2);
  });
  test("null rule returns the policy unchanged", () => {
    expect(applyContractRule(defaultCompanyPolicy, null)).toBe(defaultCompanyPolicy);
  });
});

test("retail counts as commercial usage", () => {
  expect(propertyUsageFor("retail")).toBe("commercial");
  expect(propertyUsageFor("commercial")).toBe("commercial");
  expect(propertyUsageFor("residential")).toBe("residential");
});
