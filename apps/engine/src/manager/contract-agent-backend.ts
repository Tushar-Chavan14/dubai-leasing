import { type Addendum, isCompanyClauseRef, percentOfFloor } from "@leasing/core";
import { applications, type Tx } from "@leasing/db";
import { eq } from "drizzle-orm";
import { type BlankFill, type ContractAgentContext, templateParagraphs, type TemplateBlank } from "@leasing/helpers";
import type { EngineContext } from "../context.ts";
import { approvedClauses } from "./clause-refs.ts";
import { fillTemplateBlanks, parseTemplate } from "./company-templates.ts";
import { landlordGaps } from "./company-legal.ts";
import type { contractInputs } from "./contracts.ts";
import { getCompanyPolicy } from "./events.ts";
import { matchContractRule, priceRangeFor } from "./pricing.ts";

type Inputs = Awaited<ReturnType<typeof contractInputs>>;

/**
 * What the contract agent reads, all from the records and code: the rule, approved clauses (those inside the pinned
 * template marked `inTemplate` and left out of the starting clauses), the template's paragraphs, the unit's rent band,
 * the policy deposit limit and any missing landlord details.
 */
export async function contractAgentContext(
  ctx: EngineContext,
  tx: Tx,
  i: Inputs,
  addendum: Addendum,
): Promise<ContractAgentContext> {
  const today = ctx.clock.today();
  const rule = await matchContractRule(tx, i.unit);
  const clauses = (await approvedClauses(tx, i.unit.companyId)).map((c) => ({
    ref: `cc:${c.id}`,
    title: c.title,
    text: c.textEn,
    category: c.category,
    hasValues: c.hasValues,
    // Approved with any version of the company template: its wording is already in the template.
    inTemplate: !!i.template && c.inTemplateId !== null,
  }));
  const inTemplate = new Set(clauses.filter((c) => c.inTemplate).map((c) => c.ref));
  const keep = (id: string) => !(isCompanyClauseRef(id) && inTemplate.has(id));
  // The rent was already held to the band at the offer (out-of-range offers need a manager's approval), so the band
  // is checked only when the lease's rent differs from the accepted offer and no manager approved the unit's price.
  const offer = i.lease.applicationId ? await offerOf(tx, i.lease.applicationId) : null;
  const settled = i.unit.priceApprovedAt !== null || offer?.annualRentFils === i.lease.annualRentFils;
  const { range } = settled ? { range: null } : await priceRangeFor(tx, i.unit, today);
  const policy = await getCompanyPolicy(tx, today);
  const pct = i.unit.furnished ? policy.depositPercentFurnished : policy.depositPercentUnfurnished;
  return {
    contract: { ...i.context, addendum: { ...addendum, clauses: addendum.clauses.filter(keep) } },
    rule: rule
      ? {
          id: rule.id,
          tenures: rule.tenures,
          minCheques: rule.minCheques,
          maxCheques: rule.maxCheques,
          clauseIds: rule.clauseIds.filter(keep),
        }
      : null,
    clauses,
    template: i.template
      ? {
          id: i.template.id,
          version: i.template.version,
          paragraphs: templateParagraphs(parseTemplate(i.template).sections)
            .filter((p) => p.kind === "paragraph")
            .map((p) => ({ key: p.key, text: p.text })),
        }
      : null,
    rentBand: range ? { minFils: range.min, maxFils: range.max } : null,
    // A deposit agreed at the offer was set from the policy then; only a deposit changed since is held to today's policy.
    depositMaxFils:
      offer?.depositFils === i.lease.depositFils
        ? Math.max(i.lease.depositFils, percentOfFloor(i.lease.annualRentFils, pct))
        : percentOfFloor(i.lease.annualRentFils, pct),
    landlordGaps: landlordGaps(i.company, i.landlord, today),
  };
}

async function offerOf(tx: Tx, applicationId: string) {
  const [a] = await tx.db
    .select({ offer: applications.offer })
    .from(applications)
    .where(eq(applications.id, applicationId));
  return (a?.offer as { annualRentFils?: number; depositFils?: number } | null) ?? null;
}

/** `fill_blanks` for the agent: the pinned template's blanks filled from the records (code), or null without one. */
export function blankFiller(ctx: EngineContext, i: Inputs, blanks?: TemplateBlank[]) {
  return async (fields: Record<string, unknown>): Promise<BlankFill | null> =>
    i.template ? fillTemplateBlanks(ctx, i.template, fields as never, i.extras, blanks) : null;
}
