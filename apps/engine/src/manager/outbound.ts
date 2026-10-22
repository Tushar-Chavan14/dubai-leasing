import { renderPdf, renewalNoticeEmail } from "@leasing/adapters";
import { addDays, formatAed, maskPiiText, newId, startOfDubaiDay, toDubaiDate } from "@leasing/core";
import { sha256Hex, shortRef } from "@leasing/core/tokens";
import {
  approvals,
  deadlines,
  documents,
  leaseParties,
  leases,
  outboundMessages,
  parties,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { renewalNotice } from "@leasing/helpers";
import { canSendRenewalNotice, getRulebook, noticeSentInTime } from "@leasing/rulebook";
import { and, asc, desc, eq, inArray, isNull, like } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { effectiveProposal, RenewalNoticeProposal } from "./gate-rules.ts";
import { createLink } from "./links.ts";
import { createTask, DEADLINE_JOB, renewalCycleKey } from "./milestones.ts";

type LeaseRow = typeof leases.$inferSelect;

const fmt = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${d}T08:00:00Z`),
  );

export const NOTICE_SEND_JOB = "notice.send";
/** Email addresses compare case-insensitively (SMTP servers may change the case). */
const norm = (a: string) => a.trim().toLowerCase();
const cycleLike = (lease: Pick<LeaseRow, "id" | "endOn">) => `${renewalCycleKey(lease.id, lease.endOn)}%`;
/** The outbound milestone for a renewal-notice approval: the part of its dedupe key after the lease id. */
const outboundMilestone = (dedupeKey: string) => dedupeKey.slice(dedupeKey.indexOf(":") + 1);

/**
 * A renewal notice actually sent for the lease's current term, with its proposed rent: the
 * first one (what the legal checks use) or the latest (what the tenant sees in the portal).
 */
export async function noticeSentForTerm(
  tx: Tx,
  lease: Pick<LeaseRow, "id" | "endOn">,
  which: "first" | "latest" = "first",
) {
  const rows = await tx.db
    .select({ msg: outboundMessages, approval: approvals })
    .from(outboundMessages)
    .innerJoin(approvals, eq(approvals.id, outboundMessages.approvalId))
    .where(
      and(
        eq(outboundMessages.entityId, lease.id),
        eq(outboundMessages.purpose, "notice"),
        eq(outboundMessages.status, "sent"),
        like(approvals.dedupeKey, cycleLike(lease)),
      ),
    )
    .orderBy(which === "first" ? asc(outboundMessages.sentAt) : desc(outboundMessages.sentAt))
    .limit(1);
  const row = rows[0];
  if (!row?.msg.sentAt) return null;
  return {
    id: row.msg.id,
    sentAt: row.msg.sentAt,
    acknowledgedAt: row.msg.acknowledgedAt,
    documentId: row.msg.documentId,
    approvalId: row.approval.id,
    proposedRentFils: Number(effectiveProposal(row.approval).proposedRentFils),
  };
}

/** When SMTP accepted the notice email of one approval (null if it was never sent). */
export async function sentAtOfApproval(tx: Tx, approvalId: string): Promise<Date | null> {
  const [m] = await tx.db
    .select({ sentAt: outboundMessages.sentAt })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.approvalId, approvalId), eq(outboundMessages.status, "sent")));
  return m?.sentAt ?? null;
}

/** Whether a sent notice can still renew the lease: same rent, or an increase sent by T−90. */
export function sentNoticeValid(
  proposedRentFils: number,
  sentAt: Date | null,
  lease: Pick<LeaseRow, "endOn" | "annualRentFils" | "rulesVersion">,
): boolean {
  if (proposedRentFils <= lease.annualRentFils) return true;
  return !!sentAt && noticeSentInTime(sentAt, lease.endOn, getRulebook(lease.rulesVersion));
}

/** The approved renewal notice for this term that hasn't been sent yet (if any). */
export async function approvedUnsentNotice(tx: Tx, lease: Pick<LeaseRow, "id" | "endOn">) {
  const rows = await tx.db
    .select()
    .from(approvals)
    .where(
      and(
        like(approvals.dedupeKey, cycleLike(lease)),
        inArray(approvals.status, ["approved", "edited"]),
        isNull(approvals.consumedByEventId),
      ),
    )
    .orderBy(asc(approvals.createdAt), asc(approvals.id));
  // Newest revision first.
  for (const a of rows.toReversed()) {
    const [sent] = await tx.db
      .select({ id: outboundMessages.id })
      .from(outboundMessages)
      .where(and(eq(outboundMessages.approvalId, a.id), eq(outboundMessages.status, "sent")));
    if (!sent) return a;
  }
  return null;
}

/**
 * The approval a renewal may be applied with: the latest sent notice that is still valid (same
 * rent, or an increase SMTP-accepted by T−90), else an approved same-rent notice not yet sent.
 * A late increase is never picked, so it can't block a valid same-rent fallback.
 */
export async function renewableApproval(
  tx: Tx,
  lease: Pick<LeaseRow, "id" | "endOn" | "annualRentFils" | "rulesVersion">,
) {
  const rows = await tx.db
    .select({ msg: outboundMessages, approval: approvals })
    .from(outboundMessages)
    .innerJoin(approvals, eq(approvals.id, outboundMessages.approvalId))
    .where(
      and(
        eq(outboundMessages.entityId, lease.id),
        eq(outboundMessages.purpose, "notice"),
        eq(outboundMessages.status, "sent"),
        like(approvals.dedupeKey, cycleLike(lease)),
        inArray(approvals.status, ["approved", "edited"]),
        isNull(approvals.consumedByEventId),
      ),
    )
    .orderBy(asc(outboundMessages.sentAt));
  const valid = rows.filter(({ msg, approval }) =>
    sentNoticeValid(Number(effectiveProposal(approval).proposedRentFils), msg.sentAt, lease),
  );
  const last = valid.at(-1);
  if (last) return last.approval;
  const unsent = await approvedUnsentNotice(tx, lease);
  return unsent && Number(effectiveProposal(unsent).proposedRentFils) <= lease.annualRentFils ? unsent : null;
}

export async function enqueueNoticeSend(ctx: EngineContext, tx: Tx, leaseId: string, approvalId: string) {
  await ctx.scheduler.send(tx, {
    name: NOTICE_SEND_JOB,
    data: { approvalId },
    singletonKey: `${leaseId}:notice:${approvalId}`,
  });
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: leaseId },
    type: "NOTICE_QUEUED",
    actor: "system",
    payload: { approvalId },
  });
}

export type SendResult =
  | { sent: true; outboundMessageId: string }
  | { sent: false; reason: string; outboundMessageId?: string };

/**
 * Sends an approved renewal notice by email with its PDF, and stores the evidence.
 * 1. In one transaction: check it may still be sent (an increase never after T−90), render and
 *    store the PDF, create the portal links and claim the `outbound_messages` row (unique key =
 *    idempotency). 2. Send through SMTP. 3. Record message id, SMTP response and hashes, and
 *    schedule the acknowledgement follow-up. A retry after a failure resends; a sent notice is
 *    never sent twice.
 */
export async function sendRenewalNotice(ctx: EngineContext, approvalId: string): Promise<SendResult> {
  const prepared = await withTx(ctx.database, async (tx) => {
    const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
    if (!a || a.gate !== "renewal_notice") return { sent: false as const, reason: "not a renewal notice approval" };
    if (a.status !== "approved" && a.status !== "edited")
      return { sent: false as const, reason: `approval is ${a.status}` };
    const p = RenewalNoticeProposal.parse(effectiveProposal(a));
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, p.leaseId)).for("update");
    if (!lease || lease.endOn !== p.leaseEndOn) return { sent: false as const, reason: "lease term changed" };
    if (lease.state !== "RENEWAL") return { sent: false as const, reason: `lease is ${lease.state}` };
    const r = getRulebook(lease.rulesVersion);
    const today = ctx.clock.today();
    const increase = p.proposedRentFils > p.currentRentFils;
    if (increase && !canSendRenewalNotice(today, lease.endOn, r)) {
      await createTask(ctx, tx, lease.id, {
        kind: "notice_too_late",
        title: `Approved rent-increase notice for ${lease.ref} was not sent before the ${r.renewalNoticeDays}-day deadline`,
        details: { approvalId, legalDeadline: p.legalDeadline },
        assigneeRole: "leasing_manager",
        dueOn: today,
        dedupeKey: `${lease.id}:notice_too_late:${approvalId}`,
      });
      return { sent: false as const, reason: `past the ${r.renewalNoticeDays}-day deadline for a rent increase` };
    }

    const milestone = outboundMilestone(a.dedupeKey);
    const [existing] = await tx.db
      .select()
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.entityId, lease.id),
          eq(outboundMessages.purpose, "notice"),
          eq(outboundMessages.milestone, milestone),
        ),
      )
      .for("update");
    if (existing?.status === "sent")
      return { sent: false as const, reason: "already sent", outboundMessageId: existing.id };
    if (existing?.status === "sending") {
      // Interrupted between SMTP and the evidence write, or still running: a person checks the
      // mailbox before anything is resent, so the tenant never gets two notices.
      await createTask(ctx, tx, lease.id, {
        kind: "notice_send_unclear",
        title: `Renewal notice for ${lease.ref} may or may not have been sent: check the sent mail`,
        details: { approvalId, outboundMessageId: existing.id },
        assigneeRole: "leasing_manager",
        dueOn: today,
        dedupeKey: `${lease.id}:notice_send_unclear:${existing.id}`,
      });
      return {
        sent: false as const,
        reason: "a send is already in progress or was interrupted; check before retrying",
        outboundMessageId: existing.id,
      };
    }

    const tenantRows = await tx.db
      .select({ role: leaseParties.role, party: parties })
      .from(leaseParties)
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(eq(leaseParties.leaseId, lease.id));
    const tenant = tenantRows.find((t) => t.role === "tenant")?.party;
    const landlord = tenantRows.find((t) => t.role === "landlord")?.party;
    const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
    if (!tenant?.email || !unit) {
      await createTask(ctx, tx, lease.id, {
        kind: "notice_no_email",
        title: `Renewal notice for ${lease.ref} can't be emailed: no tenant email on record`,
        details: { approvalId },
        assigneeRole: "leasing_officer",
        dueOn: today,
        dedupeKey: `${lease.id}:notice_no_email:${approvalId}`,
      });
      return { sent: false as const, reason: "no tenant email" };
    }

    const reference = shortRef("N");
    const doc = renewalNotice({
      reference,
      issuedOn: today,
      tenantName: tenant.fullNameEn,
      landlordName: landlord?.fullNameEn ?? "The landlord",
      unit: {
        code: unit.code,
        building: unit.building,
        community: unit.community,
        unitNo: unit.unitNo,
        dldPropertyNo: unit.dldPropertyNo,
        makaniNo: unit.makaniNo,
      },
      leaseRef: lease.ref,
      ejariNo: lease.ejariNo,
      leaseEndOn: lease.endOn,
      currentRentFils: p.currentRentFils,
      proposedRentFils: p.proposedRentFils,
      newTermStartOn: p.newTermStartOn,
      newTermEndOn: p.newTermEndOn,
      rulesVersion: p.rulesVersion,
      maxIncreasePercent: p.maxIncreasePercent ?? 0,
      sriAverageFils: p.sriAverageFils,
      sameRentFallback: !!p.sameRentFallback,
      renewalNoticeDays: r.renewalNoticeDays,
      demo: ctx.demoMode,
    });
    const pdf = await renderPdf({ title: doc.title, subject: `${lease.ref} ${reference}` }, doc.blocks);
    const stored = await ctx.documents.put(pdf, "pdf");
    const documentId = newId();
    await tx.db.insert(documents).values({
      id: documentId,
      partyId: tenant.id,
      leaseId: lease.id,
      kind: "renewal_notice",
      sha256: stored.sha256,
      path: stored.path,
      mime: "application/pdf",
      extracted: { reference, approvalId },
    });

    const outboundId = existing?.id ?? newId();
    if (existing) {
      await tx.db
        .update(outboundMessages)
        .set({ status: "sending", error: null, documentId, subject: doc.title, createdAt: ctx.clock.now() })
        .where(eq(outboundMessages.id, existing.id));
    } else {
      await tx.db.insert(outboundMessages).values({
        id: outboundId,
        entityKind: "lease",
        entityId: lease.id,
        purpose: "notice",
        milestone,
        to: tenant.email,
        intendedTo: tenant.email,
        template: increase ? "renewal_notice" : "same_rent_renewal",
        subject: doc.title,
        documentId,
        approvalId,
        status: "sending",
        createdAt: ctx.clock.now(),
      });
    }
    const ack = await createLink(ctx, tx, {
      purpose: "notice_ack",
      entity: { kind: "lease", id: lease.id },
      partyId: tenant.id,
      outboundMessageId: outboundId,
      ttlDays: 30,
    });
    const tenancy = await createLink(ctx, tx, {
      purpose: "tenancy",
      entity: { kind: "lease", id: lease.id },
      partyId: tenant.id,
      ttlDays: 14,
    });
    const mail = renewalNoticeEmail({
      tenantName: tenant.fullNameEn,
      unitLabel: `${unit.unitNo ?? unit.code}, ${unit.building}`,
      leaseEndOn: fmt(lease.endOn),
      currentRent: formatAed(p.currentRentFils),
      proposedRent: formatAed(p.proposedRentFils),
      increase,
      reference,
      acknowledgeUrl: ack.url,
      tenancyUrl: tenancy.url,
      demo: ctx.demoMode,
    });
    return {
      sent: true as const,
      lease,
      outboundId,
      reference,
      to: tenant.email,
      mail,
      pdf,
      pdfSha: stored.sha256,
      increase,
    };
  });
  if (!prepared.sent) return prepared;

  let receipt: Awaited<ReturnType<EngineContext["mailer"]["send"]>>;
  try {
    receipt = await ctx.mailer.send({
      to: prepared.to,
      subject: prepared.mail.subject,
      text: prepared.mail.text,
      html: prepared.mail.html,
      attachments: [
        { filename: `renewal-notice-${prepared.reference}.pdf`, content: prepared.pdf, contentType: "application/pdf" },
      ],
      headers: { "X-Notice-Reference": prepared.reference },
    });
  } catch (e) {
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    await recordSendFailure(ctx, prepared.lease, prepared.outboundId, approvalId, error);
    throw new Error(`notice email failed: ${error}`, { cause: e });
  }
  // SMTP answered but did not take the recipient: not sent, whatever the response code says.
  const to = norm(receipt.deliveredTo);
  if (!receipt.accepted.some((a) => norm(a) === to) || receipt.rejected.some((a) => norm(a) === to)) {
    const error = maskPiiText(`recipient not accepted by the mail server: ${receipt.response}`);
    await recordSendFailure(ctx, prepared.lease, prepared.outboundId, approvalId, error);
    return { sent: false, reason: error, outboundMessageId: prepared.outboundId };
  }

  await withTx(ctx.database, async (tx) => {
    const sentAt = ctx.clock.now();
    const eventId = await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: prepared.lease.id },
      type: "NOTICE_SENT",
      actor: "system",
      payload: {
        outboundMessageId: prepared.outboundId,
        approvalId,
        reference: prepared.reference,
        messageId: receipt.messageId,
        sentOn: toDubaiDate(sentAt),
        redirectedTo: receipt.deliveredTo === prepared.to ? null : receipt.deliveredTo,
      },
      rulesVersion: prepared.lease.rulesVersion,
    });
    await tx.db
      .update(outboundMessages)
      .set({
        status: "sent",
        to: receipt.deliveredTo,
        messageId: receipt.messageId,
        smtpResponse: receipt.response,
        previewUrl: receipt.previewUrl ?? null,
        bodySha256: sha256Hex(`${prepared.mail.text}\n${prepared.mail.html}`),
        attachmentSha256s: [prepared.pdfSha],
        sentAt,
        eventId,
      })
      .where(eq(outboundMessages.id, prepared.outboundId));
    // SMTP took it after midnight on T−90 (Dubai): the increase is no longer valid. Say so now.
    const r = getRulebook(prepared.lease.rulesVersion);
    if (prepared.increase && !noticeSentInTime(sentAt, prepared.lease.endOn, r)) {
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: prepared.lease.id },
        type: "NOTICE_SENT_LATE",
        actor: "system",
        payload: { outboundMessageId: prepared.outboundId, approvalId, sentOn: toDubaiDate(sentAt) },
        rulesVersion: r.version,
      });
      await createTask(ctx, tx, prepared.lease.id, {
        kind: "notice_sent_late",
        title: `Rent-increase notice for ${prepared.lease.ref} left after the ${r.renewalNoticeDays}-day deadline: renew at the same rent`,
        details: { outboundMessageId: prepared.outboundId, approvalId, sentOn: toDubaiDate(sentAt) },
        assigneeRole: "leasing_manager",
        dueOn: ctx.clock.today(),
        dedupeKey: `${prepared.lease.id}:notice_sent_late:${prepared.outboundId}`,
      });
    }
    // Chase an unacknowledged notice after N days (company policy).
    const days = (await getCompanyPolicy(tx, ctx.clock.today())).noticeAckFollowupDays;
    const dueOn = addDays(ctx.clock.today(), days);
    const [dl] = await tx.db
      .insert(deadlines)
      .values({
        id: newId(),
        entityKind: "lease",
        entityId: prepared.lease.id,
        milestone: `notice_ack_followup@${prepared.lease.endOn}`,
        dueOn,
        status: "pending",
        note: `Chase acknowledgement of notice ${prepared.reference}`,
        rulesVersion: prepared.lease.rulesVersion,
      })
      .onConflictDoNothing({ target: [deadlines.entityId, deadlines.milestone] })
      .returning();
    if (dl && !ctx.demoMode) {
      await ctx.scheduler.send(tx, {
        name: DEADLINE_JOB,
        data: { deadlineId: dl.id },
        singletonKey: `${prepared.lease.id}:${dl.milestone}`,
        startAfter: startOfDubaiDay(dueOn),
      });
    }
  });
  return { sent: true, outboundMessageId: prepared.outboundId };
}

/** A failed send is retried by the job, but a person hears about it at the first failure. */
async function recordSendFailure(
  ctx: EngineContext,
  lease: LeaseRow,
  outboundId: string,
  approvalId: string,
  error: string,
): Promise<void> {
  await withTx(ctx.database, async (tx) => {
    await tx.db.update(outboundMessages).set({ status: "failed", error }).where(eq(outboundMessages.id, outboundId));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "NOTICE_SEND_FAILED",
      actor: "system",
      payload: { outboundMessageId: outboundId, error },
      rulesVersion: lease.rulesVersion,
    });
    await createTask(ctx, tx, lease.id, {
      kind: "notice_send_failed",
      title: `Renewal notice email for ${lease.ref} failed: ${error}`,
      details: {
        approvalId,
        outboundMessageId: outboundId,
        legalDeadline: addDays(lease.endOn, -getRulebook(lease.rulesVersion).renewalNoticeDays),
      },
      assigneeRole: "leasing_manager",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:notice_send_failed:${approvalId}`,
    });
  });
}
