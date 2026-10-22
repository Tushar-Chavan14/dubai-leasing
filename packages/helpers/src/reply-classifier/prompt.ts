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

/** Payment reply comment (step 8): the tenant pressed Paid, Will pay, Dispute or Need time. */
export const PAYMENT_INTENTS = [
  "paid",
  "will_pay",
  "dispute",
  "needs_time",
  "hardship",
  "complaint",
  "other",
  "none",
] as const;
export type PaymentIntent = (typeof PAYMENT_INTENTS)[number];

export const PAYMENT_CRITERIA: Record<PaymentIntent, string> = {
  paid: "Says the rent was already paid or transferred",
  will_pay: "Promises to pay, possibly by a date",
  dispute: "Disputes the amount, the charge or that it is owed",
  needs_time: "Asks for more time or an instalment plan",
  hardship: "Describes financial hardship, job loss, illness or an emergency",
  complaint: "Raises a problem with the property or the landlord",
  other: "Something else that needs a person",
  none: "None of the above, or the comment is empty or unclear",
};

/** Move-in report comment (step 7): the tenant pressed Agree or Disagree. */
export const MOVE_IN_INTENTS = ["agrees", "damage_found", "missing_item", "complaint", "other", "none"] as const;
export type MoveInIntent = (typeof MOVE_IN_INTENTS)[number];

export const MOVE_IN_CRITERIA: Record<MoveInIntent, string> = {
  agrees: "Confirms the report as it is",
  damage_found: "Points out damage, dirt or defects not in the report",
  missing_item: "Says something is missing (keys, cards, appliances, furniture)",
  complaint: "Raises a problem with the property or the landlord",
  other: "Something else that needs a person",
  none: "None of the above, or the comment is empty or unclear",
};
