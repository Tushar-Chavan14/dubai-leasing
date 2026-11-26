import { type Actor, type ComplaintSubmitted, newId, type StaffRole, type StaffUser } from "@leasing/core";
import { shortRef } from "@leasing/core/tokens";
import {
  approvals,
  complaints,
  documents,
  inboundEvents,
  leases,
  maintenanceTickets,
  type Tx,
  withTx,
} from "@leasing/db";
import { ComplaintTriageSchemas, complaintTriage, type ComplaintTriageData } from "@leasing/helpers";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, forbidden, notFound } from "../errors.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent, getCompanyPolicy, leaseRulesVersion } from "./events.ts";
import type { SafetyComplaintProposal } from "./gate-rules.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import { createTask } from "./milestones.ts";

/**
 * Complaints and maintenance tickets (step 8, decision D28). A report from the portal (or logged
 * by staff for the tenant) is stored, then triaged by the Complaint Triage helper with no lock
 * held. Code acts on the route: escalate → a `safety_complaint` approval for an officer plus an
 * immediate task; review → a person triages; ticket → a maintenance ticket due by policy hours.
 * The tenant always gets an acknowledgement (checked model text or the fixed template).
 */

type LeaseRow = typeof leases.$inferSelect;
type InboundRow = typeof inboundEvents.$inferSelect;
type ComplaintRow = typeof complaints.$inferSelect;

export const TICKET_ROLES: StaffRole[] = ["leasing_officer", "leasing_manager"];

export async function processComplaint(ctx: EngineContext, ev: InboundRow) {
  const p = ev.payload as ComplaintSubmitted;
  // 1. The complaint row exists before the (slow) model runs, so staff see it at once.
  const complaint = await withTx(ctx.database, async (tx) => {
    const [existing] = await tx.db.select().from(complaints).where(eq(complaints.inboundEventId, ev.id));
    if (existing) return existing;
    const [row] = await tx.db
      .insert(complaints)
      .values({
        id: newId(),
        leaseId: ev.entityId,
        ref: ev.ref,
        text: p.description,
        room: p.room ?? null,
        atRisk: p.atRisk,
        source: ev.channel === "staff" ? "staff" : "portal",
        inboundEventId: ev.id,
        status: "triaging",
      })
      .returning();
    if (p.photoIds.length) {
      await tx.db
        .update(documents)
        .set({ complaintId: row!.id, status: "submitted" })
        .where(and(inArray(documents.id, p.photoIds), eq(documents.leaseId, ev.entityId)));
    }
    return row!;
  });
  if (complaint.status !== "triaging") return { done: false, reason: "already triaged" };

  // 2. Triage, no lock held.
  const policy = await withTx(ctx.database, (tx) => getCompanyPolicy(tx, ctx.clock.today()));
  const entity = { kind: "lease" as const, id: ev.entityId };
  const helperRunId = newId();
  const run = await runOnly(
    ctx,
    complaintTriage(ctx.llm),
    ComplaintTriageSchemas,
    entity,
    "COMPLAINT",
    {
      text: p.description,
      ...(p.room ? { room: p.room } : {}),
      atRisk: p.atRisk,
      safetyThreshold: policy.complaintSafetyThreshold,
      legalThreshold: policy.complaintLegalThreshold,
      injectionThreshold: policy.replyInjectionThreshold,
      minConfidence: policy.complaintMinConfidence,
    },
    ctx.rulesVersion,
    helperRunId,
  );

  // 3. Apply under lock.
  return withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.id, ev.id)).for("update");
    if (!locked || locked.status !== "received") return { done: false, reason: "already processed" };
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, ev.entityId)).for("update");
    if (!lease) return { done: false, reason: "lease not found" };
    await recordRun(ctx, tx, "complaint_triage", entity, lease.rulesVersion, run, helperRunId);
    const data = run.result.status === "ok" ? run.result.data : undefined;
    const reasons = run.result.reasons;
    const route = data?.route ?? (p.atRisk ? "escalate" : "review");
    await tx.db
      .update(complaints)
      .set({
        helperRunId,
        category: data?.category ?? null,
        categoryConfidence: data?.categoryConfidence ?? null,
        urgency: data?.urgency ?? (p.atRisk ? 3 : null),
        safety: data?.safety ?? null,
        legalThreat: data?.legalThreat ?? null,
        injection: data?.injection ?? null,
        language: data?.language ?? null,
        status: route === "escalate" ? "escalated" : route === "review" ? "review" : "ticketed",
      })
      .where(eq(complaints.id, complaint.id));
    const c = { ...complaint, category: data?.category ?? null, urgency: data?.urgency ?? null };

    if (route === "escalate") {
      const proposal: SafetyComplaintProposal = {
        leaseId: lease.id,
        complaintId: complaint.id,
        category: data?.category ?? "none",
        urgency: data?.urgency ?? 3,
        atRisk: p.atRisk,
        safety: data?.safety ?? null,
        legalThreat: data?.legalThreat ?? null,
      };
      await requestApproval(ctx, tx, {
        gate: "safety_complaint",
        entity: { kind: "lease", id: lease.id },
        dedupeKey: `${complaint.id}:safety_complaint`,
        title: `${p.atRisk || (data?.safety ?? 0) >= policy.complaintSafetyThreshold ? "Safety" : "Legal-threat"} complaint ${complaint.ref} on ${lease.ref}: act now`,
        proposal,
        reasons,
        sources: [{ kind: "helper_run", helperRunId, label: "Complaint triage" }],
        rulesVersion: lease.rulesVersion,
        proposedBy: "helper:complaint_triage",
      });
      await createTask(ctx, tx, lease.id, {
        kind: "complaint_escalated",
        title: `URGENT ${complaint.ref} on ${lease.ref}: contact the tenant now`,
        details: { complaintId: complaint.id, reasons, text: p.description, untrusted: true, atRisk: p.atRisk },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${complaint.id}:complaint_escalated`,
      });
    } else if (route === "review") {
      await createTask(ctx, tx, lease.id, {
        kind: "complaint_review",
        title: `Triage ${complaint.ref} on ${lease.ref}: open a ticket or close it`,
        details: { complaintId: complaint.id, reasons, text: p.description, untrusted: true },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${complaint.id}:complaint_review`,
      });
    } else {
      await openTicket(
        ctx,
        tx,
        lease,
        c,
        { category: data!.category, urgency: data!.urgency },
        "helper:complaint_triage",
      );
    }
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "COMPLAINT_TRIAGED",
      actor: "helper:complaint_triage",
      payload: {
        complaintId: complaint.id,
        ref: complaint.ref,
        route,
        category: data?.category ?? null,
        urgency: data?.urgency ?? null,
        ackSource: data?.ackSource ?? null,
        helperRunId,
      },
      rulesVersion: lease.rulesVersion,
    });
    // The tenant hears back whichever route it took (fixed template if the model failed).
    // The tenant is always acknowledged, even when the helper failed (the fixed template then).
    if (ev.channel === "portal")
      await queueLeaseMail(ctx, tx, { leaseId: lease.id, kind: "complaint_ack", key: complaint.id, seq: 1 });
    await tx.db
      .update(inboundEvents)
      .set({ status: "applied", result: { route, complaintId: complaint.id }, processedAt: ctx.clock.now() })
      .where(eq(inboundEvents.id, locked.id));
    return { done: true, applied: true, route };
  });
}

/** A maintenance ticket for a complaint, due by the policy hours for its urgency. */
async function openTicket(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  complaint: Pick<ComplaintRow, "id" | "ref">,
  t: { category: string; urgency: number },
  actor: Actor,
) {
  const policy = await getCompanyPolicy(tx, ctx.clock.today());
  const hours = policy.ticketDueHours[String(t.urgency) as "0" | "1" | "2" | "3"];
  const now = ctx.clock.now();
  const id = newId();
  const ref = shortRef("M");
  await tx.db
    .insert(maintenanceTickets)
    .values({
      id,
      ref,
      leaseId: lease.id,
      complaintId: complaint.id,
      category: t.category,
      urgency: t.urgency,
      dueBy: new Date(now.getTime() + hours * 3_600_000),
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: maintenanceTickets.complaintId });
  await tx.db.update(complaints).set({ status: "ticketed" }).where(eq(complaints.id, complaint.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "TICKET_OPENED",
    actor,
    payload: {
      ticketId: id,
      ref,
      complaintId: complaint.id,
      category: t.category,
      urgency: t.urgency,
      dueInHours: hours,
    },
    rulesVersion: lease.rulesVersion,
  });
  return { id, ref };
}

/** Safety-complaint approval decided: approved → an emergency ticket; rejected → closed with the reason. */
export async function onSafetyComplaintDecided(
  ctx: EngineContext,
  tx: Tx,
  a: typeof approvals.$inferSelect,
  status: "approved" | "edited" | "rejected",
  userId: string,
) {
  const p = a.proposal as SafetyComplaintProposal;
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, p.leaseId));
  const [c] = await tx.db.select().from(complaints).where(eq(complaints.id, p.complaintId)).for("update");
  if (!lease || !c) return;
  if (status === "rejected") {
    await tx.db
      .update(complaints)
      .set({ status: "closed", closedReason: a.decisionNote ?? "closed by an officer" })
      .where(eq(complaints.id, c.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "COMPLAINT_CLOSED",
      actor: `user:${userId}`,
      payload: { complaintId: c.id, ref: c.ref, approvalId: a.id, reason: a.decisionNote ?? null },
      rulesVersion: lease.rulesVersion,
    });
    // The tenant said someone is at risk: a person still follows up with them.
    if (p.atRisk) {
      await createTask(ctx, tx, lease.id, {
        kind: "complaint_review",
        title: `${lease.ref}: the tenant reported someone at risk (${c.ref}); the safety escalation was closed. Check with the tenant.`,
        details: { complaintId: c.id, approvalId: a.id, reason: a.decisionNote ?? null },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${c.id}:at_risk_followup`,
      });
    }
    return;
  }
  await openTicket(
    ctx,
    tx,
    lease,
    c,
    { category: p.category === "none" ? "building" : p.category, urgency: 3 },
    `user:${userId}`,
  );
}

// ---------------------------------------------------------------- staff actions

const TicketUpdate = z.object({
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function updateTicket(ctx: EngineContext, user: StaffUser, ticketId: string, raw: unknown) {
  if (!TICKET_ROLES.includes(user.role)) throw forbidden(`${user.role} can't update tickets`);
  const u = TicketUpdate.parse(raw);
  return withTx(ctx.database, async (tx) => {
    const [t] = await tx.db.select().from(maintenanceTickets).where(eq(maintenanceTickets.id, ticketId)).for("update");
    if (!t) throw notFound("ticket");
    const now = ctx.clock.now();
    const closing = u.status === "done" || u.status === "cancelled";
    await tx.db
      .update(maintenanceTickets)
      .set({
        ...(u.status ? { status: u.status } : {}),
        ...(u.notes !== undefined ? { notes: u.notes } : {}),
        updatedAt: now,
        ...(closing ? { closedAt: now } : {}),
      })
      .where(eq(maintenanceTickets.id, t.id));
    if (closing)
      await tx.db
        .update(complaints)
        .set({ status: "closed", closedReason: `ticket ${u.status}` })
        .where(eq(complaints.id, t.complaintId));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: t.leaseId },
      type: "TICKET_UPDATED",
      actor: `user:${user.id}`,
      payload: { ticketId: t.id, ref: t.ref, from: t.status, to: u.status ?? t.status },
      rulesVersion: await leaseRulesVersion(tx, t.leaseId),
    });
    return { ok: true };
  });
}

/** A person triaged a complaint the helper couldn't: open a ticket with their category and urgency, or close it. */
export async function resolveComplaint(ctx: EngineContext, user: StaffUser, complaintId: string, raw: unknown) {
  if (!TICKET_ROLES.includes(user.role)) throw forbidden(`${user.role} can't triage complaints`);
  const input = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("ticket"),
        category: z.enum(["ac", "plumbing", "electrical", "pest", "noise", "appliances", "building", "billing"]),
        urgency: z.number().int().min(0).max(3),
      }),
      z.object({ action: z.literal("close"), reason: z.string().trim().min(3).max(500) }),
    ])
    .parse(raw);
  return withTx(ctx.database, async (tx) => {
    const [c] = await tx.db.select().from(complaints).where(eq(complaints.id, complaintId)).for("update");
    if (!c) throw notFound("complaint");
    if (c.status !== "review" && c.status !== "open")
      throw conflict(`the complaint is ${c.status}`, "complaint_decided");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, c.leaseId));
    if (!lease) throw notFound("lease");
    if (input.action === "ticket") {
      await tx.db
        .update(complaints)
        .set({ category: input.category, urgency: input.urgency })
        .where(eq(complaints.id, c.id));
      return openTicket(ctx, tx, lease, c, input, `user:${user.id}`);
    }
    await tx.db.update(complaints).set({ status: "closed", closedReason: input.reason }).where(eq(complaints.id, c.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "COMPLAINT_CLOSED",
      actor: `user:${user.id}`,
      payload: { complaintId: c.id, ref: c.ref },
      rulesVersion: lease.rulesVersion,
    });
    return { ok: true };
  });
}

/** Staff views: a lease's complaints with their tickets, and the maintenance board. */
export async function leaseComplaints(tx: Tx, leaseId: string) {
  const rows = await tx.db
    .select()
    .from(complaints)
    .where(eq(complaints.leaseId, leaseId))
    .orderBy(desc(complaints.createdAt));
  const tickets = await tx.db.select().from(maintenanceTickets).where(eq(maintenanceTickets.leaseId, leaseId));
  return rows.map((c) => ({ ...c, ticket: tickets.find((t) => t.complaintId === c.id) ?? null }));
}

export async function ticketBoard(tx: Tx) {
  return tx.db
    .select({
      ticket: maintenanceTickets,
      leaseRef: leases.ref,
      complaintText: complaints.text,
      complaintRef: complaints.ref,
    })
    .from(maintenanceTickets)
    .innerJoin(leases, eq(leases.id, maintenanceTickets.leaseId))
    .innerJoin(complaints, eq(complaints.id, maintenanceTickets.complaintId))
    .where(inArray(maintenanceTickets.status, ["open", "in_progress"]))
    .orderBy(desc(maintenanceTickets.urgency), asc(maintenanceTickets.dueBy));
}

export type { ComplaintTriageData };
