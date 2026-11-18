import { describe, expect, test } from "bun:test";
import { calendarDate as d, EMIRATES } from "@leasing/core";
import {
  hasRulebookFor,
  REGISTRATION_FEE_SCHEDULES,
  registrationFeeFils,
  registrationFeeFor,
  rulebookFromRow,
  rulebookValues,
  dubai2025_01 as base,
} from "../src/index.ts";

const rule = (e: Parameters<typeof registrationFeeFor>[0]) => registrationFeeFor(e, d("2026-01-01"))!.rule;
const fee = (e: Parameters<typeof registrationFeeFor>[0], rent: number) => registrationFeeFils(rule(e), rent);

describe("registration fees", () => {
  test("every emirate has a schedule, sourced and frozen", () => {
    for (const e of EMIRATES) expect(registrationFeeFor(e, d("2025-01-01"))).not.toBeNull();
    for (const s of REGISTRATION_FEE_SCHEDULES) {
      expect(s.sources.length).toBeGreaterThan(0);
      for (const x of s.sources) expect(x.startsWith("From the general data available:")).toBe(true);
    }
    expect(Object.isFrozen(REGISTRATION_FEE_SCHEDULES[0]!.rule)).toBe(true);
  });
  test("flat", () => {
    expect(fee("dubai", 8_500_000)).toBe(17_775 as never);
    expect(fee("abu_dhabi", 100_000_000)).toBe(5_000 as never);
  });
  test("percent with min: min kicks in, then plus", () => {
    expect(fee("ajman", 1_000_000)).toBe(40_000 as never); // 2% = 200 < min 400
    expect(fee("ajman", 5_000_000)).toBe(100_000 as never);
    expect(fee("sharjah", 5_000_000)).toBe(210_000 as never); // 4% = 2000 + 100
  });
  test("percent plus", () => {
    expect(fee("umm_al_quwain", 5_000_000)).toBe(104_000 as never);
    expect(fee("ras_al_khaimah", 5_000_000)).toBe(252_500 as never); // 5% = 2500 + 25
  });
  test("sharjah min then plus", () => {
    expect(fee("sharjah", 1_000_000)).toBe(60_000 as never); // 4% = 400 -> min 500 + 100
    expect(fee("sharjah", 10_000_000)).toBe(410_000 as never); // 4000 + 100
  });
  test("tier edge", () => {
    expect(fee("fujairah", 1_499_999)).toBe(30_000 as never);
    expect(fee("fujairah", 1_500_000)).toBe(30_000 as never); // 2% of 15,000 = 300
    expect(fee("fujairah", 1_600_000)).toBe(32_000 as never);
  });
  test("rounds half up", () => {
    expect(registrationFeeFils({ kind: "percent", bp: 200 }, 25)).toBe(1 as never); // 0.5 -> 1
    expect(registrationFeeFils({ kind: "percent", bp: 200 }, 24)).toBe(0 as never); // 0.48 -> 0
    expect(registrationFeeFils({ kind: "percent", bp: 200 }, 74)).toBe(1 as never); // 1.48 -> 1
    expect(registrationFeeFils({ kind: "percent", bp: 200 }, 75)).toBe(2 as never); // 1.5 -> 2
  });
  test("rejects bad rent", () => {
    for (const r of [0, -1, 1.5, Number.NaN]) expect(() => registrationFeeFils(rule("dubai"), r)).toThrow();
  });
  test("lookup before effectiveFrom is null", () => {
    expect(registrationFeeFor("dubai", d("2024-12-31"))).toBeNull();
    expect(registrationFeeFor("dubai", d("2025-01-01"))).not.toBeNull();
  });
});

describe("hasRulebookFor and version ids", () => {
  test("dubai yes, others no", () => {
    expect(hasRulebookFor(d("2026-01-01"), "dubai")).toBe(true);
    expect(hasRulebookFor(d("2020-01-01"), "dubai")).toBe(true); // base fallback
    expect(hasRulebookFor(d("2026-01-01"), "sharjah")).toBe(false);
  });
  const row = (version: string) => ({
    version,
    emirate: "abu_dhabi" as const,
    effectiveFrom: "2026-01-01",
    values: rulebookValues(base),
    referenceRules: [],
  });
  test("regex accepts underscores, rejects junk", () => {
    expect(rulebookFromRow(row("abu_dhabi-2026-01")).version).toBe("abu_dhabi-2026-01");
    expect(rulebookFromRow(row("umm_al_quwain-2026-01-15")).version).toBe("umm_al_quwain-2026-01-15");
    for (const bad of ["abu_dhabi_2026-01", "_abu-2026-01", "abu_-2026-01", "Abu-2026-01", "abu-26-01", "abu_dhabi"])
      expect(() => rulebookFromRow(row(bad))).toThrow();
  });
});
