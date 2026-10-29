export type * from "./channel/types.ts";
export { FakeChannelSender, inlineKeyboard, TelegramSender } from "./channel/telegram.ts";
export { FakeEjari } from "./ejari/fake.ts";
export { HttpEjariClient } from "./ejari/http.ts";
export { EjariUnavailableError } from "./ejari/types.ts";
export type * from "./ejari/types.ts";
export type * from "./esign/types.ts";
export { FakeMailer, type MailConfig, NodemailerMailer } from "./mail/nodemailer.ts";
export {
  contractSignedEmail,
  contractSignEmail,
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
  documentsChaseEmail,
} from "./mail/templates.ts";
export type * from "./mail/types.ts";
export { type PdfBlock, renderPdf } from "./pdf/render.ts";
export { PdfLogoError, type PdfLogo, type PdfLook, renderStyledPdf, type StyledBlock } from "./pdf/styled.ts";
export { appendSignatureRecord, type SignatureRecord } from "./pdf/signature.ts";
export { type ImageType, LocalDiskStore, sniffImage } from "./storage/local.ts";
export { stripImageMetadata } from "./storage/strip.ts";
export type * from "./storage/types.ts";
