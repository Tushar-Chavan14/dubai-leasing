import { createTestAccount, createTransport, getTestMessageUrl, type Transporter } from "nodemailer";
import type { MailReceipt, Mailer, OutgoingMail } from "./types.ts";

export interface MailConfig {
  transport: "smtp" | "ethereal";
  host?: string | undefined;
  port: number;
  secure: boolean;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
  /**
   * Demo mode: every message goes to this inbox instead of its recipient (demo tenants are
   * fictional). The intended recipient is kept in the subject and an X-Intended-Recipient header.
   */
  demoRecipient?: string | undefined;
}

/** Nodemailer over SMTP, or a throwaway Ethereal inbox for development. */
export class NodemailerMailer implements Mailer {
  private transporter: Promise<Transporter>;
  constructor(private readonly cfg: MailConfig) {
    this.transporter = this.connect();
  }

  private async connect(): Promise<Transporter> {
    if (this.cfg.transport === "ethereal") {
      const acct = await createTestAccount();
      return createTransport({
        host: acct.smtp.host,
        port: acct.smtp.port,
        secure: acct.smtp.secure,
        auth: { user: acct.user, pass: acct.pass },
      });
    }
    if (!this.cfg.host) throw new Error("SMTP_HOST is not set");
    return createTransport({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      ...(this.cfg.user ? { auth: { user: this.cfg.user, pass: this.cfg.pass ?? "" } } : {}),
    });
  }

  async send(m: OutgoingMail): Promise<MailReceipt> {
    const t = await this.transporter;
    const to = this.cfg.demoRecipient ?? m.to;
    const subject = this.cfg.demoRecipient ? `[Demo, for ${m.to}] ${m.subject}` : m.subject;
    const info = await t.sendMail({
      from: this.cfg.from,
      to,
      subject,
      text: m.text,
      html: m.html,
      headers: { ...m.headers, ...(this.cfg.demoRecipient ? { "X-Intended-Recipient": m.to } : {}) },
      attachments: (m.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    });
    const preview = this.cfg.transport === "ethereal" ? getTestMessageUrl(info) : false;
    return {
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map(addressOf),
      rejected: (info.rejected ?? []).map(addressOf),
      response: info.response ?? "",
      deliveredTo: to,
      ...(preview ? { previewUrl: preview } : {}),
    };
  }
}

/** Nodemailer reports recipients as strings or `{ address }` objects. */
const addressOf = (a: unknown) =>
  typeof a === "object" && a !== null && "address" in a ? String((a as { address: unknown }).address) : String(a);

/** Test double: keeps sent messages in memory; can be told to fail or to reject the recipient. */
export class FakeMailer implements Mailer {
  sent: (OutgoingMail & { deliveredTo: string })[] = [];
  failNext: Error | null = null;
  /** The next send gets an SMTP answer that rejects the recipient. */
  rejectNext = false;
  /** Runs while the message is "on the wire" (e.g. to move a test clock past midnight). */
  onSend: (() => void) | null = null;
  constructor(private readonly demoRecipient?: string) {}
  async send(m: OutgoingMail): Promise<MailReceipt> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.onSend?.();
    const deliveredTo = this.demoRecipient ?? m.to;
    if (this.rejectNext) {
      this.rejectNext = false;
      return {
        messageId: "<fake-rejected@test>",
        accepted: [],
        rejected: [deliveredTo],
        response: "550 5.1.1 mailbox unavailable",
        deliveredTo,
      };
    }
    this.sent.push({ ...m, deliveredTo });
    return {
      messageId: `<fake-${this.sent.length}@test>`,
      accepted: [deliveredTo],
      rejected: [],
      response: "250 2.0.0 OK fake",
      deliveredTo,
    };
  }
}
