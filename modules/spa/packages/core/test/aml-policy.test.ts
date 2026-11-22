import { describe, expect, test } from "bun:test";
import { assessRisk, DEFAULT_SPA_AML_POLICY, hitFlags, SpaAmlPolicy } from "../src/index.ts";

const p = DEFAULT_SPA_AML_POLICY;
const base = {
  hits: [] as { rule: string }[],
  partyType: "person" as const,
  paymentMethod: "transfer" as const,
  priceFils: 100_000_000,
};

describe("SPA AML policy (S20)", () => {
  test("the default is valid; sanctions can't be switched off; cut-offs must rise", () => {
    expect(SpaAmlPolicy.safeParse(p).success).toBe(true);
    expect(
      SpaAmlPolicy.safeParse({ ...p, rules: { ...p.rules, sanctions: { ...p.rules.sanctions, on: false } } }).success,
    ).toBe(false);
    expect(SpaAmlPolicy.safeParse({ ...p, risk: { ...p.risk, cutoffs: { medium: 50, high: 40 } } }).success).toBe(
      false,
    );
    expect(SpaAmlPolicy.safeParse({ ...p, highRiskCountries: ["xx"] }).success).toBe(false);
  });
  test("no hits and low factors: low, nothing flagged", () => {
    expect(assessRisk(base, p)).toMatchObject({ level: "low", flagged: false, eddRequired: false });
  });
  test("a flag-severity hit flags; always-flag rules flag whatever the policy says", () => {
    expect(assessRisk({ ...base, hits: [{ rule: "pep" }] }, p).flagged).toBe(true);
    const off = { ...p, rules: { ...p.rules, pep: { ...p.rules.pep, on: false } } };
    expect(assessRisk({ ...base, hits: [{ rule: "pep" }] }, off).flagged).toBe(false);
    for (const rule of ["sanctions", "not_screened", "unconfirmed"])
      expect(assessRisk({ ...base, hits: [{ rule }] }, off).flagged).toBe(true);
  });
  test("points add up per rule and factor; high means EDD even with no flag", () => {
    const r = assessRisk({ ...base, partyType: "company", paymentMethod: "cash", priceFils: 1_000_000_000 }, p);
    expect(r.points).toBe(p.risk.factors.partyType.company + p.risk.factors.paymentMethod.cash + 30);
    expect(r.level).toBe("high");
    expect(r.flagged).toBe(false);
    expect(r.eddRequired).toBe(true);
    expect(r.breakdown.map((b) => b.source)).toContain("price band ≥ AED 5,000,000");
  });
});

describe("hitFlags (C18)", () => {
  test("sanctions, not_screened and unconfirmed always flag; other rules follow the policy", () => {
    const off = SpaAmlPolicy.parse({
      ...DEFAULT_SPA_AML_POLICY,
      rules: {
        ...DEFAULT_SPA_AML_POLICY.rules,
        pep: { on: true, severity: "warning", points: 5 },
        cash: { on: false, severity: "flag", points: 0 },
      },
    });
    for (const r of ["sanctions", "not_screened", "unconfirmed"]) expect(hitFlags(r, off)).toBe(true);
    expect(hitFlags("pep", off)).toBe(false);
    expect(hitFlags("cash", off)).toBe(false);
    expect(hitFlags("third_party_payer", off)).toBe(true);
    expect(hitFlags("anything_else", off)).toBe(false);
  });
});
