import {
  type Actor,
  addDays,
  type CalendarDate,
  type ComplaintSubmitted,
  formatAed,
  type MoveInAcknowledged,
  newId,
  type PaymentReply,
} from "@leasing/core";
import { sha256Hex, shortRef } from "@leasing/core/tokens";
import { actionLinks, documents, inboundEvents, inspections, leases, payments, type Tx, withTx } from "@leasing/db";
import {
  MoveInCommentContext,
  MoveInCommentData,
  moveInCommentClassifier,
  PaymentReplyContext,
  PaymentReplyData,
  paymentReplyClassifier,
} from "@leasing/helpers";
import { and, eq, inArray, like } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, unprocessable } from "../errors.ts";
import { processComplaint } from "./complaints.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { runAndRecord } from "./helpers.ts";
import type { InboundRequest } from "./inbound.ts";
import { addLeaseDeadline, createTask } from "./milestones.ts";
import { ownPhotos } from "./tenancy-files.ts";

/**
 * Tenant portal forms during the tenancy (phase 3, architecture §8a): confirm the move-in report
 * (step 7), reply about a payment and report an issue (step 8). Buttons and dates are trusted as
 * typed (Zod); free text is classified, never obeyed. Nothing here changes rent, amounts or dates:
 * a payment reply creates work for finance; a complaint goes to Complaint Triage.
 */
export const TENANCY_TYPES = ["MOVE_IN_ACKNOWLEDGED", "PAYMENT_REPLY", "COMPLAINT_SUBMITTED"] as const;
export type TenancyType = (typeof TENANCY_TYPES)[number];
export const isTenancyType = (t: string): t is TenancyType => (TENANCY_TYPES as readonly string[]).includes(t);

type LeaseRow = typeof leases.$inferSelect;
type InboundRow = typeof inboundEvents.$inferSelect;
type Payload = MoveInAcknowledged | PaymentReply | ComplaintSubmitted;

/** Validates against the lease, picks the dedupe key, stores the submission and queues it. */
export async function receiveTenancyInbound(
  ctx: EngineContext,
  tx: Tx,
  req: InboundRequest,
  payload: Payload,
  enqueue: (tx: Tx, inboundEventId: string, leaseId: string) => Promise<void>,
) {
  const type = req.type as TenancyType;
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, req.entity.id));
  if (!lease) throw conflict("lease not found");
  const today = ctx.clock.today();
  let dedupeKey: string;
  let summary: Record<string, unknown> = {};

  if (type === "MOVE_IN_ACKNOWLEDGED") {
    const p = payload as MoveInAcknowledged;
    if (lease.state !== "ACTIVE") throw conflict("There is no move-in report to confirm right now.");
    await ownPhotos(tx, lease.id, "tenant_condition_photo", p.photoIds);
    dedupeKey = `move_in_ack:${lease.id}`;
    summary = { agree: p.agree, photos: p.photoIds.length };
  } else if (type === "PAYMENT_REPLY") {
    const p = payload as PaymentReply;
    const [pay] = await tx.db.select().from(payments).where(eq(payments.id, p.paymentId));
    if (!pay || pay.leaseId !== lease.id) throw unprocessable("unknown payment", [], "invalid_payload");
    if (pay.status !== "overdue" && pay.status !== "bounced")
      throw conflict("This payment isn't waiting for a reply (it may already be confirmed).");
    if (p.choice === "will_pay") {
      const policy = await getCompanyPolicy(tx, today);
      const latest = addDays(today, policy.promiseToPayMaxDays);
      if (p.payBy! < today || p.payBy! > latest)
        throw unprocessable(`choose a date between today and ${latest}`, [], "invalid_payload");
    }
    await ownPhotos(tx, lease.id, "payment_proof", p.proofIds);
    const earlier = await tx.db
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(like(inboundEvents.dedupeKey, `payment_reply:${pay.id}%`));
    if (earlier.length >= 5)
      throw conflict("We already have your replies about this payment; the team will contact you.");
    // The same answer sent twice in a row (double click) is stored once.
    const last = earlier.length
      ? await tx.db
          .select()
          .from(inboundEvents)
          .where(eq(inboundEvents.dedupeKey, `payment_reply:${pay.id}#${earlier.length}`))
      : [];
    const same = last[0] && JSON.stringify(last[0].payload) === JSON.stringify(p);
    dedupeKey = same ? last[0]!.dedupeKey : `payment_reply:${pay.id}#${earlier.length + 1}`;
    summary = { paymentId: pay.id, seq: pay.seq, choice: p.choice, payBy: p.payBy ?? null };
  } else {
    const p = payload as ComplaintSubmitted;
    if (!["ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE"].includes(lease.state))
      throw conflict("Issues can be reported while the tenancy is running.");
    await ownPhotos(tx, lease.id, "issue_photo", p.photoIds);
    // Only a double submit is stored once (same text within 10 minutes). The same issue reported
    // again later is a new complaint, so a repeated safety report is triaged and escalated again.
    const bucket = Math.floor(ctx.clock.now().getTime() / 600_000);
    dedupeKey = `complaint:${lease.id}:${bucket}:${sha256Hex(p.description.toLowerCase().replace(/\s+/g, " ")).slice(0, 24)}`;
    summary = { atRisk: p.atRisk, room: p.room ?? null, photos: p.photoIds.length };
  }

  const id = newId();
  const ref = shortRef(type === "COMPLAINT_SUBMITTED" ? "C" : "R");
  const [row] = await tx.db
    .insert(inboundEvents)
    .values({
      id,
      ref,
      type,
      entityKind: "lease",
      entityId: lease.id,
      channel: req.channel,
      actor: req.actor,
      linkId: req.linkId ?? null,
      dedupeKey,
      payload: payload as unknown as Record<string, unknown>,
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
  // Tenant-written text stays in inbound_events, not in the event payload.
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "INBOUND_RECEIVED",
    actor: req.actor,
    payload: { inboundEventId: id, ref, type, channel: req.channel, ...summary },
    rulesVersion: lease.rulesVersion,
  });
  await enqueue(tx, id, lease.id);
  return { ref, duplicate: false, id };
}

/** Processes one stored tenancy submission (the inbound job). */
export async function processTenancyInbound(ctx: EngineContext, ev: InboundRow) {
  if (ev.type === "COMPLAINT_SUBMITTED") return processComplaint(ctx, ev);
  const comment = (ev.payload as { comment?: string }).comment?.trim();
  // The comment is classified first, in its own transaction (model calls can be slow).
  const cls = comment
    ? await withTx(ctx.database, async (tx) => {
        const [lease] = await tx.db.select().from(leases).where(eq(leases.id, ev.entityId));
        const policy = await getCompanyPolicy(tx, ctx.clock.today());
        const base = {
          comment,
          minConfidence: policy.replyMinConfidence,
          legalThreatThreshold: policy.replyLegalThreatThreshold,
          injectionThreshold: policy.replyInjectionThreshold,
        };
        const rv = lease?.rulesVersion ?? ctx.rulesVersion;
        const entity = { kind: "lease" as const, id: ev.entityId };
        if (ev.type === "PAYMENT_REPLY") {
          const { run, helperRunId } = await runAndRecord(
            ctx,
            tx,
            paymentReplyClassifier(ctx.llm),
            { context: PaymentReplyContext, data: PaymentReplyData },
            entity,
            "PAYMENT_REPLY",
            { ...base, choice: (ev.payload as PaymentReply).choice },
            rv,
          );
          return {
            needsPerson: run.result.status !== "ok" || !!run.result.data?.needsPerson,
            reasons: run.result.reasons,
            helperRunId,
          };
        }
        const { run, helperRunId } = await runAndRecord(
          ctx,
          tx,
          moveInCommentClassifier(ctx.llm),
          { context: MoveInCommentContext, data: MoveInCommentData },
          entity,
          "MOVE_IN",
          { ...base, choice: (ev.payload as MoveInAcknowledged).agree ? "agree" : "disagree" },
          rv,
        );
        return {
          needsPerson: run.result.status !== "ok" || !!run.result.data?.needsPerson,
          reasons: run.result.reasons,
          helperRunId,
        };
      })
    : null;

  return withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.id, ev.id)).for("update");
    if (!locked || locked.status !== "received") return { done: false, reason: "already processed" };
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, locked.entityId)).for("update");
    if (!lease) return { done: false, reason: "lease not found" };
    const result =
      locked.type === "MOVE_IN_ACKNOWLEDGED"
        ? await applyMoveInAck(ctx, tx, lease, locked, cls)
        : await applyPaymentReply(ctx, tx, lease, locked, cls);
    await tx.db
      .update(inboundEvents)
      .set({ status: result.applied ? "applied" : "stored_only", result: result.detail, processedAt: ctx.clock.now() })
      .where(eq(inboundEvents.id, locked.id));
    return { done: true, applied: result.applied };
  });
}

type Classified = { needsPerson: boolean; reasons: string[]; helperRunId: string } | null;
interface Applied {
  applied: boolean;
  detail: Record<string, unknown>;
}

/** Move-in report: the tenant's photos join the inspection; a disagreement or flagged comment goes to an officer. */
async function applyMoveInAck(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  ev: InboundRow,
  cls: Classified,
): Promise<Applied> {
  const p = ev.payload as MoveInAcknowledged;
  const [insp] = await tx.db
    .select()
    .from(inspections)
    .where(and(eq(inspections.leaseId, lease.id), eq(inspections.kind, "move_in")));
  if (insp && p.photoIds.length) {
    await tx.db
      .update(documents)
      .set({ inspectionId: insp.id, status: "submitted" })
      .where(and(inArray(documents.id, p.photoIds), eq(documents.leaseId, lease.id)));
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "MOVE_IN_ACKNOWLEDGED",
    actor: ev.actor as Actor,
    payload: { inboundEventId: ev.id, ref: ev.ref, agree: p.agree, photos: p.photoIds.length },
    rulesVersion: lease.rulesVersion,
  });
  const needsPerson = !p.agree || !!cls?.needsPerson;
  if (needsPerson) {
    await createTask(ctx, tx, lease.id, {
      kind: "move_in_dispute",
      title: `${lease.ref}: the tenant ${p.agree ? "commented on" : "disputes"} the move-in report (${ev.ref})`,
      details: {
        inboundEventId: ev.id,
        agree: p.agree,
        comment: p.comment ?? null,
        untrusted: true,
        photos: p.photoIds.length,
        reasons: cls?.reasons ?? [],
      },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:move_in_dispute:${ev.id}`,
    });
  }
  return { applied: true, detail: { agree: p.agree, needsPerson } };
}

/**
 * Payment reply: never marks anything paid or changes an amount. Paid → finance checks the
 * proof; will pay → a follow-up on that date; dispute or need time → a manager.
 */
async function applyPaymentReply(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  ev: InboundRow,
  cls: Classified,
): Promise<Applied> {
  const p = ev.payload as PaymentReply;
  const [pay] = await tx.db.select().from(payments).where(eq(payments.id, p.paymentId)).for("update");
  if (!pay || (pay.status !== "overdue" && pay.status !== "bounced"))
    return { applied: false, detail: { reason: `instalment is ${pay?.status ?? "missing"}` } };
  const label = `instalment ${pay.seq} of ${lease.ref} (${formatAed(pay.amountFils)}, due ${pay.dueOn})`;
  const base = {
    inboundEventId: ev.id,
    paymentId: pay.id,
    seq: pay.seq,
    choice: p.choice,
    comment: p.comment ?? null,
    untrusted: !!p.comment,
    proofIds: p.proofIds,
    reasons: cls?.reasons ?? [],
  };
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "PAYMENT_REPLY",
    actor: ev.actor as Actor,
    payload: {
      inboundEventId: ev.id,
      ref: ev.ref,
      paymentId: pay.id,
      seq: pay.seq,
      choice: p.choice,
      payBy: p.payBy ?? null,
    },
    rulesVersion: lease.rulesVersion,
  });
  if (p.choice === "paid") {
    await createTask(ctx, tx, lease.id, {
      kind: "payment_proof_check",
      title: `The tenant says ${label} is paid${p.proofIds.length ? " (proof attached)" : ""}: check and confirm`,
      details: base,
      assigneeRole: "finance",
      dueOn: ctx.clock.today(),
      dedupeKey: `${pay.id}:payment_proof_check:${ev.id}`,
    });
  } else if (p.choice === "will_pay") {
    await addLeaseDeadline(ctx, tx, {
      leaseId: lease.id,
      // The reply's number for this payment (its dedupe key ends in #n).
      milestone: `rent_payby@${pay.id}#${ev.dedupeKey.split("#")[1] ?? "1"}`,
      dueOn: addDays(p.payBy as CalendarDate, 1),
      rulesVersion: lease.rulesVersion,
      note: `the tenant said they would pay by ${p.payBy}`,
    });
  } else {
    await createTask(ctx, tx, lease.id, {
      kind: "payment_reply_review",
      title: `The tenant ${p.choice === "dispute" ? "disputes" : "asks for more time on"} ${label}`,
      details: base,
      assigneeRole: "leasing_manager",
      dueOn: ctx.clock.today(),
      dedupeKey: `${pay.id}:payment_reply_review:${ev.id}`,
    });
  }
  // A comment that needs a person (hardship, question, legal threat, instructions) is read by one.
  if (cls?.needsPerson && p.choice !== "dispute" && p.choice !== "need_time") {
    await createTask(ctx, tx, lease.id, {
      kind: "payment_reply_review",
      title: `Read the tenant's comment on ${label}`,
      details: base,
      assigneeRole: "leasing_manager",
      dueOn: ctx.clock.today(),
      dedupeKey: `${pay.id}:payment_reply_review:${ev.id}`,
    });
  }
  return { applied: true, detail: { choice: p.choice, needsPerson: !!cls?.needsPerson } };
}
