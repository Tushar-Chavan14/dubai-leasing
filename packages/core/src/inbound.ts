import { z } from "zod";
import { ContractSignature } from "./contract.ts";
import { OfferCounter } from "./offer.ts";

/** Tenant portal submissions (architecture §8a). Structured fields are trusted as typed; free text goes to the decision model. */
export const NoticeAcknowledged = z.object({}).strict();

export const RenewalReply = z
  .object({
    choice: z.enum(["renew", "vacate", "discuss"]),
    comment: z.string().trim().max(2000).optional(),
    /** Portal: the tenant ticked "I won't renew" (required there for a move-out). */
    confirmVacate: z.literal(true).optional(),
  })
  .strict();
export type RenewalReply = z.infer<typeof RenewalReply>;

/** The applicant finished uploading ID documents and asks for them to be checked (step 3). */
export const DocsUploaded = z.object({ documentIds: z.array(z.uuid()).min(1).max(10) }).strict();
export type DocsUploaded = z.infer<typeof DocsUploaded>;

/** The applicant's answer to an offer (step 4): buttons are trusted as typed, the comment is classified. */
export const OfferResponded = z
  .object({
    revision: z.number().int().min(1),
    choice: z.enum(["accept", "counter", "decline"]),
    counter: OfferCounter.optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((p) => p.choice !== "counter" || (p.counter && Object.keys(p.counter).length > 0), {
    message: "a counter-offer needs at least one changed term",
    path: ["counter"],
  });
export type OfferResponded = z.infer<typeof OfferResponded>;

/** The tenant confirms the move-in condition report (step 7), with their own photos if they like. */
export const MoveInAcknowledged = z
  .object({
    agree: z.boolean(),
    comment: z.string().trim().max(2000).optional(),
    photoIds: z.array(z.uuid()).max(20).default([]),
  })
  .strict();
export type MoveInAcknowledged = z.infer<typeof MoveInAcknowledged>;

/** The tenant answers a rent reminder (step 8). Buttons are trusted as typed; the comment is classified. */
export const PaymentReply = z
  .object({
    paymentId: z.uuid(),
    choice: z.enum(["paid", "will_pay", "dispute", "need_time"]),
    /** "Will pay by" (calendar date, Dubai). */
    payBy: z.iso.date().optional(),
    comment: z.string().trim().max(2000).optional(),
    proofIds: z.array(z.uuid()).max(3).default([]),
  })
  .strict()
  .refine((p) => p.choice !== "will_pay" || !!p.payBy, { message: "say when you will pay", path: ["payBy"] });
export type PaymentReply = z.infer<typeof PaymentReply>;

/** The tenant reports an issue (step 8). The description is tenant-written: classified, never obeyed. */
export const ComplaintSubmitted = z
  .object({
    description: z.string().trim().min(5).max(2000),
    room: z.string().trim().max(60).optional(),
    /** "Is anyone at risk?" ticked: escalated at once, whatever the model says. */
    atRisk: z.boolean(),
    photoIds: z.array(z.uuid()).max(5).default([]),
  })
  .strict();
export type ComplaintSubmitted = z.infer<typeof ComplaintSubmitted>;

/**
 * Step 10: the tenant gives notice that they will move out. The portal offers only the lease end
 * date; any other date is an early-termination request a person handles (contractual, not automatic).
 */
export const VacateNotice = z
  .object({
    moveOutOn: z.iso.date(),
    comment: z.string().trim().max(2000).optional(),
    /** The tenant ticked "I am giving notice that I will move out" (required). */
    confirmVacate: z.literal(true),
  })
  .strict();
export type VacateNotice = z.infer<typeof VacateNotice>;

/** Step 10: the tenant picks a move-out inspection slot (an instant offered by the portal). */
export const InspectionBooked = z.object({ slotAt: z.iso.datetime({ offset: true }) }).strict();
export type InspectionBooked = z.infer<typeof InspectionBooked>;

/**
 * Step 10: the tenant's answer to the deposit statement. Accept gives the refund account; Dispute
 * gives a reason (tenant-written: classified, never obeyed). Neither changes an amount.
 */
export const DepositResponse = z
  .object({
    revision: z.number().int().min(1),
    choice: z.enum(["accept", "dispute"]),
    accountName: z.string().trim().min(2).max(120).optional(),
    iban: z
      .string()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "enter a valid IBAN"))
      .optional(),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((p) => p.choice !== "accept" || (!!p.accountName && !!p.iban), {
    message: "give the account name and IBAN for the refund",
    path: ["iban"],
  })
  .refine((p) => p.choice !== "dispute" || (p.reason?.length ?? 0) >= 5, {
    message: "tell us what you disagree with",
    path: ["reason"],
  });
export type DepositResponse = z.infer<typeof DepositResponse>;

export const InboundType = z.enum([
  "NOTICE_ACKNOWLEDGED",
  "RENEWAL_REPLY",
  "DOCS_UPLOADED",
  "OFFER_RESPONDED",
  "CONTRACT_SIGNED_BY",
  "MOVE_IN_ACKNOWLEDGED",
  "PAYMENT_REPLY",
  "COMPLAINT_SUBMITTED",
  "VACATE_NOTICE",
  "INSPECTION_BOOKED",
  "DEPOSIT_RESPONSE",
]);
export type InboundType = z.infer<typeof InboundType>;

export const inboundPayloads = {
  NOTICE_ACKNOWLEDGED: NoticeAcknowledged,
  RENEWAL_REPLY: RenewalReply,
  DOCS_UPLOADED: DocsUploaded,
  OFFER_RESPONDED: OfferResponded,
  /** A signer signed the contract in the portal (recorded at once as evidence; see manager/contracts.ts). */
  CONTRACT_SIGNED_BY: ContractSignature,
  MOVE_IN_ACKNOWLEDGED: MoveInAcknowledged,
  PAYMENT_REPLY: PaymentReply,
  COMPLAINT_SUBMITTED: ComplaintSubmitted,
  VACATE_NOTICE: VacateNotice,
  INSPECTION_BOOKED: InspectionBooked,
  DEPOSIT_RESPONSE: DepositResponse,
} as const;
