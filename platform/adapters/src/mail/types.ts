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
