import { replyReceivedEmail } from "@leasing/adapters";
import {
  type Actor,
  type InboundType,
  inboundPayloads,
  addDays,
  maskPiiText,
  newId,
  type RenewalReply,
  type VacateNotice,
} from "@leasing/core";
import { sha256Hex, shortRef } from "@leasing/core/tokens";
import {
  actionLinks,
  deadlines,
  inboundEvents,
  leaseParties,
  leases,
  outboundMessages,
  parties,
  tasks,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { ReplyContext, ReplyData, replyClassifier } from "@leasing/helpers";
import { and, asc, eq, like } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, unprocessable } from "../errors.ts";
import { advance } from "./advance.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { runAndRecord } from "./helpers.ts";
import { createLink } from "./links.ts";
import { createTask } from "./milestones.ts";
import { processApplicationInbound, receiveApplicationInbound } from "./applications.ts";
import { noticeSentForTerm } from "./outbound.ts";
import { isTenancyType, processTenancyInbound, receiveTenancyInbound } from "./tenancy-inbound.ts";

export const INBOUND_JOB = "inbound.process";
type LeaseRow = typeof leases.$inferSelect;

const replyKey = (lease: Pick<LeaseRow, "id" | "endOn">) => `reply:${lease.id}@${lease.endOn}`;

/**
 * The tenant's renewal replies for the lease's current term, oldest first. "Discuss" keeps the
 * conversation open; a renew or move-out answer is final for the term (staff handle changes).
 */
export async function termReplies(tx: Tx, lease: Pick<LeaseRow, "id" | "endOn">) {
  const rows = await tx.db
    .select()
    .from(inboundEvents)
    .where(and(eq(inboundEvents.entityId, lease.id), like(inboundEvents.dedupeKey, `${replyKey(lease)}%`)))
    .orderBy(asc(inboundEvents.receivedAt), asc(inboundEvents.id));
  const choiceOf = (r: (typeof rows)[number]) => (r.payload as { choice?: string }).choice;
  const final = rows.find((r) => choiceOf(r) !== "discuss" && r.status !== "stored_only" && r.status !== "failed");
  return { all: rows, latest: rows.at(-1) ?? null, final: final ?? null };
}

export interface InboundRequest {
  type: InboundType;
  payload: unknown;
  channel: "portal" | "staff";
  actor: Actor;
  /** The lease (renewal forms) or application (documents, offer answer) it is about. */
  entity: { kind: "lease" | "application"; id: string };
  linkId?: string;
  /** For acknowledgements: the notice email being acknowledged. */
  outboundMessageId?: string;
}

/**
 * Stores a tenant submission (or one recorded by staff on the tenant's behalf) and queues it for
 * the Manager, in one transaction. Returns at once with a reference number. Each kind of reply
 * is accepted once per term (or once per notice for acknowledgements), so double clicks and
 * replays create nothing new.
 */
export async function receiveInbound(ctx: EngineContext, tx: Tx, req: InboundRequest) {
  const schema = inboundPayloads[req.type];
  const parsed = schema.safeParse(req.payload ?? {});
  if (!parsed.success) {
    throw unprocessable(
      "the form is incomplete",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      "invalid_payload",
    );
  }
  if (req.entity.kind === "application") return receiveApplicationInbound(ctx, tx, req, parsed.data);
  // Tenancy forms (phase 3): move-in report, payment reply, report an issue.
  if (isTenancyType(req.type)) {
    return receiveTenancyInbound(ctx, tx, req, parsed.data as never, (t, id, leaseId) =>
      ctx.scheduler
        .send(t, { name: INBOUND_JOB, data: { inboundEventId: id }, singletonKey: `${leaseId}:inbound:${id}` })
        .then(() => {}),
    );
  }
  // Leases take renewal forms and the notice to vacate; application forms can't be posted against a lease.
  if (req.type !== "NOTICE_ACKNOWLEDGED" && req.type !== "RENEWAL_REPLY" && req.type !== "VACATE_NOTICE") {
    throw unprocessable(`${req.type} is not a lease form`, [], "invalid_payload");
  }
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, req.entity.id));
  if (!lease) throw conflict("lease not found");
  if (req.type === "NOTICE_ACKNOWLEDGED" && !req.outboundMessageId) throw unprocessable("no notice to acknowledge");
  let dedupeKey = `ack:${req.outboundMessageId ?? "none"}`;
  if (req.type === "VACATE_NOTICE") {
    if (lease.state !== "ACTIVE" && lease.state !== "RENEWAL")
      throw conflict("Notice to move out can be given while the tenancy is running.");
    // Not months ahead: MOVE_OUT starts the inspection booking and stops the renewal path.
    const opens = addDays(lease.endOn, -(await getCompanyPolicy(tx, ctx.clock.today())).vacateNoticeOpensDays);
    if (ctx.clock.today() < opens) throw conflict(`Notice to move out can be given from ${opens}.`);
  }
  if (req.type === "RENEWAL_REPLY" || req.type === "VACATE_NOTICE") {
    // One final answer per term (a notice to vacate is one); after "discuss" the tenant may still renew or move out.
    // Concurrent submissions compute the same key, so only one of them is stored.
    const replies = await termReplies(tx, lease);
    if (replies.final) return { ref: replies.final.ref, duplicate: true, id: replies.final.id };
    dedupeKey = replies.all.length ? `${replyKey(lease)}#${replies.all.length + 1}` : replyKey(lease);
  }
  const id = newId();
  const ref = shortRef("R");
  const [row] = await tx.db
    .insert(inboundEvents)
    .values({
      id,
      ref,
      type: req.type,
      entityKind: "lease",
      entityId: lease.id,
      channel: req.channel,
      actor: req.actor,
      linkId: req.linkId ?? null,
      dedupeKey,
      payload: { ...parsed.data, ...(req.outboundMessageId ? { outboundMessageId: req.outboundMessageId } : {}) },
      receivedAt: ctx.clock.now(),
    })
    .onConflictDoNothing({ target: inboundEvents.dedupeKey })
    .returning();
  if (!row) {
    const [prev] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.dedupeKey, dedupeKey));
    return { ref: prev?.ref ?? "", duplicate: true, id: prev?.id ?? "" };
  }
  if (req.linkId) {
    await tx.db
      .update(actionLinks)
      .set({ usedAt: ctx.clock.now() })
      .where(and(eq(actionLinks.id, req.linkId), eq(actionLinks.singleUse, true)));
  }
  // The free-text comment is tenant-written: it stays in inbound_events, not in the event payload.
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "INBOUND_RECEIVED",
    actor: req.actor,
    payload: {
      inboundEventId: id,
      ref,
      type: req.type,
      channel: req.channel,
      ...(req.type === "RENEWAL_REPLY" ? { choice: (parsed.data as RenewalReply).choice } : {}),
      ...(req.type === "VACATE_NOTICE" ? { moveOutOn: (parsed.data as VacateNotice).moveOutOn } : {}),
    },
    rulesVersion: lease.rulesVersion,
  });
  await ctx.scheduler.send(tx, {
    name: INBOUND_JOB,
    data: { inboundEventId: id },
    singletonKey: `${lease.id}:inbound:${id}`,
  });
  return { ref, duplicate: false, id };
}

/**
 * Processes one stored submission (pg-boss job). The comment, if any, is classified first in
 * its own transaction (model calls can be slow); then the submission is applied under a lock.
 * A submission that no longer fits the lease's state is kept but not applied, and a person is told.
 */
export async function processInbound(ctx: EngineContext, inboundEventId: string) {
  try {
    return await processInboundOnce(ctx, inboundEventId);
  } catch (e) {
    // The job retries, but a person hears about it at the first failure (once per submission).
    const reason = maskPiiText(e instanceof Error ? e.message : String(e));
    await withTx(ctx.database, async (tx) => {
      const [ev] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.id, inboundEventId));
      if (!ev || ev.status !== "received") return;
      await createTask(
        ctx,
        tx,
        ev.entityId,
        {
          kind: "inbound_failing",
          title: `Submission ${ev.ref} could not be processed: ${reason}`,
          details: { inboundEventId: ev.id, type: ev.type },
          assigneeRole: "leasing_manager",
          dueOn: ctx.clock.today(),
          dedupeKey: `inbound_failing:${ev.id}`,
        },
        ev.entityKind === "application" ? "application" : "lease",
      );
    }).catch(() => {});
    throw e;
  }
}

async function processInboundOnce(ctx: EngineContext, inboundEventId: string) {
  const [ev] = await ctx.database.db.select().from(inboundEvents).where(eq(inboundEvents.id, inboundEventId));
  if (!ev || ev.status !== "received") return { done: false, reason: "not waiting" };
  if (ev.entityKind === "application") return processApplicationInbound(ctx, ev);
  if (isTenancyType(ev.type)) return processTenancyInbound(ctx, ev);

  let classification: { data: ReplyData | undefined; reasons: string[]; helperRunId: string; status: string } | null =
    null;
  if (ev.type === "RENEWAL_REPLY" || ev.type === "VACATE_NOTICE") {
    // A notice to vacate is classified like a "vacate" renewal reply: "unless…", threats, instructions.
    const reply = { choice: "vacate" as const, ...(ev.payload as Partial<RenewalReply>) };
    if (reply.comment?.trim()) {
      classification = await withTx(ctx.database, async (tx) => {
        const [lease] = await tx.db.select().from(leases).where(eq(leases.id, ev.entityId));
        const policy = await getCompanyPolicy(tx, ctx.clock.today());
        const { run, helperRunId } = await runAndRecord(
          ctx,
          tx,
          replyClassifier(ctx.llm),
          { context: ReplyContext, data: ReplyData },
          { kind: "lease", id: ev.entityId },
          "RENEWAL",
          {
            choice: reply.choice,
            comment: reply.comment ?? "",
            minConfidence: policy.replyMinConfidence,
            legalThreatThreshold: policy.replyLegalThreatThreshold,
            injectionThreshold: policy.replyInjectionThreshold,
          },
          lease?.rulesVersion ?? ctx.rulesVersion,
        );
        return { data: run.result.data, reasons: run.result.reasons, helperRunId, status: run.result.status };
      });
    }
  }

  const outcome = await withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.id, inboundEventId)).for("update");
    if (!locked || locked.status !== "received") return null;
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, locked.entityId)).for("update");
    if (!lease) return null;
    const result =
      locked.type === "NOTICE_ACKNOWLEDGED"
        ? await applyAcknowledgement(ctx, tx, lease, locked)
        : locked.type === "VACATE_NOTICE"
          ? await applyVacateNotice(ctx, tx, lease, locked, classification)
          : await applyRenewalReply(ctx, tx, lease, locked, classification);
    await tx.db
      .update(inboundEvents)
      .set({ status: result.applied ? "applied" : "stored_only", result: result.detail, processedAt: ctx.clock.now() })
      .where(eq(inboundEvents.id, locked.id));
    return { lease, result, ev: locked };
  });
  if (!outcome) return { done: false, reason: "already processed" };
  if (outcome.ev.channel === "portal" && (outcome.ev.type === "RENEWAL_REPLY" || outcome.ev.type === "VACATE_NOTICE")) {
    await sendReplyReceipt(ctx, outcome.lease, outcome.ev.ref, outcome.result.summary).catch(() => {});
  }
  return { done: true, applied: outcome.result.applied };
}

type InboundRow = typeof inboundEvents.$inferSelect;
interface Applied {
  applied: boolean;
  summary: string;
  detail: Record<string, unknown>;
}

async function applyAcknowledgement(ctx: EngineContext, tx: Tx, lease: LeaseRow, ev: InboundRow): Promise<Applied> {
  const outboundId = String((ev.payload as { outboundMessageId?: string }).outboundMessageId ?? "");
  const [msg] = await tx.db.select().from(outboundMessages).where(eq(outboundMessages.id, outboundId)).for("update");
  if (!msg || msg.entityId !== lease.id)
    return { applied: false, summary: "notice not found", detail: { reason: "notice not found" } };
  if (!msg.acknowledgedAt) {
    await tx.db.update(outboundMessages).set({ acknowledgedAt: ev.receivedAt }).where(eq(outboundMessages.id, msg.id));
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "NOTICE_ACKNOWLEDGED",
    actor: ev.actor as Actor,
    payload: { outboundMessageId: msg.id, inboundRef: ev.ref, channel: ev.channel },
    rulesVersion: lease.rulesVersion,
  });
  // No need to chase it any more.
  await tx.db
    .update(deadlines)
    .set({ status: "done", note: `acknowledged (${ev.ref})`, firedAt: ctx.clock.now() })
    .where(
      and(
        eq(deadlines.entityId, lease.id),
        like(deadlines.milestone, "notice_ack_followup@%"),
        eq(deadlines.status, "pending"),
      ),
    );
  await tx.db
    .update(tasks)
    .set({ status: "done" })
    .where(and(eq(tasks.entityId, lease.id), eq(tasks.kind, "notice_ack_followup"), eq(tasks.status, "open")));
  return { applied: true, summary: "you confirmed you received the notice", detail: { outboundMessageId: msg.id } };
}

async function applyRenewalReply(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  ev: InboundRow,
  cls: { data: ReplyData | undefined; reasons: string[]; helperRunId: string; status: string } | null,
): Promise<Applied> {
  const reply = ev.payload as RenewalReply;
  const comment = reply.comment?.trim() || null;
  const today = ctx.clock.today();
  const base = {
    choice: reply.choice,
    inboundRef: ev.ref,
    helperRunId: cls?.helperRunId ?? null,
    classification: cls?.data ?? null,
  };
  if (lease.state !== "RENEWAL") {
    await createTask(ctx, tx, lease.id, {
      kind: "reply_out_of_window",
      title: `Renewal reply (${reply.choice}) for ${lease.ref} arrived while the lease is ${lease.state}`,
      details: { ...base, comment, untrusted: true },
      assigneeRole: "leasing_manager",
      dueOn: today,
      dedupeKey: `${lease.id}:reply_out_of_window:${ev.id}`,
    });
    return {
      applied: false,
      summary: "we will review your reply",
      detail: { ...base, reason: `lease is ${lease.state}` },
    };
  }
  const needsPerson = !!comment && (!cls?.data || cls.data.needsPerson || cls.status !== "ok");
  if (needsPerson) {
    await createTask(ctx, tx, lease.id, {
      kind: "reply_review",
      title: `Read the tenant's comment on their renewal reply for ${lease.ref}`,
      details: { ...base, comment, untrusted: true, reasons: cls?.reasons ?? ["comment could not be classified"] },
      assigneeRole: "leasing_manager",
      dueOn: today,
      dedupeKey: `${lease.id}:reply_review:${ev.id}`,
    });
  }

  if (reply.choice === "renew") {
    const sent = await noticeSentForTerm(tx, lease);
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "TENANT_ACCEPTED_RENEWAL",
      actor: ev.actor as Actor,
      payload: { ...base, approvalId: sent?.approvalId ?? null },
      rulesVersion: lease.rulesVersion,
    });
    await createTask(ctx, tx, lease.id, {
      kind: "renewal_accepted",
      title: `Tenant accepted the renewal of ${lease.ref}: check and renew the lease`,
      details: { ...base, approvalId: sent?.approvalId ?? null },
      assigneeRole: "leasing_officer",
      dueOn: today,
      dedupeKey: `${lease.id}:renewal_accepted@${lease.endOn}`,
    });
    return { applied: true, summary: "you want to renew", detail: { ...base, action: "renewal task created" } };
  }
  if (reply.choice === "vacate" && needsPerson) {
    // Ending a tenancy on a comment that reads otherwise ("I'll leave unless…", a legal threat,
    // instructions aimed at the system) waits for a person; the review task above says why.
    return {
      applied: false,
      summary: "we will review your reply and contact you",
      detail: { ...base, action: "move-out held for review", reason: "the comment needs a person to read it" },
    };
  }
  if (reply.choice === "vacate") {
    // The tenant's own decision not to renew: an allowed transition, no gate.
    // Entering MOVE_OUT emails the tenant the inspection booking link (move-out.ts).
    await advance(ctx, { kind: "lease", id: lease.id }, "TENANT_VACATE_NOTICE", {
      actor: ev.actor as Actor,
      tx,
      payload: { moveOutOn: lease.endOn, inboundRef: ev.ref, channel: ev.channel },
    });
    return {
      applied: true,
      summary: "you plan to move out at the end of the lease",
      detail: { ...base, action: "lease moved to move-out" },
    };
  }
  await createTask(ctx, tx, lease.id, {
    kind: "renewal_discuss",
    title: `Tenant of ${lease.ref} wants to discuss the renewal`,
    details: { ...base, comment, untrusted: true },
    assigneeRole: "leasing_manager",
    dueOn: today,
    dedupeKey: `${lease.id}:renewal_discuss:${ev.id}`,
  });
  return {
    applied: true,
    summary: "you would like to discuss the renewal",
    detail: { ...base, action: "discussion task created" },
  };
}

type Classification = { data: ReplyData | undefined; reasons: string[]; helperRunId: string; status: string } | null;

/**
 * Notice to vacate from the tenancy page (step 10). At the lease end it moves the lease to
 * MOVE_OUT, unless the comment needs a person. Any other date is an early-termination request:
 * contractual, so a manager handles it and nothing changes here.
 */
async function applyVacateNotice(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  ev: InboundRow,
  cls: Classification,
): Promise<Applied> {
  const p = ev.payload as VacateNotice;
  const comment = p.comment?.trim() ? maskPiiText(p.comment.trim()) : null;
  const today = ctx.clock.today();
  const base = {
    inboundRef: ev.ref,
    moveOutOn: p.moveOutOn,
    helperRunId: cls?.helperRunId ?? null,
    classification: cls?.data ?? null,
  };
  if (lease.state !== "ACTIVE" && lease.state !== "RENEWAL") {
    await createTask(ctx, tx, lease.id, {
      kind: "reply_out_of_window",
      title: `Notice to vacate for ${lease.ref} arrived while the lease is ${lease.state}`,
      details: { ...base, comment, untrusted: true },
      assigneeRole: "leasing_manager",
      dueOn: today,
      dedupeKey: `${lease.id}:reply_out_of_window:${ev.id}`,
    });
    return {
      applied: false,
      summary: "we will review your notice",
      detail: { ...base, reason: `lease is ${lease.state}` },
    };
  }
  if (p.moveOutOn !== lease.endOn) {
    await createTask(ctx, tx, lease.id, {
      kind: "early_termination_request",
      title: `Tenant of ${lease.ref} asks to move out on ${p.moveOutOn}, before the lease end ${lease.endOn}`,
      details: { ...base, comment, untrusted: !!comment },
      assigneeRole: "leasing_manager",
      dueOn: today,
      dedupeKey: `${lease.id}:early_termination_request:${ev.id}`,
    });
    return {
      applied: false,
      summary: "you asked to move out before your lease ends; we will contact you about the terms",
      detail: { ...base, action: "early termination request for a manager" },
    };
  }
  if (comment && (!cls?.data || cls.data.needsPerson || cls.status !== "ok")) {
    await createTask(ctx, tx, lease.id, {
      kind: "reply_review",
      title: `Read the tenant's comment on their notice to vacate ${lease.ref}`,
      details: { ...base, comment, untrusted: true, reasons: cls?.reasons ?? ["comment could not be classified"] },
      assigneeRole: "leasing_manager",
      dueOn: today,
      dedupeKey: `${lease.id}:reply_review:${ev.id}`,
    });
    return {
      applied: false,
      summary: "we will review your notice and contact you",
      detail: { ...base, action: "move-out held for review", reason: "the comment needs a person to read it" },
    };
  }
  await advance(ctx, { kind: "lease", id: lease.id }, "TENANT_VACATE_NOTICE", {
    actor: ev.actor as Actor,
    tx,
    payload: { moveOutOn: lease.endOn, inboundRef: ev.ref, channel: ev.channel },
  });
  return {
    applied: true,
    summary: `you will move out on ${lease.endOn}`,
    detail: { ...base, action: "lease moved to move-out" },
  };
}

/** Confirmation email for a portal reply (best effort, recorded like every other email). */
async function sendReplyReceipt(ctx: EngineContext, lease: LeaseRow, ref: string, summary: string) {
  const prepared = await withTx(ctx.database, async (tx) => {
    const [t] = await tx.db
      .select({ party: parties })
      .from(leaseParties)
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(and(eq(leaseParties.leaseId, lease.id), eq(leaseParties.role, "tenant")));
    const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
    if (!t?.party.email || !unit) return null;
    const link = await createLink(ctx, tx, {
      purpose: "tenancy",
      entity: { kind: "lease", id: lease.id },
      partyId: t.party.id,
      ttlDays: 14,
    });
    const mail = replyReceivedEmail({
      tenantName: t.party.fullNameEn,
      unitLabel: `${unit.unitNo ?? unit.code}, ${unit.building}`,
      reference: ref,
      summary,
      tenancyUrl: link.url,
      demo: ctx.demoMode,
    });
    const id = newId();
    const [row] = await tx.db
      .insert(outboundMessages)
      .values({
        id,
        entityKind: "lease",
        entityId: lease.id,
        purpose: "receipt",
        milestone: `reply:${ref}`,
        to: t.party.email,
        intendedTo: t.party.email,
        template: "reply_received",
        subject: mail.subject,
        status: "sending",
        createdAt: ctx.clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    return row ? { id, to: t.party.email, mail } : null;
  });
  if (!prepared) return;
  try {
    const r = await ctx.mailer.send({
      to: prepared.to,
      subject: prepared.mail.subject,
      text: prepared.mail.text,
      html: prepared.mail.html,
    });
    await ctx.database.db
      .update(outboundMessages)
      .set({
        status: "sent",
        to: r.deliveredTo,
        messageId: r.messageId,
        smtpResponse: r.response,
        previewUrl: r.previewUrl ?? null,
        bodySha256: sha256Hex(`${prepared.mail.text}\n${prepared.mail.html}`),
        sentAt: ctx.clock.now(),
      })
      .where(eq(outboundMessages.id, prepared.id));
  } catch (e) {
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error: maskPiiText(e instanceof Error ? e.message : String(e)) })
      .where(eq(outboundMessages.id, prepared.id));
  }
}
