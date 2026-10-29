import {
  type Actor,
  addDays,
  addYears,
  type CalendarDate,
  newId,
  propertyUsageFor,
  type StaffRole,
  type StaffUser,
} from "@leasing/core";
import { approvals, leases, tasks, type Tx, units, withTx } from "@leasing/db";
import { getRulebook, repossessionNoticeDeadline } from "@leasing/rulebook";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, forbidden, notFound, unprocessable } from "../errors.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent } from "./events.ts";
import { type VacateNoticeProposal, vacateNoticeProblems } from "./gate-rules.ts";
import { createTask } from "./milestones.ts";

/**
 * Staff work on tasks (phase 3): create one, mark one done, and answer the landlord question
 * (`landlord_intent`). A repossession ground leads to the 12-month notice, which a person serves
 * by notary or registered mail and a manager approves (gate `vacate_notice`); never by email.
 */

export const TASK_CREATOR_ROLES: StaffRole[] = ["leasing_officer", "leasing_manager"];
const ASSIGNABLE: StaffRole[] = ["leasing_officer", "leasing_manager", "finance"];

export const NewTask = z.object({
  leaseId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  assigneeRole: z.enum(["leasing_officer", "leasing_manager", "finance"]),
  dueOn: z.iso.date().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type NewTask = z.infer<typeof NewTask>;

/** A task a person (or a confirmed copilot proposal) adds to a lease. */
export async function createStaffTask(
  ctx: EngineContext,
  actor: `user:${string}` | `copilot:${string}`,
  role: StaffRole,
  raw: unknown,
) {
  if (!TASK_CREATOR_ROLES.includes(role)) throw forbidden(`${role} can't create tasks`);
  const t = NewTask.parse(raw);
  return withTx(ctx.database, (tx) => createStaffTaskTx(ctx, tx, actor, t));
}

export async function createStaffTaskTx(
  ctx: EngineContext,
  tx: Tx,
  actor: `user:${string}` | `copilot:${string}`,
  t: NewTask,
) {
  const [lease] = await tx.db.select({ id: leases.id }).from(leases).where(eq(leases.id, t.leaseId));
  if (!lease) throw notFound("lease");
  if (t.dueOn && t.dueOn < ctx.clock.today()) throw unprocessable("the due date is in the past", [], "past_date");
  if (!ASSIGNABLE.includes(t.assigneeRole)) throw unprocessable("that role can't take tasks");
  const id = newId();
  await createTask(ctx, tx, lease.id, {
    kind: "staff_task",
    title: t.title,
    details: { note: t.note ?? null, createdBy: actor },
    assigneeRole: t.assigneeRole,
    dueOn: (t.dueOn as CalendarDate | undefined) ?? null,
    dedupeKey: `staff:${id}`,
    createdBy: actor,
  });
  const [row] = await tx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.dedupeKey, `staff:${id}`));
  return { taskId: row!.id };
}

/** Tasks closed by their own action (the send or prepare itself), never by "Mark done". */
export const ACTION_TASK_KINDS: string[] = ["send_offer", "prepare_contract"];

/** The assignee's role (or a leasing manager) marks a task done, with an optional note. */
export async function completeTask(ctx: EngineContext, user: StaffUser, taskId: string, note: string | undefined) {
  return withTx(ctx.database, async (tx) => {
    const [t] = await tx.db.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (!t) throw notFound("task");
    if (t.status !== "open") throw conflict(`the task is already ${t.status}`, "task_closed");
    if (user.role !== t.assigneeRole && user.role !== "leasing_manager")
      throw forbidden(`this task is for ${t.assigneeRole.replace("_", " ")}`);
    if (t.kind === "landlord_intent") throw conflict("record the landlord's answer instead", "use_landlord_answer");
    if (ACTION_TASK_KINDS.includes(t.kind))
      throw conflict("use the action on the record (Send offer or Prepare contract) instead", "use_the_action");
    await tx.db.update(tasks).set({ status: "done" }).where(eq(tasks.id, t.id));
    await appendEvent(tx, ctx, {
      entity: { kind: t.entityKind, id: t.entityId },
      type: "TASK_DONE",
      actor: `user:${user.id}`,
      payload: { taskId: t.id, kind: t.kind, title: t.title, note: note ?? null },
    });
    return { ok: true };
  });
}

export const LandlordAnswer = z.object({
  answer: z.enum(["renew", "sale", "own_use", "major_works", "demolition", "not_reached"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * The landlord's plans for the end of the term (task `landlord_intent`). Renew closes the task.
 * A repossession ground closes it too and says whether the 12-month notice can still end this
 * term (rulebook, lease's pinned version); if not, a task reminds a person before the next
 * term's deadline. "Not reached" keeps the task open.
 */
export async function recordLandlordAnswer(ctx: EngineContext, user: StaffUser, taskId: string, raw: unknown) {
  if (!TASK_CREATOR_ROLES.includes(user.role)) throw forbidden(`${user.role} can't record the landlord's answer`);
  const input = LandlordAnswer.parse(raw);
  return withTx(ctx.database, async (tx) => {
    const [t] = await tx.db.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
    if (!t || t.kind !== "landlord_intent") throw notFound("landlord question");
    if (t.status !== "open") throw conflict(`the task is already ${t.status}`, "task_closed");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, t.entityId));
    if (!lease) throw notFound("lease");
    const r = getRulebook(lease.rulesVersion);
    const deadline = repossessionNoticeDeadline(lease.endOn, r);
    const today = ctx.clock.today();
    const ground = input.answer !== "renew" && input.answer !== "not_reached";
    const possibleThisTerm = ground && today <= deadline;
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "LANDLORD_INTENT_RECORDED",
      actor: `user:${user.id}`,
      payload: {
        taskId: t.id,
        answer: input.answer,
        note: input.note ?? null,
        repossessionNoticeDeadline: deadline,
        possibleThisTerm,
      },
      rulesVersion: lease.rulesVersion,
    });
    if (input.answer === "not_reached") return { closed: false, possibleThisTerm: false, deadline };
    await tx.db.update(tasks).set({ status: "done" }).where(eq(tasks.id, t.id));
    if (ground && !possibleThisTerm) {
      // Next term: the notice has to be served 12 months before that term ends.
      const nextDeadline = repossessionNoticeDeadline(addYears(lease.endOn, 1), r);
      await createTask(ctx, tx, lease.id, {
        kind: "repossession_next_term",
        title: `The landlord of ${lease.ref} plans ${input.answer.replace("_", " ")}: the 12-month notice for the next term must be served by notary or registered mail by ${nextDeadline}`,
        details: {
          answer: input.answer,
          nextTermDeadline: nextDeadline,
          rulesVersion: lease.rulesVersion,
          note: input.note ?? null,
        },
        assigneeRole: "leasing_manager",
        dueOn: addDays(nextDeadline, -30),
        dedupeKey: `${lease.id}:repossession_next_term@${lease.endOn}`,
        createdBy: `user:${user.id}`,
      });
    }
    return { closed: true, possibleThisTerm, deadline };
  });
}

export const VacateNoticeInput = z.object({
  ground: z.enum(["sale", "own_use", "major_works", "demolition"]),
  servedOn: z.iso.date(),
  deliveryMethod: z.enum(["notary", "registered_mail"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Records a served 12-month repossession notice for a manager to approve (gate `vacate_notice`).
 * The notice itself went by notary or registered mail (never email); this only records it. The
 * existing rule checks it: served by the rulebook deadline for this term, and not in the future.
 */
export async function proposeVacateNotice(
  ctx: EngineContext,
  actor: `user:${string}` | `copilot:${string}`,
  role: StaffRole,
  leaseId: string,
  raw: unknown,
) {
  if (!TASK_CREATOR_ROLES.includes(role)) throw forbidden(`${role} can't record a repossession notice`);
  const input = VacateNoticeInput.parse(raw);
  return withTx(ctx.database, (tx) => proposeVacateNoticeTx(ctx, tx, actor, leaseId, input));
}

export async function proposeVacateNoticeTx(
  ctx: EngineContext,
  tx: Tx,
  actor: Actor,
  leaseId: string,
  input: z.infer<typeof VacateNoticeInput>,
) {
  const [row] = await tx.db
    .select({ lease: leases, unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  if (!row) throw notFound("lease");
  const { lease, unit } = row;
  if (lease.state !== "ACTIVE" && lease.state !== "RENEWAL")
    throw conflict(`the lease is ${lease.state}; a repossession notice applies to a running tenancy`, "not_running");
  const proposal: VacateNoticeProposal = {
    leaseId: lease.id,
    rulesVersion: lease.rulesVersion,
    leaseEndOn: lease.endOn,
    ground: input.ground,
    servedOn: input.servedOn as CalendarDate,
    deliveryMethod: input.deliveryMethod,
    propertyKind: propertyUsageFor(unit.category),
    ...(input.note ? { note: input.note } : {}),
  };
  const problems = vacateNoticeProblems(proposal, ctx.clock.today());
  if (problems.length) throw unprocessable("this notice can't end the current term", problems, "vacate_invalid");
  // One live notice per term; after a rejection a corrected one may be proposed (new key).
  const base = `${lease.id}:vacate_notice@${lease.endOn}`;
  const previous = await tx.db
    .select({ status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.gate, "vacate_notice"), like(approvals.dedupeKey, `${base}%`)));
  if (previous.some((a) => a.status === "pending" || a.status === "approved" || a.status === "edited"))
    throw conflict("a 12-month notice for this term is already waiting for approval or approved", "vacate_exists");
  const r = getRulebook(lease.rulesVersion);
  return requestApproval(ctx, tx, {
    gate: "vacate_notice",
    entity: { kind: "lease", id: lease.id },
    dedupeKey: previous.length ? `${base}#${previous.length + 1}` : base,
    title: `12-month repossession notice (${input.ground.replace("_", " ")}): ${lease.ref}`,
    proposal,
    reasons: [
      `Served on ${input.servedOn} by ${input.deliveryMethod.replace("_", " ")}; the deadline for this term is ${repossessionNoticeDeadline(lease.endOn, r)} (${r.version}).`,
      "Takes effect only at the end of the term.",
    ],
    sources: [
      {
        kind: "rule",
        rulesVersion: lease.rulesVersion,
        rule: "repossession_notice",
        value: `${r.repossessionNoticeMonths} months`,
      },
    ],
    rulesVersion: lease.rulesVersion,
    proposedBy: actor,
  });
}
