import { newId } from "@platform/kernel/ids";
import {
  isComplianceGate,
  isComplianceRole,
  mayDecide,
  neutralGate,
  rolesOf,
  parseDecisionFor,
  hasRole,
  type SpaActor,
  type SpaGateId,
  spaGates,
  type SpaRole,
} from "@spa/core";
import {
  deals,
  type GateEntityKind,
  listings,
  spaApprovals,
  spaTemplateVersions,
  type SpaTx,
  units,
  withSpaTx,
} from "@spa/db";
import { and, eq } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { applyAmlDecision } from "./aml-cases.ts";
import { driveAfter } from "./drive.ts";
import { applyHelperReviewDecision, type HeldDecision } from "./helper-modes.ts";
import { evaluateNoc } from "./noc.ts";
import { applyAgreementDecision, applyHeldPrepare, checkAgreementDecision } from "./prepare.ts";
import { advanceSettled, applySettlementDecision, checkSettlementDecision, refreshSettlement } from "./settlement.ts";
import { applyTemplateDecision } from "./templates.ts";

export interface ProposalInput {
  gate: SpaGateId;
  /** Gates open on a deal, unit, listing or template version (never on a settings record). */
  entity: { kind: GateEntityKind; id: string };
  /** One open proposal per key: a retried job doesn't create a second one. */
  dedupeKey: string;
  title: string;
  proposal: Record<string, unknown>;
  reasons?: string[];
  proposedBy: SpaActor;
}

/** The rulebook version events about this record carry: the deal's pinned version (AGENTS.md rule 4). */
async function rulesVersionOf(t: SpaTx, entity: { kind: GateEntityKind; id: string }): Promise<string | null> {
  if (entity.kind === "template") {
    const [v] = await t.db
      .select({ v: spaTemplateVersions.rulesVersion })
      .from(spaTemplateVersions)
      .where(eq(spaTemplateVersions.id, entity.id));
    return v?.v ?? null;
  }
  if (entity.kind !== "deal") return null;
  const [d] = await t.db.select({ v: deals.rulesVersion }).from(deals).where(eq(deals.id, entity.id));
  return d?.v ?? null;
}

/** Gates whose existence stays off the deal timeline: the event says only "compliance_review" (S42, tipping-off; the sets are in @spa/core's visibility). */
const visibleGate = neutralGate;

/** The note on an `aml_report` that the deciding compliance officer, who is also the MLRO, recorded in the same step. */
export const COMBINED_MLRO_NOTE = "The compliance officer is also the MLRO";

/** Opens a gate (S3): a pending `spa_approvals` row for the gate's role, and an `APPROVAL_PROPOSED` event. */
export async function proposeApproval(
  ctx: SpaContext,
  input: ProposalInput,
  tx?: SpaTx,
): Promise<{ id: string; created: boolean }> {
  const run = async (t: SpaTx) => {
    const table = { deal: deals, unit: units, listing: listings, template: spaTemplateVersions }[input.entity.kind];
    const [exists] = await t.db.select({ id: table.id }).from(table).where(eq(table.id, input.entity.id));
    if (!exists) throw notFound(input.entity.kind);
    const pendingWithKey = async () =>
      (
        await t.db
          .select({ id: spaApprovals.id })
          .from(spaApprovals)
          .where(and(eq(spaApprovals.dedupeKey, input.dedupeKey), eq(spaApprovals.status, "pending")))
      )[0];
    const existing = await pendingWithKey();
    if (existing) return { id: existing.id, created: false };
    const id = newId();
    // A concurrent proposal with the same key: the partial unique index makes one insert do nothing.
    const inserted = await t.db
      .insert(spaApprovals)
      .values({
        id,
        gate: input.gate,
        entityKind: input.entity.kind,
        entityId: input.entity.id,
        dedupeKey: input.dedupeKey,
        title: input.title,
        proposal: input.proposal,
        reasons: input.reasons ?? [],
        approverRole: spaGates[input.gate].approver,
        proposedBy: input.proposedBy,
        createdAt: ctx.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: spaApprovals.id });
    if (!inserted.length) {
      const winner = await pendingWithKey();
      if (winner) return { id: winner.id, created: false };
      throw conflict("proposal_race", "the same proposal was just decided; try again");
    }
    await appendDealEvent(t, ctx, {
      entity: input.entity,
      type: "APPROVAL_PROPOSED",
      rulesVersion: await rulesVersionOf(t, input.entity),
      actor: input.proposedBy,
      payload: { approvalId: id, gate: visibleGate(input.gate) },
    });
    return { id, created: true };
  };
  return tx ? run(tx) : withSpaTx(ctx.database, run);
}

/**
 * Withdraws the pending approvals of one gate on one entity because code found them stale (S77: the owners on the
 * ownership document now match, or the document changed). Only `pending` rows move; a decided one is never touched.
 * Each withdrawal is `cancelled` with the reason as its note, and appends an `APPROVAL_WITHDRAWN` event.
 */
export async function withdrawPendingApprovals(
  tx: SpaTx,
  ctx: SpaContext,
  input: { gate: SpaGateId; entity: { kind: GateEntityKind; id: string }; reason: string; actor: SpaActor },
): Promise<number> {
  const rows = await tx.db
    .update(spaApprovals)
    .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: input.reason })
    .where(
      and(
        eq(spaApprovals.gate, input.gate),
        eq(spaApprovals.entityKind, input.entity.kind),
        eq(spaApprovals.entityId, input.entity.id),
        eq(spaApprovals.status, "pending"),
      ),
    )
    .returning({ id: spaApprovals.id });
  for (const a of rows)
    await appendDealEvent(tx, ctx, {
      entity: input.entity,
      type: "APPROVAL_WITHDRAWN",
      rulesVersion: await rulesVersionOf(tx, input.entity),
      actor: input.actor,
      payload: { approvalId: a.id, gate: visibleGate(input.gate), reason: input.reason },
    });
  return rows.length;
}

/**
 * A person decides a pending gate: right role, not admin, not their own proposal (S3). `aml_flag` takes an outcome;
 * "stop and report" also opens `aml_report` for the MLRO.
 */
export async function decideApproval(
  ctx: SpaContext,
  approvalId: string,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
  input: unknown,
): Promise<{ status: string; outcome?: string }> {
  // S53: set when this decision approved a registry submission gate; the job is queued after the commit.
  const approvedSubmission: { v: { approvalId: string; gate: SpaGateId; dealId: string } | null } = { v: null };
  // S59: set when this decision released a held helper result; the deal is driven after the commit.
  const releasedHold: { v: HeldDecision | null } = { v: null };
  const result = await withSpaTx(ctx.database, async (tx) => {
    // Lock order is deal, then approval, the same as `advance` (review 15): read the approval's record first without
    // a lock, lock the deal row when it is a deal's, then lock the approval and read it again.
    const [peek] = await tx.db
      .select({ kind: spaApprovals.entityKind, id: spaApprovals.entityId })
      .from(spaApprovals)
      .where(eq(spaApprovals.id, approvalId));
    if (!peek) throw notFound("approval");
    if (peek.kind === "deal")
      await tx.db.select({ id: deals.id }).from(deals).where(eq(deals.id, peek.id)).for("update");
    const [a] = await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, approvalId)).for("update");
    if (!a) throw notFound("approval");
    const may = mayDecide({ gate: a.gate, proposedBy: a.proposedBy }, user);
    if (!may.ok) throw forbidden(may.reason);
    if (a.status !== "pending") throw conflict("not_pending", `this approval is already ${a.status}`);
    let d;
    try {
      d = parseDecisionFor(a.gate, input);
    } catch (e) {
      throw unprocessable("invalid_decision", e instanceof Error ? e.message : "invalid decision");
    }
    // S53: a registry submission is approved or rejected, never edited (the payload is code's, built from the deal).
    if ((a.gate === "oqood_submission" || a.gate === "transfer_submission") && d.decision === "edit")
      throw unprocessable("edit_not_allowed", "a registry submission is approved or rejected, not edited");
    // S59: a helper result is "looks right" or "doesn't"; the result itself is code's, so there is nothing to edit.
    if (a.gate === "helper_review" && d.decision === "edit")
      throw unprocessable("edit_not_allowed", "a helper result is approved or rejected, not edited");
    // M6 (S81): a price or booking approval is approved or rejected. Nothing applies an edited value, so an edit could
    // only be ignored (or lower a limit more than the manager meant): a different price is a new deal.
    if (
      a.gate === "price_out_of_range" &&
      d.decision === "edit" &&
      (a.proposal.kind === "price" || a.proposal.kind === "booking")
    )
      throw unprocessable("edit_not_allowed", "a price or booking is approved or rejected, not edited");
    // S48: finance approves only a statement that still holds (checked now, before anything is written).
    if (a.gate === "settlement_approval" && d.decision !== "aml") await checkSettlementDecision(tx, a, d.decision);
    // S51: legal approves only an agreement whose deal hasn't moved since it was prepared.
    if (a.gate === "agreement_approval" && d.decision !== "aml") await checkAgreementDecision(tx, a, d.decision);
    const status =
      d.decision === "aml"
        ? d.outcome === "clear"
          ? "approved"
          : "rejected"
        : d.decision === "approve"
          ? "approved"
          : d.decision === "reject"
            ? "rejected"
            : "edited";
    const outcome = d.decision === "aml" ? d.outcome : undefined;
    await tx.db
      .update(spaApprovals)
      .set({
        status,
        outcome: outcome ?? null,
        decidedBy: user.id,
        decidedAt: ctx.clock.now(),
        decisionNote: d.note ?? null,
        editedProposal: d.decision === "edit" ? d.proposal : null,
      })
      .where(eq(spaApprovals.id, approvalId));
    // S45: a template version's own rules (checks must pass; the previous approved version retires) in this
    // transaction, after the approval row says approved (the database trigger requires it); a throw rolls both back.
    if (a.gate === "template_approval" && d.decision !== "aml")
      await applyTemplateDecision(tx, ctx, a.entityId, d.decision);
    if (a.gate === "settlement_approval" && (d.decision === "approve" || d.decision === "reject"))
      await applySettlementDecision(tx, ctx, a, d.decision);
    const actor: SpaActor = `user:${user.id}`;
    const entity = { kind: a.entityKind as GateEntityKind, id: a.entityId };
    await appendDealEvent(tx, ctx, {
      entity,
      type: "APPROVAL_DECIDED",
      rulesVersion: await rulesVersionOf(tx, entity),
      actor,
      // AML outcomes stay on the compliance-only approval row, never on the deal timeline (S6, final review #1).
      // A compliance gate's status (approved for clear, rejected for the rest) would say how compliance decided: left out.
      payload: isComplianceGate(a.gate)
        ? { approvalId, gate: visibleGate(a.gate) }
        : { approvalId, gate: visibleGate(a.gate), status },
    });
    // S47: an approved or rejected NOC review re-checks the NOC in this transaction; an approval lets the deal move on.
    if (a.gate === "noc_review" && a.entityKind === "deal") await evaluateNoc(ctx, a.entityId, tx);
    // S48: an approved statement moves the deal to TRANSFER; an approved or rejected broker commission changes the
    // statement's commission lines, so it is rebuilt.
    if (a.gate === "settlement_approval" && d.decision === "approve") await advanceSettled(ctx, tx, a.entityId);
    if (a.gate === "price_out_of_range" && a.entityKind === "deal" && a.proposal.commissionBps !== undefined)
      await refreshSettlement(ctx, tx, a.entityId);
    // S51: an approved agreement moves the deal to SIGNING; a rejected one is superseded and the deal returns.
    if (a.gate === "agreement_approval" && (d.decision === "approve" || d.decision === "reject"))
      await applyAgreementDecision(tx, ctx, a, d.decision);
    // S50: the decision reaches the case and the deal (clear returns it, stop cancels it, more_info keeps the hold).
    if (a.gate === "aml_flag" && d.decision === "aml") await applyAmlDecision(tx, ctx, a, d.outcome, actor);
    if (outcome === "stop_and_report") {
      const report = await proposeApproval(
        ctx,
        {
          gate: "aml_report",
          entity,
          dedupeKey: `${a.entityId}:aml_report:${approvalId}`,
          title: "Compliance review",
          proposal: { fromApproval: approvalId },
          proposedBy: actor,
        },
        tx,
      );
      // M5c (S83): one person who is both the compliance officer and the MLRO. The report is still recorded, for the
      // audit trail and the report record, but it is decided in this same step by that user: left pending it could
      // never be decided, because nobody decides their own proposal. With two people nothing changes: it waits for the MLRO.
      if (report.created && hasRole(user, "mlro")) {
        await tx.db
          .update(spaApprovals)
          .set({
            status: "approved",
            decidedBy: user.id,
            decidedAt: ctx.clock.now(),
            decisionNote: COMBINED_MLRO_NOTE,
          })
          .where(eq(spaApprovals.id, report.id));
        await appendDealEvent(tx, ctx, {
          entity,
          type: "APPROVAL_DECIDED",
          rulesVersion: await rulesVersionOf(tx, entity),
          actor,
          payload: { approvalId: report.id, gate: visibleGate("aml_report") },
        });
      }
    }
    // S59: "looks right" releases the held result; a rejection closes it and opens the agent's task.
    if (a.gate === "helper_review" && (d.decision === "approve" || d.decision === "reject"))
      releasedHold.v = await applyHelperReviewDecision(tx, ctx, a, d.decision, user);
    // S59: a released preparation goes to legal (PREPARED and the agreement_approval) if it is still current.
    if (releasedHold.v?.decision === "released" && releasedHold.v.helper === "spa_prepare") {
      const agreementId = releasedHold.v.result.agreementId;
      if (typeof agreementId === "string") await applyHeldPrepare(ctx, tx, releasedHold.v.dealId, agreementId);
    }
    // S59: a released reader result lets the NOC steps take what the facts now allow (the existing NOC drive).
    if (releasedHold.v?.decision === "released" && releasedHold.v.helper === "spa_document_reader")
      await evaluateNoc(ctx, releasedHold.v.dealId, tx);
    if ((a.gate === "oqood_submission" || a.gate === "transfer_submission") && d.decision === "approve")
      approvedSubmission.v = { approvalId, gate: a.gate, dealId: a.entityId };
    return { status, ...(outcome ? { outcome } : {}) };
  });
  // S53: queued only once the approval is committed. A queue that is down never undoes the decision.
  if (approvedSubmission.v && ctx.onGateApproved)
    await ctx
      .onGateApproved(approvedSubmission.v)
      .catch((err: unknown) => console.warn(`could not queue the registry submission: ${(err as Error).message}`));
  // S59: a released result counts now, so the deal takes the next step its facts allow (after the commit).
  if (releasedHold.v?.decision === "released") {
    await driveAfter(ctx, releasedHold.v.dealId);
    await ctx
      .onHelperReleased?.(releasedHold.v)
      .catch((err: unknown) =>
        console.warn(`could not continue after a released helper result: ${(err as Error).message}`),
      );
  }
  return result;
}

/** The keys a decision body may carry. A role, an actor or any identity is never one of them: the session says who decides. */
export const DECISION_KEYS: ReadonlySet<string> = new Set(["decision", "note", "proposal", "outcome"]);
export const isDecisionBody = (b: unknown): b is Record<string, unknown> =>
  !!b && typeof b === "object" && !Array.isArray(b) && Object.keys(b).every((k) => DECISION_KEYS.has(k));

/**
 * The decide route's entry (C29, S57): the user is the session's, never the body's. A role with no part in a compliance
 * gate gets a plain refusal that says nothing about the gate, so it learns nothing from the answer.
 */
export async function decideForSession(
  ctx: SpaContext,
  approvalId: string,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
  body: Record<string, unknown>,
) {
  const [a] = await ctx.database.db
    .select({ gate: spaApprovals.gate })
    .from(spaApprovals)
    .where(eq(spaApprovals.id, approvalId));
  if (!a) throw notFound("approval");
  if (isComplianceGate(a.gate) && !isComplianceRole(rolesOf(user))) throw forbidden("you can't decide this");
  return decideApproval(ctx, approvalId, user, body);
}
