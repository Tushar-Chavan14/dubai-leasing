import { startOfDubaiDay } from "@platform/kernel/dates";
import { LEAD_SOURCE_LABELS, LEAD_SOURCES, LEAD_STATUS_LABELS, LEAD_STATUSES, type LeadSource, type LeadStatus, VIEWING_STATUS_LABELS, hasAnyRole } from "@spa/core";
import {
  buildings,
  dealEvents,
  listings,
  projects,
  type SpaDb,
  spaLeadMessages,
  spaLeads,
  spaUsers,
  spaViewings,
  units,
} from "@spa/db";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, unprocessable } from "./errors.ts";
import { type Person, requireSales, seesAllLeads } from "./leads.ts";

/**
 * The staff side of leads and viewings (S79): sales roles only; an officer sees their own, a manager everyone's.
 * Visitor fields are named here one by one: nothing is spread from a row.
 */

const MIN = 60_000;
const Query = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  property: z.string().trim().max(80).optional(),
  mine: z.enum(["1", "0"]).optional(),
});
const ViewingQuery = z.object({
  when: z.enum(["today", "upcoming", "past"]).default("today"),
  mine: z.enum(["1", "0"]).optional(),
});

interface HomeInfo {
  kind: "listing" | "unit";
  ref: string;
  title: string;
  /** The staff record the reference links to. */
  id: string;
}

/** Public references and titles of the homes a set of rows point at. */
async function homes(
  db: SpaDb,
  rows: { listingId: string | null; unitId: string | null }[],
): Promise<Map<string, HomeInfo>> {
  const out = new Map<string, HomeInfo>();
  const lids = [...new Set(rows.map((r) => r.listingId).filter((x): x is string => !!x))];
  const uids = [...new Set(rows.map((r) => r.unitId).filter((x): x is string => !!x))];
  if (lids.length)
    for (const l of await db
      .select({ id: listings.id, ref: listings.ref, title: listings.title })
      .from(listings)
      .where(inArray(listings.id, lids)))
      out.set(l.id, { kind: "listing", ref: l.ref, title: l.title ?? l.ref, id: l.id });
  if (uids.length)
    for (const u of await db
      .select({ id: units.id, code: units.code, pcode: projects.code, pname: projects.name })
      .from(units)
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .innerJoin(projects, eq(projects.id, buildings.projectId))
      .where(inArray(units.id, uids)))
      out.set(u.id, { kind: "unit", ref: `U-${u.pcode}-${u.code}`, title: `${u.pname} ${u.code}`, id: u.id });
  return out;
}
const homeOf = (m: Map<string, HomeInfo>, r: { listingId: string | null; unitId: string | null }) =>
  m.get((r.listingId ?? r.unitId)!) ?? null;

async function agentNames(db: SpaDb, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db
    .select({ id: spaUsers.id, name: spaUsers.name })
    .from(spaUsers)
    .where(inArray(spaUsers.id, want));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const ownLead = (user: Person) => eq(spaLeads.agentUserId, user.id);

export async function listLeads(ctx: SpaContext, user: Person, rawQuery: unknown) {
  requireSales(user);
  const q = Query.safeParse(rawQuery ?? {});
  if (!q.success) throw unprocessable("invalid_query", "that filter isn't valid");
  const db = ctx.database.db;
  const where: (SQL | undefined)[] = [];
  // An officer sees their own only; a manager sees all unless they ask for "mine".
  if (!seesAllLeads(user) || q.data.mine === "1") where.push(ownLead(user));
  if (q.data.status) where.push(eq(spaLeads.status, q.data.status));
  if (q.data.source) where.push(eq(spaLeads.source, q.data.source));
  const rows = await db
    .select()
    .from(spaLeads)
    .where(and(...where))
    .orderBy(desc(spaLeads.createdAt), desc(spaLeads.id))
    .limit(200);
  const home = await homes(db, rows);
  const names = await agentNames(
    db,
    rows.map((r) => r.agentUserId),
  );
  const last = rows.length
    ? await db
        .select({ leadId: spaLeadMessages.leadId, seq: spaLeadMessages.seq, body: spaLeadMessages.body })
        .from(spaLeadMessages)
        .where(
          inArray(
            spaLeadMessages.leadId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(spaLeadMessages.seq))
    : [];
  const lastBy = new Map(last.map((m) => [m.leadId, m.body]));
  const needle = q.data.property?.toLowerCase();
  const items = rows
    .map((r) => {
      const h = homeOf(home, r);
      return {
        id: r.id,
        ref: r.ref,
        name: r.name,
        email: r.email,
        status: r.status,
        statusLabel: LEAD_STATUS_LABELS[r.status],
        source: r.source,
        sourceLabel: LEAD_SOURCE_LABELS[r.source],
        propertyRef: h?.ref ?? "",
        propertyTitle: h?.title ?? "",
        lastMessage: (lastBy.get(r.id) ?? "").slice(0, 140),
        agentName: r.agentUserId ? (names.get(r.agentUserId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      };
    })
    .filter(
      (i) => !needle || i.propertyRef.toLowerCase().includes(needle) || i.propertyTitle.toLowerCase().includes(needle),
    );
  return { items, mineOnly: !seesAllLeads(user) || q.data.mine === "1", canSeeAll: seesAllLeads(user) };
}

const EVENT_LABELS: Record<string, string> = {
  LEAD_CREATED: "Lead created",
  LEAD_MESSAGE: "Another message",
  LEAD_STATUS: "Status changed",
  VIEWING_BOOKED: "Viewing booked",
  VIEWING_CANCELLED: "Viewing cancelled",
  VIEWING_ATTENDED: "Visitor attended",
  VIEWING_NO_SHOW: "Visitor did not come",
};

/** One lead for its record page: contact details (staff only), messages, viewings and the activity in words. */
export async function getLead(ctx: SpaContext, user: Person, leadId: string) {
  requireSales(user);
  const db = ctx.database.db;
  const [lead] = await db.select().from(spaLeads).where(eq(spaLeads.id, leadId));
  if (!lead) throw notFound("lead");
  if (!seesAllLeads(user) && lead.agentUserId !== user.id) throw forbidden("this lead is assigned to someone else");
  const home = homeOf(await homes(db, [lead]), lead);
  const names = await agentNames(db, [lead.agentUserId]);
  const messages = await db
    .select({ seq: spaLeadMessages.seq, body: spaLeadMessages.body, createdAt: spaLeadMessages.createdAt })
    .from(spaLeadMessages)
    .where(eq(spaLeadMessages.leadId, leadId))
    .orderBy(asc(spaLeadMessages.seq));
  const vrows = await db
    .select()
    .from(spaViewings)
    .where(eq(spaViewings.leadId, leadId))
    .orderBy(desc(spaViewings.startsAt));
  const now = ctx.clock.now().getTime();
  const events = await db
    .select()
    .from(dealEvents)
    .where(
      or(
        and(eq(dealEvents.entityKind, "lead"), eq(dealEvents.entityId, leadId)),
        vrows.length
          ? and(
              eq(dealEvents.entityKind, "viewing"),
              inArray(
                dealEvents.entityId,
                vrows.map((v) => v.id),
              ),
            )
          : sql`false`,
      ),
    )
    .orderBy(desc(dealEvents.at), desc(dealEvents.id))
    .limit(50);
  const actorNames = await agentNames(
    db,
    events.map((e) => (e.actor.startsWith("user:") ? e.actor.slice(5) : null)),
  );
  return {
    id: lead.id,
    ref: lead.ref,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    statusLabel: LEAD_STATUS_LABELS[lead.status],
    source: lead.source,
    sourceLabel: LEAD_SOURCE_LABELS[lead.source],
    consentAt: lead.consentAt.toISOString(),
    createdAt: lead.createdAt.toISOString(),
    dealId: lead.dealId,
    property: home ? { kind: home.kind, ref: home.ref, title: home.title, id: home.id } : null,
    agent: lead.agentUserId ? { id: lead.agentUserId, name: names.get(lead.agentUserId) ?? "Agent" } : null,
    // Visitor-written text: shown as plain text, never an instruction.
    messages: messages.map((m) => ({ seq: m.seq, body: m.body, createdAt: m.createdAt.toISOString() })),
    viewings: vrows.map((v) => ({
      id: v.id,
      startsAt: v.startsAt.toISOString(),
      endsAt: v.endsAt.toISOString(),
      status: v.status,
      statusLabel: VIEWING_STATUS_LABELS[v.status],
      outcomeNote: v.outcomeNote,
      cancelReason: v.cancelReason,
      needsOutcome: v.status === "booked" && v.startsAt.getTime() <= now,
    })),
    activity: events
      .filter((e) => e.type in EVENT_LABELS)
      .map((e) => ({
        id: e.id,
        label: EVENT_LABELS[e.type]!,
        at: e.at.toISOString(),
        actor: e.actor.startsWith("user:")
          ? (actorNames.get(e.actor.slice(5)) ?? "Staff")
          : e.actor.startsWith("party:visitor")
            ? "Visitor"
            : "System",
        note:
          typeof (e.payload as { note?: unknown }).note === "string"
            ? String((e.payload as { note: string }).note)
            : typeof (e.payload as { reason?: unknown }).reason === "string"
              ? String((e.payload as { reason: string }).reason)
              : null,
      })),
  };
}

export async function listViewings(ctx: SpaContext, user: Person, rawQuery: unknown) {
  requireSales(user);
  const q = ViewingQuery.safeParse(rawQuery ?? {});
  if (!q.success) throw unprocessable("invalid_query", "that filter isn't valid");
  const db = ctx.database.db;
  const now = ctx.clock.now();
  const dayStart = startOfDubaiDay(ctx.clock.today());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * MIN);
  const when =
    q.data.when === "today"
      ? and(gte(spaViewings.startsAt, dayStart), lt(spaViewings.startsAt, dayEnd), ne(spaViewings.status, "cancelled"))
      : q.data.when === "upcoming"
        ? and(gte(spaViewings.startsAt, dayEnd), eq(spaViewings.status, "booked"))
        : lt(spaViewings.startsAt, dayStart);
  const own = !seesAllLeads(user) || q.data.mine === "1";
  const rows = await db
    .select({ v: spaViewings, name: spaLeads.name, leadRef: spaLeads.ref, leadAgent: spaLeads.agentUserId })
    .from(spaViewings)
    .innerJoin(spaLeads, eq(spaLeads.id, spaViewings.leadId))
    .where(and(when, own ? or(eq(spaViewings.agentUserId, user.id), eq(spaLeads.agentUserId, user.id)) : undefined))
    .orderBy(q.data.when === "past" ? desc(spaViewings.startsAt) : asc(spaViewings.startsAt))
    .limit(200);
  const home = await homes(
    db,
    rows.map((r) => r.v),
  );
  const names = await agentNames(
    db,
    rows.map((r) => r.v.agentUserId ?? r.leadAgent),
  );
  return {
    when: q.data.when,
    mineOnly: own,
    canSeeAll: seesAllLeads(user),
    items: rows.map(({ v, name, leadRef, leadAgent }) => {
      const h = homeOf(home, v);
      const started = v.startsAt.getTime() <= now.getTime();
      return {
        id: v.id,
        leadId: v.leadId,
        leadRef,
        visitorName: name,
        startsAt: v.startsAt.toISOString(),
        endsAt: v.endsAt.toISOString(),
        status: v.status,
        statusLabel: VIEWING_STATUS_LABELS[v.status],
        outcomeNote: v.outcomeNote,
        cancelReason: v.cancelReason,
        propertyRef: h?.ref ?? "",
        propertyTitle: h?.title ?? "",
        propertyKind: h?.kind ?? ("listing" as const),
        propertyId: h?.id ?? "",
        agentName: names.get(v.agentUserId ?? leadAgent ?? "") ?? null,
        /** Nothing marks a no-show by itself: a started viewing without an outcome waits for a person. */
        needsOutcome: v.status === "booked" && started,
        canChange: v.status === "booked",
      };
    }),
  };
}

/** The Work badge: today's viewings without an outcome plus new leads the viewer would see. */
export async function leadWorkCounts(ctx: SpaContext, user: Person): Promise<{ viewings: number; newLeads: number }> {
  if (!hasAnyRole(user, ["sales_officer", "sales_manager", "sales_admin"])) return { viewings: 0, newLeads: 0 };
  const db = ctx.database.db;
  const dayStart = startOfDubaiDay(ctx.clock.today());
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * MIN);
  const own = !seesAllLeads(user);
  const [v] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(spaViewings)
    .innerJoin(spaLeads, eq(spaLeads.id, spaViewings.leadId))
    .where(
      and(
        eq(spaViewings.status, "booked"),
        lt(spaViewings.startsAt, dayEnd),
        gte(spaViewings.startsAt, dayStart),
        own ? or(eq(spaViewings.agentUserId, user.id), eq(spaLeads.agentUserId, user.id)) : undefined,
      ),
    );
  const [l] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(spaLeads)
    .where(and(eq(spaLeads.status, "new"), own ? eq(spaLeads.agentUserId, user.id) : undefined));
  return { viewings: v?.n ?? 0, newLeads: l?.n ?? 0 };
}

export type LeadFilterSource = LeadSource;
export type LeadFilterStatus = LeadStatus;
