import {
  type Actor,
  type ApprovalDecision,
  approvalGates,
  canDecideGate,
  type EntityRef,
  type GateId,
  newId,
  type StaffUser,
  userActor,
} from "@leasing/core";
import { type ApprovalSource, approvals, type Tx, withTx } from "@leasing/db";
import { eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, forbidden, notFound, unprocessable } from "../errors.ts";
import { type AnyEvent, advance } from "./advance.ts";
import { appendEvent } from "./events.ts";
import { checkDecision, effectiveProposal, FormalReminderProposal, RenewalNoticeProposal } from "./gate-rules.ts";
import { onFormalReminderApproved } from "./collections.ts";
import { onSafetyComplaintDecided } from "./complaints.ts";
import { onContractDecided } from "./contracts.ts";
import { enqueueNoticeSend } from "./outbound.ts";
import { onEjariRejectedDecided, onEjariSubmissionDecided } from "./registration.ts";
import { applyApprovedPrice } from "./units.ts";

export interface ApprovalRequest {
  gate: GateId;
  entity: EntityRef;
  /** Same key → same approval; job retries never create a second one. */
  dedupeKey: string;
  title: string;
  proposal: Record<string, unknown>;
  reasons: string[];
  sources: ApprovalSource[];
  rulesVersion?: string;
  proposedBy: Actor;
  /** Event the Manager applies to the entity when a person approves. */
  onApproveEvent?: AnyEvent;
}

/** Creates a pending approval (or returns the existing one with the same dedupe key). */
export async function requestApproval(
  ctx: EngineContext,
  tx: Tx,
  req: ApprovalRequest,
): Promise<{ id: string; created: boolean }> {
  const id = newId();
  const [row] = await tx.db
    .insert(approvals)
    .values({
      id,
      gate: req.gate,
      entityKind: req.entity.kind,
      entityId: req.entity.id,
      dedupeKey: req.dedupeKey,
      title: req.title,
      proposal: req.proposal,
      sources: req.sources,
      reasons: req.reasons,
      rulesVersion: req.rulesVersion ?? null,
      approverRole: approvalGates[req.gate].approver,
      proposedBy: req.proposedBy,
      onApproveEvent: req.onApproveEvent ?? null,
      createdAt: ctx.clock.now(),
    })
    .onConflictDoNothing({ target: approvals.dedupeKey })
    .returning({ id: approvals.id });
  if (!row) {
    const [existing] = await tx.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(eq(approvals.dedupeKey, req.dedupeKey));
    if (!existing) throw new Error("approval dedupe conflict without a row");
    return { id: existing.id, created: false };
  }
  const eventId = await appendEvent(tx, ctx, {
    entity: req.entity,
    type: "APPROVAL_REQUESTED",
    actor: req.proposedBy,
    payload: { approvalId: id, gate: req.gate, title: req.title },
    rulesVersion: req.rulesVersion ?? null,
  });
  await tx.db.update(approvals).set({ createdEventId: eventId }).where(eq(approvals.id, id));
  return { id, created: true };
}

/**
 * A person decides an approval in the inbox. This is the only path to an approved gate: it
 * needs a logged-in staff user whose role may decide the gate.
 */
export async function decideApproval(
  ctx: EngineContext,
  approvalId: string,
  user: StaffUser,
  decision: ApprovalDecision,
) {
  return withTx(ctx.database, async (tx) => {
    const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
    if (!a) throw notFound("approval");
    if (a.status !== "pending") throw conflict(`approval is already ${a.status}`, "already_decided");
    if (!canDecideGate(a.gate, user.role)) throw forbidden(`${user.role} can't decide ${approvalGates[a.gate].label}`);
    if (a.proposedBy === userActor(user.id) || a.proposedBy === `copilot:${user.id}`) {
      throw forbidden("you can't approve your own proposal");
    }
    // The person who entered the SRI value that sets the cap can't also approve the notice.
    const sriBy = (a.proposal as { sriEnteredBy?: string }).sriEnteredBy;
    if (decision.decision !== "reject" && sriBy && sriBy === userActor(user.id)) {
      throw forbidden("you entered the SRI value behind this notice; another manager must approve it");
    }

    // Closing a safety complaint needs a written reason (it may close the tenant's only report).
    if (decision.decision === "reject" && a.gate === "safety_complaint" && !decision.note?.trim()) {
      throw unprocessable("give the reason for closing this safety complaint", [], "reason_required");
    }
    if (decision.decision !== "reject") {
      const problems = checkDecision(a.gate, a.proposal, decision, ctx.clock.today());
      if (problems.length) throw unprocessable("decision breaks a rule or limit", problems, "rule_violation");
    }

    const status =
      decision.decision === "approve" ? "approved" : decision.decision === "reject" ? "rejected" : "edited";
    const editedProposal = decision.decision === "edit" ? { ...a.proposal, ...decision.proposal } : null;
    const [updated] = await tx.db
      .update(approvals)
      .set({
        status,
        decidedBy: user.id,
        decidedAt: ctx.clock.now(),
        decisionNote: decision.note ?? null,
        editedProposal,
      })
      .where(eq(approvals.id, a.id))
      .returning();
    if (!updated) throw new Error("approval update failed");

    await appendEvent(tx, ctx, {
      entity: { kind: a.entityKind, id: a.entityId },
      type: "APPROVAL_DECIDED",
      actor: userActor(user.id),
      payload: {
        approvalId: a.id,
        gate: a.gate,
        status,
        note: decision.note ?? null,
        ...(editedProposal ? { editedProposal } : {}),
      },
      rulesVersion: a.rulesVersion,
    });

    // An approved renewal notice goes out at T−100, or straight away if that date has passed.
    if (status !== "rejected" && a.gate === "renewal_notice") {
      const p = RenewalNoticeProposal.parse(effectiveProposal(updated));
      if (ctx.clock.today() >= p.sendOn) await enqueueNoticeSend(ctx, tx, p.leaseId, a.id);
    }
    // Formal late-payment reminder: approving queues the email; its accepted send starts the clock (D27).
    if (status !== "rejected" && a.gate === "formal_reminder") {
      await onFormalReminderApproved(ctx, tx, a.id, FormalReminderProposal.parse(effectiveProposal(updated)));
    }
    if (a.gate === "safety_complaint") await onSafetyComplaintDecided(ctx, tx, updated, status, user.id);
    if (status !== "rejected" && a.gate === "price_out_of_range") {
      await applyApprovedPrice(ctx, tx, updated, user.id);
    }
    // Contract and Ejari gates: the Manager acts on the decision itself (approvals are consumed
    // later, by CONTRACT_SIGNED and EJARI_ISSUED).
    if (a.gate === "final_contract") await onContractDecided(ctx, tx, updated, status);
    if (a.gate === "ejari_submission") await onEjariSubmissionDecided(ctx, tx, updated, status);
    if (a.gate === "ejari_rejected_twice") await onEjariRejectedDecided(ctx, tx, updated, status);
    if (status !== "rejected" && a.onApproveEvent) {
      await advance(ctx, { kind: a.entityKind, id: a.entityId }, a.onApproveEvent as AnyEvent, {
        actor: userActor(user.id),
        approvalId: a.id,
        payload: effectiveProposal(updated),
        tx,
      });
    }
    return updated;
  });
}
