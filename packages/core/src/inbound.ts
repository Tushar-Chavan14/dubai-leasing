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

export const InboundType = z.enum([
  "NOTICE_ACKNOWLEDGED",
  "RENEWAL_REPLY",
  "DOCS_UPLOADED",
  "OFFER_RESPONDED",
  "CONTRACT_SIGNED_BY",
  "MOVE_IN_ACKNOWLEDGED",
  "PAYMENT_REPLY",
  "COMPLAINT_SUBMITTED",
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
} as const;
