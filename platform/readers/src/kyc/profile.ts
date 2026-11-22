import type { z } from "zod";

/**
 * The words the shared KYC reader uses (S4): its helper name, who the documents belong to, who asked for them, and
 * what each document is. Leasing passes `leasingKycProfile` (its default, so its prompts and results stay the same);
 * SPA passes its own (S49). A profile holds wording only: the code checks never come from it.
 */
export interface KycProfile {
  /** Helper name in the run record and the activity log. */
  helperName: string;
  /** Who set up the form, as a custom document prompt names it ("a document the leasing company calls ..."). */
  orgNoun: string;
  /** Whose documents they are, in flag messages ("differs from the applicant's"). */
  partyNoun: string;
  /** What each read key's image should be, for the prompt ("the front of an identity card"). */
  documents: Readonly<Record<string, string>>;
  /** A document kind's name in the activity log and in "Reading the ... timed out" (by document kind, not side). */
  documentLabels: Readonly<Record<string, string>>;
  /** Read keys whose prompt asks for the two machine-readable lines, character for character. */
  mrzKeys: readonly string[];
  /** Who set the plain-English rules, in the AI-check prompt ("You check one rule <subject>"). */
  aiCheckSubject: string;
  /**
   * Document kinds beyond the built-in ones (S49): a Zod schema per read key, as the model must answer. Each answer has
   * `documentType` (the read key when it is the right document, else `other`), `holderName` and `issueDate`, each a
   * `ReadField`. Upload these as kind `extra` with the read key in `fieldKey`.
   */
  extraReads?: Readonly<Record<string, z.ZodType<Record<string, unknown>>>>;
  /**
   * What makes a person's document set complete when the form doesn't say. `resident_set` (default): both sides of the
   * Emirates ID, or the passport and the residence visa. `any_id`: the passport, or both sides of the Emirates ID.
   */
  personDocs?: PersonDocs;
}

export type PersonDocs = "resident_set" | "any_id";
