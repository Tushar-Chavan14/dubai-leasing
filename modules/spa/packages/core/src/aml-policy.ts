import { z } from "zod";

/**
 * The company's AML policy (S20): which warning signs are on and how serious, risk points and cut-offs, EDD documents,
 * source-of-funds evidence and re-screening points. Policy, not law: thresholds (name match, cash) stay in the
 * rulebook. Risk is computed by code only; no model raises, scores or clears anything (S6).
 */
export const AML_RULES = [
  "sanctions",
  "pep",
  "third_party_payer",
  "cash",
  "high_risk_country",
  "missing_source_of_funds",
  "complex_ownership",
] as const;
export type AmlRuleId = (typeof AML_RULES)[number];
/** Hits that always flag, whatever the policy says. */
export const ALWAYS_FLAG: ReadonlySet<string> = new Set(["sanctions", "not_screened", "unconfirmed"]);

const RuleSetting = z.object({
  on: z.boolean(),
  /** `flag` puts the deal on AML hold; `warning` only adds points. */
  severity: z.enum(["flag", "warning"]),
  points: z.number().int().min(0).max(100),
});
const points = z.number().int().min(0).max(100);
export const FUND_SOURCES = [
  "salary",
  "savings",
  "property_sale",
  "business_income",
  "loan",
  "gift",
  "inheritance",
  "other",
] as const;

export const SpaAmlPolicy = z
  .object({
    rules: z.object(
      Object.fromEntries(AML_RULES.map((r) => [r, RuleSetting])) as Record<AmlRuleId, typeof RuleSetting>,
    ),
    /** ISO 3166 alpha-2 codes, upper case. */
    highRiskCountries: z.array(z.string().regex(/^[A-Z]{2}$/, "two upper-case letters")).max(250),
    sourceOfFunds: z.object(
      Object.fromEntries(
        FUND_SOURCES.map((s) => [s, z.object({ documents: z.array(z.string().trim().min(1).max(80)).max(10) })]),
      ) as Record<(typeof FUND_SOURCES)[number], z.ZodObject<{ documents: z.ZodArray<z.ZodString> }>>,
    ),
    risk: z.object({
      factors: z.object({
        partyType: z.object({ person: points, company: points }),
        paymentMethod: z.object({ transfer: points, cheque: points, cash: points, mortgage: points }),
        priceBands: z
          .array(z.object({ minFils: z.number().int().min(0), points }))
          .min(1)
          .refine(
            (b) => b[0]!.minFils === 0 && b.every((x, i) => i === 0 || x.minFils > b[i - 1]!.minFils),
            "bands start at 0 and rise",
          ),
      }),
      cutoffs: z.object({ medium: points, high: points }).refine((c) => c.high > c.medium, "high must be above medium"),
    }),
    edd: z.object({ documents: z.array(z.string().trim().min(1).max(80)).min(1).max(10) }),
    rescreen: z.object({
      atOffer: z.boolean(),
      beforeAgreementApproval: z.boolean(),
      beforeTransfer: z.boolean(),
      onPartyChange: z.boolean(),
      everyDays: z.number().int().min(1).max(365).nullable(),
    }),
  })
  .refine((p) => p.rules.sanctions.on && p.rules.sanctions.severity === "flag", {
    message: "a sanctions match always flags",
    path: ["rules", "sanctions"],
  });
export type SpaAmlPolicy = z.infer<typeof SpaAmlPolicy>;

const rule = (points: number) => ({ on: true, severity: "flag" as const, points });
/** Placeholders until compliance publishes its own policy (version 0). Confirm with compliance. */
export const DEFAULT_SPA_AML_POLICY: SpaAmlPolicy = Object.freeze({
  rules: {
    sanctions: rule(100),
    pep: rule(40),
    third_party_payer: rule(30),
    cash: rule(30),
    high_risk_country: rule(30),
    missing_source_of_funds: rule(20),
    complex_ownership: rule(20),
  },
  highRiskCountries: [],
  sourceOfFunds: Object.fromEntries(
    FUND_SOURCES.map((s) => [s, { documents: ["Bank statements (6 months)"] }]),
  ) as SpaAmlPolicy["sourceOfFunds"],
  risk: {
    factors: {
      partyType: { person: 0, company: 20 },
      paymentMethod: { transfer: 0, cheque: 5, cash: 30, mortgage: 0 },
      priceBands: [
        { minFils: 0, points: 0 },
        { minFils: 200_000_000, points: 10 },
        { minFils: 500_000_000, points: 30 },
      ],
    },
    cutoffs: { medium: 30, high: 60 },
  },
  edd: { documents: ["Source of wealth statement", "Bank reference letter"] },
  rescreen: { atOffer: true, beforeAgreementApproval: true, beforeTransfer: true, onPartyChange: true, everyDays: 90 },
}) as SpaAmlPolicy;

export type RiskLevel = "low" | "medium" | "high";
export interface RiskInput {
  hits: readonly { rule: string }[];
  partyType: "person" | "company";
  paymentMethod: "transfer" | "cheque" | "cash" | "mortgage";
  priceFils: number;
}
const aed = (fils: number) => `AED ${Math.floor(fils / 100).toLocaleString("en-US")}`;

/** Whether a hit of this rule flags under this policy: `sanctions`, `not_screened` and `unconfirmed` always do (S20). */
export function hitFlags(ruleId: string, policy: SpaAmlPolicy): boolean {
  if (ALWAYS_FLAG.has(ruleId)) return true;
  const s = (policy.rules as Record<string, z.infer<typeof RuleSetting>>)[ruleId];
  return !!s?.on && s.severity === "flag";
}

/** Risk points, level and flag for one party, by code (S20). High always needs EDD and `edd_signoff`. */
export function assessRisk(input: RiskInput, policy: SpaAmlPolicy) {
  const breakdown: { source: string; points: number }[] = [];
  let flagged = false;
  for (const h of input.hits) {
    if (hitFlags(h.rule, policy)) flagged = true;
    const s = (policy.rules as Record<string, z.infer<typeof RuleSetting>>)[h.rule];
    if (s?.on) breakdown.push({ source: `rule ${h.rule}`, points: s.points });
  }
  const f = policy.risk.factors;
  breakdown.push({ source: `party type ${input.partyType}`, points: f.partyType[input.partyType] });
  breakdown.push({ source: `payment ${input.paymentMethod}`, points: f.paymentMethod[input.paymentMethod] });
  const band = f.priceBands.filter((b) => input.priceFils >= b.minFils).at(-1)!;
  breakdown.push({ source: `price band ≥ ${aed(band.minFils)}`, points: band.points });
  const total = breakdown.reduce((a, b) => a + b.points, 0);
  const level: RiskLevel =
    total >= policy.risk.cutoffs.high ? "high" : total >= policy.risk.cutoffs.medium ? "medium" : "low";
  return { points: total, level, flagged, eddRequired: level === "high", breakdown };
}
