import {
  type Actor,
  addDays,
  addYears,
  type CalendarDate,
  formatAed,
  maskPiiText,
  newId,
  startOfDubaiDay,
} from "@leasing/core";
import { approvals, deadlines, leases, outboundMessages, type Tx, tasks, units, withTx } from "@leasing/db";
import {
  getRulebook,
  type MilestoneId,
  noticeSentInTime,
  renewalMilestones,
  repossessionNoticeDeadline,
} from "@leasing/rulebook";
import { and, asc, eq, inArray, isNull, like, lt, lte, notLike, or, type SQL, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { RenewalContext, RenewalData, renewalHelper } from "@leasing/helpers";
import { advance } from "./advance.ts";
import { handleApplicationMilestone } from "./applications.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { runAndRecord } from "./helpers.ts";
import { approvedUnsentNotice, enqueueNoticeSend, noticeSentForTerm } from "./outbound.ts";
import { handlePaymentMilestone, isPaymentMilestone } from "./collections.ts";
import { lookupSri } from "./sri.ts";
import type { RenewalNoticeProposal } from "./gate-rules.ts";

type LeaseRow = typeof leases.$inferSelect;

export const DEADLINE_JOB = "deadline.fire";

/** Milestone keys carry the term end so a renewed lease gets fresh milestones: "notice_send@2026-12-31". */
export const milestoneKey = (id: MilestoneId, leaseEnd: CalendarDate) => `${id}@${leaseEnd}`;
/**
 * Renewal-notice dedupe keys: "<leaseId>:renewal_notice@<leaseEnd>" for the first draft, then
 * "…#2", "…#3" after a rejection or cancellation, so a term can always get a fresh proposal.
 */
export const renewalCycleKey = (leaseId: string, leaseEnd: CalendarDate) => `${leaseId}:renewal_notice@${leaseEnd}`;
export const isRenewalCycleKey = (key: string, leaseId: string, leaseEnd: CalendarDate) =>
  key === renewalCycleKey(leaseId, leaseEnd) || key.startsWith(`${renewalCycleKey(leaseId, leaseEnd)}#`);
const cycleKeyLike = (leaseId: string, leaseEnd: CalendarDate) => `${renewalCycleKey(leaseId, leaseEnd)}%`;

/** An approved (or edited), unused repossession notice for this lease's current term. */
export const repossessionApprovedFor = (lease: { id: string; endOn: CalendarDate }) =>
  and(
    eq(approvals.entityId, lease.id),
    eq(approvals.gate, "vacate_notice"),
    inArray(approvals.status, ["approved", "edited"]),
    isNull(approvals.consumedByEventId),
    sql`coalesce(${approvals.editedProposal}, ${approvals.proposal})->>'leaseEndOn' = ${lease.endOn}`,
  );
export const sameRentFallbackKey = (leaseId: string, leaseEnd: CalendarDate) =>
  `${leaseId}:same_rent_fallback@${leaseEnd}`;

/**
 * T−90 is still a legal send day, so the "was a notice sent in time?" check runs the morning
 * after (T−89). Its deadline row keeps the legal date as `dueOn`.
 */
const CHECKED_DAY_AFTER = "notice_deadline@%";
const fireOn = (milestone: string, dueOn: CalendarDate) =>
  milestone.startsWith("notice_deadline@") ? addDays(dueOn, 1) : dueOn;
/** Deadlines that may fire today. */
const dueBy = (today: CalendarDate) =>
  or(
    and(notLike(deadlines.milestone, CHECKED_DAY_AFTER), lte(deadlines.dueOn, today)),
    and(like(deadlines.milestone, CHECKED_DAY_AFTER), lt(deadlines.dueOn, today)),
  );

/** Milestones whose silent loss could cost a legal right; a skip raises a manager task. */
const LEGAL_MILESTONES = new Set<MilestoneId>(["landlord_intent", "notice_draft", "notice_send", "notice_deadline"]);

/**
 * Writes the renewal milestones for the lease's current term into `deadlines` (idempotent on
 * entity + milestone). Milestones already in the past are stored as `skipped`, except two that
 * catch up to today: the notice draft (while a notice is still legal) and the landlord question
 * (while the term runs; the task says whether 12 months' notice is still possible). Outside demo
 * mode each pending deadline also gets a pg-boss job at 00:00 Asia/Dubai on its due date.
 */
export async function scheduleLeaseMilestones(ctx: EngineContext, tx: Tx, lease: LeaseRow): Promise<void> {
  const today = ctx.clock.today();
  const rulebook = getRulebook(lease.rulesVersion);
  const legalDeadline = addDays(lease.endOn, -rulebook.renewalNoticeDays);
  for (const m of renewalMilestones(lease.endOn, rulebook)) {
    const milestone = milestoneKey(m.id, lease.endOn);
    const catchUp =
      m.dueOn < today &&
      ((m.id === "notice_draft" && today <= legalDeadline) || (m.id === "landlord_intent" && today < lease.endOn));
    const dueOn = catchUp ? today : m.dueOn;
    const past = dueOn < today;
    const [row] = await tx.db
      .insert(deadlines)
      .values({
        id: newId(),
        entityKind: "lease",
        entityId: lease.id,
        milestone,
        dueOn,
        status: past ? "skipped" : "pending",
        note: past
          ? `due ${m.dueOn}, before the lease was tracked`
          : catchUp
            ? `${m.description} (catch-up, was due ${m.dueOn})`
            : m.description,
        rulesVersion: rulebook.version,
      })
      .onConflictDoNothing({ target: [deadlines.entityId, deadlines.milestone] })
      .returning();
    if (!row || past || ctx.demoMode) continue;
    const jobId = await ctx.scheduler.send(tx, {
      name: DEADLINE_JOB,
      data: { deadlineId: row.id },
      singletonKey: `${lease.id}:${milestone}`,
      startAfter: startOfDubaiDay(fireOn(milestone, dueOn)),
    });
    if (jobId) await tx.db.update(deadlines).set({ jobId }).where(eq(deadlines.id, row.id));
  }
}

/**
 * Adds one pending deadline on a lease (idempotent on lease + milestone key) and, outside demo
 * mode, its pg-boss job at 00:00 Asia/Dubai on the due date. Used by collections (phase 3).
 */
export async function addLeaseDeadline(
  ctx: EngineContext,
  tx: Tx,
  d: { leaseId: string; milestone: string; dueOn: CalendarDate; rulesVersion: string; note: string },
): Promise<boolean> {
  const [row] = await tx.db
    .insert(deadlines)
    .values({
      id: newId(),
      entityKind: "lease",
      entityId: d.leaseId,
      milestone: d.milestone,
      dueOn: d.dueOn,
      status: "pending",
      note: d.note,
      rulesVersion: d.rulesVersion,
    })
    .onConflictDoNothing({ target: [deadlines.entityId, deadlines.milestone] })
    .returning();
  if (!row) return false;
  if (!ctx.demoMode) {
    const jobId = await ctx.scheduler.send(tx, {
      name: DEADLINE_JOB,
      data: { deadlineId: row.id },
      singletonKey: `${d.leaseId}:${d.milestone}`,
      startAfter: startOfDubaiDay(d.dueOn),
    });
    if (jobId) await tx.db.update(deadlines).set({ jobId }).where(eq(deadlines.id, row.id));
  }
  return true;
}

export type FireResult = { fired: true; milestone: string; skipped?: string } | { fired: false; reason: string };

/**
 * Fires one deadline exactly once: the `pending → done` update and the milestone's work commit
 * together, so a retry after a crash re-runs everything or nothing. When the work doesn't apply
 * (wrong state, stale term) the deadline is recorded as `skipped` with the reason.
 */
export async function fireDeadline(ctx: EngineContext, deadlineId: string): Promise<FireResult> {
  return withTx(ctx.database, async (tx) => {
    const today = ctx.clock.today();
    const [d] = await tx.db
      .update(deadlines)
      .set({ status: "done", firedAt: ctx.clock.now() })
      .where(and(eq(deadlines.id, deadlineId), eq(deadlines.status, "pending"), dueBy(today)))
      .returning();
    if (!d) return { fired: false, reason: "not pending or not due" };
    const [id, termEnd] = d.milestone.split("@") as [MilestoneId, CalendarDate | undefined];
    const eventId = await appendEvent(tx, ctx, {
      entity: { kind: d.entityKind, id: d.entityId },
      type: "MILESTONE_FIRED",
      actor: "system",
      payload: { milestone: d.milestone, dueOn: d.dueOn, deadlineId: d.id },
      rulesVersion: d.rulesVersion,
    });
    const skipped =
      d.entityKind === "lease" && isPaymentMilestone(d.milestone)
        ? await handlePaymentMilestone(ctx, tx, d.entityId, d.milestone)
        : d.entityKind === "lease"
          ? await handleLeaseMilestone(ctx, tx, d.entityId, id, termEnd, eventId)
          : d.entityKind === "application"
            ? await handleApplicationMilestone(ctx, tx, d.entityId, d.milestone)
            : null;
    if (!skipped) return { fired: true, milestone: d.milestone };
    await tx.db.update(deadlines).set({ status: "skipped", note: skipped }).where(eq(deadlines.id, d.id));
    await appendEvent(tx, ctx, {
      entity: { kind: d.entityKind, id: d.entityId },
      type: "MILESTONE_SKIPPED",
      actor: "system",
      payload: { milestone: d.milestone, reason: skipped },
      rulesVersion: d.rulesVersion,
    });
    return { fired: true, milestone: d.milestone, skipped };
  });
}

/** Fires every pending deadline due on or before today, oldest first. */
export async function sweepDueDeadlines(ctx: EngineContext): Promise<FireResult[]> {
  const due = await ctx.database.db
    .select({ id: deadlines.id })
    .from(deadlines)
    .where(and(eq(deadlines.status, "pending"), dueBy(ctx.clock.today())))
    .orderBy(asc(deadlines.dueOn), asc(deadlines.createdAt), asc(deadlines.id));
  const results: FireResult[] = [];
  for (const { id } of due) {
    // One failing deadline must not stop the rest (T−90 included). It stays pending and is
    // retried on the next sweep; the error is logged without PII.
    try {
      results.push(await fireDeadline(ctx, id));
    } catch (e) {
      const reason = maskPiiText(e instanceof Error ? e.message : String(e));
      console.error(`deadline ${id} failed: ${reason}`);
      results.push({ fired: false, reason });
      await alertFailingDeadline(ctx, id, reason).catch(() => {});
    }
  }
  return results;
}

/**
 * A deadline that throws stays pending for the next sweep, but a person must know: one task per
 * deadline (deduplicated), for a leasing manager.
 */
async function alertFailingDeadline(ctx: EngineContext, deadlineId: string, reason: string): Promise<void> {
  await withTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deadlines).where(eq(deadlines.id, deadlineId));
    if (!d || d.entityKind !== "lease") return;
    await createTask(ctx, tx, d.entityId, {
      kind: "deadline_failing",
      title: `Deadline ${d.milestone} keeps failing: ${reason}`,
      details: { deadlineId: d.id, milestone: d.milestone, dueOn: d.dueOn },
      assigneeRole: "leasing_manager",
      dueOn: d.dueOn,
      dedupeKey: `deadline_failing:${d.id}`,
    });
  });
}

/** Runs a milestone's work. Returns null when done, or why it did not apply. */
async function handleLeaseMilestone(
  ctx: EngineContext,
  tx: Tx,
  leaseId: string,
  id: MilestoneId,
  termEnd: CalendarDate | undefined,
  eventId: string,
): Promise<string | null> {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
  if (!lease) return "lease not found";
  if (termEnd && termEnd !== lease.endOn) return `belongs to the term ending ${termEnd}; lease now ends ${lease.endOn}`;
  const r = getRulebook(lease.rulesVersion);
  const label = await leaseLabel(tx, lease);
  const legalDeadline = addDays(lease.endOn, -r.renewalNoticeDays);

  const anyApproval = async (where: SQL | undefined) =>
    (await tx.db.select({ id: approvals.id }).from(approvals).where(where)).length > 0;
  const repossessing = () => anyApproval(repossessionApprovedFor(lease));
  const skip = async (reason: string) => {
    if (LEGAL_MILESTONES.has(id) && lease.state !== "MOVE_OUT" && lease.state !== "CLOSED") {
      await createTask(ctx, tx, lease.id, {
        kind: "milestone_not_run",
        title: `${id} for ${label} could not run: ${reason}`,
        details: { milestone: id, termEnd: lease.endOn, state: lease.state },
        assigneeRole: "leasing_manager",
        dueOn: ctx.clock.today(),
        dedupeKey: `${lease.id}:milestone_not_run:${id}@${lease.endOn}`,
      });
    }
    return reason;
  };
  // An approved landlord repossession notice replaces the renewal path for this term.
  if (id !== "landlord_intent" && id !== "lease_end" && (await repossessing())) {
    return skip("an approved repossession notice replaces the renewal for this term");
  }

  switch (id) {
    case "landlord_intent": {
      const latest = repossessionNoticeDeadline(lease.endOn, r);
      const stillPossible = ctx.clock.today() <= latest;
      await createTask(ctx, tx, lease.id, {
        kind: "landlord_intent",
        title: `Ask landlord about ${label}: sell, own use, major works or demolition?`,
        details: {
          repossessionNoticeDeadline: latest,
          possibleThisTerm: stillPossible,
          rule: `${r.repossessionNoticeMonths}-month notice by notary or registered mail, never email (${r.version})`,
          ...(stillPossible
            ? {}
            : { note: `The deadline for this term (${latest}) has passed; a notice can only end a later term.` }),
        },
        assigneeRole: "leasing_officer",
        dueOn: stillPossible ? latest : ctx.clock.today(),
        dedupeKey: `${lease.id}:landlord_intent@${lease.endOn}`,
      });
      return null;
    }

    case "renewal_assess":
      if (lease.state !== "RENEWAL") {
        if (lease.state !== "ACTIVE") return skip(`lease is ${lease.state}`);
        await advance(ctx, { kind: "lease", id: lease.id }, "RENEWAL_WINDOW_OPENED", {
          actor: "system",
          tx,
          payload: { milestoneEventId: eventId },
        });
      }
      // SRI value and legal cap, recorded now; the notice draft at T−4 months re-runs it.
      await assessRenewal(ctx, tx, lease);
      return null;

    case "notice_draft":
      if (lease.state !== "RENEWAL") return skip(`lease is ${lease.state}, not RENEWAL`);
      await draftRenewalNotice(ctx, tx, lease, eventId);
      return null;

    case "notice_send": {
      if (lease.state !== "RENEWAL") return skip(`lease is ${lease.state}, not RENEWAL`);
      if (await noticeSentForTerm(tx, lease)) return null;
      const approved = await approvedUnsentNotice(tx, lease);
      if (approved) {
        await enqueueNoticeSend(ctx, tx, lease.id, approved.id);
        return null;
      }
      await createTask(ctx, tx, lease.id, {
        kind: "renewal_notice_overdue",
        title: `Renewal notice for ${label} is not approved yet`,
        details: { legalDeadline },
        assigneeRole: "leasing_manager",
        dueOn: legalDeadline,
        dedupeKey: `${lease.id}:renewal_notice_overdue@${lease.endOn}`,
      });
      return null;
    }

    case "notice_deadline": {
      if (lease.state !== "RENEWAL") return skip(`lease is ${lease.state}, not RENEWAL`);
      // What counts is a notice that left by T−90, not one that was only approved.
      const sent = await noticeSentForTerm(tx, lease);
      if (sent && noticeSentInTime(sent.sentAt, lease.endOn, r)) return null;
      if (sent && sent.proposedRentFils <= lease.annualRentFils) return null; // same-rent offer already out
      await createSameRentFallbackTask(ctx, tx, lease, label);
      // Same rent is always within the cap, so a fresh same-rent proposal goes to the inbox.
      await draftRenewalNotice(ctx, tx, lease, eventId, { sameRentFallback: true });
      return null;
    }

    case "notice_ack_followup": {
      if (lease.state !== "RENEWAL") return `lease is ${lease.state}, not RENEWAL`;
      const sent = await noticeSentForTerm(tx, lease);
      if (!sent || sent.acknowledgedAt) return null;
      const days = (await getCompanyPolicy(tx, ctx.clock.today())).noticeAckFollowupDays;
      await createTask(ctx, tx, lease.id, {
        kind: "notice_ack_followup",
        title: `Renewal notice for ${label} not acknowledged after ${days} days: call the tenant or send by courier`,
        details: { outboundMessageId: sent.id, sentAt: sent.sentAt.toISOString() },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${lease.id}:notice_ack_followup@${lease.endOn}`,
      });
      return null;
    }

    case "lease_end":
      if (lease.state !== "RENEWAL") return null;
      await createTask(ctx, tx, lease.id, {
        kind: "lease_end_undecided",
        title: `${label} reached its end date with no renewal decision`,
        details: {},
        assigneeRole: "leasing_manager",
        dueOn: lease.endOn,
        dedupeKey: `${lease.id}:lease_end_undecided@${lease.endOn}`,
      });
      return null;
  }
}

async function leaseLabel(tx: Tx, lease: LeaseRow): Promise<string> {
  const [unit] = await tx.db.select({ code: units.code }).from(units).where(eq(units.id, lease.unitId));
  return `${lease.ref} (${unit?.code ?? "unit"})`;
}

/** T−90 passed without an approved notice: no increase is possible this year. */
export async function createSameRentFallbackTask(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  label?: string,
): Promise<void> {
  const r = getRulebook(lease.rulesVersion);
  await createTask(ctx, tx, lease.id, {
    kind: "renewal_same_rent_fallback",
    title: `Legal notice deadline passed for ${label ?? (await leaseLabel(tx, lease))}: renew at the same rent`,
    details: {
      rule: `${r.renewalNoticeDays}-day notice not given; no increase this year (${r.version})`,
      currentRentFils: lease.annualRentFils,
    },
    assigneeRole: "leasing_manager",
    dueOn: lease.endOn,
    dedupeKey: sameRentFallbackKey(lease.id, lease.endOn),
  });
}

/**
 * Runs the renewal helper for the lease's current term: SRI value (staff override → table →
 * none) and the legal cap from the rulebook. Recorded in `helper_runs`.
 */
export async function assessRenewal(ctx: EngineContext, tx: Tx, lease: LeaseRow) {
  const [unit] = await tx.db
    .select({ community: units.community, bedrooms: units.bedrooms })
    .from(units)
    .where(eq(units.id, lease.unitId));
  const sri = await lookupSri(tx, lease, ctx.clock.today());
  const recorded = await runAndRecord(
    ctx,
    tx,
    renewalHelper,
    { context: RenewalContext, data: RenewalData },
    { kind: "lease", id: lease.id },
    "RENEWAL",
    {
      leaseRef: lease.ref,
      currentRentFils: lease.annualRentFils,
      leaseEndOn: lease.endOn,
      community: unit?.community ?? "",
      bedrooms: unit?.bedrooms ?? null,
      sri,
    },
    lease.rulesVersion,
  );
  return { ...recorded, sriEnteredBy: sri?.source === "override" ? sri.enteredBy : undefined };
}

/**
 * Puts the renewal notice for the lease's current term in the inbox: one live proposal per
 * term, a new revision after a rejection or cancellation. The proposed rent is the legal cap
 * from the renewal helper (a manager may lower it). `sameRentFallback` (after T−90 with no
 * increase notice sent) proposes the current rent and cancels pending increase revisions.
 */
export async function draftRenewalNotice(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  eventId: string | null,
  opts: { sameRentFallback?: boolean } = {},
): Promise<void> {
  const existing = await tx.db
    .select({
      id: approvals.id,
      status: approvals.status,
      proposal: approvals.proposal,
      editedProposal: approvals.editedProposal,
    })
    .from(approvals)
    .where(like(approvals.dedupeKey, cycleKeyLike(lease.id, lease.endOn)));
  const live = existing.filter((a) => a.status === "pending" || a.status === "approved" || a.status === "edited");
  const rentOf = (a: (typeof existing)[number]) => Number((a.editedProposal ?? a.proposal).proposedRentFils);
  if (opts.sameRentFallback) {
    // An increase can no longer be given this term: retire increase proposals that were not
    // sent, whether still pending or approved (an approved one can no longer be sent).
    const reason = `${getRulebook(lease.rulesVersion).renewalNoticeDays}-day notice deadline passed`;
    const sent = await noticeSentForTerm(tx, lease);
    const inFlight = await tx.db
      .select({ approvalId: outboundMessages.approvalId, id: outboundMessages.id })
      .from(outboundMessages)
      .where(and(eq(outboundMessages.entityId, lease.id), eq(outboundMessages.status, "sending")));
    for (const m of inFlight) {
      // It may have gone out on T−90: a person checks before anything is cancelled.
      await createTask(ctx, tx, lease.id, {
        kind: "notice_send_unclear",
        title: `Renewal notice for ${lease.ref} may or may not have been sent: check the sent mail`,
        details: { approvalId: m.approvalId, outboundMessageId: m.id },
        assigneeRole: "leasing_manager",
        dueOn: ctx.clock.today(),
        dedupeKey: `${lease.id}:notice_send_unclear:${m.id}`,
      });
    }
    const keep = new Set([sent?.approvalId, ...inFlight.map((m) => m.approvalId)]);
    for (const a of live.filter((x) => rentOf(x) > lease.annualRentFils && !keep.has(x.id))) {
      await tx.db
        .update(approvals)
        .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: reason })
        .where(eq(approvals.id, a.id));
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: lease.id },
        type: "APPROVAL_CANCELLED",
        actor: "system",
        payload: { approvalId: a.id, gate: "renewal_notice", reason, wasStatus: a.status },
        rulesVersion: lease.rulesVersion,
      });
    }
    // A same-rent proposal is already live (pending or approved): nothing more to draft.
    if (live.some((x) => rentOf(x) <= lease.annualRentFils)) return;
  } else if (live.length) {
    return;
  }
  const dedupeKey = existing.length
    ? `${renewalCycleKey(lease.id, lease.endOn)}#${existing.length + 1}`
    : renewalCycleKey(lease.id, lease.endOn);
  const r = getRulebook(lease.rulesVersion);
  const label = await leaseLabel(tx, lease);
  const { run, helperRunId, sriEnteredBy } = await assessRenewal(ctx, tx, lease);
  const data = run.result.status === "ok" ? run.result.data : undefined;
  const fallback = !!opts.sameRentFallback;
  const proposedRentFils = fallback || !data ? lease.annualRentFils : data.proposedRentFils;
  const proposal: RenewalNoticeProposal = {
    leaseId: lease.id,
    leaseRef: lease.ref,
    rulesVersion: r.version,
    currentRentFils: lease.annualRentFils,
    proposedRentFils,
    sriAverageFils: data?.sriAverageFils ?? null,
    leaseEndOn: lease.endOn,
    sendOn: addDays(lease.endOn, -r.renewalSendAtDays),
    legalDeadline: addDays(lease.endOn, -r.renewalNoticeDays),
    newTermStartOn: addDays(lease.endOn, 1),
    newTermEndOn: addDays(addYears(addDays(lease.endOn, 1), 1), -1),
    maxRentFils: fallback ? lease.annualRentFils : (data?.maxRentFils ?? lease.annualRentFils),
    maxIncreasePercent: fallback ? 0 : (data?.maxIncreasePercent ?? 0),
    sriSource: data?.sriSource ?? "none",
    sriLabel: data?.sriLabel ?? null,
    helperRunId,
    ...(sriEnteredBy && !fallback ? { sriEnteredBy } : {}),
    ...(fallback ? { sameRentFallback: true } : {}),
  };
  const reasons = fallback
    ? [
        `The ${r.renewalNoticeDays}-day deadline (${proposal.legalDeadline}) passed without a rent-increase notice, so renewal is offered at the current rent.`,
      ]
    : [
        ...run.result.reasons,
        `Notice must be sent by ${proposal.legalDeadline}; company target is ${proposal.sendOn}.`,
      ];
  await requestApproval(ctx, tx, {
    gate: "renewal_notice",
    entity: { kind: "lease", id: lease.id },
    dedupeKey,
    title: `${fallback ? "Same-rent renewal" : "Renewal notice"} for ${label}${existing.length ? ` (revision ${existing.length + 1})` : ""}`,
    proposal,
    reasons,
    sources: [
      { kind: "field", label: "Current annual rent", value: formatAed(lease.annualRentFils) },
      ...(data?.sriAverageFils
        ? [
            {
              kind: "field" as const,
              label: "SRI average",
              value: `${formatAed(data.sriAverageFils)} (${data.sriLabel ?? data.sriSource})`,
            },
          ]
        : [{ kind: "field" as const, label: "SRI average", value: "none on record" }]),
      {
        kind: "rule",
        rulesVersion: r.version,
        rule: "rentCapBands",
        value: `up to ${proposal.maxIncreasePercent}% → cap ${formatAed(proposal.maxRentFils ?? lease.annualRentFils)}`,
      },
      {
        kind: "rule",
        rulesVersion: r.version,
        rule: "renewalNoticeDays",
        value: `${r.renewalNoticeDays} days → deadline ${proposal.legalDeadline}`,
      },
      {
        kind: "rule",
        rulesVersion: r.version,
        rule: "renewalSendAtDays",
        value: `${r.renewalSendAtDays} days → send on ${proposal.sendOn}`,
      },
      { kind: "helper_run", helperRunId, label: "Renewal helper (SRI and cap)" },
      ...(eventId ? [{ kind: "event" as const, eventId, label: "milestone" }] : []),
    ],
    rulesVersion: r.version,
    proposedBy: "system",
  });
}

interface TaskInput {
  kind: string;
  title: string;
  details: Record<string, unknown>;
  assigneeRole: (typeof tasks.$inferInsert)["assigneeRole"];
  dueOn: CalendarDate | null;
  dedupeKey: string;
  /** Who created it: the system by default; `user:<id>` or `copilot:<id>` for staff tasks. */
  createdBy?: Actor;
}

/** A person-led task on a lease (default), an application or an enquiry conversation, created once per dedupe key. */
export async function createTask(
  ctx: EngineContext,
  tx: Tx,
  leaseId: string,
  t: TaskInput,
  entityKind: "lease" | "application" | "conversation" = "lease",
): Promise<void> {
  const [row] = await tx.db
    .insert(tasks)
    .values({
      id: newId(),
      entityKind,
      entityId: leaseId,
      createdAt: ctx.clock.now(),
      ...t,
      createdBy: t.createdBy ?? "system",
    })
    .onConflictDoNothing({ target: tasks.dedupeKey })
    .returning({ id: tasks.id });
  if (row) {
    await appendEvent(tx, ctx, {
      entity: { kind: entityKind, id: leaseId },
      type: "TASK_CREATED",
      actor: t.createdBy ?? "system",
      payload: { taskId: row.id, kind: t.kind, title: t.title },
    });
  }
}
