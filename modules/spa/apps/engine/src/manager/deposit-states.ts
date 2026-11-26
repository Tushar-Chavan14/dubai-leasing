/** States in which the deposit may still be recorded: before signing is complete (S18); never during an AML hold (S40 amendment: no tipping-off, no money moves). */
export const RECORDABLE = new Set(["OFFER_AGREED", "PARTY_CHECK", "AGREEMENT_DRAFT", "LEGAL_REVIEW", "SIGNING"]);
