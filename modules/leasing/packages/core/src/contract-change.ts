import { z } from "zod";
import { isCalendarDate } from "./dates.ts";
import { CompanyClauseRef, ContractClauseId, MAX_ADDENDUM_CLAUSES } from "./contract.ts";

/**
 * D67: a tenant or landlord asks for a change to the contract from their signing page. The request text is
 * untrusted. While a request is open, signing of that contract version is paused for both parties. An AI helper
 * drafts a revised addendum and an analysis; code checks it and builds the diff; a person re-issues (through the
 * `final_contract` gate) or declines.
 */

/** What the change is about: one clause on the contract, the extra terms, or something else. */
export const ChangeTarget = z.union([ContractClauseId, CompanyClauseRef, z.enum(["free_text", "other"])]);
export type ChangeTarget = z.infer<typeof ChangeTarget>;

/** The signer's form. `text` length is also capped by policy (`contractChanges.maxChars`). */
export const ContractChangeRequestInput = z.strictObject({
  target: ChangeTarget.default("other"),
  text: z.string().trim().min(5, "Tell us what you would like changed.").max(2000),
});
export type ContractChangeRequestInput = z.infer<typeof ContractChangeRequestInput>;

export const ContractChangeStatus = z.enum([
  /** Received; the AI is drafting. Signing paused. */
  "open",
  /** The AI draft (or its failure) is ready for staff. Signing paused. */
  "analysed",
  /** Staff prepared a new contract version from it (waits at `final_contract`). */
  "reissued",
  /** Staff declined with a note; the requester was emailed. */
  "declined",
  /** The requester withdrew it from the signing page. */
  "withdrawn",
  /** Another request on the same version was re-issued, so this version was replaced. */
  "superseded",
]);
export type ContractChangeStatus = z.infer<typeof ContractChangeStatus>;
/** Requests in these statuses pause signing of their contract version. */
export const PAUSING_CHANGE_STATUSES: readonly ContractChangeStatus[] = ["open", "analysed"];

export const ChangeKind = z.enum([
  /** Reword or soften a clause: drafted as extra terms (approved clause wording is never edited). */
  "clause_wording",
  "remove_clause",
  "add_term",
  /** Rent, cheques, deposit, dates, notice periods, parties or the unit: never drafted (rule 1). */
  "money_or_dates",
  /** A question, not a change. */
  "question",
  "other",
]);
export type ChangeKind = z.infer<typeof ChangeKind>;

export const DiffPart = z.object({ op: z.enum(["same", "add", "del"]), text: z.string() });
export type DiffPart = z.infer<typeof DiffPart>;

/** The helper's checked result, stored on the request and shown to staff. */
export const ContractChangeAnalysis = z.object({
  kind: ChangeKind,
  summary: z.string().max(400),
  analysis: z.string().max(2000),
  risks: z.array(z.string().max(300)).max(6),
  /** The revised addendum (clause ids + extra terms), or null when nothing is drafted. */
  proposal: z
    .object({
      clauses: z.array(z.string()).max(MAX_ADDENDUM_CLAUSES),
      freeText: z.string().max(4000).nullable(),
    })
    .nullable(),
  /** Why nothing was drafted (money or dates, a question, a rejected draft, the model failed). */
  blocked: z.string().max(400).nullable(),
  /** Old wording against new, word by word (code). */
  diff: z.array(DiffPart),
});
export type ContractChangeAnalysis = z.infer<typeof ContractChangeAnalysis>;

const tokens = (s: string) => s.match(/^\s+|\S+\s*/g) ?? [];

/**
 * Word-level diff (longest common subsequence). Pure code: the model never writes the diff.
 * Inputs are capped at the addendum's size, so the O(n·m) table stays small.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before).slice(0, 1500);
  const b = tokens(after).slice(0, 1500);
  // Words compare without their trailing space, so "cheques." at the end matches "cheques. " mid-text.
  const ak = a.map((t) => t.trim());
  const bk = b.map((t) => t.trim());
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = ak[i] === bk[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => {
    const last = out.at(-1);
    if (last?.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ak[i] === bk[j]) {
      push("same", b[j]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push("del", a[i++]!);
    else push("add", b[j++]!);
  }
  while (i < n) push("del", a[i++]!);
  while (j < m) push("add", b[j++]!);
  return out;
}

export const MarkAnchor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), key: z.string(), label: z.string() }),
  z.object({ kind: z.literal("clause"), ref: z.string(), label: z.string() }),
  z.object({ kind: z.literal("free_text"), label: z.literal("Additional terms") }),
  /** Standard-contract body or law terms: not reworded. */
  z.object({ kind: z.literal("fixed"), label: z.string() }),
  z.object({ kind: z.literal("unknown") }),
]);
export type MarkAnchor = z.infer<typeof MarkAnchor>;

/** D72: lease terms an officer may change by marking the contract (fils and ISO dates). */
export const TermValues = z.object({
  annualRentFils: z.number().int().positive().optional(),
  depositFils: z.number().int().min(0).optional(),
  cheques: z.number().int().min(1).max(12).optional(),
  startOn: z
    .string()
    .refine((v): boolean => isCalendarDate(v), "expected a calendar date YYYY-MM-DD")
    .optional(),
  moveInOn: z
    .string()
    .refine((v): boolean => isCalendarDate(v), "expected a calendar date YYYY-MM-DD")
    .optional(),
});
export type TermValues = z.infer<typeof TermValues>;

export const MarkRewrite = z.object({
  target: z.enum(["paragraph", "free_text", "clause_remove", "clause_add", "terms"]),
  /** Paragraph key, "free_text" or clause ref. */
  key: z.string(),
  before: z.string().max(4000),
  after: z.string().max(4000),
  summary: z.string().max(300),
  author: z.enum(["ai", "officer"]),
  /**
   * D72 (target "terms"): `change` is what the officer wrote (checked against their words); `from` and `to` are the
   * values that actually change, derived ones included (deposit, end date); `problems` is what is outside the offer
   * limits (needs a leasing manager).
   */
  terms: z
    .object({
      change: TermValues,
      from: TermValues,
      to: TermValues,
      problems: z.array(z.string()).max(20).default([]),
    })
    .optional(),
});
export type MarkRewrite = z.infer<typeof MarkRewrite>;

export const ChangeMark = z.object({
  n: z.number().int().min(1).max(20),
  page: z.number().int().min(1),
  quote: z.string().min(1).max(500),
  note: z.string().min(1).max(2000),
  anchor: MarkAnchor,
  rewrite: MarkRewrite.nullable(),
  problems: z.array(z.string()).max(10),
  decision: z.enum(["apply", "keep"]).nullable(),
  keepReason: z.string().max(500).nullable(),
  officerNote: z.string().max(2000).nullable(),
});
export type ChangeMark = z.infer<typeof ChangeMark>;

export const ParagraphText = z.object({
  key: z.string(),
  /** e.g. "4.5 Maintenance" */
  label: z.string(),
  text: z.string(),
  /** Each printed blank value in the text. */
  values: z.array(z.string()),
  rewritable: z.boolean(),
  page: z.number().int().nullable(),
});
export type ParagraphText = z.infer<typeof ParagraphText>;
