import { formatDubaiDateTime } from "@leasing/adapters";
import { formatAed, newId, type StaffRole, type StaffUser } from "@leasing/core";
import {
  applications,
  copilotMessages,
  copilotProposals,
  copilotThreads,
  parties,
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
import { appendEvent, getCompanyPolicy } from "./events.ts";

/**
 * Copilot proposals (decision D25). The copilot's `propose_application` tool stores a proposal
 * here and nothing else. Only the user's Confirm click in the chat (`confirmProposal`, called by
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
      requireLeasing(user);
      const now = ctx.clock.now();
      assertPending(p, now.getTime());
      const input = ProposeApplication.parse({
        unitCode: p.payload.unitCode,
        nameEn: p.payload.nameEn,
        email: p.payload.email,
        kind: p.payload.kind,
        viewingAt: p.payload.viewingAt,
      });
      const actor = `copilot:${user.id}` as const;
      let created: { id: string; ref: string };
      try {
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
        created = await createApplication(
          ctx,
          {
            unitId: String(p.payload.unitId),
            nameEn: input.nameEn,
            email: input.email,
            kind: input.kind,
            viewingAt: new Date(input.viewingAt),
            source: "copilot",
          },
          actor,
          tx,
        );
      } catch (e) {
        if (e instanceof DomainError) throw new CreateFailed(e);
        throw e;
      }
      await appendEvent(tx, ctx, {
        entity: { kind: "application", id: created.id },
        type: "COPILOT_PROPOSAL_CONFIRMED",
        actor: `user:${user.id}`,
        payload: { proposalId: p.id, threadId: p.threadId },
        rulesVersion: ctx.rulesVersion,
      });
      const result = { applicationId: created.id, ref: created.ref };
      const [row] = await tx.db
        .update(copilotProposals)
        .set({ status: "confirmed", result, decidedAt: now })
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
