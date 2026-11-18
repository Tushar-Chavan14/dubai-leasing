import { type Actor, type CalendarDate, newId, type StaffUser } from "@leasing/core";
import { depositStatements, documents, inspections, leases, tasks, type Tx, units, withTx } from "@leasing/db";
import { Finding, RoomComparisonSchemas, roomComparisonHelper, type Suggestion } from "@leasing/helpers";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { appendEvent, getCompanyPolicy, leaseRulesVersion } from "./events.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import { addLeaseDeadline, createTask } from "./milestones.ts";
import { type ChecklistItem, roomsFor } from "./move-in.ts";
import { addTenancyPhoto } from "./tenancy-files.ts";
import { inspectionSlots } from "./viewing-slots.ts";

/**
 * Move-out (step 10). Entering MOVE_OUT creates the `move_out` inspection and emails the tenant
 * a link to book it. At the inspection staff tick keys and cards returned and photograph every
 * room; the local vision model compares each room with its move-in photos and suggests damage
 * items from the price list (D29), which an officer confirms or ignores. Completing the
 * inspection issues the deposit statement (deposit.ts) and, from the move-out date, cancels Ejari.
 */
export const EXIT_COMPARE_JOB = "exit.compare";
export const MOVE_OUT_MILESTONE = "move_out_date";

const CHECKS: { id: string; label: string }[] = [
  { id: "keys_returned", label: "Keys returned" },
  { id: "cards_returned", label: "Access cards returned" },
  { id: "dewa_final", label: "DEWA final reading requested" },
];

type LeaseRow = typeof leases.$inferSelect;
type InspectionRow = typeof inspections.$inferSelect;

export interface FindingRecord extends Finding {
  fromSuggestion: boolean;
  by: string;
  at: string;
}

export interface RoomSuggestions {
  room: string;
  status: "pending" | "ok" | "needs_human";
  seq: number;
  suggestions: Suggestion[];
  reasons: string[];
  helperRunId?: string;
}

/** The lease's move-out inspection, created on first use. */
export async function ensureMoveOutInspection(ctx: EngineContext, tx: Tx, leaseId: string): Promise<InspectionRow> {
  const [existing] = await tx.db
    .select()
    .from(inspections)
    .where(and(eq(inspections.leaseId, leaseId), eq(inspections.kind, "move_out")));
  if (existing) return existing;
  const [row] = await tx.db
    .select({ unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  if (!row) throw notFound("lease");
  const items: ChecklistItem[] = [
    ...CHECKS.map((c) => ({ ...c, kind: "check" as const, done: false })),
    ...roomsFor(row.unit).map((room) => ({ id: `room:${room}`, label: room, kind: "room" as const, done: false })),
  ];
  const [created] = await tx.db
    .insert(inspections)
    .values({ id: newId(), leaseId, kind: "move_out", status: "scheduled", items })
    .returning();
  return created!;
}

/**
 * Work on entering MOVE_OUT (tenant notice, renewal reply "vacate", landlord repossession): the
 * move-out date (the lease end unless the payload set one), the inspection, a milestone on the
 * move-out date and the booking email.
 */
export async function onEnterMoveOut(ctx: EngineContext, tx: Tx, lease: LeaseRow): Promise<void> {
  const moveOutOn = lease.moveOutOn ?? lease.endOn;
  if (!lease.moveOutOn) await tx.db.update(leases).set({ moveOutOn }).where(eq(leases.id, lease.id));
  await ensureMoveOutInspection(ctx, tx, lease.id);
  await addLeaseDeadline(ctx, tx, {
    leaseId: lease.id,
    milestone: `${MOVE_OUT_MILESTONE}@${moveOutOn}`,
    dueOn: moveOutOn,
    rulesVersion: lease.rulesVersion,
    note: "the tenant moves out: inspection, deposit statement, Ejari cancellation",
  });
  await queueLeaseMail(ctx, tx, { leaseId: lease.id, kind: "move_out", key: lease.id, seq: 1 });
}

/** The move-out milestone: chase an inspection not done yet, and cancel Ejari once it is. */
export async function handleMoveOutMilestone(ctx: EngineContext, tx: Tx, leaseId: string): Promise<string | null> {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
  if (!lease) return "lease not found";
  if (lease.state !== "MOVE_OUT") return `lease is ${lease.state}`;
  const inspection = await ensureMoveOutInspection(ctx, tx, leaseId);
  if (inspection.status !== "done") {
    await createTask(ctx, tx, lease.id, {
      kind: "move_out_inspection_due",
      title: `${lease.ref}: the tenant moves out today and the inspection isn't done${inspection.scheduledAt ? "" : " (not booked)"}`,
      details: { inspectionId: inspection.id, scheduledAt: inspection.scheduledAt },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:move_out_inspection_due@${lease.moveOutOn}`,
    });
    return null;
  }
  await queueEjariCancel(ctx, tx, lease);
  return null;
}

/** Ejari is cancelled once the tenant has handed the unit back: inspection done and the move-out date reached. */
export async function queueEjariCancel(ctx: EngineContext, tx: Tx, lease: LeaseRow): Promise<boolean> {
  if (!lease.ejariNo || lease.ejariCancelledOn) return false;
  if (ctx.clock.today() < (lease.moveOutOn ?? lease.endOn)) return false;
  await ctx.scheduler.send(tx, {
    name: EJARI_CANCEL_JOB,
    data: { leaseId: lease.id },
    singletonKey: `${lease.id}:ejari_cancel`,
  });
  return true;
}
export const EJARI_CANCEL_JOB = "ejari.cancel";

/** Slots the tenant may book, the booking, and whether it can still change. */
export async function moveOutBooking(ctx: EngineContext, tx: Tx, lease: LeaseRow) {
  const inspection = await ensureMoveOutInspection(ctx, tx, lease.id);
  const policy = await getCompanyPolicy(tx, ctx.clock.today());
  const moveOutOn = lease.moveOutOn ?? lease.endOn;
  const open = lease.state === "MOVE_OUT" && inspection.status !== "done";
  return {
    moveOutOn,
    scheduledAt: inspection.scheduledAt,
    done: inspection.status === "done",
    canBook: open,
    slots: open ? inspectionSlots(ctx.clock.now(), policy, moveOutOn).map((d) => d.toISOString()) : [],
  };
}

/** Books (or moves) the inspection to one of the offered slots; the officer gets a task for that day. */
export async function bookInspection(ctx: EngineContext, tx: Tx, lease: LeaseRow, slotAt: Date, actor: Actor) {
  if (lease.state !== "MOVE_OUT") throw conflict("There is no move-out inspection to book right now.");
  const booking = await moveOutBooking(ctx, tx, lease);
  if (!booking.canBook) throw conflict("The move-out inspection is already done.");
  if (!booking.slots.includes(slotAt.toISOString()))
    throw unprocessable("choose one of the offered times", [], "invalid_slot");
  const inspection = await ensureMoveOutInspection(ctx, tx, lease.id);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(slotAt) as CalendarDate;
  await tx.db
    .update(inspections)
    .set({ scheduledAt: slotAt, scheduledOn: day, bookedBy: actor })
    .where(eq(inspections.id, inspection.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "INSPECTION_BOOKED",
    actor,
    payload: {
      inspectionId: inspection.id,
      slotAt: slotAt.toISOString(),
      previous: inspection.scheduledAt?.toISOString() ?? null,
    },
    rulesVersion: lease.rulesVersion,
  });
  // A rebooking replaces the earlier slot's task.
  await tx.db
    .update(tasks)
    .set({ status: "cancelled" })
    .where(and(eq(tasks.entityId, lease.id), eq(tasks.kind, "move_out_inspection"), eq(tasks.status, "open")));
  await createTask(ctx, tx, lease.id, {
    kind: "move_out_inspection",
    title: `Move-out inspection of ${lease.ref} at ${slotAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    details: { inspectionId: inspection.id, slotAt: slotAt.toISOString() },
    assigneeRole: "leasing_officer",
    dueOn: day,
    dedupeKey: `${lease.id}:move_out_inspection@${slotAt.toISOString()}`,
  });
  return { scheduledAt: slotAt.toISOString() };
}

/** Rooms with their move-in and move-out photos side by side, suggestions, findings and the statement. */
export async function moveOutStatus(ctx: EngineContext, tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease) throw notFound("lease");
  const inspection = await ensureMoveOutInspection(ctx, tx, leaseId);
  const [moveIn] = await tx.db
    .select({ id: inspections.id })
    .from(inspections)
    .where(and(eq(inspections.leaseId, leaseId), eq(inspections.kind, "move_in")));
  const photos = await tx.db
    .select({ id: documents.id, room: documents.room, kind: documents.kind, inspectionId: documents.inspectionId })
    .from(documents)
    .where(
      and(
        eq(documents.leaseId, leaseId),
        inArray(documents.kind, ["condition_photo", "move_out_photo"]),
        ne(documents.status, "rejected"),
      ),
    )
    .orderBy(asc(documents.createdAt));
  const items = (inspection.items as ChecklistItem[]).map((i) =>
    i.kind === "room"
      ? {
          ...i,
          done: photos.some(
            (p) => p.kind === "move_out_photo" && p.inspectionId === inspection.id && p.room === i.label,
          ),
        }
      : i,
  );
  const rooms = items
    .filter((i) => i.kind === "room")
    .map((i) => ({
      room: i.label,
      moveIn: photos
        .filter((p) => p.kind === "condition_photo" && moveIn && p.inspectionId === moveIn.id && p.room === i.label)
        .map((p) => p.id),
      moveOut: photos
        .filter((p) => p.kind === "move_out_photo" && p.inspectionId === inspection.id && p.room === i.label)
        .map((p) => p.id),
    }));
  const [statement] = await tx.db
    .select()
    .from(depositStatements)
    .where(eq(depositStatements.leaseId, leaseId))
    .orderBy(desc(depositStatements.revision))
    .limit(1);
  const missing = items
    .filter((i) => !i.done)
    .map((i) => (i.kind === "room" ? `no move-out photo of the ${i.label.toLowerCase()}` : `${i.label}: not ticked`));
  const policy = await getCompanyPolicy(tx, ctx.clock.today());
  return {
    inspectionId: inspection.id,
    status: inspection.status,
    scheduledAt: inspection.scheduledAt,
    moveOutOn: lease.moveOutOn ?? lease.endOn,
    items,
    rooms,
    suggestions: inspection.suggestions as unknown as RoomSuggestions[],
    findings: inspection.findings as unknown as FindingRecord[],
    findingsEditable: findingsEditable(lease, inspection, statement ?? null),
    priceList: policy.deductionPriceList,
    statement: statement ?? null,
    missing,
    depositFils: lease.depositFils,
    ejariNo: lease.ejariNo,
    ejariCancelledOn: lease.ejariCancelledOn,
    depositSettledOn: lease.depositSettledOn,
  };
}

const findingsEditable = (
  lease: LeaseRow,
  inspection: InspectionRow,
  statement: typeof depositStatements.$inferSelect | null,
) => lease.state === "MOVE_OUT" && (inspection.status !== "done" || statement?.status === "superseded");

async function lockMoveOut(ctx: EngineContext, tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
  if (!lease) throw notFound("lease");
  if (lease.state !== "MOVE_OUT") throw conflict(`the lease is ${lease.state}, not moving out`, "not_move_out");
  const inspection = await ensureMoveOutInspection(ctx, tx, leaseId);
  return { lease, inspection };
}

async function lockOpenInspection(ctx: EngineContext, tx: Tx, leaseId: string) {
  const r = await lockMoveOut(ctx, tx, leaseId);
  if (r.inspection.status === "done") throw conflict("the move-out inspection is complete", "inspection_done");
  return r;
}

/** Staff tick (or untick) a move-out checklist item. */
export async function tickMoveOutItem(
  ctx: EngineContext,
  leaseId: string,
  itemId: string,
  done: boolean,
  user: StaffUser,
) {
  return withTx(ctx.database, async (tx) => {
    const { inspection } = await lockOpenInspection(ctx, tx, leaseId);
    const items = inspection.items as ChecklistItem[];
    const item = items.find((i) => i.id === itemId && i.kind === "check");
    if (!item) throw notFound("checklist item");
    const next = items.map((i) =>
      i.id === itemId
        ? done
          ? { ...i, done: true, doneBy: `user:${user.id}`, doneAt: ctx.clock.now().toISOString() }
          : { id: i.id, label: i.label, kind: i.kind, done: false }
        : i,
    );
    await tx.db.update(inspections).set({ items: next }).where(eq(inspections.id, inspection.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: done ? "MOVE_OUT_ITEM_TICKED" : "MOVE_OUT_ITEM_UNTICKED",
      actor: `user:${user.id}`,
      payload: { item: itemId, label: item.label },
      rulesVersion: await leaseRulesVersion(tx, leaseId),
    });
    return moveOutStatus(ctx, tx, leaseId);
  });
}

/** Staff add a move-out condition photo of one room on the checklist. */
export async function addMoveOutPhoto(
  ctx: EngineContext,
  leaseId: string,
  room: string,
  bytes: Uint8Array,
  user: StaffUser,
) {
  const inspectionId = await withTx(ctx.database, async (tx) => {
    const { inspection } = await lockOpenInspection(ctx, tx, leaseId);
    if (!(inspection.items as ChecklistItem[]).some((i) => i.kind === "room" && i.label === room))
      throw unprocessable(`"${room}" is not a room on this checklist`, [], "invalid_room");
    return inspection.id;
  });
  return addTenancyPhoto(
    ctx,
    { leaseId, kind: "move_out_photo", uploadedBy: `user:${user.id}`, room, inspectionId },
    bytes,
  );
}

export async function removeMoveOutPhoto(ctx: EngineContext, leaseId: string, documentId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    await lockOpenInspection(ctx, tx, leaseId);
    const [doc] = await tx.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.leaseId, leaseId), eq(documents.kind, "move_out_photo")));
    if (!doc) throw notFound("photo");
    await tx.db.update(documents).set({ inspectionId: null, status: "rejected" }).where(eq(documents.id, doc.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "PHOTO_REMOVED",
      actor: `user:${user.id}`,
      payload: { documentId: doc.id, room: doc.room },
      rulesVersion: await leaseRulesVersion(tx, leaseId),
    });
    return { ok: true };
  });
}

/**
 * Asks the local vision model to compare every room that has both move-in and move-out photos
 * (one job per room; the photos never leave the machine, D29). Earlier suggestions for those
 * rooms are replaced when the new answer arrives.
 */
export async function requestComparison(ctx: EngineContext, leaseId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    const { inspection } = await lockOpenInspection(ctx, tx, leaseId);
    const status = await moveOutStatus(ctx, tx, leaseId);
    const ready = status.rooms.filter((r) => r.moveIn.length && r.moveOut.length);
    if (!ready.length)
      throw unprocessable("no room has both move-in and move-out photos yet", [], "nothing_to_compare");
    const prev = inspection.suggestions as unknown as RoomSuggestions[];
    const next = prev.filter((s) => !ready.some((r) => r.room === s.room));
    for (const r of ready) {
      const seq = (prev.find((s) => s.room === r.room)?.seq ?? 0) + 1;
      next.push({ room: r.room, status: "pending", seq, suggestions: [], reasons: [] });
      await ctx.scheduler.send(tx, {
        name: EXIT_COMPARE_JOB,
        data: { leaseId, room: r.room, seq },
        singletonKey: `${leaseId}:exit_compare:${r.room}#${seq}`,
      });
    }
    await tx.db
      .update(inspections)
      .set({ suggestions: next as unknown as Record<string, unknown>[] })
      .where(eq(inspections.id, inspection.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "PHOTO_COMPARISON_REQUESTED",
      actor: `user:${user.id}`,
      payload: { rooms: ready.map((r) => r.room) },
      rulesVersion: await leaseRulesVersion(tx, leaseId),
    });
    return { rooms: ready.map((r) => r.room) };
  });
}

/** The comparison job for one room: the model runs outside any transaction; a stale answer is dropped. */
export async function runComparison(ctx: EngineContext, j: { leaseId: string; room: string; seq: number }) {
  const prepared = await withTx(ctx.database, async (tx) => {
    const status = await moveOutStatus(ctx, tx, j.leaseId);
    const room = status.rooms.find((r) => r.room === j.room);
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    const [lease] = await tx.db.select({ rv: leases.rulesVersion }).from(leases).where(eq(leases.id, j.leaseId));
    if (!room || !lease) return null;
    return {
      rulesVersion: lease.rv,
      context: {
        room: j.room,
        // The latest three of each: what the room looked like at each end of the tenancy.
        moveInDocIds: room.moveIn.slice(-3),
        moveOutDocIds: room.moveOut.slice(-3),
        priceList: policy.deductionPriceList.map((p) => ({ id: p.id, label: p.label })),
        minConfidence: policy.exitVisionMinConfidence,
      },
    };
  });
  if (!prepared || !prepared.context.moveInDocIds.length || !prepared.context.moveOutDocIds.length) return;
  const readImage = async (docId: string) => {
    const [doc] = await ctx.database.db.select({ path: documents.path }).from(documents).where(eq(documents.id, docId));
    if (!doc) throw new Error("photo missing");
    return new Uint8Array(await ctx.uploads.read(doc.path));
  };
  const helperRunId = newId();
  const entity = { kind: "lease" as const, id: j.leaseId };
  const run = await runOnly(
    ctx,
    roomComparisonHelper(ctx.llm, readImage),
    RoomComparisonSchemas,
    entity,
    "MOVE_OUT",
    prepared.context,
    prepared.rulesVersion,
    helperRunId,
  );
  await withTx(ctx.database, async (tx) => {
    await recordRun(ctx, tx, "exit_compare", entity, prepared.rulesVersion, run, helperRunId);
    const [inspection] = await tx.db
      .select()
      .from(inspections)
      .where(and(eq(inspections.leaseId, j.leaseId), eq(inspections.kind, "move_out")))
      .for("update");
    if (!inspection) return;
    const list = inspection.suggestions as unknown as RoomSuggestions[];
    const cur = list.find((s) => s.room === j.room);
    if (!cur || cur.seq !== j.seq) return;
    const done: RoomSuggestions = {
      room: j.room,
      seq: j.seq,
      status: run.result.status === "ok" ? "ok" : "needs_human",
      suggestions: run.result.data?.suggestions ?? [],
      reasons: run.result.reasons,
      helperRunId,
    };
    await tx.db
      .update(inspections)
      .set({ suggestions: list.map((s) => (s.room === j.room ? done : s)) as unknown as Record<string, unknown>[] })
      .where(eq(inspections.id, inspection.id));
  });
}

export const AddFinding = z.object({
  room: z.string().trim().max(60).nullable(),
  itemId: z.string().trim().min(1).max(40),
  quantity: z.number().int().min(1).max(999),
  otherLabel: z.string().trim().min(3).max(120).optional(),
  otherAmountFils: z.number().int().positive().max(100_000_000).optional(),
  note: z.string().trim().max(500).optional(),
  fromSuggestion: z.boolean().default(false),
});

/** An officer confirms a damage item: from the price list (any amount comes from the list) or "other". */
export async function addFinding(ctx: EngineContext, leaseId: string, raw: unknown, user: StaffUser) {
  const input = AddFinding.parse(raw);
  return withTx(ctx.database, async (tx) => {
    const { lease, inspection } = await lockMoveOut(ctx, tx, leaseId);
    await assertFindingsEditable(tx, lease, inspection);
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    if (input.itemId !== "other" && !policy.deductionPriceList.some((p) => p.id === input.itemId))
      throw unprocessable(`"${input.itemId}" is not on the price list`, [], "invalid_item");
    const finding = Finding.parse({
      id: newId(),
      room: input.room,
      itemId: input.itemId,
      quantity: input.quantity,
      ...(input.itemId === "other" ? { otherLabel: input.otherLabel, otherAmountFils: input.otherAmountFils } : {}),
      ...(input.note ? { note: input.note } : {}),
    });
    const record: FindingRecord = {
      ...finding,
      fromSuggestion: input.fromSuggestion,
      by: `user:${user.id}`,
      at: ctx.clock.now().toISOString(),
    };
    await tx.db
      .update(inspections)
      .set({
        findings: [...(inspection.findings as Record<string, unknown>[]), record as unknown as Record<string, unknown>],
      })
      .where(eq(inspections.id, inspection.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "DAMAGE_CONFIRMED",
      actor: `user:${user.id}`,
      payload: {
        findingId: finding.id,
        room: finding.room,
        itemId: finding.itemId,
        quantity: finding.quantity,
        otherAmountFils: finding.otherAmountFils ?? null,
        fromSuggestion: input.fromSuggestion,
      },
      rulesVersion: lease.rulesVersion,
    });
    return moveOutStatus(ctx, tx, leaseId);
  });
}

export async function removeFinding(ctx: EngineContext, leaseId: string, findingId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    const { lease, inspection } = await lockMoveOut(ctx, tx, leaseId);
    await assertFindingsEditable(tx, lease, inspection);
    const list = inspection.findings as unknown as FindingRecord[];
    if (!list.some((f) => f.id === findingId)) throw notFound("finding");
    await tx.db
      .update(inspections)
      .set({ findings: list.filter((f) => f.id !== findingId) as unknown as Record<string, unknown>[] })
      .where(eq(inspections.id, inspection.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "DAMAGE_REMOVED",
      actor: `user:${user.id}`,
      payload: { findingId },
      rulesVersion: lease.rulesVersion,
    });
    return moveOutStatus(ctx, tx, leaseId);
  });
}

async function assertFindingsEditable(tx: Tx, lease: LeaseRow, inspection: InspectionRow) {
  const [statement] = await tx.db
    .select()
    .from(depositStatements)
    .where(eq(depositStatements.leaseId, lease.id))
    .orderBy(desc(depositStatements.revision))
    .limit(1);
  if (!findingsEditable(lease, inspection, statement ?? null))
    throw conflict("the deposit statement is out; findings change only after finance rejects it", "statement_issued");
}

/** The deadline milestones that belong to move-out (fired through `handleMoveOutMilestone`). */
export const isMoveOutMilestone = (m: string) => m.startsWith(`${MOVE_OUT_MILESTONE}@`);
