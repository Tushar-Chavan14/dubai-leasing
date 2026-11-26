import { LEAD_MANUAL_STATUSES, type LeadStatus } from "@spa/core";
import { spaLeads, spaViewings, withSpaTx } from "@spa/db";
import { and, eq, gt } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { type Person, requireSales, seesAllLeads } from "./leads.ts";
import { CLOSED_REASON, dispatchViewingMail, cancelViewingTx } from "./viewings.ts";

const MANUAL_FROM: readonly LeadStatus[] = ["new", "contacted", "viewing_booked", "interested", "not_interested"];

/**
 * A person moves a lead on: contacted, interested, not interested, or closed (a note is required to close). Marking a lead
 * not interested or closing it cancels its future booked viewings in the same transaction (the slot goes back to other
 * visitors and the visitor is emailed once); a viewing that has already started keeps waiting for its outcome.
 */
export async function updateLeadStatus(
  ctx: SpaContext,
  leadId: string,
  status: unknown,
  user: Person,
  note?: string,
): Promise<void> {
  requireSales(user);
  if (!(LEAD_MANUAL_STATUSES as readonly unknown[]).includes(status))
    throw unprocessable("invalid_status", "a lead can be marked contacted, interested, not interested or closed");
  const to = status as LeadStatus;
  const why = note?.trim() ?? "";
  if (to === "closed" && why.length < 3)
    throw unprocessable("note_required", "say why you are closing this lead (3 to 500 characters)");
  if (why.length > 500) throw unprocessable("invalid_note", "keep the note to 500 characters");
  const cancelled: string[] = [];
  await withSpaTx(ctx.database, async (tx) => {
    const [lead] = await tx.db.select().from(spaLeads).where(eq(spaLeads.id, leadId)).for("update");
    if (!lead) throw notFound("lead");
    if (!seesAllLeads(user) && lead.agentUserId !== user.id) throw forbidden("this lead is assigned to someone else");
    if (!MANUAL_FROM.includes(lead.status)) throw conflict("lead_finished", "this lead is already closed");
    if (lead.status === to) return;
    let from = lead.status;
    if (to === "closed" || to === "not_interested") {
      const future = await tx.db
        .select()
        .from(spaViewings)
        .where(
          and(
            eq(spaViewings.leadId, leadId),
            eq(spaViewings.status, "booked"),
            gt(spaViewings.startsAt, ctx.clock.now()),
          ),
        )
        .for("update");
      for (const v of future) {
        await cancelViewingTx(ctx, tx, v, CLOSED_REASON, `user:${user.id}`);
        cancelled.push(v.id);
      }
      if (future.length) {
        const [now] = await tx.db.select({ status: spaLeads.status }).from(spaLeads).where(eq(spaLeads.id, leadId));
        from = now?.status ?? from;
      }
    }
    await tx.db.update(spaLeads).set({ status: to, updatedAt: ctx.clock.now() }).where(eq(spaLeads.id, leadId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "lead", id: leadId },
      type: "LEAD_STATUS",
      fromState: from,
      toState: to,
      actor: `user:${user.id}`,
      payload: why ? { note: why } : {},
    });
  });
  for (const id of cancelled) await dispatchViewingMail(ctx, id, "cancel");
}
