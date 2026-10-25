import {
  type Actor,
  type ApplicationEvent,
  applicationMachine,
  type CalendarDate,
  type EntityRef,
  type GateId,
  isCalendarDate,
  LEASE_STATES_WITH_LIVE_EJARI,
  type LeaseEvent,
  leaseMachine,
  OfferTerms,
  type UnitEvent,
  unitMachine,
} from "@leasing/core";
import { applications, approvals, deadlines, helperRuns, leases, parties, type Tx, units, withTx } from "@leasing/db";
import { KycData, offerProblems } from "@leasing/helpers";
import {
  getRulebook,
  noticeSentInTime,
  ownUseRelistAllowedFrom,
  renewalMilestones,
  rulesVersionForTerm,
} from "@leasing/rulebook";
import { and, eq, inArray, isNotNull, isNull, notLike, sql } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { PAYMENT_MILESTONES, scheduleTermPayments } from "./collections.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import { ensureMoveInInspection, moveInMissing } from "./move-in.ts";
import { onEnterMoveOut } from "./move-out.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { sentAtOfApproval } from "./outbound.ts";
import { applyVerifiedIdentity, onEnterApplication } from "./applications.ts";
import { assertSignedContract } from "./contracts.ts";
import { assertIssuedSubmission, proposeEjariSubmission } from "./registration.ts";
import {
  effectiveProposal,
  identityExpiryProblems,
  KycReviewProposal,
  RenewalNoticeProposal,
  VacateNoticeProposal,
  vacateNoticeProblems,
} from "./gate-rules.ts";
import { createTask, draftRenewalNotice, isRenewalCycleKey, scheduleLeaseMilestones } from "./milestones.ts";

export type AnyEvent = UnitEvent | ApplicationEvent | LeaseEvent;

export interface AdvanceOptions {
  actor: Actor;
  payload?: Record<string, unknown>;
  /** Required for gated transitions: an approved, unused approval of that gate for this entity. */
  approvalId?: string;
  /** Join the caller's transaction instead of opening one. */
  tx?: Tx;
  /** Rules version recorded on unit/application events (cascades pass the lease's). */
  rulesVersion?: string;
}

export interface AdvanceResult {
  entity: EntityRef;
  event: AnyEvent;
  from: string;
  to: string;
  eventId: string;
}

type ApprovalRow = typeof approvals.$inferSelect;
type LeaseRow = typeof leases.$inferSelect;

const calDate = z
  .string()
  .refine(isCalendarDate, "expected YYYY-MM-DD")
  .transform((s) => s as CalendarDate);
const leasePatches: Partial<Record<LeaseEvent, z.ZodType<Record<string, unknown>>>> = {
  EJARI_ISSUED: z
    .object({ ejariNo: z.string().trim().min(1), issuedOn: calDate })
    .transform((p) => ({ ejariNo: p.ejariNo, ejariIssuedOn: p.issuedOn })),
  // The move-out date the tenant gave (the lease end unless a person agreed an earlier one).
  TENANT_VACATE_NOTICE: z
    .object({ moveOutOn: calDate.optional() })
    .transform((p): Record<string, unknown> => (p.moveOutOn ? { moveOutOn: p.moveOutOn } : {})),
  RENEWED: z
    .object({ startOn: calDate, endOn: calDate, annualRentFils: z.number().int().positive() })
    .transform((p) => ({ startOn: p.startOn, endOn: p.endOn, annualRentFils: p.annualRentFils })),
};

/**
 * The only way entity state changes (AGENTS.md rule 2). In one transaction: lock the row, check
 * the transition, its guard and gate, write the new state and a `lease_events` row, then run the
 * `onEnter` work (schedule milestones, cascade to the unit).
 */
export async function advance(
  ctx: EngineContext,
  entity: EntityRef,
  event: AnyEvent,
  opts: AdvanceOptions,
): Promise<AdvanceResult> {
  if (opts.tx) return advanceInTx(ctx, opts.tx, entity, event, opts);
  return withTx(ctx.database, (tx) => advanceInTx(ctx, tx, entity, event, opts));
}

async function advanceInTx(
  ctx: EngineContext,
  tx: Tx,
  entity: EntityRef,
  event: AnyEvent,
  opts: AdvanceOptions,
): Promise<AdvanceResult> {
  switch (entity.kind) {
    case "unit":
      return advanceUnit(ctx, tx, entity.id, event as UnitEvent, opts);
    case "application":
      return advanceApplication(ctx, tx, entity.id, event as ApplicationEvent, opts);
    case "lease":
      return advanceLease(ctx, tx, entity.id, event as LeaseEvent, opts);
    case "rulebook":
      // Rulebook versions have no state machine; drafts are published through the rulebook API.
      throw new Error("advance() does not apply to rulebook versions");
    case "conversation":
      // Enquiry conversations have no state machine; their bookings go through the application.
      throw new Error("advance() does not apply to conversations");
  }
}

async function advanceUnit(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  event: UnitEvent,
  opts: AdvanceOptions,
): Promise<AdvanceResult> {
  const [unit] = await tx.db.select().from(units).where(eq(units.id, id)).for("update");
  if (!unit) throw notFound("unit");
  const t = unitMachine.transitions.find((x) => x.from === unit.state && x.event === event);
  if (!t) throw conflict(`unit in ${unit.state} does not accept ${event}`, "transition_not_allowed");
  const today = ctx.clock.today();
  const guard = t.guard?.({
    unit,
    today,
    policy: await getCompanyPolicy(tx, today),
    hasActiveEjari: await unitHasActiveEjari(tx, id),
    hasContractedLease: await unitHasContractedLease(tx, id),
  });
  if (guard && !guard.ok) throw unprocessable(`cannot ${event}`, guard.reasons, "guard_failed");
  const approval = t.gate ? await usableApproval(tx, t.gate, { kind: "unit", id }, opts.approvalId) : undefined;

  await tx.db.update(units).set({ state: t.to, updatedAt: ctx.clock.now() }).where(eq(units.id, id));
  const eventId = await appendEvent(tx, ctx, {
    entity: { kind: "unit", id },
    type: event,
    actor: opts.actor,
    fromState: t.from,
    toState: t.to,
    payload: { ...opts.payload, ...(approval ? { approvalId: approval.id } : {}) },
    rulesVersion: opts.rulesVersion ?? ctx.rulesVersion,
  });
  if (approval) await markConsumed(tx, approval.id, eventId);
  return { entity: { kind: "unit", id }, event, from: t.from, to: t.to, eventId };
}

async function advanceApplication(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  event: ApplicationEvent,
  opts: AdvanceOptions,
): Promise<AdvanceResult> {
  const [app] = await tx.db.select().from(applications).where(eq(applications.id, id)).for("update");
  if (!app) throw notFound("application");
  const t = applicationMachine.transitions.find((x) => x.from === app.state && x.event === event);
  if (!t) throw conflict(`application in ${app.state} does not accept ${event}`, "transition_not_allowed");
  const guard = t.guard?.({ reservationPaid: app.reservationPaidOn !== null });
  if (guard && !guard.ok) throw unprocessable(`cannot ${event}`, guard.reasons, "guard_failed");

  // Conditional gates, enforced here: KYC needs a clean check or an approved review; offer
  // terms outside company limits need an approved offer_out_of_limits.
  let approval: ApprovalRow | undefined;
  const patch: Partial<typeof applications.$inferInsert> = {};
  if (event === "KYC_VERIFIED") {
    const basis = await kycBasis(tx, app, opts, ctx.clock.today());
    approval = basis.approval;
    // Linking to an existing party with the same Emirates ID needs an officer's approval.
    const { partyId, linked } = await applyVerifiedIdentity(ctx, tx, app, basis.identity, basis.documentIds, {
      allowLink: !!basis.approval,
      actor: opts.actor,
    });
    if (linked) opts = { ...opts, payload: { ...opts.payload, linkedToPartyId: partyId } };
  }
  if (event === "OFFER_REVISED") {
    const { terms } = z
      .object({ terms: OfferTerms })
      .passthrough()
      .parse(opts.payload ?? {});
    if (terms.revision !== (app.offer?.revision ?? 0) + 1) {
      throw conflict(`offer revision ${terms.revision} is out of date`, "stale_revision");
    }
    const [unit] = await tx.db.select().from(units).where(eq(units.id, app.unitId));
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    if (!unit?.askingRentFils) throw conflict("the unit has no approved asking rent", "no_price");
    // Limits are judged against the unit's approved asking rent today, not the one stored in the offer.
    const problems = offerProblems(
      terms,
      { askingRentFils: unit.askingRentFils, furnished: !!unit.furnished },
      policy,
      ctx.clock.today(),
    );
    if (problems.length)
      approval = await usableApproval(tx, "offer_out_of_limits", { kind: "application", id }, opts.approvalId);
    patch.offer = terms;
    patch.offerAcceptedAt = null;
  }

  await tx.db
    .update(applications)
    .set({ ...patch, state: t.to, updatedAt: ctx.clock.now() })
    .where(eq(applications.id, id));
  const eventId = await appendEvent(tx, ctx, {
    entity: { kind: "application", id },
    type: event,
    actor: opts.actor,
    fromState: t.from,
    toState: t.to,
    payload: { ...opts.payload, ...(approval ? { approvalId: approval.id } : {}) },
    rulesVersion: opts.rulesVersion ?? ctx.rulesVersion,
  });
  if (approval) await markConsumed(tx, approval.id, eventId);
  const [updated] = await tx.db.select().from(applications).where(eq(applications.id, id));
  await onEnterApplication(ctx, tx, updated!, t.from, opts.actor);
  return { entity: { kind: "application", id }, event, from: t.from, to: t.to, eventId };
}

/** What KYC_VERIFIED rests on: an approved kyc_review, or a KYC helper run with nothing flagged. */
async function kycBasis(tx: Tx, app: typeof applications.$inferSelect, opts: AdvanceOptions, today: CalendarDate) {
  const [party] = await tx.db.select({ kind: parties.kind }).from(parties).where(eq(parties.id, app.partyId));
  const kind = party?.kind ?? "individual";
  if (opts.approvalId) {
    const approval = await usableApproval(tx, "kyc_review", { kind: "application", id: app.id }, opts.approvalId);
    const p = KycReviewProposal.parse(effectiveProposal(approval));
    if (p.flags.some((f) => f.blocking))
      throw unprocessable("a blocking KYC problem can't be approved", [], "rule_violation");
    if (!p.identity) throw unprocessable("no identity was read from the documents", [], "rule_violation");
    // Re-checked on the day of approval: a document may have expired since it was read.
    const expired = identityExpiryProblems(p.identity, kind, today);
    if (expired.length) throw unprocessable("a document is not valid today", expired, "rule_violation");
    return { approval, identity: p.identity, documentIds: p.documentIds };
  }
  const helperRunId = z.object({ helperRunId: z.string() }).safeParse(opts.payload ?? {});
  const [run] = helperRunId.success
    ? await tx.db
        .select()
        .from(helperRuns)
        .where(
          and(
            eq(helperRuns.id, helperRunId.data.helperRunId),
            eq(helperRuns.entityId, app.id),
            eq(helperRuns.helper, "kyc"),
          ),
        )
    : [];
  const data = KycData.safeParse((run?.output as { data?: unknown } | null)?.data);
  if (!run || run.status !== "ok" || !data.success || data.data.verdict !== "verified" || data.data.flags.length) {
    throw conflict("KYC needs a clean check or an approved KYC review", "gate_required");
  }
  const expired = identityExpiryProblems(data.data.identity, kind, today);
  if (expired.length) throw conflict("a document is not valid today", "gate_required");
  const documentIds = z.object({ documentIds: z.array(z.string()) }).safeParse(opts.payload ?? {});
  return {
    approval: undefined,
    identity: data.data.identity,
    documentIds: documentIds.success ? documentIds.data.documentIds : [],
  };
}

async function advanceLease(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  event: LeaseEvent,
  opts: AdvanceOptions,
): Promise<AdvanceResult> {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, id)).for("update");
  if (!lease) throw notFound("lease");
  const t = leaseMachine.transitions.find((x) => x.from === lease.state && x.event === event);
  if (!t) throw conflict(`lease in ${lease.state} does not accept ${event}`, "transition_not_allowed");

  const patchSchema = leasePatches[event];
  let patch: Record<string, unknown> = {};
  if (patchSchema) {
    const parsed = patchSchema.safeParse(opts.payload ?? {});
    if (!parsed.success)
      throw unprocessable(
        `invalid ${event} payload`,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        "invalid_payload",
      );
    patch = parsed.data;
  }
  const merged = { ...lease, ...patch } as LeaseRow;
  const today = ctx.clock.today();
  // RENEWED checks the new term against the current one, so its guard sees the unpatched lease.
  const guard = t.guard?.({
    lease: event === "RENEWED" ? lease : merged,
    today,
    newTerm: event === "RENEWED" ? { startOn: merged.startOn, endOn: merged.endOn } : undefined,
    // Move-in (step 7): the checklist is read inside this transaction, so it can't change under us.
    moveInMissing: event === "MOVE_IN_COMPLETED" ? await moveInMissing(ctx, tx, id) : undefined,
  });
  if (guard && !guard.ok) throw unprocessable(`cannot ${event}`, guard.reasons, "guard_failed");

  const approval = t.gate ? await usableApproval(tx, t.gate, { kind: "lease", id }, opts.approvalId) : undefined;
  let vacate: VacateNoticeProposal | undefined;
  if (event === "RENEWED") {
    assertRenewalMatchesApproval(lease, merged, approval);
    await assertIncreaseNoticeSentInTime(tx, lease, merged, approval!);
  }
  if (event === "TERMINATED") vacate = assertVacateNoticeValid(lease, approval, today);
  if (event === "CONTRACT_SIGNED") await assertSignedContract(tx, id, approval!.id, opts.payload ?? {});
  if (event === "EJARI_ISSUED") await assertIssuedSubmission(tx, id, approval!.id, opts.payload ?? {});

  // The renewal itself was checked under the lease's pinned version; the new term is pinned to the
  // version in force on its start date, so its notice and cap milestones follow those rules (D23).
  const repin = event === "RENEWED" ? { rulesVersion: rulesVersionForTerm(merged.startOn) } : {};
  await tx.db
    .update(leases)
    .set({ ...patch, ...repin, state: t.to, updatedAt: ctx.clock.now() })
    .where(eq(leases.id, id));
  const audit: Record<string, unknown> = { ...opts.payload, ...(approval ? { approvalId: approval.id } : {}) };
  if (event === "RENEWED") {
    audit.previous = { startOn: lease.startOn, endOn: lease.endOn, annualRentFils: lease.annualRentFils };
    audit.nextTermRulesVersion = repin.rulesVersion;
  }
  const eventId = await appendEvent(tx, ctx, {
    entity: { kind: "lease", id },
    type: event,
    actor: opts.actor,
    fromState: t.from,
    toState: t.to,
    payload: audit,
    rulesVersion: lease.rulesVersion,
  });
  if (approval) await markConsumed(tx, approval.id, eventId);

  if (vacate?.ground === "own_use") {
    const lockUntil = ownUseRelistAllowedFrom(today, vacate.propertyKind, getRulebook(lease.rulesVersion));
    await tx.db.update(units).set({ ownUseLockUntil: lockUntil }).where(eq(units.id, lease.unitId));
  }
  await onEnterLease(ctx, tx, { ...merged, ...repin, state: t.to }, t.from, opts.actor);
  return { entity: { kind: "lease", id }, event, from: t.from, to: t.to, eventId };
}

/** RENEWED applies exactly the term and rent a person approved for this cycle. Fails closed. */
function assertRenewalMatchesApproval(lease: LeaseRow, next: LeaseRow, approval: ApprovalRow | undefined): void {
  if (!approval || !isRenewalCycleKey(approval.dedupeKey, lease.id, lease.endOn)) {
    throw conflict("renewal needs the approved renewal notice for this term", "gate_required");
  }
  const parsed = RenewalNoticeProposal.safeParse(effectiveProposal(approval));
  if (!parsed.success) throw conflict("approved renewal notice is malformed", "gate_required");
  const p = parsed.data;
  const reasons: string[] = [];
  if (p.leaseId !== lease.id || p.leaseEndOn !== lease.endOn) reasons.push("approval is for another term");
  if (next.annualRentFils !== p.proposedRentFils) reasons.push(`approved rent is ${p.proposedRentFils} fils`);
  if (next.startOn !== p.newTermStartOn || next.endOn !== p.newTermEndOn) {
    reasons.push(`approved term is ${p.newTermStartOn} → ${p.newTermEndOn}`);
  }
  if (reasons.length) throw unprocessable("renewal differs from the approved notice", reasons, "gate_required");
}

/**
 * A rent increase only stands if the tenant was given notice in time: the notice email must have
 * been accepted by SMTP on or before T−90 (Dubai date). Approval alone is not enough.
 */
async function assertIncreaseNoticeSentInTime(
  tx: Tx,
  lease: LeaseRow,
  next: LeaseRow,
  approval: ApprovalRow,
): Promise<void> {
  if (next.annualRentFils <= lease.annualRentFils) return;
  // The notice of the approval being applied, so this agrees with `renewableApproval`.
  const sentAt = await sentAtOfApproval(tx, approval.id);
  const r = getRulebook(lease.rulesVersion);
  if (!sentAt || !noticeSentInTime(sentAt, lease.endOn, r)) {
    throw unprocessable(
      "a rent increase needs a notice sent in time",
      [
        sentAt
          ? `the notice for this approval was sent on ${sentAt.toISOString()}`
          : "the approved notice was never emailed",
        `it had to leave by ${r.renewalNoticeDays} days before ${lease.endOn} (${r.version})`,
      ],
      "gate_required",
    );
  }
}

/** TERMINATED re-checks the approved repossession notice (ground, delivery, 12-month deadline). */
function assertVacateNoticeValid(
  lease: LeaseRow,
  approval: ApprovalRow | undefined,
  today: CalendarDate,
): VacateNoticeProposal {
  if (!approval) throw conflict("vacate_notice approval required", "gate_required");
  const raw = effectiveProposal(approval);
  const problems = vacateNoticeProblems(raw, today);
  const parsed = VacateNoticeProposal.safeParse(raw);
  if (problems.length || !parsed.success)
    throw unprocessable("repossession notice is not valid", problems, "rule_violation");
  if (parsed.data.leaseId !== lease.id || parsed.data.leaseEndOn !== lease.endOn) {
    throw unprocessable("repossession notice is for another term", [], "rule_violation");
  }
  return parsed.data;
}

async function onEnterLease(ctx: EngineContext, tx: Tx, lease: LeaseRow, from: string, actor: Actor): Promise<void> {
  const [unit] = await tx.db.select({ state: units.state }).from(units).where(eq(units.id, lease.unitId));
  const cascade = { actor, payload: { leaseId: lease.id }, rulesVersion: lease.rulesVersion };
  switch (lease.state) {
    case "MOVE_IN":
      // Step 7: the checklist exists from the moment the keys can be handed over.
      await ensureMoveInInspection(ctx, tx, lease.id);
      return;
    case "REGISTRATION":
      // Step 6: the submission is built from the signed contract and waits for an officer.
      await proposeEjariSubmission(ctx, tx, lease, "system");
      return;
    case "ACTIVE": {
      await scheduleLeaseMilestones(ctx, tx, lease);
      // Rent instalments for this term (a renewed term gets its own); finance confirms each (D27).
      if (from === "MOVE_IN" || from === "RENEWAL")
        await scheduleTermPayments(ctx, tx, lease, { assumePastPaid: false });
      // The tenant confirms the move-in report and gets their portal link.
      if (from === "MOVE_IN")
        await queueLeaseMail(ctx, tx, { leaseId: lease.id, kind: "move_in", key: lease.id, seq: 1 });
      if (unit?.state === "LISTED" || unit?.state === "READY") {
        await advanceUnit(ctx, tx, lease.unitId, "LEASE_ACTIVATED", cascade);
      }
      if (from === "RENEWAL") {
        // The old term's remaining milestones no longer apply (they would be skipped anyway).
        await tx.db
          .update(deadlines)
          .set({ status: "cancelled", note: "lease renewed for a new term" })
          .where(
            and(
              eq(deadlines.entityId, lease.id),
              eq(deadlines.status, "pending"),
              notLike(deadlines.milestone, `%@${lease.endOn}`),
              // Payment deadlines follow the payment, not the term: an unpaid cheque still gets chased.
              ...PAYMENT_MILESTONES.map((m) => notLike(deadlines.milestone, `${m}@%`)),
            ),
          );
        await cancelPendingApprovals(ctx, tx, lease.id, ["renewal_notice"]);
        await createTask(ctx, tx, lease.id, {
          kind: "ejari_renewal",
          title: `Renew the Ejari registration for ${lease.ref} (new term ${lease.startOn} → ${lease.endOn})`,
          details: { ejariNo: lease.ejariNo },
          assigneeRole: "leasing_officer",
          dueOn: lease.startOn,
          dedupeKey: `${lease.id}:ejari_renewal@${lease.endOn}`,
        });
        return;
      }
      // Entering ACTIVE after T−5 months (late move-in, short term, dispute resolved): the
      // renewal window opens now and the notice is drafted while one is still legal.
      const r = getRulebook(lease.rulesVersion);
      const ms = renewalMilestones(lease.endOn, r);
      const assess = ms.find((m) => m.id === "renewal_assess")?.dueOn;
      const deadline = ms.find((m) => m.id === "notice_deadline")?.dueOn;
      const today = ctx.clock.today();
      if (assess && today >= assess && today <= lease.endOn) {
        await advanceLease(ctx, tx, lease.id, "RENEWAL_WINDOW_OPENED", { actor: "system", payload: { catchUp: true } });
        if (deadline && today <= deadline) await draftRenewalNotice(ctx, tx, { ...lease, state: "RENEWAL" }, null);
      }
      return;
    }
    case "MOVE_OUT":
      if (from === "ACTIVE" || from === "RENEWAL")
        await cancelPendingDeadlines(tx, lease.id, ["lease_end", ...PAYMENT_MILESTONES]);
      await cancelPendingApprovals(ctx, tx, lease.id, ["renewal_notice"]);
      // Step 10: the inspection, its booking email and the move-out milestone.
      await onEnterMoveOut(ctx, tx, lease);
      return;
    case "CLOSED":
      await cancelPendingDeadlines(tx, lease.id, []);
      await cancelPendingApprovals(ctx, tx, lease.id, null);
      await extendOwnUseLock(ctx, tx, lease);
      if (unit?.state === "OCCUPIED") await advanceUnit(ctx, tx, lease.unitId, "LEASE_CLOSED", cascade);
      return;
  }
}

async function cancelPendingDeadlines(tx: Tx, leaseId: string, keepPrefixes: string[]): Promise<void> {
  await tx.db
    .update(deadlines)
    .set({ status: "cancelled", note: "lease left the renewal path" })
    .where(
      and(
        eq(deadlines.entityId, leaseId),
        eq(deadlines.status, "pending"),
        ...keepPrefixes.map((p) => notLike(deadlines.milestone, `${p}@%`)),
      ),
    );
}

/** Pending proposals that no longer apply are closed as `cancelled` (nobody decided them). */
async function cancelPendingApprovals(ctx: EngineContext, tx: Tx, leaseId: string, gates: GateId[] | null) {
  const cancelled = await tx.db
    .update(approvals)
    .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: "lease left the path this was for" })
    .where(
      and(
        eq(approvals.entityId, leaseId),
        eq(approvals.status, "pending"),
        ...(gates ? [inArray(approvals.gate, gates)] : []),
      ),
    )
    .returning({ id: approvals.id, gate: approvals.gate });
  for (const a of cancelled) {
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "APPROVAL_CANCELLED",
      actor: "system",
      payload: { approvalId: a.id, gate: a.gate },
    });
  }
}

async function usableApproval(
  tx: Tx,
  gate: GateId,
  entity: EntityRef,
  approvalId: string | undefined,
): Promise<ApprovalRow> {
  if (!approvalId) throw conflict(`${gate} approval required`, "gate_required");
  const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
  if (!a) throw notFound("approval");
  const reasons: string[] = [];
  if (a.gate !== gate) reasons.push(`approval is for ${a.gate}, not ${gate}`);
  if (a.entityKind !== entity.kind || a.entityId !== entity.id) reasons.push("approval is for another entity");
  if (a.status !== "approved" && a.status !== "edited") reasons.push(`approval is ${a.status}`);
  if (a.consumedByEventId) reasons.push("approval was already used");
  if (reasons.length) throw conflict(`${gate} approval not usable: ${reasons.join("; ")}`, "gate_required");
  return a;
}

async function markConsumed(tx: Tx, approvalId: string, eventId: string): Promise<void> {
  await tx.db.update(approvals).set({ consumedByEventId: eventId }).where(eq(approvals.id, approvalId));
}

/** True while a lease on the unit is signed up but not yet active. */
export async function unitHasContractedLease(tx: Tx, unitId: string): Promise<boolean> {
  const rows = await tx.db
    .select({ id: leases.id })
    .from(leases)
    .where(and(eq(leases.unitId, unitId), inArray(leases.state, ["CONTRACT", "REGISTRATION", "MOVE_IN"])))
    .limit(1);
  return rows.length > 0;
}

/**
 * Own-use repossession: the relist lock runs from the day the tenant actually leaves. It is set
 * at TERMINATED and extended at CLOSED (never shortened). CONFIRM WITH LEGAL which date starts it.
 */
async function extendOwnUseLock(ctx: EngineContext, tx: Tx, lease: LeaseRow): Promise<void> {
  const used = await tx.db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.entityId, lease.id),
        eq(approvals.gate, "vacate_notice"),
        isNotNull(approvals.consumedByEventId),
      ),
    );
  for (const a of used) {
    const p = VacateNoticeProposal.safeParse(effectiveProposal(a));
    if (!p.success || p.data.ground !== "own_use") continue;
    const until = ownUseRelistAllowedFrom(ctx.clock.today(), p.data.propertyKind, getRulebook(lease.rulesVersion));
    await tx.db
      .update(units)
      .set({ ownUseLockUntil: sql`greatest(coalesce(${units.ownUseLockUntil}, ${until}::date), ${until}::date)` })
      .where(eq(units.id, lease.unitId));
  }
}

/** True while any lease on the unit has an Ejari number that has not been cancelled. */
export async function unitHasActiveEjari(tx: Tx, unitId: string): Promise<boolean> {
  const rows = await tx.db
    .select({ id: leases.id })
    .from(leases)
    .where(
      and(
        eq(leases.unitId, unitId),
        isNotNull(leases.ejariNo),
        isNull(leases.ejariCancelledOn),
        inArray(leases.state, [...LEASE_STATES_WITH_LIVE_EJARI, "REGISTRATION"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
