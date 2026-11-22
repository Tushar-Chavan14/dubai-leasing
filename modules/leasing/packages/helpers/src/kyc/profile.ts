import type { KycProfile } from "@platform/readers/kyc/profile";

export type { KycProfile };

/** Leasing's KYC wording (S4): what its prompts and flag messages have always said. */
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
  aiCheckSubject: "a leasing company set for tenant documents",
});
