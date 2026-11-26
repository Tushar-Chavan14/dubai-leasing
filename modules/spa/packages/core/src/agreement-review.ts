/**
 * `agreement-review` (C25, S22, S60): flags for legal on one prepared agreement. Advice only: a flag never edits, approves
 * or blocks the agreement, and every flag quotes words that exist in the agreement or in the offer's conditions.
 */
export const AGREEMENT_FLAG_KINDS = ["conflict", "unknown_amount", "unknown_date", "instruction_like"] as const;
export type AgreementFlagKind = (typeof AGREEMENT_FLAG_KINDS)[number];

export interface AgreementFlag {
  kind: AgreementFlagKind;
  /** Words that exist in the agreement or the conditions (the quote guard drops any flag whose quote doesn't). */
  quote: string;
  note: string;
  /** Where the quote was found. */
  in: "agreement" | "conditions";
  /** Who raised it: the model, or a code rule (stray values, the instruction scan). */
  source: "model" | "code";
}

/** At most this many flags from the model, and a note at most this long (S60). */
export const AGREEMENT_REVIEW_MAX_FLAGS = 20;
export const AGREEMENT_NOTE_MAX = 200;
