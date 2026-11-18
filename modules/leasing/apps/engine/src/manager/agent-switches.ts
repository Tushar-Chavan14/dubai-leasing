import { type CompanyPolicy, inQuietHours, newId, postponeOutOfQuietHours, toDubaiDate } from "@leasing/core";
import { deadlines, type Tx } from "@leasing/db";
import type { EngineContext } from "../context.ts";
import { getCompanyPolicy } from "./events.ts";

/**
 * Helpers for the agent switches added in slice 4 (decision D37). Every reminder, chase and
 * automatic release reads its switch twice: when it is scheduled and again when it fires, so a
 * switch turned off in between stops it, and the entity's own state is re-checked by the sender.
 * Nothing here touches an approval gate.
 */
export type Autopilot = CompanyPolicy["autopilot"];

export const autopilotNow = async (ctx: EngineContext, tx: Tx): Promise<Autopilot> =>
  (await getCompanyPolicy(tx, ctx.clock.today())).autopilot;

/** When a message due at `at` may go out: quiet hours (Dubai, from the Clock's instant) move it to their end. */
export const sendTime = (a: Autopilot, at: Date): Date =>
  a.quiet_hours ? postponeOutOfQuietHours(at, a.quiet_hours_start, a.quiet_hours_end) : at;

/** True when `now` is inside the quiet hours and the quiet-hours switch is on. */
export const quietNow = (a: Autopilot, now: Date): boolean =>
  a.quiet_hours && inQuietHours(now, a.quiet_hours_start, a.quiet_hours_end);

export const hoursFrom = (from: Date, hours: number): Date => new Date(from.getTime() + hours * 3_600_000);

/**
 * Queues a timed job. Real mode: a pg-boss job with `startAfter`. Demo mode: a `deadlines` row (due on
 * the Dubai date of `startAfter`) that the sweep fires, as every other milestone does, so the demo clock
 * (fast-forward, rewind) and the job agree. When the row fires it queues the same job at once, and the
 * job's own handler re-checks the switch and the entity's state. Idempotent on the singleton key.
 */
export async function scheduleTimed(
  ctx: EngineContext,
  tx: Tx,
  j: {
    name: string;
    data: Record<string, unknown>;
    singletonKey: string;
    startAfter: Date;
    entity: { kind: "application" | "lease"; id: string };
  },
): Promise<void> {
  if (!ctx.demoMode) {
    await ctx.scheduler.send(tx, {
      name: j.name,
      data: j.data,
      singletonKey: j.singletonKey,
      startAfter: j.startAfter,
    });
    return;
  }
  await tx.db
    .insert(deadlines)
    .values({
      id: newId(),
      entityKind: j.entity.kind,
      entityId: j.entity.id,
      milestone: `${TIMED_PREFIX}${j.singletonKey}`,
      dueOn: toDubaiDate(j.startAfter),
      status: "pending",
      note: JSON.stringify({ name: j.name, data: j.data, startAfter: j.startAfter.toISOString() }),
    })
    .onConflictDoNothing({ target: [deadlines.entityId, deadlines.milestone] });
}

export const TIMED_PREFIX = "timed:";

/**
 * True when a `timed:` row is due by its Dubai date but its exact instant (`startAfter`, stored in the
 * note) has not come yet: an hour-based reminder fires on a later sweep, like its pg-boss job would.
 */
export function timedNotYet(ctx: EngineContext, d: { milestone: string; note: string | null }): boolean {
  if (!d.milestone.startsWith(TIMED_PREFIX)) return false;
  try {
    const at = (JSON.parse(d.note ?? "null") as { startAfter?: string } | null)?.startAfter;
    return !!at && ctx.clock.now().getTime() < new Date(at).getTime();
  } catch {
    return false;
  }
}

/** A due `timed:` deadline: queues its job now (the sweep is the clock). Returns null when done. */
export async function fireTimed(ctx: EngineContext, tx: Tx, d: { milestone: string; note: string | null }) {
  const job = JSON.parse(d.note ?? "null") as { name: string; data: Record<string, unknown> } | null;
  if (!job) return "no job recorded";
  await ctx.scheduler.send(tx, {
    name: job.name,
    data: job.data,
    singletonKey: `${d.milestone.slice(TIMED_PREFIX.length)}#due`,
  });
  return null;
}

const TIMED_MAIL_KINDS = new Set(["viewing_reminder", "no_show", "docs_chase", "sign_reminder"]);
/** For test drains: a job that pg-boss would hold until its `startAfter` (the new reminder, chase and release jobs). */
export const isTimedAgentJob = (j: { name: string; data: Record<string, unknown>; startAfter?: Date | undefined }) =>
  !!j.startAfter &&
  (j.name === "offer.release" ||
    ((j.name === "application.mail" || j.name === "lease.mail") && TIMED_MAIL_KINDS.has(String(j.data.kind))));
