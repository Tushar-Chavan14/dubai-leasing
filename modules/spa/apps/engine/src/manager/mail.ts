import { type MailAttachment, mailEvidence } from "@platform/adapters";
import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { type OutboundPurpose, outboundMessages } from "@spa/db";
import type { SpaMailParts } from "@spa/helpers";
import { and, eq, or, sql } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { unavailable } from "./errors.ts";

/** An error text keeps no ID or phone number (rule 8) and no address. */
export const scrub = (t: string): string => maskPiiText(t).replace(/[^\s<>"']+@[^\s<>"']+/g, "[email]");

/** A `sending` row this old is a worker that died mid-send: it may be claimed again (S54 amendment). */
export const STALE_MAIL_CLAIM_MINUTES = 15;

export interface SpaMailInput {
  entityKind: string;
  entityId: string;
  purpose: OutboundPurpose;
  /** Names this mail among the entity's mails of the purpose (`link:1`, `remind:2`): the claim's unique key. */
  milestone: string;
  to: string;
  parts: SpaMailParts;
  attachments?: MailAttachment[];
}
export type SpaMailResult = { outboundId: string; status: "sent" | "failed" | "skipped" };

/**
 * Sends one email and stores it as evidence (rule 10, S54). The row for (entity, purpose, milestone) is claimed first,
 * so a mail that was sent or is being sent is never sent again; a failed one is tried again, and so is one stuck in
 * `sending` past the timeout (a worker that died mid-send). SMTP runs outside the
 * claim's transaction. The row keeps the body's hash, never the body, so a link in it is not stored. Pure code: no model.
 */
export async function sendSpaMail(ctx: SpaContext, m: SpaMailInput): Promise<SpaMailResult> {
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so nothing can be sent");
  const mailer = ctx.mail.mailer;
  const db = ctx.database.db;
  const key = and(
    eq(outboundMessages.entityId, m.entityId),
    eq(outboundMessages.purpose, m.purpose),
    eq(outboundMessages.milestone, m.milestone),
  );
  const id = newId();
  const claimed = await db
    .insert(outboundMessages)
    .values({
      id,
      entityKind: m.entityKind,
      entityId: m.entityId,
      purpose: m.purpose,
      milestone: m.milestone,
      toEmail: m.to,
      intendedTo: m.to,
      template: m.parts.template,
      templateVersion: m.parts.version,
      subject: m.parts.subject,
      status: "sending",
      createdAt: ctx.clock.now(),
      claimedAt: ctx.clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: outboundMessages.id });
  let outboundId = claimed[0]?.id;
  if (!outboundId) {
    // A failed mail, or one stuck in `sending` past the timeout, is claimed again (one retry at a time: the update
    // re-reads the row, so a second worker finds the fresh claim time). A sent or recently claimed one is left alone.
    const now = ctx.clock.now();
    const cutoff = new Date(now.getTime() - (ctx.mail.staleClaimMinutes ?? STALE_MAIL_CLAIM_MINUTES) * 60_000);
    const retry = await db
      .update(outboundMessages)
      .set({ status: "sending", error: null, claimedAt: now })
      .where(
        and(
          key,
          or(
            eq(outboundMessages.status, "failed"),
            and(
              eq(outboundMessages.status, "sending"),
              sql`coalesce(${outboundMessages.claimedAt}, ${outboundMessages.createdAt}) < ${cutoff.toISOString()}::timestamptz`,
            ),
          ),
        ),
      )
      .returning({ id: outboundMessages.id });
    if (!retry[0]) {
      const [existing] = await db.select({ id: outboundMessages.id }).from(outboundMessages).where(key);
      return { outboundId: existing!.id, status: "skipped" };
    }
    outboundId = retry[0].id;
  }
  const out = {
    to: m.to,
    subject: m.parts.subject,
    text: m.parts.text,
    html: m.parts.html,
    ...(m.attachments ? { attachments: m.attachments } : {}),
  };
  const fail = async (error: string, extra: Partial<typeof outboundMessages.$inferInsert> = {}) => {
    await db
      .update(outboundMessages)
      .set({ status: "failed", error: scrub(error), ...extra })
      .where(eq(outboundMessages.id, outboundId!));
    return { outboundId: outboundId!, status: "failed" as const };
  };
  let receipt;
  try {
    receipt = await mailer.send(out);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const ev = mailEvidence(out, receipt);
  if (!receipt.accepted.length)
    return fail(`recipient not accepted by the mail server: ${receipt.response}`, {
      messageId: ev.messageId,
      smtpResponse: ev.smtpResponse,
      bodySha256: ev.bodySha256,
      attachmentSha256s: ev.attachmentSha256s,
    });
  await db
    .update(outboundMessages)
    .set({
      status: "sent",
      toEmail: receipt.deliveredTo,
      bodySha256: ev.bodySha256,
      attachmentSha256s: ev.attachmentSha256s,
      messageId: ev.messageId,
      smtpResponse: ev.smtpResponse,
      previewUrl: ev.previewUrl,
      sentAt: ctx.clock.now(),
    })
    .where(eq(outboundMessages.id, outboundId));
  return { outboundId, status: "sent" };
}
