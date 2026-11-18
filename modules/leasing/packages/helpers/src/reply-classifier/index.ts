import { commentClassifier } from "./generic.ts";
import {
  CRITERIA,
  INTENTS,
  MOVE_IN_CRITERIA,
  MOVE_IN_INTENTS,
  OFFER_CRITERIA,
  OFFER_INTENTS,
  PAYMENT_CRITERIA,
  PAYMENT_INTENTS,
} from "./prompt.ts";

export { commentClassifier, commentQuestions, commentState } from "./generic.ts";

/**
 * Renewal reply comment (step 9): the tenant pressed Renew, Move out or Discuss; tev1 reads the
 * comment. The Manager decides what to do with the result.
 */
const renewal = commentClassifier({
  name: "reply_classifier",
  situation: "A tenant replied to a lease renewal notice.",
  author: "tenant",
  choices: ["renew", "vacate", "discuss"],
  intents: INTENTS,
  criteria: CRITERIA,
  match: { renew: ["renew"], vacate: ["vacate"], discuss: ["negotiate", "needs_time", "other"] },
  escalate: ["complaint"],
});
export const ReplyContext = renewal.Context;
export type ReplyContext = typeof ReplyContext._output;
export const ReplyData = renewal.Data;
export type ReplyData = typeof ReplyData._output;
export const replyClassifier = renewal.helper;

/**
 * Offer reply comment (step 4): the applicant pressed Accept, Counter or Decline. A question or
 * complaint always goes to a person; a comment that contradicts the button too.
 */
const offer = commentClassifier({
  name: "offer_reply_classifier",
  situation: "An applicant answered a rental offer for an apartment.",
  author: "applicant",
  choices: ["accept", "counter", "decline"],
  intents: OFFER_INTENTS,
  criteria: OFFER_CRITERIA,
  match: { accept: ["accept"], counter: ["counter", "needs_time"], decline: ["decline"] },
  escalate: ["complaint", "question"],
  detectQuestion: true,
});
export const OfferReplyContext = offer.Context;
export type OfferReplyContext = typeof OfferReplyContext._output;
export const OfferReplyData = offer.Data;
export type OfferReplyData = typeof OfferReplyData._output;
export const offerReplyClassifier = offer.helper;

/**
 * Payment reply comment (step 8). Replies never change amounts or dates; hardship, disputes,
 * complaints and questions always go to a person.
 */
const payment = commentClassifier({
  name: "payment_reply_classifier",
  situation: "A tenant replied to a reminder about an unpaid rent instalment.",
  author: "tenant",
  choices: ["paid", "will_pay", "dispute", "need_time"],
  intents: PAYMENT_INTENTS,
  criteria: PAYMENT_CRITERIA,
  match: { paid: ["paid"], will_pay: ["will_pay"], dispute: ["dispute"], need_time: ["needs_time", "hardship"] },
  escalate: ["complaint", "hardship", "dispute"],
  detectQuestion: true,
});
export const PaymentReplyContext = payment.Context;
export type PaymentReplyContext = typeof PaymentReplyContext._output;
export const PaymentReplyData = payment.Data;
export type PaymentReplyData = typeof PaymentReplyData._output;
export const paymentReplyClassifier = payment.helper;

/** Move-in report comment (step 7): anything but a plain "agree" goes to an officer. */
const moveIn = commentClassifier({
  name: "move_in_comment_classifier",
  situation: "A new tenant confirmed or disputed the move-in condition report of their home.",
  author: "tenant",
  choices: ["agree", "disagree"],
  intents: MOVE_IN_INTENTS,
  criteria: MOVE_IN_CRITERIA,
  match: { agree: ["agrees"], disagree: ["damage_found", "missing_item", "complaint"] },
  escalate: ["damage_found", "missing_item", "complaint"],
  detectQuestion: true,
});
export const MoveInCommentContext = moveIn.Context;
export type MoveInCommentContext = typeof MoveInCommentContext._output;
export const MoveInCommentData = moveIn.Data;
export type MoveInCommentData = typeof MoveInCommentData._output;
export const moveInCommentClassifier = moveIn.helper;
