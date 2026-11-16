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
import { appendEvent, unitRulesVersion } from "./events.ts";
import {
  checkDecision,
  effectiveProposal,
  FormalReminderProposal,
  isLeaseTermsProposal,
  LeaseTermsProposal,
  OfferLimitsProposal,
  RenewalNoticeProposal,
} from "./gate-rules.ts";
import { onOfferLimitsRejected, reissueOfferProposal } from "./applications.ts";
import { onFormalReminderApproved } from "./collections.ts";
import { onSafetyComplaintDecided } from "./complaints.ts";
import { onRefundDecided } from "./deposit.ts";
import { onContractDecided } from "./contracts.ts";
import { createTask } from "./milestones.ts";
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
  // Units and applications record their own emirate's version (rule 4), as their events do.
  const rv = await unitRulesVersion(tx, ctx, req.entity, req.rulesVersion);
  const { rulesVersion: _given, ...rest } = req;
  req = rv ? { ...rest, rulesVersion: rv } : rest;
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
  opts: DecideOptions = {},
) {
  // D72: approving a lease-terms change applies it and prepares the new contract version in one go.
  if (decision.decision !== "reject") {
    const [a] = await ctx.database.db.select().from(approvals).where(eq(approvals.id, approvalId));
    if (a && a.gate === "offer_out_of_limits" && isLeaseTermsProposal(a.proposal)) {
      if (decision.decision === "edit")
        throw unprocessable("A lease terms change can't be edited; reject it with a note instead.", [], "not_editable");
      return decideLeaseTerms(ctx, a, user);
    }
  }
  return withTx(ctx.database, (tx) => decideApprovalIn(ctx, tx, approvalId, user, decision, opts));
}

async function decideLeaseTerms(ctx: EngineContext, a: typeof approvals.$inferSelect, user: StaffUser) {
  if (a.status !== "pending") throw conflict(`approval is already ${a.status}`, "already_decided");
  if (!canDecideGate(a.gate, user.role)) throw forbidden(`${user.role} can't decide ${approvalGates[a.gate].label}`);
  if (a.proposedBy === userActor(user.id)) throw forbidden("you can't approve your own proposal");
  const problems = checkDecision(a.gate, a.proposal, { decision: "approve" }, ctx.clock.today());
  if (problems.length) throw unprocessable("decision breaks a rule or limit", problems, "rule_violation");
  const p = LeaseTermsProposal.parse(a.proposal);
  const { prepareFromMarks } = await import("./contract-changes.ts");
  await prepareFromMarks(
    ctx,
    p.leaseId,
    p.requestId,
    { decisions: p.decisions, ...(p.keepReasons ? { keepReasons: p.keepReasons } : {}) },
    user,
    a.id,
    {
      snapshot: { terms: p.terms, from: p.from, ...(p.notes ? { notes: p.notes } : {}) },
      marksHash: p.marksHash,
      change: p.change,
    },
  );
  const [done] = await ctx.database.db.select().from(approvals).where(eq(approvals.id, a.id));
  return done!;
}

/** D72: a manager rejected a lease terms change: nothing changed, the request stays open, the officer is told why. */
async function onLeaseTermsRejected(ctx: EngineContext, tx: Tx, a: typeof approvals.$inferSelect) {
  const p = LeaseTermsProposal.parse(a.proposal);
  const note = a.decisionNote?.trim() || "no reason given";
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: p.leaseId },
    type: "LEASE_TERMS_REJECTED",
    actor: a.decidedBy ? userActor(a.decidedBy) : "system",
    payload: { requestId: p.requestId, approvalId: a.id, note: note.slice(0, 500), to: p.to },
    rulesVersion: a.rulesVersion,
  });
  await createTask(ctx, tx, p.leaseId, {
    kind: "lease_terms_rejected",
    title:
      `A manager rejected the lease term change for ${p.leaseRef}: ${note}. The change request stays open: decide it again.`.slice(
        0,
        300,
      ),
    details: { approvalId: a.id, requestId: p.requestId },
    assigneeRole: "leasing_officer",
    dueOn: ctx.clock.today(),
    dedupeKey: `${a.id}:lease_terms_rejected`,
  });
}

export interface DecideOptions {
  /**
   * The person who prepared the proposal may decide it. Used only by the contract change marks route (the officer who
   * clicks "Approve changes" approves that version, including their own wording); the role check is unchanged.
   */
  allowPreparer?: boolean;
  /** D72: the lease terms were applied by `prepareFromMarks`, which decides a lease-terms approval itself. */
  leaseTermsApplied?: boolean;
}

/** `decideApproval` inside a transaction the caller already holds (so a preparation and its approval commit together). */
export async function decideApprovalIn(
  ctx: EngineContext,
  tx: Tx,
  approvalId: string,
  user: StaffUser,
  decision: ApprovalDecision,
  opts: DecideOptions = {},
) {
  const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
  if (!a) throw notFound("approval");
  if (a.status !== "pending") throw conflict(`approval is already ${a.status}`, "already_decided");
  if (!canDecideGate(a.gate, user.role)) throw forbidden(`${user.role} can't decide ${approvalGates[a.gate].label}`);
  if ((a.proposedBy === userActor(user.id) && !opts.allowPreparer) || a.proposedBy === `copilot:${user.id}`) {
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

  // D51: an approved offer outside limits is re-issued by code on the day of the decision, with the
  // manager's rent, cheques and move-in (if edited) and everything else recomputed; the bounds are
  // checked again on what actually goes out.
  let issuedOffer: Record<string, unknown> | null = null;
  let offerChanges: Record<string, { before: unknown; after: unknown }> | null = null;
  const leaseTerms = a.gate === "offer_out_of_limits" && isLeaseTermsProposal(a.proposal);
  if (leaseTerms && decision.decision !== "reject" && !opts.leaseTermsApplied)
    throw conflict("A lease terms change is approved from the approvals inbox.", "use_inbox");
  if (a.gate === "offer_out_of_limits" && !leaseTerms && decision.decision !== "reject") {
    const edits = decision.decision === "edit" ? decision.proposal : {};
    const r = await reissueOfferProposal(ctx, tx, OfferLimitsProposal.parse(a.proposal), edits);
    issuedOffer = {
      ...r.proposal,
      ...(decision.decision === "edit" && decision.proposal.note !== undefined ? { note: decision.proposal.note } : {}),
    };
    offerChanges = r.changes;
    const problems = checkDecision(a.gate, issuedOffer, { decision: "approve" }, ctx.clock.today());
    if (problems.length) throw unprocessable("decision breaks a rule or limit", problems, "rule_violation");
  }

  const status = decision.decision === "approve" ? "approved" : decision.decision === "reject" ? "rejected" : "edited";
  const editedProposal = decision.decision === "edit" ? (issuedOffer ?? { ...a.proposal, ...decision.proposal }) : null;
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
      ...(offerChanges && Object.keys(offerChanges).length ? { changes: offerChanges } : {}),
      // What an approved offer outside limits actually sends (re-issued on the decision day, D51).
      ...(issuedOffer ? { issuedTerms: issuedOffer.terms } : {}),
    },
    rulesVersion: a.rulesVersion,
  });
  if (status === "rejected" && a.gate === "offer_out_of_limits")
    await (leaseTerms ? onLeaseTermsRejected(ctx, tx, updated) : onOfferLimitsRejected(ctx, tx, updated));

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
  // Deposit refund (step 10): approved → finance pays and records it; rejected → the officer revises.
  if (a.gate === "refund") await onRefundDecided(ctx, tx, updated, status);
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
      // An approved offer outside limits sends the re-issued terms (fresh expiry), never the stale proposal.
      payload: issuedOffer ?? effectiveProposal(updated),
      tx,
    });
  }
  return updated;
}
