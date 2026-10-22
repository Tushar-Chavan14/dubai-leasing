import {
  type Actor,
  addDays,
  type CalendarDate,
  formatAed,
  newId,
  paymentSchedule,
  type StaffRole,
  type StaffUser,
  toDubaiDate,
} from "@leasing/core";
import { approvals, deadlines, leases, payments, tasks, type Tx, withTx } from "@leasing/db";
import { evictionEligibleDate, getRulebook } from "@leasing/rulebook";
import { and, desc, eq, inArray, isNull, like, max } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, forbidden, notFound, unprocessable } from "../errors.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import type { FormalReminderProposal } from "./gate-rules.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import { addLeaseDeadline, createTask } from "./milestones.ts";

/**
 * Collections (step 8, decision D27). Rent instalments come from pure code (`paymentSchedule`).
 * Finance confirms every payment. The one exception: when a running lease is imported, instalments
 * already due are stored as paid (`ASSUMED_PAID_REF`) and finance gets a task to check them; a
 * bounced one can still be recorded, which reopens it. A reminder goes out
 * before each due date; an unconfirmed payment becomes overdue after the grace days, and an
 * overdue or bounced one gets friendly reminders. After `friendlyRemindersBeforeFormal` of them a
 * formal reminder is drafted for a leasing manager (gate `formal_reminder`, always). Only its
 * SMTP-accepted send starts the legal clock: the eviction-eligible date is the send date plus the
 * rulebook's days (the lease's pinned version). What happens after that is a person's decision.
 */

type LeaseRow = typeof leases.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

/** Payment deadlines are keyed by payment, not by term, so renewal and move-out don't cancel them. */
export const PAYMENT_MILESTONES = [
  "rent_reminder",
  "rent_overdue",
  "rent_followup",
  "rent_payby",
  "late_rent_eligible",
] as const;
type PaymentMilestone = (typeof PAYMENT_MILESTONES)[number];
export const isPaymentMilestone = (m: string) => PAYMENT_MILESTONES.some((p) => m.startsWith(`${p}@`));
const key = (m: PaymentMilestone, paymentId: string, n?: number) => `${m}@${paymentId}${n ? `#${n}` : ""}`;

/** Roles that confirm payments (and record a bounced cheque). */
export const PAYMENT_ROLES: StaffRole[] = ["finance", "leasing_manager"];
/** Roles that may propose a formal reminder from the payments panel (approval stays the manager's). */
export const FORMAL_PROPOSER_ROLES: StaffRole[] = ["finance", "leasing_officer", "leasing_manager"];
const OPEN: PaymentRow["status"][] = ["scheduled", "overdue", "bounced"];
/** `paidRef` of an instalment the import assumed paid (finance checks it; it can still bounce). */
export const ASSUMED_PAID_REF = "assumed paid at import";

// ---------------------------------------------------------------- schedule

/**
 * Creates the current term's instalments once (idempotent: a term that has payments is left
 * alone) and their reminder deadlines. `assumePastPaid` (import, demo seed): instalments already
 * due before today are stored as paid, flagged in the event, since only running leases are imported.
 */
export async function scheduleTermPayments(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  opts: { assumePastPaid: boolean; actor?: Actor },
): Promise<void> {
  const actor = opts.actor ?? "system";
  const today = ctx.clock.today();
  const existing = await tx.db.select().from(payments).where(eq(payments.leaseId, lease.id));
  if (existing.some((p) => p.dueOn >= lease.startOn && p.dueOn <= lease.endOn)) return;
  const [top] = await tx.db
    .select({ n: max(payments.seq) })
    .from(payments)
    .where(eq(payments.leaseId, lease.id));
  const base = top?.n ?? 0;
  const plan = paymentSchedule(lease);
  const policy = await getCompanyPolicy(tx, today);
  const rows = plan.map((i) => ({
    id: newId(),
    leaseId: lease.id,
    seq: base + i.n,
    dueOn: i.dueOn,
    amountFils: i.amountFils,
    method: "cheque" as const,
    status: opts.assumePastPaid && i.dueOn < today ? ("paid" as const) : ("scheduled" as const),
    ...(opts.assumePastPaid && i.dueOn < today ? { paidRef: ASSUMED_PAID_REF, confirmedBy: actor } : {}),
  }));
  await tx.db.insert(payments).values(rows);
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "PAYMENTS_SCHEDULED",
    actor,
    payload: {
      term: { startOn: lease.startOn, endOn: lease.endOn },
      instalments: rows.map((r) => ({ seq: r.seq, dueOn: r.dueOn, amountFils: r.amountFils, status: r.status })),
      assumedPaidAtImport: rows.filter((r) => r.status === "paid").length,
    },
    rulesVersion: lease.rulesVersion,
  });
  const assumed = rows.filter((r) => r.status === "paid");
  if (assumed.length) {
    // Finance confirms every payment (D27): the import's assumption is theirs to check.
    await createTask(ctx, tx, lease.id, {
      kind: "payment_import_check",
      title: `Check ${assumed.length} instalment(s) of ${lease.ref} assumed paid at import (a bounced one can still be recorded)`,
      details: { paymentIds: assumed.map((r) => r.id), seqs: assumed.map((r) => r.seq) },
      assigneeRole: "finance",
      dueOn: today,
      dedupeKey: `${lease.id}:payment_import_check@${lease.endOn}`,
    });
  }
  for (const p of rows) if (p.status === "scheduled") await scheduleInstalment(ctx, tx, lease, p, policy);
}

async function scheduleInstalment(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  p: { id: string; dueOn: CalendarDate; seq: number },
  policy: Awaited<ReturnType<typeof getCompanyPolicy>>,
) {
  const today = ctx.clock.today();
  if (p.dueOn < today) {
    // Already due when the tenancy started (cheques are usually handed over at signing): finance
    // confirms it; the tenant isn't chased as "overdue" on move-in day.
    await createTask(ctx, tx, lease.id, {
      kind: "payment_confirm",
      title: `Confirm instalment ${p.seq} of ${lease.ref} (due ${p.dueOn}, before the tenancy started here): paid or bounced?`,
      details: { paymentId: p.id, seq: p.seq },
      assigneeRole: "finance",
      dueOn: today,
      dedupeKey: `${p.id}:payment_confirm`,
    });
    return;
  }
  const remindOn = addDays(p.dueOn, -policy.rentReminderDaysBefore);
  await addLeaseDeadline(ctx, tx, {
    leaseId: lease.id,
    milestone: key("rent_reminder", p.id),
    dueOn: remindOn < today ? today : remindOn,
    rulesVersion: lease.rulesVersion,
    note: `rent reminder, instalment ${p.seq} due ${p.dueOn}`,
  });
  await addLeaseDeadline(ctx, tx, {
    leaseId: lease.id,
    milestone: key("rent_overdue", p.id),
    dueOn: addDays(p.dueOn, policy.paymentGraceDays),
    rulesVersion: lease.rulesVersion,
    note: `instalment ${p.seq} overdue unless finance confirms it`,
  });
}

// ---------------------------------------------------------------- deadlines

/** Runs a payment deadline. Returns null when done, or why it didn't apply (stored as skipped). */
export async function handlePaymentMilestone(
  ctx: EngineContext,
  tx: Tx,
  leaseId: string,
  milestone: string,
): Promise<string | null> {
  const m = /^([a-z_]+)@([0-9a-f-]{36})(?:#(\d+))?$/.exec(milestone);
  if (!m) return "unknown payment milestone";
  const [, kind, paymentId] = m as unknown as [string, PaymentMilestone, string];
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
  const [p] = await tx.db.select().from(payments).where(eq(payments.id, paymentId)).for("update");
  if (!lease || !p || p.leaseId !== leaseId) return "payment not found";
  if (!OPEN.includes(p.status)) return `instalment ${p.seq} is ${p.status}`;
  if (lease.state === "CLOSED") return "the lease is closed";
  const policy = await getCompanyPolicy(tx, ctx.clock.today());
  const label = `instalment ${p.seq} of ${lease.ref} (${formatAed(p.amountFils)}, due ${p.dueOn})`;

  switch (kind) {
    case "rent_reminder":
      if (p.status !== "scheduled") return `instalment ${p.seq} is already ${p.status}`;
      await queueLeaseMail(ctx, tx, { leaseId, kind: "rent_reminder", key: p.id, seq: 1 });
      return null;
    case "rent_overdue":
      if (p.status !== "scheduled") return `instalment ${p.seq} is already ${p.status}`;
      await tx.db.update(payments).set({ status: "overdue" }).where(eq(payments.id, p.id));
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: leaseId },
        type: "PAYMENT_OVERDUE",
        actor: "system",
        payload: { paymentId: p.id, seq: p.seq, dueOn: p.dueOn, amountFils: p.amountFils },
        rulesVersion: lease.rulesVersion,
      });
      await createTask(ctx, tx, leaseId, {
        kind: "payment_confirm",
        title: `Confirm ${label}: paid or bounced?`,
        details: { paymentId: p.id, seq: p.seq },
        assigneeRole: "finance",
        dueOn: ctx.clock.today(),
        dedupeKey: `${p.id}:payment_confirm`,
      });
      await friendlyReminder(ctx, tx, lease, { ...p, status: "overdue" }, policy);
      return null;
    case "rent_followup": {
      // Only the latest chain counts, and nothing friendly follows a formal reminder.
      const n = Number(m[3] ?? 0);
      if (n !== p.friendlyCount) return `follow-up ${n} was replaced (now ${p.friendlyCount})`;
      if (p.formalReminderSentOn) return "a formal reminder was already sent";
      if (p.friendlyCount >= policy.friendlyRemindersBeforeFormal) {
        await proposeFormalReminder(ctx, tx, lease, p, "system");
        return null;
      }
      await friendlyReminder(ctx, tx, lease, p, policy);
      return null;
    }
    case "rent_payby":
      await createTask(ctx, tx, leaseId, {
        kind: "payment_promise_due",
        title: `The tenant said they would pay ${label} by now: check`,
        details: { paymentId: p.id, seq: p.seq },
        assigneeRole: "finance",
        dueOn: ctx.clock.today(),
        dedupeKey: `${p.id}:${milestone}`,
      });
      return null;
    case "late_rent_eligible":
      if (!p.formalReminderSentOn) return "no formal reminder was sent";
      await createTask(ctx, tx, leaseId, {
        kind: "late_rent_decision",
        title: `${label} is still unpaid ${getRulebook(lease.rulesVersion).lateRentDaysAfterFormalReminder} days after the formal reminder: a person decides on next steps (RDC)`,
        details: {
          paymentId: p.id,
          seq: p.seq,
          formalReminderSentOn: p.formalReminderSentOn,
          evictionEligibleOn: p.evictionEligibleOn,
          rulesVersion: lease.rulesVersion,
          note: "Nothing happens automatically. Any eviction case is filed by a person.",
        },
        assigneeRole: "leasing_manager",
        dueOn: ctx.clock.today(),
        dedupeKey: `${p.id}:late_rent_decision`,
      });
      return null;
  }
  return "unknown payment milestone";
}

/** One friendly reminder (fixed text, email with the reply link), then the next follow-up date. */
async function friendlyReminder(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  p: PaymentRow,
  policy: Awaited<ReturnType<typeof getCompanyPolicy>>,
) {
  const n = p.friendlyCount + 1;
  await tx.db.update(payments).set({ friendlyCount: n }).where(eq(payments.id, p.id));
  await queueLeaseMail(ctx, tx, { leaseId: lease.id, kind: "rent_friendly", key: p.id, seq: n });
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "RENT_REMINDER_QUEUED",
    actor: "system",
    payload: { paymentId: p.id, seq: p.seq, reminder: n, status: p.status },
    rulesVersion: lease.rulesVersion,
  });
  await addLeaseDeadline(ctx, tx, {
    leaseId: lease.id,
    milestone: key("rent_followup", p.id, n),
    dueOn: addDays(ctx.clock.today(), policy.friendlyReminderIntervalDays),
    rulesVersion: lease.rulesVersion,
    note: `follow-up ${n} for instalment ${p.seq}`,
  });
}

// ---------------------------------------------------------------- formal reminder (gate)

/**
 * Drafts the formal reminder for a leasing manager (gate `formal_reminder`, always). One live
 * proposal per payment; after a rejection a new one may be drafted. Never sent before approval.
 */
export async function proposeFormalReminder(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  p: PaymentRow,
  proposedBy: "system" | `user:${string}` | `copilot:${string}`,
): Promise<string> {
  if (!OPEN.includes(p.status) || p.status === "scheduled")
    throw conflict(
      `instalment ${p.seq} is ${p.status}: a formal reminder is only for an overdue or bounced payment`,
      "not_overdue",
    );
  if (p.formalReminderSentOn) throw conflict("a formal reminder was already sent for this payment", "already_sent");
  const previous = await tx.db
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.gate, "formal_reminder"), like(approvals.dedupeKey, `${p.id}:formal_reminder%`)))
    .orderBy(desc(approvals.createdAt));
  const live = previous.find((a) => a.status === "pending" || a.status === "approved" || a.status === "edited");
  if (live) return live.id;
  const r = getRulebook(lease.rulesVersion);
  const of = (await tx.db.select({ id: payments.id }).from(payments).where(eq(payments.leaseId, lease.id))).length;
  const proposal: FormalReminderProposal = {
    leaseId: lease.id,
    paymentId: p.id,
    seq: p.seq,
    of,
    amountFils: p.amountFils,
    dueOn: p.dueOn,
    paymentStatus: p.status === "bounced" ? "bounced" : "overdue",
    friendlyReminders: p.friendlyCount,
    rulesVersion: lease.rulesVersion,
    lateRentDays: r.lateRentDaysAfterFormalReminder,
  };
  const req = await requestApproval(ctx, tx, {
    gate: "formal_reminder",
    entity: { kind: "lease", id: lease.id },
    dedupeKey: previous.length ? `${p.id}:formal_reminder#${previous.length + 1}` : `${p.id}:formal_reminder`,
    title: `Formal late-payment reminder: ${lease.ref}, instalment ${p.seq} (${formatAed(p.amountFils)})`,
    proposal,
    reasons: [
      p.status === "bounced"
        ? `Cheque ${p.seq} (due ${p.dueOn}) was returned on ${p.bouncedOn}.`
        : `Instalment ${p.seq} (due ${p.dueOn}) is unpaid and unconfirmed.`,
      `${p.friendlyCount} friendly reminder(s) sent.`,
      `Sending starts the ${r.lateRentDaysAfterFormalReminder}-day period before the landlord may take further steps (rules ${lease.rulesVersion}). It counts only once the email is accepted for delivery.`,
    ],
    sources: [
      {
        kind: "rule",
        rulesVersion: lease.rulesVersion,
        rule: "late_rent",
        value: `${r.lateRentDaysAfterFormalReminder} days after a formal reminder`,
      },
      { kind: "field", label: "Amount", value: formatAed(p.amountFils) },
    ],
    rulesVersion: lease.rulesVersion,
    proposedBy,
  });
  return req.id;
}

/** Approved: the formal reminder email is queued (sent by the job; its acceptance starts the clock). */
export async function onFormalReminderApproved(
  ctx: EngineContext,
  tx: Tx,
  approvalId: string,
  proposal: FormalReminderProposal,
) {
  await queueLeaseMail(ctx, tx, { leaseId: proposal.leaseId, kind: "formal_reminder", key: approvalId, seq: 1 });
}

/**
 * The formal reminder email was accepted by SMTP (D27): records the send date (Dubai), the
 * eviction-eligible date from the lease's pinned rulebook, consumes the approval and sets the
 * deadline at which a manager is asked to decide. Nothing beyond that happens automatically.
 */
export async function onFormalReminderSent(
  ctx: EngineContext,
  tx: Tx,
  approvalId: string,
  outboundMessageId: string,
): Promise<void> {
  const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, approvalId)).for("update");
  // Once per approval: a second call never moves the clock's start.
  if (!a || a.status !== "approved" || a.consumedByEventId) return;
  const proposal = a.proposal as FormalReminderProposal;
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, proposal.leaseId));
  if (!lease) return;
  const sentOn = toDubaiDate(ctx.clock.now());
  const rulebook = getRulebook(lease.rulesVersion);
  const eligibleOn = evictionEligibleDate(sentOn, rulebook);
  const set = await tx.db
    .update(payments)
    .set({ formalReminderSentOn: sentOn, evictionEligibleOn: eligibleOn })
    .where(and(eq(payments.id, proposal.paymentId), isNull(payments.formalReminderSentOn)))
    .returning({ id: payments.id });
  if (!set.length) return;
  const eventId = await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "FORMAL_REMINDER_SENT",
    actor: "system",
    payload: {
      paymentId: proposal.paymentId,
      approvalId,
      outboundMessageId,
      sentOn,
      evictionEligibleOn: eligibleOn,
      lateRentDays: rulebook.lateRentDaysAfterFormalReminder,
    },
    rulesVersion: lease.rulesVersion,
  });
  await tx.db.update(approvals).set({ consumedByEventId: eventId }).where(eq(approvals.id, approvalId));
  await addLeaseDeadline(ctx, tx, {
    leaseId: lease.id,
    milestone: key("late_rent_eligible", proposal.paymentId),
    dueOn: eligibleOn,
    rulesVersion: lease.rulesVersion,
    note: `${rulebook.lateRentDaysAfterFormalReminder} days after the formal reminder sent on ${sentOn}`,
  });
}

// ---------------------------------------------------------------- staff actions

export const RecordPayment = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("paid"),
    paidOn: z.iso.date(),
    ref: z.string().trim().min(1).max(120),
  }),
  z.object({ outcome: z.literal("bounced"), note: z.string().trim().max(500).optional() }),
]);

/** Finance (or a leasing manager) confirms a payment, or records a returned cheque. */
export async function recordPayment(ctx: EngineContext, user: StaffUser, paymentId: string, raw: unknown) {
  if (!PAYMENT_ROLES.includes(user.role)) throw forbidden(`${user.role} can't record payments`);
  const input = RecordPayment.parse(raw);
  return withTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw notFound("payment");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, p.leaseId)).for("update");
    if (!lease) throw notFound("lease");
    // An instalment the import assumed paid is reopened by a bounce finance records (D27).
    const assumedPaid = p.status === "paid" && p.paidRef === ASSUMED_PAID_REF;
    if (!OPEN.includes(p.status) && !(assumedPaid && input.outcome === "bounced"))
      throw conflict(`instalment ${p.seq} is already ${p.status}`, "payment_closed");
    const today = ctx.clock.today();
    const actor = `user:${user.id}` as const;
    if (input.outcome === "paid") {
      if (input.paidOn > today) throw unprocessable("the payment date can't be in the future", [], "future_date");
      await tx.db
        .update(payments)
        .set({ status: "paid", paidOn: input.paidOn as CalendarDate, paidRef: input.ref, confirmedBy: actor })
        .where(eq(payments.id, p.id));
      await closePaymentWork(ctx, tx, lease, p.id, "paid");
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: lease.id },
        type: "PAYMENT_CONFIRMED",
        actor,
        payload: { paymentId: p.id, seq: p.seq, paidOn: input.paidOn, ref: input.ref, wasStatus: p.status },
        rulesVersion: lease.rulesVersion,
      });
      return { status: "paid" as const };
    }
    if (p.method !== "cheque") throw unprocessable("only a cheque can bounce", [], "not_a_cheque");
    if (p.dueOn > today) throw unprocessable("a cheque can't bounce before its date", [], "not_due");
    if (p.status === "bounced") throw conflict(`instalment ${p.seq} is already recorded as bounced`, "already_bounced");
    await tx.db
      .update(payments)
      .set({
        status: "bounced",
        bouncedOn: today,
        ...(assumedPaid ? { paidOn: null, paidRef: null, confirmedBy: null } : {}),
      })
      .where(eq(payments.id, p.id));
    // The overdue check no longer applies; the friendly sequence starts now.
    await tx.db
      .update(deadlines)
      .set({ status: "cancelled", note: "cheque bounced" })
      .where(
        and(
          eq(deadlines.entityId, lease.id),
          eq(deadlines.status, "pending"),
          eq(deadlines.milestone, key("rent_overdue", p.id)),
        ),
      );
    await tx.db
      .update(deadlines)
      .set({ status: "cancelled", note: "replaced: cheque bounced" })
      .where(
        and(
          eq(deadlines.entityId, lease.id),
          eq(deadlines.status, "pending"),
          like(deadlines.milestone, `rent_followup@${p.id}%`),
        ),
      );
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "CHEQUE_BOUNCED",
      actor,
      payload: {
        paymentId: p.id,
        seq: p.seq,
        dueOn: p.dueOn,
        amountFils: p.amountFils,
        note: input.note ?? null,
        ...(assumedPaid ? { wasAssumedPaidAtImport: true } : {}),
      },
      rulesVersion: lease.rulesVersion,
    });
    // After a formal reminder (sent, or waiting for a manager) no friendly email goes on top.
    const [liveFormal] = await tx.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.gate, "formal_reminder"),
          inArray(approvals.status, ["pending", "approved", "edited"]),
          isNull(approvals.consumedByEventId),
          like(approvals.dedupeKey, `${p.id}:%`),
        ),
      );
    if (!p.formalReminderSentOn && !liveFormal) {
      const policy = await getCompanyPolicy(tx, today);
      await friendlyReminder(ctx, tx, lease, { ...p, status: "bounced", bouncedOn: today }, policy);
    }
    return { status: "bounced" as const };
  });
}

/** A staff member (or a confirmed copilot proposal) asks for the formal reminder sooner. */
export async function requestFormalReminder(
  ctx: EngineContext,
  paymentId: string,
  proposedBy: `user:${string}` | `copilot:${string}`,
  role: StaffRole,
) {
  if (!FORMAL_PROPOSER_ROLES.includes(role)) throw forbidden(`${role} can't propose a formal reminder`);
  return withTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw notFound("payment");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, p.leaseId));
    if (!lease) throw notFound("lease");
    return { approvalId: await proposeFormalReminder(ctx, tx, lease, p, proposedBy) };
  });
}

/** Paid: every pending reminder deadline for this payment stops, open proposals and tasks close. */
async function closePaymentWork(ctx: EngineContext, tx: Tx, lease: LeaseRow, paymentId: string, why: string) {
  await tx.db
    .update(deadlines)
    .set({ status: "cancelled", note: `payment ${why}` })
    .where(
      and(
        eq(deadlines.entityId, lease.id),
        eq(deadlines.status, "pending"),
        like(deadlines.milestone, `%@${paymentId}%`),
      ),
    );
  const open = await tx.db
    .update(approvals)
    .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: `payment ${why}` })
    .where(
      and(
        eq(approvals.gate, "formal_reminder"),
        // Approved but not yet sent counts too: the queued mail then finds nothing to send.
        inArray(approvals.status, ["pending", "approved"]),
        isNull(approvals.consumedByEventId),
        like(approvals.dedupeKey, `${paymentId}:%`),
      ),
    )
    .returning({ id: approvals.id });
  for (const a of open) {
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "APPROVAL_CANCELLED",
      actor: "system",
      payload: { approvalId: a.id, gate: "formal_reminder", reason: `payment ${why}` },
      rulesVersion: lease.rulesVersion,
    });
  }
  await tx.db
    .update(tasks)
    .set({ status: "done" })
    .where(and(eq(tasks.entityId, lease.id), eq(tasks.status, "open"), like(tasks.dedupeKey, `${paymentId}:%`)));
}

/** A lease's instalments for the staff Payments panel (and the copilot's read tool). */
export async function leasePayments(tx: Tx, leaseId: string) {
  return tx.db.select().from(payments).where(eq(payments.leaseId, leaseId)).orderBy(payments.seq);
}

/** Open instalments the tenant may reply about in the portal (overdue or bounced). */
export async function openForReply(tx: Tx, leaseId: string) {
  return tx.db
    .select()
    .from(payments)
    .where(and(eq(payments.leaseId, leaseId), inArray(payments.status, ["overdue", "bounced"])))
    .orderBy(payments.seq);
}
