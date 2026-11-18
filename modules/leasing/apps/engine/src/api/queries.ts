import { approvalGates, type EntityKind, maskPii } from "@leasing/core";
import {
  applications,
  approvals,
  deadlines,
  type Db,
  helperRuns,
  inboundEvents,
  outboundMessages,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  staffUsers,
  tasks,
  units,
} from "@leasing/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

/** Read models for the staff UI. Party identifiers are masked; revealing them is a separate UI action. */

const partyView = (p: typeof parties.$inferSelect) =>
  maskPii({
    id: p.id,
    kind: p.kind,
    fullNameEn: p.fullNameEn,
    email: p.email,
    phone: p.phone,
    emiratesIdNo: p.emiratesIdNo,
    nationality: p.nationality,
  });

export async function listLeases(db: Db) {
  const rows = await db
    .select({ lease: leases, unitCode: units.code, building: units.building })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .orderBy(asc(leases.endOn));
  const ids = rows.map((r) => r.lease.id);
  const [tenants, next] = await Promise.all([tenantNames(db, ids), nextDeadlines(db, ids)]);
  return rows.map((r) => ({
    ...r.lease,
    unitCode: r.unitCode,
    building: r.building,
    tenantName: tenants.get(r.lease.id) ?? null,
    nextDeadline: next.get(r.lease.id) ?? null,
  }));
}

async function tenantNames(db: Db, leaseIds: string[]) {
  if (!leaseIds.length) return new Map<string, string>();
  const rows = await db
    .select({ leaseId: leaseParties.leaseId, name: parties.fullNameEn })
    .from(leaseParties)
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(and(inArray(leaseParties.leaseId, leaseIds), eq(leaseParties.role, "tenant")));
  return new Map(rows.map((r) => [r.leaseId, r.name]));
}

async function nextDeadlines(db: Db, entityIds: string[]) {
  if (!entityIds.length) return new Map<string, { milestone: string; dueOn: string }>();
  const rows = await db
    .selectDistinctOn([deadlines.entityId], {
      entityId: deadlines.entityId,
      milestone: deadlines.milestone,
      dueOn: deadlines.dueOn,
    })
    .from(deadlines)
    .where(and(inArray(deadlines.entityId, entityIds), eq(deadlines.status, "pending")))
    .orderBy(deadlines.entityId, asc(deadlines.dueOn));
  return new Map(rows.map((r) => [r.entityId, { milestone: r.milestone, dueOn: r.dueOn }]));
}

export async function getLease(db: Db, id: string) {
  const [row] = await db
    .select({ lease: leases, unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, id));
  if (!row) return null;
  const [people, dl, events, aps, ts, outbound, inbound, runs] = await Promise.all([
    db
      .select({ role: leaseParties.role, party: parties })
      .from(leaseParties)
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(eq(leaseParties.leaseId, id)),
    db.select().from(deadlines).where(eq(deadlines.entityId, id)).orderBy(asc(deadlines.dueOn)),
    entityEvents(db, "lease", id),
    db.select().from(approvals).where(eq(approvals.entityId, id)).orderBy(desc(approvals.createdAt)),
    db.select().from(tasks).where(eq(tasks.entityId, id)).orderBy(desc(tasks.createdAt)),
    db
      .select()
      .from(outboundMessages)
      .where(eq(outboundMessages.entityId, id))
      .orderBy(desc(outboundMessages.createdAt)),
    db.select().from(inboundEvents).where(eq(inboundEvents.entityId, id)).orderBy(desc(inboundEvents.receivedAt)),
    db.select().from(helperRuns).where(eq(helperRuns.entityId, id)).orderBy(desc(helperRuns.at)).limit(20),
  ]);
  return {
    ...row.lease,
    unit: row.unit,
    parties: people.map((p) => ({ role: p.role, ...partyView(p.party) })),
    deadlines: dl,
    nextDeadline: dl.find((d) => d.status === "pending") ?? null,
    events,
    approvals: aps,
    tasks: ts,
    outbound,
    // Tenant-written comments are untrusted text: the UI shows them as quotes, never as instructions.
    inbound: inbound.map((e) => ({ ...e, payload: maskPii(e.payload) })),
    helperRuns: runs,
  };
}

export function entityEvents(db: Db, kind: EntityKind, id: string, limit = 200) {
  return db
    .select()
    .from(leaseEvents)
    .where(and(eq(leaseEvents.entityKind, kind), eq(leaseEvents.entityId, id)))
    .orderBy(asc(leaseEvents.at), asc(leaseEvents.recordedAt))
    .limit(limit);
}

/** Proposals that carry ID numbers are shown masked; the full values are in the documents. */
const MASKED_GATES = new Set<string>(["kyc_review", "final_contract", "ejari_submission", "ejari_rejected_twice"]);
const masked = <T extends { gate: string; proposal: unknown; editedProposal: unknown }>(a: T): T =>
  MASKED_GATES.has(a.gate) ? { ...a, proposal: maskPii(a.proposal), editedProposal: maskPii(a.editedProposal) } : a;

export async function listApprovals(db: Db, status: "pending" | "decided" | "all") {
  const where =
    status === "pending"
      ? eq(approvals.status, "pending")
      : status === "decided"
        ? sql`${approvals.status} <> 'pending'`
        : undefined;
  const rows = await db.select().from(approvals).where(where).orderBy(desc(approvals.createdAt)).limit(200);
  return rows.map((a) => ({ ...masked(a), gateLabel: approvalGates[a.gate].label }));
}

export async function getApproval(db: Db, id: string) {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, id));
  if (!a) return null;
  const [events, decider] = await Promise.all([
    entityEvents(db, a.entityKind, a.entityId, 50),
    a.decidedBy
      ? db
          .select({ name: staffUsers.name, role: staffUsers.role })
          .from(staffUsers)
          .where(eq(staffUsers.id, a.decidedBy))
      : Promise.resolve([]),
  ]);
  let entity: Record<string, unknown> | null = null;
  if (a.entityKind === "lease") {
    const [l] = await db
      .select({ lease: leases, unitCode: units.code })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, a.entityId));
    if (l)
      entity = {
        kind: "lease",
        id: l.lease.id,
        ref: l.lease.ref,
        state: l.lease.state,
        unitCode: l.unitCode,
        endOn: l.lease.endOn,
        annualRentFils: l.lease.annualRentFils,
      };
  } else if (a.entityKind === "unit") {
    const [u] = await db.select().from(units).where(eq(units.id, a.entityId));
    if (u) entity = { kind: "unit", id: u.id, code: u.code, state: u.state };
  } else {
    const [ap] = await db
      .select({ app: applications, unitCode: units.code })
      .from(applications)
      .innerJoin(units, eq(units.id, applications.unitId))
      .where(eq(applications.id, a.entityId));
    if (ap)
      entity = { kind: "application", id: ap.app.id, state: ap.app.state, ref: ap.app.ref, unitCode: ap.unitCode };
  }
  // ID numbers are shown masked; the officer compares with the document image or the PDF.
  const view = masked(a);
  return { ...view, gateDef: approvalGates[a.gate], entity, events, decidedByUser: decider[0] ?? null };
}

export async function listTasks(db: Db, status: "open" | "all") {
  return db
    .select()
    .from(tasks)
    .where(status === "open" ? eq(tasks.status, "open") : undefined)
    .orderBy(asc(tasks.dueOn))
    .limit(200);
}

/** Pending deadlines due in the next `days` days (and any overdue), with lease and unit labels. */
export async function upcomingDeadlines(db: Db, today: string, days: number) {
  return db
    .select({
      id: deadlines.id,
      milestone: deadlines.milestone,
      dueOn: deadlines.dueOn,
      leaseId: leases.id,
      leaseRef: leases.ref,
      leaseState: leases.state,
      unitCode: units.code,
    })
    .from(deadlines)
    .innerJoin(leases, eq(leases.id, deadlines.entityId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(and(eq(deadlines.status, "pending"), sql`${deadlines.dueOn} <= (${today}::date + ${days}::int)`))
    .orderBy(asc(deadlines.dueOn))
    .limit(100);
}
