import { newId } from "@platform/kernel/ids";
import { type SpaRole, taskVisibleTo, hasRole, rolesOf } from "@spa/core";
import { spaTasks, type SpaTx, type TaskKind, withSpaTx } from "@spa/db";
import { and, eq } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound } from "./errors.ts";
import { appendDealEvent } from "./events.ts";

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

export interface TaskInput {
  dealId: string | null;
  kind: TaskKind;
  role: SpaRole;
  /** Plain words for the role that sees the task. Never a compliance word, never a name or a number (S55). */
  title: string;
  /** Ids and codes only, never personal data. */
  detail?: Record<string, unknown>;
  /** One open task per key: opening the same one again is a no-op. */
  dedupeKey: string;
}

/** Opens a task unless one with this key is already open. Joins the caller's transaction. */
export async function openTask(
  ctx: SpaContext,
  tx: SpaTx,
  input: TaskInput,
): Promise<{ id: string | null; created: boolean }> {
  const id = newId();
  const rows = await tx.db
    .insert(spaTasks)
    .values({
      id,
      dealId: input.dealId,
      kind: input.kind,
      role: input.role,
      title: input.title,
      detail: input.detail ?? {},
      dedupeKey: input.dedupeKey,
      createdAt: ctx.clock.now(),
    })
    .onConflictDoNothing()
    .returning({ id: spaTasks.id });
  return rows.length ? { id, created: true } : { id: null, created: false };
}

/** Closes the open task with this key, if any (the work it asked for is done). */
export async function closeTask(
  ctx: SpaContext,
  tx: SpaTx,
  dedupeKey: string,
  by: string,
  status: "done" | "cancelled" = "done",
): Promise<void> {
  const [live] = await tx.db
    .select()
    .from(spaTasks)
    .where(and(eq(spaTasks.dedupeKey, dedupeKey), eq(spaTasks.status, "open")))
    .for("update");
  if (!live) return;
  await tx.db.update(spaTasks).set({ status, doneAt: ctx.clock.now(), doneBy: by }).where(eq(spaTasks.id, live.id));
}

/**
 * Finishes a task (S55): the person whose role the task is for, or a sales manager. A task is finished once; it is
 * never deleted.
 */
export async function completeTask(ctx: SpaContext, taskId: string, user: Person): Promise<void> {
  await withSpaTx(ctx.database, async (tx) => {
    const [t] = await tx.db.select().from(spaTasks).where(eq(spaTasks.id, taskId)).for("update");
    if (!t) throw notFound("task");
    // A task its viewer can't see doesn't exist for them, and no error names the task's role (S55 amendment).
    if (!taskVisibleTo(t.role, rolesOf(user))) throw notFound("task");
    if (!hasRole(user, t.role) && !hasRole(user, "sales_manager")) throw forbidden("you can't finish this task");
    if (t.status !== "open") throw conflict("task_closed", "this task is already finished");
    await tx.db
      .update(spaTasks)
      .set({ status: "done", doneAt: ctx.clock.now(), doneBy: `user:${user.id}` })
      .where(eq(spaTasks.id, taskId));
    if (t.dealId)
      await appendDealEvent(tx, ctx, {
        entity: { kind: "deal", id: t.dealId },
        type: "TASK_DONE",
        actor: `user:${user.id}`,
        payload: { taskId, kind: t.kind },
      });
  });
}
