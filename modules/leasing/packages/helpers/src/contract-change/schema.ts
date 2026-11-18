import { ChangeKind, ContractChangeAnalysis, MAX_ADDENDUM_CLAUSES } from "@leasing/core";
import { z } from "zod";

/** A clause as printed: a standard clause id or `cc:<uuid>`, with its title and approved wording. */
export const ClauseOption = z.object({
  ref: z.string().min(1).max(60),
  title: z.string().max(200),
  text: z.string().max(4000),
});
export type ClauseOption = z.infer<typeof ClauseOption>;

/**
 * What the helper sees: the signer's request (untrusted), the contract's addendum and the clauses that may be added.
 * No rent, deposit, cheque or date is given to the model: those never change through this path (rule 1).
 */
export const ContractChangeContext = z.object({
  request: z.object({
    role: z.enum(["tenant", "landlord"]),
    /** The clause the signer pointed at, `free_text` or `other`. */
    target: z.string().max(60),
    text: z.string().min(1).max(2000),
  }),
  current: z.object({
    clauses: z.array(ClauseOption).max(MAX_ADDENDUM_CLAUSES),
    freeText: z.string().max(4000).nullable(),
  }),
  /** Clauses that may be added: the standard ones and the company's approved clauses. */
  allowed: z.array(ClauseOption).max(60),
});
export type ContractChangeContext = z.infer<typeof ContractChangeContext>;

export const ContractChangeData = ContractChangeAnalysis;
export type ContractChangeData = z.infer<typeof ContractChangeData>;

/** A clause id as the model wrote it; "[no_pets]" or "`no_pets`" is read as "no_pets" (still checked by code). */
const clauseId = z
  .string()
  .max(60)
  .transform((v) => v.trim().replace(/^[[`"'\s]+|[\]`"'\s]+$/g, ""));

/** The model's answer. Code checks every part before anything reaches staff. */
export const ModelChange = z.object({
  kind: ChangeKind,
  summary: z.string().trim().min(1).max(400),
  analysis: z.string().trim().min(1).max(2000),
  risks: z.array(z.string().trim().max(300)).max(6).default([]),
  removeClauses: z.array(clauseId).max(MAX_ADDENDUM_CLAUSES).default([]),
  addClauses: z.array(clauseId).max(MAX_ADDENDUM_CLAUSES).default([]),
  /** The whole new "Additional terms" text, or null to keep it as it is. */
  freeText: z.string().max(4000).nullable().default(null),
});
export type ModelChange = z.infer<typeof ModelChange>;
