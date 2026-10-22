import { commentState } from "./generic.ts";

/** Renewal reply comment: what tev1 may answer. Always includes `none`. */
export const INTENTS = ["renew", "vacate", "negotiate", "needs_time", "complaint", "other", "none"] as const;
export type Intent = (typeof INTENTS)[number];

export const CRITERIA: Record<Intent, string> = {
  renew: "Wants to renew or accepts the offered terms",
  vacate: "Plans to move out or not renew",
  negotiate: "Wants to discuss or change the rent or terms",
  needs_time: "Needs more time to decide",
  complaint: "Raises a problem with the property or the landlord",
  other: "Something else that needs a person",
  none: "None of the above, or the comment is empty or unclear",
};

/** Short state text for a renewal reply; the comment is quoted as data. */
export const stateText = (choice: string, comment: string) => commentState("tenant", choice, comment);

/** Offer reply comment (step 4). */
export const OFFER_INTENTS = [
  "accept",
  "counter",
  "decline",
  "question",
  "needs_time",
  "complaint",
  "other",
  "none",
] as const;
export type OfferIntent = (typeof OFFER_INTENTS)[number];

export const OFFER_CRITERIA: Record<OfferIntent, string> = {
  accept: "Accepts the offered terms",
  counter: "Asks for different rent, cheques, move-in date or other terms",
  decline: "Does not want the unit",
  question: "Asks a question that a person needs to answer",
  needs_time: "Needs more time to decide",
  complaint: "Raises a problem or complaint",
  other: "Something else that needs a person",
  none: "None of the above, or the comment is empty or unclear",
};
