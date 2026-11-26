import { z } from "zod";
import { isCalendarDate } from "./dates.ts";

const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");
const fils = z.number().int().min(0);

/**
 * The terms offered to an applicant (step 4). Money is integer fils; dates are Dubai calendar
 * dates. Every value is computed by the Offer helper from company policy or entered by staff;
 * models never produce them.
 */
export const OfferTerms = z.object({
  revision: z.number().int().min(1),
  annualRentFils: fils.positive(),
  /** The unit's approved asking rent when the offer was made (reference for the limits). */
  askingRentFils: fils.positive(),
  cheques: z.number().int().min(1).max(12),
  depositFils: fils,
  rentFreeDays: z.number().int().min(0),
  moveInOn: calDate,
  startOn: calDate,
  endOn: calDate,
  reservationFils: fils,
  expiresOn: calDate,
  /** Set when the terms came from the applicant's counter-offer. */
  fromCounter: z.boolean().optional(),
});
export type OfferTerms = z.infer<typeof OfferTerms>;

/** What an applicant may propose in a counter-offer. Anything not given keeps the offered value. */
export const OfferCounter = z
  .object({
    annualRentFils: fils.positive().optional(),
    cheques: z.number().int().min(1).max(12).optional(),
    moveInOn: calDate.optional(),
  })
  .strict();
export type OfferCounter = z.infer<typeof OfferCounter>;
