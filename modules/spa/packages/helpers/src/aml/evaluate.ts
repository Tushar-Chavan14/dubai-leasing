import { ALWAYS_FLAG, hitFlags, type SpaAmlPolicy } from "@spa/core";
import { type AmlHit, type AmlPartyFacts, amlRules, type SalesRulebook } from "@spa/rulebook";
import type { ScreeningAdapter, ScreeningResult } from "./adapter.ts";
import { normaliseName } from "./similarity.ts";

/** One name code screens: a party, a company, a beneficial owner or someone paying who is not a party. */
export interface AmlSubject {
  /** The party id, or `payer:<normalised name>` for a payer who is not a party. */
  key: string;
  partyId: string | null;
  name: string;
  kind: "person" | "company";
  /** False for a payer who is not a party. */
  isParty: boolean;
  country: string;
  sourceOfFundsDeclared: boolean;
  ownershipLayers: number;
  cashFils: number;
}
export interface EvaluatedHit {
  rule: AmlHit["rule"];
  /** `flag` puts the deal on hold; `warning` only adds points. */
  severity: "flag" | "warning";
  detail: string;
  flags: boolean;
}
export interface SubjectResult {
  subject: AmlSubject;
  /** Null when the service failed: the subject is "not screened", which flags. */
  screening: ScreeningResult | null;
  hits: EvaluatedHit[];
}

/**
 * Screens every subject, then runs the code rules (`amlRules`, C2) under the policy (S20). No model is involved: a hit
 * flags when its rule's policy severity is `flag` or the rule always flags (`sanctions`, `not_screened`,
 * `unconfirmed`). A rule the policy switched off leaves no hit, except those that always flag.
 */
export async function evaluateAml(
  adapter: ScreeningAdapter,
  subjects: readonly AmlSubject[],
  rb: SalesRulebook,
  policy: SpaAmlPolicy,
): Promise<{ results: SubjectResult[] }> {
  const screened = await Promise.all(
    subjects.map((s) =>
      // A name with no letters or digits can match nothing, so a list "found nothing" would be silence, not a
      // pass (review 16): it is not screened, which flags. The adapter isn't asked.
      normaliseName(s.name) === ""
        ? Promise.resolve<ScreeningResult | null>(null)
        : adapter.screen({ name: s.name, kind: s.kind }).then(
            (r): ScreeningResult | null => r,
            () => null,
          ),
    ),
  );
  const facts: AmlPartyFacts[] = subjects.map((s, i) => ({
    partyId: s.key,
    sanctionsExactMatch: screened[i]?.exact ?? false,
    sanctionsScore: screened[i]?.sanctionsScore ?? null,
    pepScore: screened[i]?.pepScore ?? null,
    country: s.country,
    isParty: s.isParty,
    cashFils: s.cashFils,
    sourceOfFundsDeclared: s.sourceOfFundsDeclared,
    ownershipLayers: s.ownershipLayers,
  }));
  const { hits } = amlRules(facts, rb, { highRiskCountries: policy.highRiskCountries });
  const rules = policy.rules as Record<string, { on: boolean } | undefined>;
  return {
    results: subjects.map((subject, i) => ({
      subject,
      screening: screened[i] ?? null,
      hits: hits
        .filter((h) => h.partyId === subject.key)
        .filter((h) => ALWAYS_FLAG.has(h.rule) || rules[h.rule]?.on !== false)
        .map((h) => {
          const flags = hitFlags(h.rule, policy);
          return { rule: h.rule, severity: flags ? ("flag" as const) : ("warning" as const), detail: h.detail, flags };
        }),
    })),
  };
}
