import { addDays, type CalendarDate, toDubaiDate } from "@platform/kernel/dates";
import type { SpaActor, SpaRole } from "@spa/core";
import { dealEvents, type DefaultReason, deals, type SpaTx, withSpaTx } from "@spa/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { planCoverage } from "./payment-facts.ts";
import { policyAt } from "./policy.ts";
import { closeTask, openTask } from "./tasks.ts";

type Person = { id: string; role: SpaRole };
export const DEFAULT_ACTOR: SpaActor = "system:default-check";
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);
/** Who records a withdrawal or a no-show (S55), and who alone clears the flag. */
const RECORD_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager"];

const TITLES: Readonly<Record<DefaultReason, string>> = {
  overdue: "An instalment is overdue past the default period: review the deal",
  withdrew: "A party withdrew: review the deal",
  no_show: "A party did not show up: review the deal",
};

/**
 * Sets `in_default` (S55, S27): a flag, a `DEFAULT_FLAGGED` event and one task for the sales manager. It changes no deal
 * state and sends no notice or message to anyone. Already flagged is a no-op (`false`), so a job that runs twice flags
 * once. The caller holds the transaction.
 */
async function applyDefault(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  reason: DefaultReason,
  actor: SpaActor,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d) throw notFound("deal");
  if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} can't be flagged`);
  if (d.inDefault) return false;
  const since = ctx.clock.today();
  await tx.db
    .update(deals)
    .set({ inDefault: true, inDefaultSince: since, inDefaultReason: reason })
    .where(eq(deals.id, dealId));
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: dealId },
    type: "DEFAULT_FLAGGED",
    actor,
    rulesVersion: d.rulesVersion,
    payload: { reason, since, ...extra },
  });
  await openTask(ctx, tx, {
    dealId,
    kind: "default_flagged",
    role: "sales_manager",
    title: TITLES[reason],
    detail: { reason, since },
    dedupeKey: `${dealId}:default`,
  });
  return true;
}

/** Flags a deal as in default, idempotently (S55). */
export async function flagDefault(
  ctx: SpaContext,
  dealId: string,
  reason: DefaultReason,
  actor: SpaActor,
  extra: Record<string, unknown> = {},
): Promise<{ flagged: boolean }> {
  return { flagged: await withSpaTx(ctx.database, (tx) => applyDefault(ctx, tx, dealId, reason, actor, extra)) };
}

const PartyDefault = z.object({
  kind: z.enum(["withdrew", "no_show"]),
  note: z.string().trim().min(1).max(500),
});

/** A sales officer or manager records that a party withdrew or did not show up (S55); the flag is set as for an overdue instalment. */
export async function recordPartyDefault(ctx: SpaContext, dealId: string, input: unknown, user: Person): Promise<void> {
  if (!RECORD_ROLES.includes(user.role)) throw forbidden(`only ${RECORD_ROLES.join(" or ")} can record this`);
  const parsed = PartyDefault.safeParse(input);
  if (!parsed.success) throw unprocessable("invalid_default", "say what happened and add a note");
  const flagged = await withSpaTx(ctx.database, (tx) =>
    applyDefault(ctx, tx, dealId, parsed.data.kind, `user:${user.id}`, { note: parsed.data.note }),
  );
  if (!flagged) throw conflict("already_in_default", "the deal is already flagged");
}

/** Only a sales manager clears the flag, with a reason (S55). The open default task is finished. */
export async function clearDefaultFlag(ctx: SpaContext, dealId: string, reason: unknown, user: Person): Promise<void> {
  if (user.role !== "sales_manager") throw forbidden("only a sales manager clears the default flag");
  const why = z.string().trim().min(1).max(500).safeParse(reason);
  if (!why.success) throw unprocessable("reason_required", "give the reason for clearing the flag");
  await withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (!d.inDefault) throw conflict("not_in_default", "the deal isn't flagged");
    await tx.db
      .update(deals)
      .set({ inDefault: false, inDefaultSince: null, inDefaultReason: null })
      .where(eq(deals.id, dealId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "DEFAULT_CLEARED",
      actor: `user:${user.id}`,
      rulesVersion: d.rulesVersion,
      payload: { reason: why.data, was: d.inDefaultReason, since: d.inDefaultSince },
    });
    await closeTask(ctx, tx, `${dealId}:default`, `user:${user.id}`);
  });
}

/**
 * The daily default check (`spa.default.check`, S55): for each deal in `INSTALMENTS` with a dated plan row that is not
 * covered by counted payments and whose `due_on` plus the pinned policy's `defaultAfterDays` is before today, flags
 * the deal. Milestone rows have no date and are never flagged. A row already overdue when a manager cleared the flag
 * does not flag again; a row that falls overdue after the clearing does. Safe to run twice.
 */
export async function defaultCheck(ctx: SpaContext): Promise<{ flagged: string[] }> {
  const today = ctx.clock.today();
  const open = await ctx.database.db
    .select({ id: deals.id, policyVersion: deals.policyVersion })
    .from(deals)
    .where(and(eq(deals.state, "INSTALMENTS"), eq(deals.inDefault, false)));
  const flagged: string[] = [];
  for (const d of open) {
    try {
      const days = (await policyAt(ctx.database.db, d.policyVersion)).defaultAfterDays;
      const [cleared] = await ctx.database.db
        .select({ at: dealEvents.at })
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, d.id), eq(dealEvents.type, "DEFAULT_CLEARED")))
        .orderBy(desc(dealEvents.at))
        .limit(1);
      const clearedOn = cleared ? toDubaiDate(cleared.at) : null;
      const overdue = (await planCoverage(ctx.database.db, d.id)).filter(
        (r) =>
          r.dueOn !== null &&
          r.paidFils < r.amountFils &&
          addDays(r.dueOn as CalendarDate, days) < today &&
          (!clearedOn || addDays(r.dueOn as CalendarDate, days + 1) > clearedOn),
      );
      if (!overdue.length) continue;
      const r = await flagDefault(ctx, d.id, "overdue", DEFAULT_ACTOR, {
        overdueSeqs: overdue.map((o) => o.seq),
        defaultAfterDays: days,
      });
      if (r.flagged) flagged.push(d.id);
    } catch (e) {
      console.error(`default check: deal ${d.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { flagged };
}
