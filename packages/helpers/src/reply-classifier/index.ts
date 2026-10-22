import { commentClassifier } from "./generic.ts";
import { CRITERIA, INTENTS, OFFER_CRITERIA, OFFER_INTENTS } from "./prompt.ts";

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
