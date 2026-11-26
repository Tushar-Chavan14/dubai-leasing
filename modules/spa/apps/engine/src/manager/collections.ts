import { type CalendarDate, addDays } from "@platform/kernel/dates";
import { formatCalendarDate } from "@platform/readers/structure/format";
import { collectionReminders, dealParties, deals, outboundMessages, parties, spaTasks, withSpaTx } from "@spa/db";
import type { ReminderMilestone } from "@spa/db";
import { instalmentReminderMail } from "@spa/helpers";
import { and, asc, eq, inArray } from "drizzle-orm";
import { newId } from "@platform/kernel/ids";
import type { SpaContext } from "./context.ts";
import { unavailable } from "./errors.ts";
import { sendWithViewLink } from "./portal.ts";
import { planCoverage } from "./payment-facts.ts";
import { policyAt } from "./policy.ts";
import { propertyLabel } from "./signing.ts";
import { openTask } from "./tasks.ts";

type DealRow = typeof deals.$inferSelect;

interface Milestone {
  label: ReminderMilestone;
  date: CalendarDate;
}

/**
 * The daily instalment reminders (`spa.instalment.remind`, S56, C21). For each deal in `INSTALMENTS`, every dated plan
 * row that counted payments don't cover gets an email to each buyer at the policy's days before the due date (default 14
 * and 3) and the day after (default 1): fixed wording, the amount from the plan in integer fils and the dates from the
 * Clock; no model, a read-only status link (C35, S67), nothing about checks. Each (row, milestone) is recorded once in `collection_reminders`. A job
 * that was down sends the latest milestone that has come due, not all of them. A milestone row (no date) and a paid row
 * get nothing: the milestone task is C22's. At the first day after the due date an unpaid row also opens one task for
 * the sales officer. Collections can't be switched off (S22). Safe to run twice.
 */
export async function remindInstalments(ctx: SpaContext): Promise<{ sent: number; tasks: number }> {
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so no reminder can be sent");
  const open = await ctx.database.db.select().from(deals).where(eq(deals.state, "INSTALMENTS"));
  const total = { sent: 0, tasks: 0 };
  for (const d of open) {
    try {
      const r = await remindDeal(ctx, d);
      total.sent += r.sent;
      total.tasks += r.tasks;
    } catch (e) {
      console.error(`instalment reminders: deal ${d.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return total;
}

async function remindDeal(ctx: SpaContext, d: DealRow): Promise<{ sent: number; tasks: number }> {
  const db = ctx.database.db;
  const today = ctx.clock.today();
  const policy = (await policyAt(db, d.policyVersion)).instalmentReminders;
  const due = (await planCoverage(db, d.id)).filter((r) => r.dueOn !== null && r.paidFils < r.amountFils);
  if (!due.length) return { sent: 0, tasks: 0 };
  const buyers = await db
    .select({ partyId: parties.id, name: parties.fullNameEn, email: parties.email })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(dealParties.dealId, d.id), eq(dealParties.role, "buyer")))
    .orderBy(asc(dealParties.order));
  const already = new Set(
    (await db.select().from(collectionReminders).where(eq(collectionReminders.dealId, d.id))).map(
      (r) => `${r.planSeq}:${r.milestone}`,
    ),
  );
  const property = await propertyLabel({ db }, d);
  const out = { sent: 0, tasks: 0 };
  for (const row of due) {
    const dueOn = row.dueOn as CalendarDate;
    const outstanding = row.amountFils - row.paidFils;

    // The first day after the due date: a task, once (a finished task is not opened again).
    const firstAfter = policy.afterDays[0];
    if (firstAfter !== undefined && today >= addDays(dueOn, firstAfter)) {
      const key = `${d.id}:${row.seq}:instalment_overdue`;
      const [seen] = await db.select({ id: spaTasks.id }).from(spaTasks).where(eq(spaTasks.dedupeKey, key)).limit(1);
      if (!seen) {
        const t = await withSpaTx(ctx.database, (tx) =>
          openTask(ctx, tx, {
            dealId: d.id,
            kind: "instalment_overdue",
            role: "sales_officer",
            title: `Instalment ${row.seq} (due ${formatCalendarDate(dueOn) ?? dueOn}) is overdue: contact the buyer.`,
            detail: { seq: row.seq, dueOn, outstandingFils: outstanding },
            dedupeKey: key,
          }),
        );
        if (t.created) out.tasks++;
      }
    }

    const milestones: Milestone[] = [
      ...policy.beforeDays.map((n): Milestone => ({ label: `T-${n}`, date: addDays(dueOn, -n) })),
      ...policy.afterDays.map((n): Milestone => ({ label: `T+${n}`, date: addDays(dueOn, n) })),
    ].toSorted((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const latest = milestones.filter((m) => m.date <= today).at(-1);
    if (!latest || already.has(`${row.seq}:${latest.label}`)) continue;

    const ids: string[] = [];
    for (const b of buyers) {
      const r = await sendWithViewLink(ctx, {
        dealId: d.id,
        partyId: b.partyId,
        purpose: "reminder",
        milestone: `instalment:${row.seq}:${latest.label}:${b.partyId}`,
        to: b.email,
        by: "system:collections",
        parts: (link) =>
          instalmentReminderMail({
            name: b.name,
            property,
            label: row.label,
            amountFils: outstanding,
            dueOn,
            phase: today > dueOn ? "after" : "before",
            link,
          }),
      });
      if (r.outboundId) ids.push(r.outboundId);
    }
    if (!ids.length) continue;
    // Recorded only when every buyer's mail is sent (a failed one is tried again on the next run).
    const stored = await db
      .select({ status: outboundMessages.status })
      .from(outboundMessages)
      .where(inArray(outboundMessages.id, ids));
    if (stored.length !== ids.length || stored.some((s) => s.status !== "sent")) continue;
    const inserted = await db
      .insert(collectionReminders)
      .values({
        id: newId(),
        dealId: d.id,
        planSeq: row.seq,
        milestone: latest.label,
        outboundMessageId: ids[0]!,
        sentAt: ctx.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: collectionReminders.id });
    if (inserted.length) out.sent++;
  }
  return out;
}
