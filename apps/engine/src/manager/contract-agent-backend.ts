import { type Addendum, isCompanyClauseRef, percentOfFloor } from "@leasing/core";
import { applications, type Tx } from "@leasing/db";
import { eq } from "drizzle-orm";
import {
  type BlankFill,
  type ContractAgentContext,
  describesUnit,
  templateParagraphs,
  type TemplateBlank,
} from "@leasing/helpers";
import type { EngineContext } from "../context.ts";
import { approvedClauses } from "./clause-refs.ts";
import { fillTemplateBlanks, linkedParagraphs, parseTemplate, type TemplateRow } from "./company-templates.ts";
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
      ? await printedTemplate(tx, i.template, [...(rule?.clauseIds ?? []), ...addendum.clauses])
      : null,
    rentBand: range ? { minFils: range.min, maxFils: range.max } : null,
    // A deposit agreed at the offer was set from the policy then; only a deposit changed since is held to today's policy.
    depositMaxFils:
      offer?.depositFils === i.lease.depositFils
        ? Math.max(i.lease.depositFils, percentOfFloor(i.lease.annualRentFils, pct))
        : percentOfFloor(i.lease.annualRentFils, pct),
    landlordGaps: landlordGaps(i.company, i.landlord, today),
    // D64: the only source a reworded template paragraph may use.
    unitFacts: {
      subtype: i.unit.subtype ?? null,
      bedrooms: i.unit.bedrooms ?? null,
      bathrooms: i.unit.bathrooms ?? null,
      areaSqft: i.unit.areaSqft ?? null,
      parkingSpaces: i.unit.parkingSpaces ?? null,
      floor: i.unit.floor ?? null,
      furnished: i.unit.furnished ?? null,
      description: i.unit.description?.trim() || null,
    },
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

/**
 * The template wording as the contract prints it (D47), for the agent to check: a paragraph linked to a clause shows
 * the clause's current wording, one whose clause isn't in this contract is left out, and paragraphs code left out
 * (sample notes, sample values) are not shown. Never the sample's original wording where a clause replaced it.
 */
async function printedTemplate(tx: Tx, row: TemplateRow, clauseIds: readonly string[]) {
  const t = parseTemplate(row);
  const dropped = new Set(t.review.droppedParagraphs);
  const linked = await linkedParagraphs(tx, row, clauseIds);
  const paragraphs = templateParagraphs(t.sections)
    .filter((p) => p.kind === "paragraph" && !dropped.has(p.key))
    .flatMap((p) => {
      const over = Object.hasOwn(linked.paragraphs, p.key) ? linked.paragraphs[p.key] : undefined;
      if (over === null) return [];
      // D64: only a paragraph about the unit (no legal or money terms, no company clause) may be reworded from its records.
      return [{ key: p.key, text: over ?? p.text, rewritable: over === undefined && describesUnit(p.text) }];
    });
  return { id: row.id, version: row.version, paragraphs };
}
