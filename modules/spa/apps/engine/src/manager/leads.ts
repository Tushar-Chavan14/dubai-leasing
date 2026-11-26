import { newId } from "@platform/kernel/ids";
import { LEAD_CLOSED_STATUSES, type LeadInput, LeadInput as LeadInputSchema, type LeadSource, type SpaActor, type SpaRole, StaffLeadInput, hasAnyRole, hasRole } from "@spa/core";
import {
  buildings,
  listings,
  projects,
  spaLeadMessages,
  spaLeads,
  type SpaTx,
  spaUsers,
  units,
  withSpaTx,
} from "@spa/db";
import { leadNewMail } from "@spa/helpers";
import { and, eq, max, notInArray, sql } from "drizzle-orm";
import { dayBucket, takeRateLimit } from "./assistants.ts";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, tooMany, unprocessable, conflict } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { sendSpaMail } from "./mail.ts";
import { currentPolicy } from "./policy.ts";

/**
 * Leads (S79): a visitor's interest in one public home. SpaManager is the only writer of `spa_leads` and
 * `spa_lead_messages`; every write appends a `deal_events` row (entity `lead`). Visitor data is stored only with the
 * consent tick, and no event or log carries an email or phone number.
 */
export type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
export const SALES_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];
/** Sales roles see leads and viewings; a sales officer only their own (design §Work). */
export function requireSales(user: Person): void {
  if (!hasAnyRole(user, SALES_ROLES)) throw forbidden("only the sales roles work with leads and viewings");
}
/** A manager (and a sales admin) sees every lead; an officer only the ones assigned to them. */
export const seesAllLeads = (user: Person): boolean => !hasRole(user, "sales_officer");

/** A home on the public site, resolved from its public reference. */
export interface PublicHome {
  kind: "listing" | "unit";
  id: string;
  ref: string;
  title: string;
  /** The agent who gets its leads: the listing's agent, or the project's sales agent; null = unassigned. */
  agentUserId: string | null;
}

/** The visitor's actor in events: `party:visitor:<leadId>`. */
export const visitorActor = (leadId: string): SpaActor => `party:visitor:${leadId}`;

/**
 * The home a public reference names, only while it is on the public site (the same gate as the catalogue). Null for
 * anything else, so a withdrawn home and a made-up reference look the same.
 */
export async function findPublicHome(ctx: SpaContext, ref: string): Promise<PublicHome | null> {
  // Loaded here, not at the top: the catalogue reads the listing screens, which read `reads.ts`, which reads this file.
  const { getCatalogueItem } = await import("./public-catalogue.ts");
  const item = await getCatalogueItem(ctx, ref);
  if (!item) return null;
  const db = ctx.database.db;
  if (item.source === "listing") {
    const [l] = await db
      .select({ id: listings.id, agent: listings.agentUserId })
      .from(listings)
      .where(eq(listings.ref, ref));
    if (!l) return null;
    return { kind: "listing", id: l.id, ref, title: item.title, agentUserId: await activeAgent(ctx, l.agent) };
  }
  const [u] = await db
    .select({ id: units.id, agent: projects.salesAgentUserId })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(projects, eq(projects.id, buildings.projectId))
    .where(sql`'U-' || ${projects.code} || '-' || ${units.code} = ${ref}`);
  if (!u) return null;
  return { kind: "unit", id: u.id, ref, title: item.title, agentUserId: await activeAgent(ctx, u.agent) };
}

async function activeAgent(ctx: SpaContext, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [a] = await ctx.database.db
    .select({ id: spaUsers.id })
    .from(spaUsers)
    .where(and(eq(spaUsers.id, id), eq(spaUsers.active, true)));
  return a?.id ?? null;
}

export interface VisitorFields {
  name: string;
  email: string;
  phone?: string | undefined;
  message: string;
  source: LeadSource;
  consentAt: Date;
}

/**
 * Finds the open lead for (email, home) or creates it, and appends the message. Runs inside the caller's transaction.
 * A second enquiry about the same home is one more message on the same lead; another home is another lead.
 */
export async function upsertLeadTx(
  ctx: SpaContext,
  tx: SpaTx,
  home: PublicHome,
  v: VisitorFields,
  actorOf: (leadId: string) => SpaActor,
): Promise<{ leadId: string; ref: string; created: boolean; seq: number; agentUserId: string | null }> {
  const where = and(
    eq(spaLeads.email, v.email),
    home.kind === "listing" ? eq(spaLeads.listingId, home.id) : eq(spaLeads.unitId, home.id),
    notInArray(spaLeads.status, [...LEAD_CLOSED_STATUSES]),
  );
  const now = ctx.clock.now();
  const find = () => tx.db.select().from(spaLeads).where(where).for("update");
  let [lead] = await find();
  let created = false;
  if (!lead) {
    const id = newId();
    const inserted = await tx.db
      .insert(spaLeads)
      .values({
        id,
        propertyKind: home.kind,
        listingId: home.kind === "listing" ? home.id : null,
        unitId: home.kind === "unit" ? home.id : null,
        name: v.name,
        email: v.email,
        phone: v.phone ?? null,
        source: v.source,
        status: "new",
        agentUserId: home.agentUserId,
        consentAt: v.consentAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      lead = inserted[0];
      created = true;
      await appendDealEvent(tx, ctx, {
        entity: { kind: "lead", id },
        type: "LEAD_CREATED",
        toState: "new",
        actor: actorOf(id),
        payload: { propertyKind: home.kind, propertyRef: home.ref, source: v.source, assigned: !!home.agentUserId },
      });
    } else [lead] = await find();
  }
  if (!lead) throw conflict("lead_unavailable", "try again in a moment");
  const [m] = await tx.db
    .select({ n: max(spaLeadMessages.seq) })
    .from(spaLeadMessages)
    .where(eq(spaLeadMessages.leadId, lead.id));
  const seq = (m?.n ?? 0) + 1;
  await tx.db.insert(spaLeadMessages).values({ leadId: lead.id, seq, body: v.message, createdAt: now });
  const set: Partial<typeof spaLeads.$inferInsert> = { updatedAt: now };
  if (!created && !lead.agentUserId && home.agentUserId) set.agentUserId = home.agentUserId;
  if (!created && !lead.phone && v.phone) set.phone = v.phone;
  await tx.db.update(spaLeads).set(set).where(eq(spaLeads.id, lead.id));
  if (!created)
    await appendDealEvent(tx, ctx, {
      entity: { kind: "lead", id: lead.id },
      type: "LEAD_MESSAGE",
      actor: actorOf(lead.id),
      payload: { seq, source: v.source },
    });
  return { leadId: lead.id, ref: lead.ref, created, seq, agentUserId: set.agentUserId ?? lead.agentUserId };
}

/** The page of the staff app a lead's mail links to. */
export const leadUrl = (ctx: SpaContext, leadId: string): string => `${ctx.mail?.webBaseUrl ?? ""}/leads/${leadId}`;

/** Emails the lead's agent about one new message. Best effort: a down mail server never undoes the lead. */
export async function mailAgentNewLead(ctx: SpaContext, leadId: string, seq: number): Promise<void> {
  if (!ctx.mail) return;
  try {
    const db = ctx.database.db;
    const [row] = await db
      .select({ lead: spaLeads, agentEmail: spaUsers.email })
      .from(spaLeads)
      .innerJoin(spaUsers, eq(spaUsers.id, spaLeads.agentUserId))
      .where(and(eq(spaLeads.id, leadId), eq(spaUsers.active, true)));
    if (!row) return;
    const [msg] = await db
      .select()
      .from(spaLeadMessages)
      .where(and(eq(spaLeadMessages.leadId, leadId), eq(spaLeadMessages.seq, seq)));
    const home = await homeTitle(ctx, row.lead);
    await sendSpaMail(ctx, {
      entityKind: "lead",
      entityId: leadId,
      purpose: "notice",
      milestone: `lead:${seq}`,
      to: row.agentEmail,
      parts: leadNewMail({
        leadRef: row.lead.ref,
        property: home,
        name: row.lead.name,
        email: row.lead.email,
        phone: row.lead.phone,
        message: msg?.body ?? "",
        url: leadUrl(ctx, leadId),
      }),
    });
  } catch (e) {
    console.warn(`lead mail not sent: ${e instanceof Error ? e.message : "failed"}`);
  }
}

export async function homeTitle(
  ctx: SpaContext,
  lead: Pick<typeof spaLeads.$inferSelect, "listingId" | "unitId">,
): Promise<string> {
  const db = ctx.database.db;
  if (lead.listingId) {
    const [l] = await db
      .select({ title: listings.title, ref: listings.ref })
      .from(listings)
      .where(eq(listings.id, lead.listingId));
    return l?.title || l?.ref || "a home";
  }
  if (lead.unitId) {
    const [u] = await db
      .select({ code: units.code, project: projects.name })
      .from(units)
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .innerJoin(projects, eq(projects.id, buildings.projectId))
      .where(eq(units.id, lead.unitId));
    return u ? `${u.project} ${u.code}` : "a home";
  }
  return "a home";
}

/** Per-email daily cap, all homes together (policy `leads.perEmailPerDay`). Staff entry is not capped. */
export async function takeEmailAllowance(ctx: SpaContext, email: string): Promise<void> {
  const cap = (await currentPolicy(ctx.database.db)).values.leads.perEmailPerDay;
  if (!(await takeRateLimit(ctx, { key: email, bucket: `lead-email:${dayBucket(ctx)}`, limit: cap })))
    throw tooMany("too many enquiries from this email today, try again tomorrow");
}

/**
 * Records an enquiry as a lead (or a message on the visitor's open lead for that home) and emails the agent. The visitor
 * ticked consent (the input type says so). `source` defaults to the public form.
 */
export async function recordLead(
  ctx: SpaContext,
  input: unknown,
  actor: SpaActor,
  opts: { source?: LeadSource } = {},
): Promise<{ leadId: string; ref: string; created: boolean }> {
  const parsed = LeadInputSchema.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_lead",
      "check the details and tick the consent box",
      parsed.error.issues.map((i) => i.path.join(".")),
    );
  const i: LeadInput = parsed.data;
  const home = await findPublicHome(ctx, i.ref);
  if (!home) throw notFound("home");
  const source = opts.source ?? "form";
  await takeEmailAllowance(ctx, i.email);
  const out = await withSpaTx(ctx.database, (tx) =>
    upsertLeadTx(
      ctx,
      tx,
      home,
      { name: i.name, email: i.email, phone: i.phone, message: i.message, source, consentAt: ctx.clock.now() },
      (leadId) => (actor.startsWith("party:visitor") ? visitorActor(leadId) : actor),
    ),
  );
  await mailAgentNewLead(ctx, out.leadId, out.seq);
  return { leadId: out.leadId, ref: out.ref, created: out.created };
}

/** A person types in a lead for someone who contacted them another way (source `staff`). */
export async function recordStaffLead(
  ctx: SpaContext,
  input: unknown,
  user: Person,
): Promise<{ leadId: string; ref: string; created: boolean }> {
  requireSales(user);
  const parsed = StaffLeadInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_lead",
      "check the details",
      parsed.error.issues.map((i) => i.path.join(".")),
    );
  const i = parsed.data;
  const home = await findPublicHome(ctx, i.ref);
  if (!home) throw notFound("home");
  const out = await withSpaTx(ctx.database, (tx) =>
    upsertLeadTx(
      ctx,
      tx,
      // A lead a person types in is theirs unless the home has an agent.
      { ...home, agentUserId: home.agentUserId ?? (hasRole(user, "sales_officer") ? user.id : null) },
      { name: i.name, email: i.email, phone: i.phone, message: i.message, source: "staff", consentAt: ctx.clock.now() },
      () => `user:${user.id}`,
    ),
  );
  return { leadId: out.leadId, ref: out.ref, created: out.created };
}
