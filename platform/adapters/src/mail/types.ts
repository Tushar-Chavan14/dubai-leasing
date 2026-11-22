import { createHash } from "node:crypto";
/**
 * Outbound email (architecture §8). The engine records each send in `outbound_messages`
 * (recipient, body hash, attachment hashes, message id, SMTP response) as evidence.
 */
export type MailPurpose = "notice" | "formal_reminder" | "reminder" | "offer" | "link" | "receipt";

export interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  /** Extra headers, e.g. a stable reference for threading. */
  headers?: Record<string, string>;
}

export interface MailReceipt {
  messageId: string;
  /** Who the SMTP server accepted (in demo mode this is the redirect inbox). */
  accepted: string[];
  rejected: string[];
  response: string;
  /** The address actually used (after any demo redirect). */
  deliveredTo: string;
  /** Ethereal only: where to view the message. */
  previewUrl?: string;
}

export interface Mailer {
  send(m: OutgoingMail): Promise<MailReceipt>;
}

export interface MailEvidence {
  bodySha256: string;
  attachmentSha256s: string[];
  messageId: string;
  smtpResponse: string;
  previewUrl: string | null;
}

const sha256 = (d: string | Uint8Array): string => createHash("sha256").update(d).digest("hex");

/**
 * What an outbound-message row keeps as evidence (rule 10): the hash of the text and html bodies (the same formula
 * leasing has always used), the hash of each attachment, and the mail server's answer.
 */
export function mailEvidence(mail: OutgoingMail, receipt: MailReceipt): MailEvidence {
  return {
    bodySha256: sha256(`${mail.text}\n${mail.html}`),
    attachmentSha256s: (mail.attachments ?? []).map((a) => sha256(a.content)),
    messageId: receipt.messageId,
    smtpResponse: receipt.response,
    previewUrl: receipt.previewUrl ?? null,
  };
}
