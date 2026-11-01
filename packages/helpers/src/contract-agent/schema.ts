import { AddendumFlag } from "@leasing/core";
import { z } from "zod";
import { ContractContext, ContractData } from "../contract/schema.ts";

/**
 * What the Manager hands the contract agent: the contract records (as for the Contract helper, with the rule's
 * clauses as the starting addendum), the company's contract config, and limits computed by code.
 */
export const ContractAgentContext = z.object({
  contract: ContractContext,
  rule: z
    .object({
      id: z.string(),
      tenures: z.array(z.enum(["annual", "short_term"])),
      minCheques: z.number().int(),
      maxCheques: z.number().int(),
      clauseIds: z.array(z.string()),
    })
    .nullable(),
  /** Approved clauses of the company (`inTemplate`: already part of the template's wording). */
  clauses: z.array(
    z.object({
      ref: z.string(),
      title: z.string(),
      text: z.string(),
      category: z.string(),
      hasValues: z.boolean(),
      inTemplate: z.boolean(),
    }),
  ),
  /** The approved company template the rule pins: its paragraphs with `{{bN}}` blanks. Null: standard contract. */
  template: z
    .object({
      id: z.string(),
      version: z.number().int(),
      paragraphs: z.array(z.object({ key: z.string(), text: z.string() })),
    })
    .nullable(),
  /** The unit's allowed annual rent range from its rent rule and the SRI (code). Null: no band to check. */
  rentBand: z.object({ minFils: z.number().int(), maxFils: z.number().int() }).nullable(),
  /** Highest deposit company policy allows for this unit (code). */
  depositMaxFils: z.number().int(),
  /** Missing company legal details (D44); any → preparation stops. */
  landlordGaps: z.array(z.string()),
});
export type ContractAgentContext = z.infer<typeof ContractAgentContext>;

export const TermCheckId = z.enum([
  "tenure",
  "cheques",
  "rent_band",
  "deposit",
  "landlord",
  "required_terms",
  "blanks",
]);
export const TermCheck = z.object({ id: TermCheckId, ok: z.boolean(), reason: z.string() });
export type TermCheck = z.infer<typeof TermCheck>;

/** What the model must end with. Values never come from here: fields are code-copied, checks recomputed. */
export const AgentAnswer = z.object({
  extraClauseIds: z.array(z.string()).max(30),
  clauseReasons: z.array(z.object({ id: z.string(), reason: z.string().max(300) })).max(30),
  flags: z.array(AddendumFlag).max(20),
});
export type AgentAnswer = z.infer<typeof AgentAnswer>;

export const ContractAgentData = ContractData.extend({
  checks: z.array(TermCheck),
  extraClauseIds: z.array(z.string()),
  clauseReasons: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type ContractAgentData = z.infer<typeof ContractAgentData>;

/** Blank filling, done by the engine (code mapping of template blanks to record values). */
export interface BlankFill {
  filled: { label: string; key: string }[];
  leftEmpty: string[];
  /** Legal or money blanks with no value: preparation stops. */
  missingCore: string[];
}
