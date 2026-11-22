/**
 * The words the shared KYC reader uses (S4): its helper name, who the documents belong to, who asked for them, and
 * what each document is. Leasing passes nothing and gets `leasingKycProfile`, so its prompts and results stay the same;
 * another module (SPA, P6) passes its own. A profile holds wording only: the code checks never come from it.
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
}

export const leasingKycProfile: KycProfile = Object.freeze({
  helperName: "kyc",
  orgNoun: "leasing company",
  partyNoun: "applicant",
  documents: Object.freeze({
    emirates_id_front: "the front of an identity card",
    emirates_id_back: "the back of an identity card",
    passport: "a passport data page with a two-line machine-readable zone (MRZ) at the bottom",
    visa: "a residence permit / visa",
    trade_licence: "a commercial trade licence",
  }),
  documentLabels: Object.freeze({
    emirates_id: "Emirates ID",
    passport: "passport",
    visa: "visa",
    trade_licence: "trade licence",
  }),
  mrzKeys: Object.freeze(["passport"]),
});
