import { Emirate, TermValues } from "@leasing/core";
import { z } from "zod";

export const MarksContext = z.object({
  marks: z
    .array(
      z.object({
        n: z.number().int().min(1).max(20),
        quote: z.string().max(500),
        note: z.string().max(2000),
        author: z.enum(["signer", "officer"]),
        /** The paragraph key the mark is anchored to (code knows it; the model does not own it). */
        key: z.string().optional(),
        /** What the mark points at: only "clause" (removal) and "fixed" (additional terms) change how it is answered. */
        anchor: z.enum(["paragraph", "clause", "free_text", "fixed", "unknown"]).optional(),
        /** The clause id or `cc:<uuid>` when the anchor is a clause. */
        clauseRef: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
  /** Paragraph wording as the template has it (with {{bN}} blanks), or clause / free text. */
  paragraphs: z
    .array(
      z.object({
        key: z.string(),
        raw: z.string().max(4000),
        label: z.string(),
        rewritable: z.boolean(),
        /** The paragraph prints a core record value (rent, deposit, cheques, dates, parties, unit): not removed (D72). */
        core: z.boolean().optional(),
      }),
    )
    .max(200),
  /** The contract's current additional terms (free text), the base for an additional-terms proposal. */
  freeText: z.string().max(4000).optional(),
  rules: z.object({
    renewalNoticeDays: z.number(),
    repossessionNoticeMonths: z.number(),
    lateRentDaysAfterFormalReminder: z.number(),
  }),
  emirate: Emirate,
});
export type MarksContext = z.infer<typeof MarksContext>;

export const MarksData = z.object({
  rewrites: z.array(
    z.object({ n: z.array(z.number().int()).min(1), key: z.string(), after: z.string(), summary: z.string() }),
  ),
  refused: z.array(z.object({ n: z.number().int(), reason: z.string() })),
  /** Clauses to remove (a clause-anchored mark whose note asks for it): before = the clause wording, after = "". */
  removals: z
    .array(
      z.object({
        n: z.array(z.number().int()).min(1),
        key: z.string(),
        before: z.string(),
        summary: z.string(),
        /** D72: an officer's reworded clause. The clause is removed and this sentence goes into the additional terms. */
        after: z.string().optional(),
      }),
    )
    .default([]),
  /** A new sentence for the additional terms (a mark on fixed text): after = current free text + the sentence. */
  additions: z
    .array(
      z.object({ n: z.array(z.number().int()).min(1), before: z.string(), after: z.string(), summary: z.string() }),
    )
    .default([]),
  /** D72: the paragraph code found for an officer's mark whose place was unknown (its quote is in that paragraph). */
  places: z.array(z.object({ n: z.number().int(), key: z.string() })).default([]),
  /** D72: an officer's lease-term change; every value was found in the officer's words by code. */
  terms: z
    .array(z.object({ n: z.array(z.number().int()).min(1), changes: TermValues, summary: z.string() }))
    .default([]),
});
export type MarksData = z.infer<typeof MarksData>;

/** The model's answer. Code checks every rewrite before it is kept. */
export const ModelMarks = z.object({
  rewrites: z
    .array(
      z.object({
        n: z.array(z.number().int()).min(1).max(20),
        key: z.string().trim().min(1).max(200),
        after: z.string().trim().min(1).max(4000),
        summary: z.string().trim().min(1).max(300),
      }),
    )
    .max(20)
    .default([]),
  refused: z
    .array(z.object({ n: z.number().int(), reason: z.string().trim().min(1).max(400) }))
    .max(20)
    .default([]),
  removeClauses: z.array(z.number().int()).max(20).default([]),
  /** D72: an officer's removal of a clause or paragraph; `key` is where the model found the words (code checks it). */
  removals: z
    .array(z.object({ n: z.array(z.number().int()).min(1).max(20), key: z.string().trim().max(200).default("") }))
    .max(20)
    .default([]),
  additionalTerms: z
    .array(z.object({ n: z.array(z.number().int()).min(1).max(20), text: z.string().trim().min(1).max(600) }))
    .max(20)
    .default([]),
  /** D72: an officer's change of lease terms (fils, ISO dates). Code keeps a value only if the officer wrote it. */
  termChanges: z
    .array(
      z.object({
        n: z.array(z.number().int()).min(1).max(20),
        changes: TermValues,
        summary: z.string().trim().max(300).default("Changes the lease terms."),
      }),
    )
    .max(20)
    .default([]),
});
export type ModelMarks = z.infer<typeof ModelMarks>;
