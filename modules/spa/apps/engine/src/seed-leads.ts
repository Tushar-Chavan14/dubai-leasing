import { createHash } from "node:crypto";
import { type Clock, newId } from "@platform/kernel";
import { addDays, startOfDubaiDay } from "@platform/kernel/dates";
import { listings, projects, spaLeads, spaUsers, spaViewings, type SpaDatabase, withSpaTx } from "@spa/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { SpaContext } from "./manager/context.ts";
import { failClosedFacts } from "./manager/facts.ts";
import { appendDealEvent } from "./manager/events.ts";
import { updateLeadStatus } from "./manager/lead-status.ts";
import { recordLead } from "./manager/leads.ts";
import { unitPublicRef } from "./manager/public-catalogue.ts";
import { buildings, units } from "@spa/db";

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * M5 (S79): fictional leads in every status and viewings today, upcoming and past, with and without an outcome, so Work ->
 * Leads and Viewings aren't empty, plus the sales agent of each project. Leads go through `recordLead` (no mail is
 * configured on this context, so nothing is sent); the viewings are written straight in with fixed times and a token that
 * nobody holds, because a past viewing can't be booked through the public slots. Visitor names and emails are invented
 * (`.test` never delivers mail). Demo only; skipped when a lead exists.
 */
export async function seedLeadsAndViewings(database: SpaDatabase, clock: Clock): Promise<void> {
  const db = database.db;
  if ((await db.select({ id: spaLeads.id }).from(spaLeads).limit(1)).length) return;
  const [officer] = await db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer"));
  const [manager] = await db.select().from(spaUsers).where(eq(spaUsers.role, "sales_manager"));
  if (!officer || !manager) return;
  const ctx: SpaContext = { database, clock, facts: failClosedFacts };

  // Project agents: the first project's units go to the officer; the second's wait in the manager's queue.
  const projs = await db.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.code));
  if (projs[0]) await db.update(projects).set({ salesAgentUserId: officer.id }).where(eq(projects.id, projs[0].id));
  const published = await db
    .select({ id: listings.id, ref: listings.ref })
    .from(listings)
    .where(and(eq(listings.state, "PUBLISHED"), isNotNull(listings.permitNo)))
    .orderBy(asc(listings.ref));
  const unitRows = await db
    .select({ id: units.id, code: units.code, pcode: projects.code })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(projects, eq(projects.id, buildings.projectId))
    .where(eq(units.state, "AVAILABLE"))
    .orderBy(asc(projects.code), asc(units.code));
  const homes = [...published.map((l) => l.ref), ...unitRows.map((u) => unitPublicRef(u.pcode, u.code))];
  if (!homes.length) return;
  const home = (i: number) => homes[i % homes.length]!;

  const make = async (
    i: number,
    name: string,
    message: string,
    source: "form" | "listing_chat" | "staff" = "form",
  ): Promise<string> => {
    const r = await recordLead(
      ctx,
      {
        ref: home(i),
        name,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.test`,
        message,
        consent: true,
      },
      "party:visitor:seed",
      { source },
    );
    return r.leadId;
  };

  const today = clock.today();
  const dayStart = (offset: number) => {
    // Viewings run Monday to Saturday: a Sunday moves to the Monday.
    let day = addDays(today, offset);
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) day = addDays(day, 1);
    return startOfDubaiDay(day).getTime();
  };
  const viewing = async (
    leadId: string,
    startsAt: number,
    status: "booked" | "attended" | "no_show" | "cancelled",
    extra: { note?: string; reason?: string } = {},
  ) => {
    const [lead] = await db.select().from(spaLeads).where(eq(spaLeads.id, leadId));
    if (!lead) return;
    const id = newId();
    await withSpaTx(database, async (tx) => {
      await tx.db.insert(spaViewings).values({
        id,
        leadId,
        listingId: lead.listingId,
        unitId: lead.unitId,
        agentUserId: lead.agentUserId,
        startsAt: new Date(startsAt),
        endsAt: new Date(startsAt + 30 * MIN),
        status,
        outcomeNote: extra.note ?? null,
        cancelReason: extra.reason ?? null,
        cancelTokenHash: createHash("sha256").update(`demo-seed:${id}`).digest("hex"),
        createdAt: clock.now(),
      });
      await appendDealEvent(tx, ctx, {
        entity: { kind: "viewing", id },
        type: "VIEWING_BOOKED",
        toState: "booked",
        actor: "demo",
        payload: { leadId, startsAt: new Date(startsAt).toISOString() },
      });
      if (status !== "booked")
        await appendDealEvent(tx, ctx, {
          entity: { kind: "viewing", id },
          type:
            status === "cancelled"
              ? "VIEWING_CANCELLED"
              : status === "attended"
                ? "VIEWING_ATTENDED"
                : "VIEWING_NO_SHOW",
          fromState: "booked",
          toState: status,
          actor: `user:${officer.id}`,
          payload: extra.note ? { note: extra.note } : extra.reason ? { reason: extra.reason } : {},
        });
      if (status === "booked") {
        await tx.db.update(spaLeads).set({ status: "viewing_booked" }).where(eq(spaLeads.id, leadId));
        await appendDealEvent(tx, ctx, {
          entity: { kind: "lead", id: leadId },
          type: "LEAD_STATUS",
          fromState: lead.status,
          toState: "viewing_booked",
          actor: "demo",
        });
      }
    });
  };
  const asManager = { id: manager.id, role: "sales_manager" as const };

  // New and contacted.
  await make(0, "Layla Haddad", "Hello, is this home still available? I'd like to know the service charge.");
  const contacted = await make(1, "Noor Farouk", "Could you send me the floor plan?", "listing_chat");
  await updateLeadStatus(ctx, contacted, "contacted", asManager);
  // Viewing booked: one today in the morning (probably started: needs an outcome), one this evening, one tomorrow, one in three days.
  const v1 = await make(2, "Tariq Mansour", "I'd like to see it this week.");
  await viewing(v1, dayStart(0) + 10 * HOUR, "booked");
  const v2 = await make(3, "Dina Saleh", "Booking a viewing after work.");
  await viewing(v2, dayStart(0) + 17 * HOUR + 30 * MIN, "booked");
  const v3 = await make(4, "Faisal Nasser", "Can I come on Thursday?");
  await viewing(v3, dayStart(1) + 11 * HOUR, "booked");
  const v4 = await make(5, "Mariam Qasem", "Viewing please.");
  await viewing(v4, dayStart(3) + 15 * HOUR, "booked");
  // Past: attended then interested; no-show then not interested; a booked one nobody recorded; one cancelled.
  const i1 = await make(6, "Hamad Rashed", "Interested in a viewing.");
  await viewing(i1, dayStart(-1) + 12 * HOUR, "attended", { note: "Liked the view. Wants to discuss the price." });
  await updateLeadStatus(ctx, i1, "interested", asManager);
  const n1 = await make(7, "Salma Idris", "Viewing, please.");
  await viewing(n1, dayStart(-3) + 14 * HOUR, "no_show", { note: "Did not come and did not answer." });
  await updateLeadStatus(ctx, n1, "not_interested", asManager);
  const p1 = await make(8, "Yara Khalil", "Booking for Saturday.");
  await viewing(p1, dayStart(-2) + 16 * HOUR, "booked");
  const c1 = await make(9, "Bader Jaber", "Is a viewing possible?");
  await viewing(c1, dayStart(-1) + 10 * HOUR, "cancelled", { reason: "Cancelled by the visitor" });
  await updateLeadStatus(ctx, c1, "closed", asManager, "Moved abroad, no longer buying.");
  // A lead typed in by a person.
  await make(10, "Walk-in Visitor", "Came to the sales office and asked about this home.", "staff");
}
