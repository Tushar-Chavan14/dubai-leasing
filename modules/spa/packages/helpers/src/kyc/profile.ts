import { ReadField } from "@platform/readers/kyc/schema";
import type { KycProfile } from "@platform/readers/kyc/profile";
import { z } from "zod";

/**
 * What a proof of address must show (S49): which document it really is, whose name it carries and when it was issued.
 * Code decides the rest: the name comparison, the age limit and the severities come from the role's published config.
 */
export const ProofOfAddressRead = z.object({
  documentType: z.enum([
    "proof_of_address",
    "passport",
    "identity_card_front",
    "identity_card_back",
    "residence_visa",
    "trade_licence",
    "other",
  ]),
  holderName: ReadField.describe("the person's name exactly as printed (null if not visible) and your confidence 0–1"),
  address: ReadField.describe("the address exactly as printed, and your confidence 0–1"),
  issueDate: ReadField.describe("the date of the document exactly as printed, and your confidence 0–1"),
});

/**
 * The words the shared KYC reader uses for SPA parties (S49, specs step 2): buyer, seller and beneficial-owner
 * documents. A passport alone is a complete set (a buyer abroad has no visa). Company documents, title deeds and
 * powers of attorney are read in C20.
 */
export const spaKycProfile: KycProfile = Object.freeze({
  helperName: "spa_kyc",
  orgNoun: "sales brokerage",
  partyNoun: "party",
  documents: Object.freeze({
    emirates_id_front: "the front of an identity card",
    emirates_id_back: "the back of an identity card",
    passport: "a passport data page with a two-line machine-readable zone (MRZ) at the bottom",
    visa: "a residence permit / visa",
    proof_of_address:
      "a proof of address: a utility bill, bank statement or tenancy contract showing the person's name and address",
  }),
  documentLabels: Object.freeze({
    emirates_id: "Emirates ID",
    passport: "passport",
    visa: "visa",
    proof_of_address: "proof of address",
  }),
  mrzKeys: Object.freeze(["passport"]),
  aiCheckSubject: "a sales brokerage set for buyer and seller documents",
  extraReads: Object.freeze({ proof_of_address: ProofOfAddressRead }),
  personDocs: "any_id",
});
