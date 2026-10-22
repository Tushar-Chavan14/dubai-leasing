import { type Actor, newId, type StaffUser } from "@leasing/core";
import { documents, inspections, leases, type Tx, units, withTx } from "@leasing/db";
import { and, asc, eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { advance } from "./advance.ts";
import { appendEvent, leaseRulesVersion } from "./events.ts";
import { addTenancyPhoto } from "./tenancy-files.ts";

/**
 * Move-in checklist (step 7, no AI). On entering MOVE_IN the lease gets a `move_in` inspection:
 * DEWA active, keys and access cards handed over (ticked by staff), and a condition photo of
 * every room. The Ejari number is checked from the lease itself. `MOVE_IN_COMPLETED` is refused
 * until nothing is missing.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  kind: "check" | "room";
  done: boolean;
  doneBy?: string;
  doneAt?: string;
}

const CHECKS: { id: string; label: string }[] = [
  { id: "dewa", label: "DEWA electricity and water active" },
  { id: "keys", label: "Keys handed over" },
  { id: "access_cards", label: "Access cards handed over" },
];

/** Rooms to photograph, from the unit record (studio: one main room). */
export function roomsFor(unit: { bedrooms: number | null; bathrooms: number | null }): string[] {
  const beds = unit.bedrooms ?? 1;
  const baths = Math.max(1, unit.bathrooms ?? 1);
  const living = beds === 0 ? ["Main room"] : ["Living room"];
  const bedrooms =
    beds === 0 ? [] : Array.from({ length: beds }, (_, i) => (beds === 1 ? "Bedroom" : `Bedroom ${i + 1}`));
  const bathrooms = Array.from({ length: baths }, (_, i) => (baths === 1 ? "Bathroom" : `Bathroom ${i + 1}`));
  return [...living, "Kitchen", ...bedrooms, ...bathrooms];
}

type InspectionRow = typeof inspections.$inferSelect;

/** The lease's move-in inspection, created on first use (also for leases imported into MOVE_IN). */
export async function ensureMoveInInspection(ctx: EngineContext, tx: Tx, leaseId: string): Promise<InspectionRow> {
  const [existing] = await tx.db
    .select()
    .from(inspections)
    .where(and(eq(inspections.leaseId, leaseId), eq(inspections.kind, "move_in")));
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
    .values({ id: newId(), leaseId, kind: "move_in", status: "scheduled", scheduledOn: ctx.clock.today(), items })
    .returning();
  return created!;
}

/** The checklist with each room's photos, and what is still missing (in words, for the guard). */
export async function moveInStatus(ctx: EngineContext, tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease) throw notFound("lease");
  const inspection = await ensureMoveInInspection(ctx, tx, leaseId);
  const photos = await tx.db
    .select({
      id: documents.id,
      room: documents.room,
      kind: documents.kind,
      uploadedBy: documents.uploadedBy,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.leaseId, leaseId), eq(documents.inspectionId, inspection.id)))
    .orderBy(asc(documents.createdAt));
  const items = (inspection.items as ChecklistItem[]).map((i) =>
    i.kind === "room" ? { ...i, done: photos.some((p) => p.kind === "condition_photo" && p.room === i.label) } : i,
  );
  const missing = [
    ...(lease.ejariNo ? [] : ["Ejari number missing"]),
    ...items
      .filter((i) => !i.done)
      .map((i) =>
        i.kind === "room" ? `no condition photo of the ${i.label.toLowerCase()}` : `${i.label}: not ticked`,
      ),
  ];
  return { inspectionId: inspection.id, status: inspection.status, items, photos, missing, ejariNo: lease.ejariNo };
}

async function lockMoveIn(tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
  if (!lease) throw notFound("lease");
  if (lease.state !== "MOVE_IN") throw conflict(`the lease is ${lease.state}, not moving in`, "not_move_in");
  return lease;
}

/** Staff tick (or untick) a checklist item. */
export async function tickMoveInItem(
  ctx: EngineContext,
  leaseId: string,
  itemId: string,
  done: boolean,
  user: StaffUser,
) {
  return withTx(ctx.database, async (tx) => {
    await lockMoveIn(tx, leaseId);
    const inspection = await ensureMoveInInspection(ctx, tx, leaseId);
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
      type: done ? "MOVE_IN_ITEM_TICKED" : "MOVE_IN_ITEM_UNTICKED",
      actor: `user:${user.id}`,
      payload: { item: itemId, label: item.label },
      rulesVersion: await leaseRulesVersion(tx, leaseId),
    });
    return moveInStatus(ctx, tx, leaseId);
  });
}

/** Staff add a condition photo of one room (the room must be on the checklist). */
export async function addConditionPhoto(
  ctx: EngineContext,
  leaseId: string,
  room: string,
  bytes: Uint8Array,
  user: StaffUser,
) {
  const inspectionId = await withTx(ctx.database, async (tx) => {
    await lockMoveIn(tx, leaseId);
    const inspection = await ensureMoveInInspection(ctx, tx, leaseId);
    if (!(inspection.items as ChecklistItem[]).some((i) => i.kind === "room" && i.label === room))
      throw unprocessable(`"${room}" is not a room on this checklist`, [], "invalid_room");
    return inspection.id;
  });
  return addTenancyPhoto(
    ctx,
    { leaseId, kind: "condition_photo", uploadedBy: `user:${user.id}`, room, inspectionId },
    bytes,
  );
}

/** Removes a staff condition photo while the lease is still moving in (the file stays, content-addressed). */
export async function removeConditionPhoto(ctx: EngineContext, leaseId: string, documentId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    await lockMoveIn(tx, leaseId);
    const [doc] = await tx.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.leaseId, leaseId), eq(documents.kind, "condition_photo")));
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

/** What the MOVE_IN_COMPLETED guard sees (computed inside the transaction that advances). */
export async function moveInMissing(ctx: EngineContext, tx: Tx, leaseId: string): Promise<string[]> {
  return (await moveInStatus(ctx, tx, leaseId)).missing.filter((m) => m !== "Ejari number missing");
}

/** Staff finish the move-in: the guard re-checks everything; entering ACTIVE starts the tenancy. */
export async function completeMoveIn(ctx: EngineContext, leaseId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    await lockMoveIn(tx, leaseId);
    const inspection = await ensureMoveInInspection(ctx, tx, leaseId);
    const result = await advance(ctx, { kind: "lease", id: leaseId }, "MOVE_IN_COMPLETED", { actor, tx });
    await tx.db
      .update(inspections)
      .set({ status: "done", doneOn: ctx.clock.today() })
      .where(eq(inspections.id, inspection.id));
    return result;
  });
}
