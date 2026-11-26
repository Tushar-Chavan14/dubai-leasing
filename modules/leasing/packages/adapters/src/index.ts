/**
 * `@leasing/adapters`: leasing's own edges (Ejari, the Telegram enquiry channel, leasing email wording). The generic
 * ones moved to `@platform/adapters` (S34) and are re-exported here so leasing imports stay the same.
 */
export * from "@platform/adapters";
export type * from "./channel/types.ts";
export { FakeChannelSender, inlineKeyboard, TelegramSender } from "./channel/telegram.ts";
export { FakeEjari } from "./ejari/fake.ts";
export { HttpEjariClient } from "./ejari/http.ts";
export { EjariUnavailableError } from "./ejari/types.ts";
export type * from "./ejari/types.ts";
export {
  contractSignedEmail,
  contractSignEmail,
  contractSignPausedEmail,
  documentsRequestEmail,
  ejariIssuedEmail,
  formatDubaiDateTime,
  offerAcceptedEmail,
  offerEmail,
  renewalNoticeEmail,
  replyReceivedEmail,
  type ViewingInvitationMail,
  viewingInvitationEmail,
  complaintAckEmail,
  formalReminderEmail,
  moveInEmail,
  moveOutEmail,
  depositStatementEmail,
  rentFriendlyEmail,
  rentReminderEmail,
  staffMessageEmail,
  applicantMessageEmail,
  viewingReminderEmail,
  noShowFollowupEmail,
  counterDeclinedEmail,
  offerExpiredEmail,
  documentsChaseEmail,
} from "./mail/templates.ts";
