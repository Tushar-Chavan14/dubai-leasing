import { addYears, calendarDate, newId, toDubaiDate } from "@platform/kernel";
import { type SpaRole } from "@spa/core";
import { dealEvents, deals, retentionReviewItems, retentionReviews, spaUsers, withSpaTx } from "@spa/db";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { requireCompliance } from "./compliance.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { currentPolicy } from "./policy.ts";

const TERMINAL = ["HANDED_OVER", "COMPLETED", "CANCELLED"] as const;

/**
 * The monthly retention list (S29, S62). Lists the deals that ended at least `retentionYears` ago (the company policy's
 * years, 5 until the company confirms), counted from the Dubai day of the deal's terminal event; a deal with no terminal
 * event has no known end and is never listed, and neither is a deal already on an earlier list. It writes the list and
 * an event and **nothing else: no row and no file is deleted** (what "deleted" means waits for compliance). One list per
 * month, so the job is safe to run twice.
 */
export async function runRetentionReview(
  ctx: SpaContext,
): Promise<{ created: boolean; count: number; reviewId: string | null }> {
  const db = ctx.database.db;
  const period = ctx.clock.today().slice(0, 7);
  const [have] = await db
    .select({ id: retentionReviews.id })
    .from(retentionReviews)
    .where(eq(retentionReviews.period, period));
  if (have) return { created: false, count: 0, reviewId: have.id };
  const years = (await currentPolicy(db)).values.retentionYears;
  const cutoffOn = addYears(calendarDate(ctx.clock.today()), -years);
  const ended = await db
    .select({ id: deals.id, at: sql<Date>`max(${dealEvents.at})` })
    .from(deals)
    .innerJoin(
      dealEvents,
      and(eq(dealEvents.entityKind, "deal"), eq(dealEvents.entityId, deals.id), eq(dealEvents.toState, deals.state)),
    )
    .where(
      and(
        inArray(deals.state, [...TERMINAL]),
        notInArray(deals.id, db.select({ id: retentionReviewItems.dealId }).from(retentionReviewItems)),
      ),
    )
    .groupBy(deals.id);
  const due = ended
    .map((e) => ({ dealId: e.id, endedOn: toDubaiDate(new Date(e.at)) }))
    .filter((e) => e.endedOn <= cutoffOn)
    .toSorted((a, b) => (a.endedOn < b.endedOn ? -1 : a.endedOn > b.endedOn ? 1 : a.dealId < b.dealId ? -1 : 1));
  if (!due.length) return { created: false, count: 0, reviewId: null };
  const reviewId = newId();
  return withSpaTx(ctx.database, async (tx) => {
    const made = await tx.db
      .insert(retentionReviews)
      .values({ id: reviewId, period, retentionYears: years, cutoffOn, createdAt: ctx.clock.now() })
      .onConflictDoNothing()
      .returning({ id: retentionReviews.id });
    if (!made.length) return { created: false, count: 0, reviewId: null };
    await tx.db
      .insert(retentionReviewItems)
      .values(due.map((e) => ({ reviewId, dealId: e.dealId, endedOn: e.endedOn })));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "settings", id: reviewId },
      type: "RETENTION_REVIEW_LISTED",
      actor: "system",
      payload: { period, count: due.length, retentionYears: years, cutoffOn },
    });
    return { created: true, count: due.length, reviewId };
  });
}

/** A compliance role approves the month's list (S29, S62). The approval is an event; it deletes nothing. */
export async function approveRetentionReview(
  ctx: SpaContext,
  reviewId: string,
  user: { id: string; role: SpaRole },
): Promise<{ id: string; period: string; status: "approved"; count: number }> {
  requireCompliance(user);
  return withSpaTx(ctx.database, async (tx) => {
    const [review] = await tx.db.select().from(retentionReviews).where(eq(retentionReviews.id, reviewId)).for("update");
    if (!review) throw notFound("retention list");
    if (review.status !== "listed") throw conflict("already_approved", "this list is already approved");
    const now = ctx.clock.now();
    await tx.db
      .update(retentionReviews)
      .set({ status: "approved", approvedBy: user.id, approvedAt: now })
      .where(eq(retentionReviews.id, reviewId));
    const items = await tx.db
      .update(retentionReviewItems)
      .set({ status: "approved" })
      .where(eq(retentionReviewItems.reviewId, reviewId))
      .returning({ dealId: retentionReviewItems.dealId });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "settings", id: reviewId },
      type: "RETENTION_REVIEW_APPROVED",
      actor: `user:${user.id}`,
      // Nothing is deleted yet: the approval only records that the list was reviewed (S62).
      payload: { period: review.period, count: items.length, deleted: 0 },
    });
    return { id: reviewId, period: review.period, status: "approved" as const, count: items.length };
  });
}

/** The lists, newest first, each with its deals (ref and end day only) for a compliance role. */
export async function listRetentionReviews(ctx: SpaContext, user: { id: string; role: SpaRole }) {
  requireCompliance(user);
  const db = ctx.database.db;
  const reviews = await db.select().from(retentionReviews).orderBy(desc(retentionReviews.period));
  if (!reviews.length) return [];
  const items = await db
    .select({
      reviewId: retentionReviewItems.reviewId,
      ref: deals.ref,
      endedOn: retentionReviewItems.endedOn,
      status: retentionReviewItems.status,
    })
    .from(retentionReviewItems)
    .innerJoin(deals, eq(deals.id, retentionReviewItems.dealId))
    .orderBy(retentionReviewItems.endedOn, deals.ref);
  const who = new Map(
    (await db.select({ id: spaUsers.id, name: spaUsers.name }).from(spaUsers)).map((u) => [u.id, u.name]),
  );
  return reviews.map((r) => ({
    id: r.id,
    period: r.period,
    status: r.status,
    retentionYears: r.retentionYears,
    cutoffOn: r.cutoffOn,
    createdAt: r.createdAt.toISOString(),
    approvedBy: r.approvedBy,
    approvedByName: r.approvedBy ? (who.get(r.approvedBy) ?? null) : null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    items: items.filter((i) => i.reviewId === r.id).map((i) => ({ ref: i.ref, endedOn: i.endedOn, status: i.status })),
  }));
}
