import type { DealState } from "./state/index.ts";
import type { StepKey } from "./steps.ts";

/**
 * The words a buyer or seller reads about their own deal (S24, S61). Fixed text: no model writes it. A compliance hold
 * reads "Under review" like every other non-compliance screen (S42, S57); nothing here names a check, a list or a risk.
 * The party assistant's answers take their state words from here, and a test keeps every line free of banned words.
 */
export const PARTY_STATE_WORDS: Readonly<Record<DealState, string>> = Object.freeze({
  OFFER_AGREED: "Offer accepted. Your agent is arranging the next steps.",
  PARTY_CHECK: "We are checking the details and documents of everyone in this purchase.",
  AML_HOLD: "Under review",
  AGREEMENT_DRAFT: "The agreement is being prepared.",
  LEGAL_REVIEW: "The agreement is waiting for approval before it goes out for signing.",
  SIGNING: "The agreement is ready to sign. Each person signs in turn.",
  REGISTRATION: "The agreement is being registered.",
  NOC: "Waiting for the developer's no objection certificate.",
  FINANCE: "Waiting for the banks.",
  SETTLEMENT: "The settlement statement is being prepared.",
  TRANSFER: "The transfer of ownership is being arranged.",
  INSTALMENTS: "Payments are following the agreed plan.",
  HANDED_OVER: "Handed over.",
  COMPLETED: "Completed.",
  CANCELLED: "This purchase has been cancelled.",
});

/** `explain_step`: what each step is, in plain words and without any date or amount. */
export const PARTY_GLOSSARY: Readonly<Record<StepKey, string>> = Object.freeze({
  offer: "Offer accepted: the seller and buyer have agreed the price and terms. Your agent takes it from here.",
  parties:
    "Checking parties: the agent checks the identity documents of the buyer and the seller, and for a company its licence and signatory.",
  agreement:
    "Preparing the agreement: the sale agreement is filled in from the agreed terms using the company's approved template.",
  legal: "Legal approval: the company's legal team reads the agreement before anyone is asked to sign it.",
  signing:
    "Signing: every buyer and seller receives a link by email, reads the agreement and signs by typing their name.",
  noc: "Developer NOC: for a resale, the developer confirms in a no objection certificate that the property can be transferred.",
  finance: "Banks: when a mortgage is involved, the banks confirm the amounts needed to release and complete the sale.",
  settlement:
    "Settlement statement: a statement of who pays and receives what at transfer, prepared and approved by the finance team.",
  registration:
    "Oqood registration: the sale agreement of an off-plan property is registered with the land department.",
  transfer:
    "Transfer: ownership moves to the buyer at the land department or a trustee office, with everyone invited on the day.",
  instalments: "Instalments: the buyer pays the agreed payment plan on its due dates.",
});

/**
 * Words a party-facing answer must never contain (S24, S61): the party assistant's output guard replaces any reply or
 * tool result that matches with a fixed line. Whole words only, with the usual endings.
 */
export const PARTY_BANNED_PATTERN =
  /\b(?:aml|anti[-\s]?money|sanction\w*|screening|screened|pep|peps|edd|risks?|risky|flag\w*|report\w*|compliance|launder\w*|suspicious)\b/i;
export const partyBanned = (text: string): boolean => PARTY_BANNED_PATTERN.test(text);
