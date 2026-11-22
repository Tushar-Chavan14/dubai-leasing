import { isPending, pendingReason, type SalesRulebook } from "./types.ts";

/** What code knows about one party or payer when it checks warning signs (specs step 2). */
export interface AmlPartyFacts {
  partyId: string;
  sanctionsExactMatch: boolean;
  /** Name similarity against the lists (0..1), from the screening adapter; null when not screened. */
  sanctionsScore: number | null;
  pepScore: number | null;
  country: string;
  /** False for someone paying who is not a party (third-party payer). */
  isParty: boolean;
  cashFils: number;
  sourceOfFundsDeclared: boolean;
  /** Companies between the party and a person. */
  ownershipLayers: number;
}
export interface AmlHit {
  rule:
    | "sanctions"
    | "pep"
    | "third_party_payer"
    | "cash"
    | "high_risk_country"
    | "missing_source_of_funds"
    | "complex_ownership"
    | "not_screened"
    | "unconfirmed";
  partyId: string;
  detail: string;
}

/**
 * Warning-sign rules in code (S6, S20): any hit flags the party for compliance. A rule whose threshold is pending
 * raises an `unconfirmed` hit instead of passing. No model raises or clears anything here.
 */
export function amlRules(
  parties: readonly AmlPartyFacts[],
  rb: SalesRulebook,
  opts: { highRiskCountries: readonly string[] },
): { hits: AmlHit[]; flagged: boolean } {
  const hits: AmlHit[] = [];
  const nameThresholdPending = isPending(rb, "amlNameMatchThreshold");
  const cashPending = isPending(rb, "amlCashThresholdFils");
  for (const p of parties) {
    const hit = (rule: AmlHit["rule"], detail: string) => hits.push({ rule, partyId: p.partyId, detail });
    if (p.sanctionsExactMatch) hit("sanctions", "Exact match on a sanctions list.");
    // Not screened is never a pass (review #7).
    if (p.sanctionsScore === null || p.pepScore === null) hit("not_screened", "Not screened against every list.");
    const scores = [p.sanctionsScore, p.pepScore].filter((s): s is number => s !== null);
    if (scores.length && nameThresholdPending) hit("unconfirmed", pendingReason("amlNameMatchThreshold"));
    else {
      if (!p.sanctionsExactMatch && p.sanctionsScore !== null && p.sanctionsScore >= rb.amlNameMatchThreshold)
        hit("sanctions", "Name similar to a sanctions list entry.");
      if (p.pepScore !== null && p.pepScore >= rb.amlNameMatchThreshold) hit("pep", "Name similar to a PEP entry.");
    }
    if (!p.isParty) hit("third_party_payer", "Paid by someone who is not a party.");
    if (p.cashFils > 0 && cashPending) hit("unconfirmed", pendingReason("amlCashThresholdFils"));
    else if (!cashPending && p.cashFils >= rb.amlCashThresholdFils && p.cashFils > 0)
      hit("cash", "Cash at or above the threshold.");
    if (opts.highRiskCountries.some((c) => c.trim().toUpperCase() === p.country.trim().toUpperCase()))
      hit("high_risk_country", "Country on the high-risk list.");
    if (!p.sourceOfFundsDeclared) hit("missing_source_of_funds", "No source of funds declared.");
    if (p.ownershipLayers >= 2) hit("complex_ownership", "Ownership runs through several companies.");
  }
  return { hits, flagged: hits.length > 0 };
}
