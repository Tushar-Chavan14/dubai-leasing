import { formatDubaiDateTime } from "@leasing/adapters";
import { formatAed, newId, type StaffRole, type StaffUser } from "@leasing/core";
import {
  applications,
  copilotMessages,
  copilotProposals,
  copilotThreads,
  leases,
  parties,
  payments,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, DomainError, forbidden, notFound, unprocessable } from "../errors.ts";
import { createApplication } from "./applications.ts";
import { listedUnit, takenViewings } from "./availability.ts";
import { FORMAL_PROPOSER_ROLES, proposeFormalReminder } from "./collections.ts";
import { appendEvent, getCompanyPolicy, leaseRulesVersion } from "./events.ts";
import { createStaffTaskTx, NewTask, proposeVacateNoticeTx, TASK_CREATOR_ROLES } from "./task-actions.ts";

/**
 * Copilot proposals (decisions D25, D26). The copilot's propose tools (`propose_application`,
 * `create_task`, `propose_approval`) store a proposal here and nothing else. Only the user's Confirm click in the chat (`confirmProposal`, called by
 * the staff UI with the user's own session) creates the application, through `createApplication`
 * with every check run again, as `copilot:<userId>`. Single-use, owner-only, expires.
 * Audit: this table is the record of proposals (created, cancelled, failed, expired); the tool
 * call is in `copilot_messages`; a confirmed one adds events on the new application.
 */

/** Same roles as `POST /api/applications`. */
export const PROPOSE_APPLICATION_ROLES: StaffRole[] = ["leasing_officer", "leasing_manager"];
export const PROPOSAL_TTL_MS = 30 * 60_000;
const OPEN_STATES = ["ENQUIRY", "VIEWING", "SCREENING", "OFFER", "RESERVED"] as const;

export const ProposeApplication = z
  .object({
    unitCode: z.string().trim().min(2).max(40),
    nameEn: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    kind: z.enum(["individual", "company"]).default("individual"),
    /** An instant with its offset, e.g. "2026-11-03T10:00:00+04:00" (Dubai time). */
    viewingAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ProposeApplication = z.infer<typeof ProposeApplication>;

type ProposalRow = typeof copilotProposals.$inferSelect;

export function proposalView(p: ProposalRow, nowMs: number) {
  const expired = p.status === "pending" && p.expiresAt.getTime() <= nowMs;
  return {
    id: p.id,
    kind: p.kind,
    status: expired ? ("expired" as const) : p.status,
    summary: p.summary,
    result: p.result,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    decidedAt: p.decidedAt?.toISOString() ?? null,
  };
}

function requireLeasing(user: StaffUser) {
  if (!PROPOSE_APPLICATION_ROLES.includes(user.role)) throw forbidden(`${user.role} can't create applications`);
}

/** Validates and stores a proposal for the user's own thread. Creates nothing else. */
export async function proposeApplication(ctx: EngineContext, user: StaffUser, threadId: string, raw: unknown) {
  requireLeasing(user);
  const input = ProposeApplication.parse(raw);
  const at = new Date(input.viewingAt);
  return withTx(ctx.database, async (tx) => {
    const [thread] = await tx.db
      .select({ id: copilotThreads.id })
      .from(copilotThreads)
      .where(and(eq(copilotThreads.id, threadId), eq(copilotThreads.userId, user.id)));
    if (!thread) throw notFound("conversation");
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    await requireFromUser(tx, threadId, input);
    // Exact code, ignoring case (never a LIKE pattern).
    const byCode = await tx.db
      .select()
      .from(units)
      .where(sql`lower(${units.code}) = lower(${input.unitCode})`)
      .limit(2);
    const unit = byCode.length === 1 ? await listedUnit(tx, byCode[0]!.id, policy) : null;
    if (!unit) {
      throw unprocessable(
        `unit ${input.unitCode} can't be booked: it isn't listed, has no settled price, or a lease on it is being signed`,
        [],
        "unit_not_bookable",
      );
    }
    if (at.getTime() <= ctx.clock.now().getTime())
      throw unprocessable("the viewing time must be in the future", [], "viewing_in_past");
    await checkSlot(tx, unit.id, at, policy.viewingSlotMinutes);
    await checkNoOpenApplication(tx, unit.id, input.email);

    const now = ctx.clock.now();
    const id = newId();
    const summary = {
      unitCode: unit.code,
      unit: `${unit.building}, ${unit.community}`,
      bedrooms: unit.bedrooms,
      askingRent: formatAed(unit.askingRentFils ?? 0),
      applicant: input.nameEn,
      email: input.email,
      kind: input.kind,
      viewingAt: at.toISOString(),
      viewingLabel: formatDubaiDateTime(at),
    };
    const [row] = await tx.db
      .insert(copilotProposals)
      .values({
        id,
        threadId,
        userId: user.id,
        kind: "create_application",
        payload: { unitId: unit.id, ...input },
        summary,
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
        createdAt: now,
      })
      .returning();
    return proposalView(row!, now.getTime());
  });
}

/**
 * Defence in depth against injected instructions: the applicant's email and every word of their
 * name must appear in the user's own messages in this thread (not in tool results or tenant
 * text), so a tenant's comment can't put someone else on the card.
 */
async function requireFromUser(tx: Tx, threadId: string, input: ProposeApplication) {
  const said = (
    await tx.db
      .select({ content: copilotMessages.content })
      .from(copilotMessages)
      .where(and(eq(copilotMessages.threadId, threadId), eq(copilotMessages.role, "user")))
  )
    .map((m) => m.content)
    .join("\n")
    .toLowerCase();
  const words = input.nameEn.toLowerCase().split(/\s+/).filter(Boolean);
  if (!said.includes(input.email) || !words.every((w) => said.includes(w))) {
    throw unprocessable(
      "the applicant's name and email must be ones you typed in this conversation",
      [],
      "applicant_not_from_user",
    );
  }
}

async function checkSlot(tx: Tx, unitId: string, at: Date, slotMinutes: number) {
  const slotMs = slotMinutes * 60_000;
  const clash = (await takenViewings(tx, unitId)).find((t) => Math.abs(t.getTime() - at.getTime()) < slotMs);
  if (clash) {
    throw conflict(
      `another viewing of this unit is booked at ${formatDubaiDateTime(clash)}; viewings need ${slotMinutes} minutes between them`,
      "viewing_slot_taken",
    );
  }
}

async function checkNoOpenApplication(tx: Tx, unitId: string, email: string) {
  const [open] = await tx.db
    .select({ ref: applications.ref })
    .from(applications)
    .innerJoin(parties, eq(parties.id, applications.partyId))
    .where(
      and(eq(applications.unitId, unitId), eq(parties.email, email), inArray(applications.state, [...OPEN_STATES])),
    )
    .limit(1);
  if (open)
    throw conflict(`this applicant already has an open application (${open.ref}) for the unit`, "already_applied");
}

class CreateFailed extends Error {
  constructor(readonly reason: DomainError) {
    super(reason.message);
  }
}

/**
 * The user clicked Confirm: creates the application exactly as the New application form does,
 * once. A booking check that fails now (slot taken, unit gone) marks the proposal `failed`.
 */
export async function confirmProposal(ctx: EngineContext, user: StaffUser, proposalId: string) {
  try {
    return await withTx(ctx.database, async (tx) => {
      const p = await lockOwn(tx, user, proposalId);
      const now = ctx.clock.now();
      assertPending(p, now.getTime());
      let done: { result: Record<string, unknown>; entity: { kind: "application" | "lease"; id: string } };
      try {
        done =
          p.kind === "create_task"
            ? await confirmTask(ctx, tx, p, user)
            : p.kind === "request_approval"
              ? await confirmApprovalRequest(ctx, tx, p, user)
              : await confirmApplication(ctx, tx, p, user);
      } catch (e) {
        if (e instanceof DomainError && e.status !== 403) throw new CreateFailed(e);
        throw e;
      }
      await appendEvent(tx, ctx, {
        entity: done.entity,
        type: "COPILOT_PROPOSAL_CONFIRMED",
        actor: `user:${user.id}`,
        payload: { proposalId: p.id, threadId: p.threadId, kind: p.kind },
        rulesVersion: done.entity.kind === "lease" ? await leaseRulesVersion(tx, done.entity.id) : ctx.rulesVersion,
      });
      const [row] = await tx.db
        .update(copilotProposals)
        .set({ status: "confirmed", result: done.result, decidedAt: now })
        .where(eq(copilotProposals.id, p.id))
        .returning();
      return proposalView(row!, now.getTime());
    });
  } catch (e) {
    if (!(e instanceof CreateFailed)) throw e;
    // The whole attempt rolled back; record why on the proposal, then report it.
    await withTx(ctx.database, async (tx) => {
      await tx.db
        .update(copilotProposals)
        .set({ status: "failed", result: { error: e.reason.message, code: e.reason.code }, decidedAt: ctx.clock.now() })
        .where(and(eq(copilotProposals.id, proposalId), eq(copilotProposals.status, "pending")));
    });
    throw e.reason;
  }
}

/** A new application with its viewing, exactly as the New application form does. */
async function confirmApplication(ctx: EngineContext, tx: Tx, p: ProposalRow, user: StaffUser) {
  requireLeasing(user);
  const input = ProposeApplication.parse({
    unitCode: p.payload.unitCode,
    nameEn: p.payload.nameEn,
    email: p.payload.email,
    kind: p.payload.kind,
    viewingAt: p.payload.viewingAt,
  });
  // The unit row first, so two confirms for the same person and unit are served in turn.
  await tx.db
    .select({ id: units.id })
    .from(units)
    .where(eq(units.id, String(p.payload.unitId)))
    .for("update");
  const policy = await getCompanyPolicy(tx, ctx.clock.today());
  if (!(await listedUnit(tx, String(p.payload.unitId), policy)))
    throw unprocessable(`unit ${input.unitCode} can no longer be booked`, [], "unit_not_bookable");
  await checkNoOpenApplication(tx, String(p.payload.unitId), input.email);
  const created = await createApplication(
    ctx,
    {
      unitId: String(p.payload.unitId),
      nameEn: input.nameEn,
      email: input.email,
      kind: input.kind,
      viewingAt: new Date(input.viewingAt),
      source: "copilot",
    },
    `copilot:${user.id}`,
    tx,
  );
  return {
    result: { applicationId: created.id, ref: created.ref },
    entity: { kind: "application" as const, id: created.id },
  };
}

/** A task on a lease, as the staff "Add task" form creates it (D26). */
async function confirmTask(ctx: EngineContext, tx: Tx, p: ProposalRow, user: StaffUser) {
  if (!TASK_CREATOR_ROLES.includes(user.role)) throw forbidden(`${user.role} can't create tasks`);
  const input = NewTask.parse(p.payload);
  const r = await createStaffTaskTx(ctx, tx, `copilot:${user.id}`, input);
  return { result: { taskId: r.taskId }, entity: { kind: "lease" as const, id: input.leaseId } };
}

/**
 * A pending approval through the same route the UI uses (D26): a formal late-payment reminder or
 * a served 12-month notice. It lands in the inbox; this user can never approve it.
 */
async function confirmApprovalRequest(ctx: EngineContext, tx: Tx, p: ProposalRow, user: StaffUser) {
  const input = ApprovalRequestInput.parse(p.payload);
  const actor = `copilot:${user.id}` as const;
  if (input.gate === "formal_reminder") {
    if (!FORMAL_PROPOSER_ROLES.includes(user.role)) throw forbidden(`${user.role} can't propose a formal reminder`);
    const [pay] = await tx.db.select().from(payments).where(eq(payments.id, input.paymentId)).for("update");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, input.leaseId));
    if (!pay || !lease || pay.leaseId !== lease.id) throw notFound("payment");
    const approvalId = await proposeFormalReminder(ctx, tx, lease, pay, actor);
    return { result: { approvalId }, entity: { kind: "lease" as const, id: lease.id } };
  }
  if (!TASK_CREATOR_ROLES.includes(user.role)) throw forbidden(`${user.role} can't record a repossession notice`);
  const r = await proposeVacateNoticeTx(ctx, tx, actor, input.leaseId, input);
  return { result: { approvalId: r.id }, entity: { kind: "lease" as const, id: input.leaseId } };
}

// ---------------------------------------------------------------- task and approval proposals (D26)

export const ApprovalRequestInput = z.discriminatedUnion("gate", [
  z.object({ gate: z.literal("formal_reminder"), leaseId: z.uuid(), paymentId: z.uuid() }),
  z.object({
    gate: z.literal("vacate_notice"),
    leaseId: z.uuid(),
    ground: z.enum(["sale", "own_use", "major_works", "demolition"]),
    servedOn: z.iso.date(),
    deliveryMethod: z.enum(["notary", "registered_mail"]),
    note: z.string().trim().max(2000).optional(),
  }),
]);

/**
 * Stores a task or approval proposal (D26). Validated now as far as it can be without writing;
 * every check runs again on Confirm, through the same code the staff UI calls.
 */
export async function proposeOther(ctx: EngineContext, user: StaffUser, threadId: string, raw: unknown) {
  const body = z
    .object({ kind: z.enum(["create_task", "request_approval"]) })
    .loose()
    .parse(raw);
  return withTx(ctx.database, async (tx) => {
    const [thread] = await tx.db
      .select({ id: copilotThreads.id })
      .from(copilotThreads)
      .where(and(eq(copilotThreads.id, threadId), eq(copilotThreads.userId, user.id)));
    if (!thread) throw notFound("conversation");
    let payload: Record<string, unknown>;
    let summary: Record<string, unknown>;
    if (body.kind === "create_task") {
      if (!TASK_CREATOR_ROLES.includes(user.role)) throw forbidden(`${user.role} can't create tasks`);
      const t = NewTask.parse(body);
      const [lease] = await tx.db.select({ ref: leases.ref }).from(leases).where(eq(leases.id, t.leaseId));
      if (!lease) throw notFound("lease");
      if (t.dueOn && t.dueOn < ctx.clock.today()) throw unprocessable("the due date is in the past", [], "past_date");
      payload = t;
      summary = { leaseRef: lease.ref, title: t.title, assigneeRole: t.assigneeRole, dueOn: t.dueOn ?? null };
    } else {
      const a = ApprovalRequestInput.parse(body);
      const [lease] = await tx.db.select().from(leases).where(eq(leases.id, a.leaseId));
      if (!lease) throw notFound("lease");
      if (a.gate === "formal_reminder") {
        if (!FORMAL_PROPOSER_ROLES.includes(user.role)) throw forbidden(`${user.role} can't propose a formal reminder`);
        const [pay] = await tx.db.select().from(payments).where(eq(payments.id, a.paymentId));
        if (!pay || pay.leaseId !== lease.id) throw notFound("payment");
        if (pay.status !== "overdue" && pay.status !== "bounced")
          throw conflict(
            `instalment ${pay.seq} is ${pay.status}: a formal reminder is only for an overdue or bounced payment`,
            "not_overdue",
          );
        if (pay.formalReminderSentOn)
          throw conflict("a formal reminder was already sent for this payment", "already_sent");
        summary = {
          gate: "formal_reminder",
          leaseRef: lease.ref,
          instalment: pay.seq,
          amount: formatAed(pay.amountFils),
          dueOn: pay.dueOn,
          status: pay.status,
        };
      } else {
        if (!TASK_CREATOR_ROLES.includes(user.role)) throw forbidden(`${user.role} can't record a repossession notice`);
        summary = {
          gate: "vacate_notice",
          leaseRef: lease.ref,
          ground: a.ground,
          servedOn: a.servedOn,
          deliveryMethod: a.deliveryMethod,
          leaseEndOn: lease.endOn,
        };
      }
      payload = a;
    }
    const now = ctx.clock.now();
    const [row] = await tx.db
      .insert(copilotProposals)
      .values({
        id: newId(),
        threadId,
        userId: user.id,
        kind: body.kind,
        payload,
        summary,
        expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
        createdAt: now,
      })
      .returning();
    return proposalView(row!, now.getTime());
  });
}

export async function cancelProposal(ctx: EngineContext, user: StaffUser, proposalId: string) {
  return withTx(ctx.database, async (tx) => {
    const p = await lockOwn(tx, user, proposalId);
    const now = ctx.clock.now();
    if (p.status !== "pending") throw conflict(`the proposal is already ${p.status}`, "proposal_decided");
    const [row] = await tx.db
      .update(copilotProposals)
      .set({ status: "cancelled", decidedAt: now })
      .where(eq(copilotProposals.id, p.id))
      .returning();
    return proposalView(row!, now.getTime());
  });
}

/** Only the user who proposed it can see or act on a proposal (others get "not found"). */
async function lockOwn(tx: Tx, user: StaffUser, proposalId: string): Promise<ProposalRow> {
  const [p] = await tx.db.select().from(copilotProposals).where(eq(copilotProposals.id, proposalId)).for("update");
  if (!p || p.userId !== user.id) throw notFound("proposal");
  return p;
}

function assertPending(p: ProposalRow, nowMs: number) {
  if (p.status !== "pending") throw conflict(`the proposal is already ${p.status}`, "proposal_decided");
  if (p.expiresAt.getTime() <= nowMs)
    throw conflict("the proposal has expired; ask the copilot again", "proposal_expired");
}

export async function threadProposals(ctx: EngineContext, threadId: string) {
  const rows = await ctx.database.db
    .select()
    .from(copilotProposals)
    .where(eq(copilotProposals.threadId, threadId))
    .orderBy(asc(copilotProposals.createdAt));
  const now = ctx.clock.now().getTime();
  return rows.map((r) => proposalView(r, now));
}

export async function getOwnProposal(ctx: EngineContext, user: StaffUser, id: string) {
  const [p] = await ctx.database.db.select().from(copilotProposals).where(eq(copilotProposals.id, id));
  if (!p || p.userId !== user.id) return null;
  return proposalView(p, ctx.clock.now().getTime());
}
