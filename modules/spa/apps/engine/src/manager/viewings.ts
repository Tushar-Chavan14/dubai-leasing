import { createHash, createHmac } from "node:crypto";
import { newId } from "@platform/kernel/ids";
import { freeViewingSlots, type SlotPolicy } from "@platform/kernel/viewing-slots";
import { type SpaActor, ViewingBookInput, ViewingOutcome } from "@spa/core";
import {
  listings,
  type SpaDb,
  spaLeadMessages,
  spaLeads,
  type SpaTx,
  spaUsers,
  spaViewings,
  units,
  withSpaTx,
  outboundMessages,
} from "@spa/db";
import { viewingCancelledMail, viewingConfirmationMail, viewingNewMail, viewingReminderMail } from "@spa/helpers";
import { and, desc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { SpaContext, ViewingMailMilestone } from "./context.ts";
import { conflict, forbidden, isUniqueClash, notFound, unavailable, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import {
  findPublicHome,
  homeTitle,
  leadUrl,
  type Person,
  type PublicHome,
  requireSales,
  seesAllLeads,
  takeEmailAllowance,
  upsertLeadTx,
  visitorActor,
} from "./leads.ts";
import { sendSpaMail } from "./mail.ts";
import { currentPolicy } from "./policy.ts";

/**
 * Viewings (S79). A viewing is an instant, not a legal date: slots come from the pure `freeViewingSlots` over the
 * `viewings` policy, in Asia/Dubai time, from the Clock. One viewing per agent per slot: the agent's row is locked, the
 * slot is checked again under the lock, and a partial unique index is the last guard. SpaManager is the only writer.
 */

const MIN = 60_000;
export const RESCHEDULED_REASON = "Rescheduled";
export const UNAVAILABLE_REASON = "The home is no longer available";
export const VISITOR_CANCEL_REASON = "Cancelled by the visitor";
/** The message a booking carries when the visitor wrote none. */
export const DEFAULT_BOOKING_MESSAGE = "Booked a viewing.";
export const CLOSED_REASON = "The enquiry was closed";
/** The reminder goes this long before the viewing. */
export const REMINDER_HOURS = 24;

const slotPolicy = async (db: SpaDb): Promise<SlotPolicy> => (await currentPolicy(db)).values.viewings;

// ---------------------------------------------------------------------------------------------
// The visitor's cancel link: HMAC of the viewing id; only the token's hash is stored.

const hashToken = (t: string): string => createHash("sha256").update(t).digest("hex");
function tokenFor(ctx: SpaContext, viewingId: string): string {
  if (!ctx.viewingLinkSecret) throw unavailable("viewing_links_unavailable", "viewings can't be booked right now");
  return createHmac("sha256", ctx.viewingLinkSecret).update(`viewing-cancel:${viewingId}`).digest("base64url");
}
const cancelUrl = (ctx: SpaContext, viewingId: string): string =>
  `${ctx.mail?.webBaseUrl ?? ""}/v/${tokenFor(ctx, viewingId)}/cancel`;

// ---------------------------------------------------------------------------------------------
// Slots

type Schedule = Pick<PublicHome, "kind" | "id" | "agentUserId">;

/** Booked viewings that take a slot: the agent's (any home), or for a home with no agent, that home's own. */
async function takenInstants(db: SpaDb, home: Schedule, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - 24 * 60 * MIN);
  const scope = home.agentUserId
    ? eq(spaViewings.agentUserId, home.agentUserId)
    : and(
        isNull(spaViewings.agentUserId),
        home.kind === "listing" ? eq(spaViewings.listingId, home.id) : eq(spaViewings.unitId, home.id),
      );
  const rows = await db
    .select({ at: spaViewings.startsAt })
    .from(spaViewings)
    .where(and(eq(spaViewings.status, "booked"), gt(spaViewings.startsAt, since), scope));
  return rows.map((r) => r.at);
}

/** The free slots of a public home, as ISO instants (soonest first). */
export async function freeSlotsFor(
  ctx: SpaContext,
  property: { kind: "listing" | "unit"; ref: string },
  max = 8,
): Promise<string[]> {
  const home = await findPublicHome(ctx, property.ref);
  if (!home || home.kind !== property.kind) return [];
  const db = ctx.database.db;
  const taken = await takenInstants(db, home, ctx.clock.now());
  return freeViewingSlots(ctx.clock.now(), await slotPolicy(db), taken, max).map((d) => d.toISOString());
}

/** Locks what guards the slots: the agent's row, or the home's own row when it has no agent. */
async function lockSchedule(tx: SpaTx, home: Schedule): Promise<void> {
  if (home.agentUserId)
    await tx.db.select({ id: spaUsers.id }).from(spaUsers).where(eq(spaUsers.id, home.agentUserId)).for("update");
  else if (home.kind === "listing")
    await tx.db.select({ id: listings.id }).from(listings).where(eq(listings.id, home.id)).for("update");
  else await tx.db.select({ id: units.id }).from(units).where(eq(units.id, home.id)).for("update");
}

/** Checks a slot under the lock: not on the grid or in the past is 422, on the grid but taken is 409. */
async function checkSlot(
  ctx: SpaContext,
  tx: SpaTx,
  home: Schedule,
  slot: Date,
  ignoreViewingId?: string,
): Promise<SlotPolicy> {
  const now = ctx.clock.now();
  const policy = await slotPolicy(tx.db);
  const grid = freeViewingSlots(now, policy, [], Number.POSITIVE_INFINITY);
  if (!grid.some((g) => g.getTime() === slot.getTime()))
    throw unprocessable("slot_unavailable", "that time isn't offered, pick one of the listed times");
  let taken = await takenInstants(tx.db, home, now);
  if (ignoreViewingId) {
    const [own] = await tx.db
      .select({ at: spaViewings.startsAt })
      .from(spaViewings)
      .where(eq(spaViewings.id, ignoreViewingId));
    if (own)
      taken = taken.filter(
        (t) => t.getTime() !== own.at.getTime() || taken.filter((x) => x.getTime() === own.at.getTime()).length > 1,
      );
  }
  if (
    taken.some(
      (t) =>
        t.getTime() > slot.getTime() - policy.viewingSlotMinutes * MIN &&
        t.getTime() < slot.getTime() + policy.viewingSlotMinutes * MIN,
    )
  )
    throw conflict("slot_taken", "that time was just taken, pick another");
  return policy;
}

export const dispatchViewingMail = async (ctx: SpaContext, viewingId: string, milestone: ViewingMailMilestone) => {
  try {
    if (ctx.queueViewingMail) return await ctx.queueViewingMail({ viewingId, milestone });
  } catch (e) {
    console.warn(`viewing mail job not queued (${milestone}): ${e instanceof Error ? e.message : "failed"}`);
  }
  // No queue (or it failed): send now, best effort.
  await sendViewingMail(ctx, viewingId, milestone).catch((e) =>
    console.warn(`viewing mail not sent (${milestone}): ${e instanceof Error ? e.message : "failed"}`),
  );
};

// ---------------------------------------------------------------------------------------------
// Booking

async function insertViewing(
  ctx: SpaContext,
  tx: SpaTx,
  home: PublicHome,
  leadId: string,
  slot: Date,
  policy: SlotPolicy,
  actor: SpaActor,
): Promise<string> {
  const id = newId();
  await tx.db.insert(spaViewings).values({
    id,
    leadId,
    listingId: home.kind === "listing" ? home.id : null,
    unitId: home.kind === "unit" ? home.id : null,
    agentUserId: home.agentUserId,
    startsAt: slot,
    endsAt: new Date(slot.getTime() + policy.viewingSlotMinutes * MIN),
    status: "booked",
    cancelTokenHash: hashToken(tokenFor(ctx, id)),
    createdAt: ctx.clock.now(),
  });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "viewing", id },
    type: "VIEWING_BOOKED",
    toState: "booked",
    actor,
    payload: { leadId, startsAt: slot.toISOString(), agentUserId: home.agentUserId },
  });
  return id;
}

async function markViewingBooked(ctx: SpaContext, tx: SpaTx, leadId: string, actor: SpaActor) {
  const [lead] = await tx.db.select({ status: spaLeads.status }).from(spaLeads).where(eq(spaLeads.id, leadId));
  if (!lead || lead.status === "viewing_booked" || lead.status === "converted" || lead.status === "closed") return;
  await tx.db
    .update(spaLeads)
    .set({ status: "viewing_booked", updatedAt: ctx.clock.now() })
    .where(eq(spaLeads.id, leadId));
  await appendDealEvent(tx, ctx, {
    entity: { kind: "lead", id: leadId },
    type: "LEAD_STATUS",
    fromState: lead.status,
    toState: "viewing_booked",
    actor,
  });
}

/**
 * Books a slot for a visitor: creates (or reuses) the lead, marks it `viewing_booked`, stores the viewing, and queues the
 * confirmation and the reminder. Two visitors at the same slot: one booking, the other a 409 `slot_taken`.
 */
export async function bookViewing(
  ctx: SpaContext,
  input: unknown,
  actor: SpaActor,
  opts: { source?: "form" | "listing_chat" } = {},
): Promise<{ viewingId: string; leadId: string; startsAt: string }> {
  const parsed = ViewingBookInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_booking",
      "check the details and tick the consent box",
      parsed.error.issues.map((i) => i.path.join(".")),
    );
  const i = parsed.data;
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so a viewing can't be confirmed");
  tokenFor(ctx, "probe");
  const home = await findPublicHome(ctx, i.ref);
  if (!home) throw notFound("home");
  const slot = new Date(i.slot);
  await takeEmailAllowance(ctx, i.email);
  let r;
  try {
    r = await withSpaTx(ctx.database, async (tx) => {
      await lockSchedule(tx, home);
      const policy = await checkSlot(ctx, tx, home, slot);
      const lead = await upsertLeadTx(
        ctx,
        tx,
        home,
        {
          name: i.name,
          email: i.email,
          phone: i.phone,
          message: i.message ?? DEFAULT_BOOKING_MESSAGE,
          source: opts.source ?? "form",
          consentAt: ctx.clock.now(),
        },
        (leadId) => (actor.startsWith("party:visitor") ? visitorActor(leadId) : actor),
      );
      const who = actor.startsWith("party:visitor") ? visitorActor(lead.leadId) : actor;
      const viewingId = await insertViewing(ctx, tx, home, lead.leadId, slot, policy, who);
      await markViewingBooked(ctx, tx, lead.leadId, who);
      return { viewingId, lead };
    });
  } catch (e) {
    if (isUniqueClash(e)) throw conflict("slot_taken", "that time was just taken, pick another");
    throw e;
  }
  await afterBooked(ctx, r.viewingId, slot);
  // The agent's "New viewing" email (sent with the confirmation) is the one agent email for a booking.
  return { viewingId: r.viewingId, leadId: r.lead.leadId, startsAt: slot.toISOString() };
}

async function afterBooked(ctx: SpaContext, viewingId: string, slot: Date) {
  await dispatchViewingMail(ctx, viewingId, "invite");
  // Booked inside the reminder window: the confirmation is the reminder. The delay is the queue's own (seconds from now).
  const waitMs = slot.getTime() - REMINDER_HOURS * 60 * MIN - ctx.clock.now().getTime();
  if (waitMs > 0 && ctx.queueViewingMail)
    await ctx
      .queueViewingMail({ viewingId, milestone: "reminder", delaySeconds: Math.ceil(waitMs / 1000) })
      .catch((e) => console.warn(`viewing reminder not queued: ${e instanceof Error ? e.message : "failed"}`));
}

// ---------------------------------------------------------------------------------------------
// Cancelling

type ViewingRow = typeof spaViewings.$inferSelect;

export async function cancelViewingTx(
  ctx: SpaContext,
  tx: SpaTx,
  v: ViewingRow,
  reason: string,
  actor: SpaActor,
  leadBack: "new" | "contacted" = "contacted",
) {
  await tx.db.update(spaViewings).set({ status: "cancelled", cancelReason: reason }).where(eq(spaViewings.id, v.id));
  await appendDealEvent(tx, ctx, {
    entity: { kind: "viewing", id: v.id },
    type: "VIEWING_CANCELLED",
    fromState: "booked",
    toState: "cancelled",
    actor,
    payload: { reason },
  });
  // The lead goes back a step only when it has no other booked viewing.
  const [other] = await tx.db
    .select({ id: spaViewings.id })
    .from(spaViewings)
    .where(and(eq(spaViewings.leadId, v.leadId), eq(spaViewings.status, "booked"), ne(spaViewings.id, v.id)));
  const [lead] = await tx.db.select({ status: spaLeads.status }).from(spaLeads).where(eq(spaLeads.id, v.leadId));
  if (!other && lead?.status === "viewing_booked" && reason !== RESCHEDULED_REASON) {
    await tx.db.update(spaLeads).set({ status: leadBack, updatedAt: ctx.clock.now() }).where(eq(spaLeads.id, v.leadId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "lead", id: v.leadId },
      type: "LEAD_STATUS",
      fromState: "viewing_booked",
      toState: leadBack,
      actor,
      payload: { because: "viewing cancelled" },
    });
  }
}

/** Staff or code cancels a booked viewing. The visitor is emailed once. */
export async function cancelViewing(
  ctx: SpaContext,
  viewingId: string,
  reason: string,
  actor: SpaActor,
  user?: Person,
): Promise<void> {
  const why = reason.trim();
  if (why.length < 3 || why.length > 500) throw unprocessable("reason_required", "say why (3 to 500 characters)");
  await withSpaTx(ctx.database, async (tx) => {
    const [v] = await tx.db.select().from(spaViewings).where(eq(spaViewings.id, viewingId)).for("update");
    if (!v) throw notFound("viewing");
    if (user) await mayTouch(tx, user, v);
    if (v.status !== "booked") throw conflict("not_booked", "this viewing is not booked");
    await cancelViewingTx(ctx, tx, v, why, actor, "contacted");
  });
  await dispatchViewingMail(ctx, viewingId, "cancel");
}

/** A staff member cancels from the app: the reason is their own words. */
export const cancelViewingAs = (ctx: SpaContext, viewingId: string, reason: string, user: Person) =>
  cancelViewing(ctx, viewingId, reason, `user:${user.id}`, user);

/** An officer works only with their own viewings; a manager with any. */
async function mayTouch(tx: SpaTx, user: Person, v: ViewingRow): Promise<void> {
  requireSales(user);
  if (seesAllLeads(user)) return;
  const [lead] = await tx.db.select({ agent: spaLeads.agentUserId }).from(spaLeads).where(eq(spaLeads.id, v.leadId));
  if (v.agentUserId !== user.id && lead?.agent !== user.id) throw forbidden("this viewing belongs to someone else");
}

/**
 * The visitor's cancel link. A second click, or an old link, never emails twice: `already_cancelled`. A viewing that is
 * over (or a token that matches nothing) is `not_found`.
 */
export async function cancelViewingByToken(
  ctx: SpaContext,
  token: string,
): Promise<{ status: "cancelled" | "already_cancelled" | "not_found" }> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { status: "not_found" };
  const hash = hashToken(token);
  const res = await withSpaTx(ctx.database, async (tx) => {
    const [v] = await tx.db.select().from(spaViewings).where(eq(spaViewings.cancelTokenHash, hash)).for("update");
    if (!v) return { status: "not_found" as const, id: null };
    if (v.status === "cancelled") return { status: "already_cancelled" as const, id: null };
    if (v.status !== "booked" || v.startsAt.getTime() <= ctx.clock.now().getTime())
      return { status: "not_found" as const, id: null };
    await cancelViewingTx(ctx, tx, v, VISITOR_CANCEL_REASON, visitorActor(v.leadId), "new");
    return { status: "cancelled" as const, id: v.id };
  });
  if (res.id) await dispatchViewingMail(ctx, res.id, "cancel");
  return { status: res.status };
}

/**
 * The home left the public site (a listing out of PUBLISHED/UNDER_OFFER, a unit out of AVAILABLE): every future booked
 * viewing is cancelled by code in the caller's transaction. The visitor's email is queued with a short delay, because
 * the job may start before the transaction commits; `sendViewingMail('cancel')` sends it once.
 */
export async function cancelFutureViewingsFor(
  ctx: SpaContext,
  tx: SpaTx,
  property: { kind: "listing" | "unit"; id: string },
): Promise<number> {
  const rows = await tx.db
    .select()
    .from(spaViewings)
    .where(
      and(
        eq(spaViewings.status, "booked"),
        gt(spaViewings.startsAt, ctx.clock.now()),
        property.kind === "listing" ? eq(spaViewings.listingId, property.id) : eq(spaViewings.unitId, property.id),
      ),
    )
    .for("update");
  for (const v of rows) {
    await cancelViewingTx(ctx, tx, v, UNAVAILABLE_REASON, "system:property-unavailable", "new");
    // A short delay for the queue (not a date): the transaction commits within moments.
    await ctx.queueViewingMail?.({ viewingId: v.id, milestone: "cancel", delaySeconds: 10 }).catch(() => {});
  }
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// Outcome and reschedule (staff)

/** Records what happened: only once the viewing has started. Nothing marks a no-show by itself. */
export async function recordViewingOutcome(
  ctx: SpaContext,
  viewingId: string,
  outcome: unknown,
  note: string | undefined,
  user: Person,
): Promise<void> {
  const parsed = ViewingOutcome.safeParse({ outcome, ...(note ? { note } : {}) });
  if (!parsed.success)
    throw unprocessable("invalid_outcome", "record attended or no-show, with a note of up to 1,000 characters");
  await withSpaTx(ctx.database, async (tx) => {
    const [v] = await tx.db.select().from(spaViewings).where(eq(spaViewings.id, viewingId)).for("update");
    if (!v) throw notFound("viewing");
    await mayTouch(tx, user, v);
    if (v.status !== "booked") throw conflict("not_booked", "this viewing already has an outcome or is cancelled");
    if (v.startsAt.getTime() > ctx.clock.now().getTime())
      throw conflict("viewing_not_started", "the viewing hasn't happened yet");
    await tx.db
      .update(spaViewings)
      .set({ status: parsed.data.outcome, outcomeNote: parsed.data.note ?? null })
      .where(eq(spaViewings.id, viewingId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "viewing", id: viewingId },
      type: parsed.data.outcome === "attended" ? "VIEWING_ATTENDED" : "VIEWING_NO_SHOW",
      fromState: "booked",
      toState: parsed.data.outcome,
      actor: `user:${user.id}`,
      payload: parsed.data.note ? { note: parsed.data.note } : {},
    });
  });
}

/** Moves a booked viewing to another free slot for the same lead: the old one is cancelled and a new one booked in one transaction. */
export async function rescheduleViewing(
  ctx: SpaContext,
  viewingId: string,
  slotIso: string,
  user: Person,
): Promise<{ viewingId: string }> {
  const slot = new Date(slotIso);
  if (Number.isNaN(slot.getTime())) throw unprocessable("invalid_slot", "pick one of the listed times");
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so a viewing can't be confirmed");
  let newId_: string;
  try {
    newId_ = await withSpaTx(ctx.database, async (tx) => {
      const [v] = await tx.db.select().from(spaViewings).where(eq(spaViewings.id, viewingId)).for("update");
      if (!v) throw notFound("viewing");
      await mayTouch(tx, user, v);
      if (v.status !== "booked") throw conflict("not_booked", "only a booked viewing can be moved");
      const home = await homeOfViewing(tx, v);
      await lockSchedule(tx, home);
      const policy = await checkSlot(ctx, tx, home, slot);
      await cancelViewingTx(ctx, tx, v, RESCHEDULED_REASON, `user:${user.id}`, "contacted");
      const id = await insertViewing(ctx, tx, home, v.leadId, slot, policy, `user:${user.id}`);
      await markViewingBooked(ctx, tx, v.leadId, `user:${user.id}`);
      return id;
    });
  } catch (e) {
    if (isUniqueClash(e)) throw conflict("slot_taken", "that time was just taken, pick another");
    throw e;
  }
  await afterBooked(ctx, newId_, slot);
  return { viewingId: newId_ };
}

/** A staff member books a slot for an existing lead (the lead's visitor is emailed the confirmation). */
export async function bookViewingForLead(
  ctx: SpaContext,
  leadId: string,
  slotIso: string,
  user: Person,
): Promise<{ viewingId: string }> {
  requireSales(user);
  const slot = new Date(slotIso);
  if (Number.isNaN(slot.getTime())) throw unprocessable("invalid_slot", "pick one of the listed times");
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so a viewing can't be confirmed");
  tokenFor(ctx, "probe");
  let id: string;
  try {
    id = await withSpaTx(ctx.database, async (tx) => {
      const [lead] = await tx.db.select().from(spaLeads).where(eq(spaLeads.id, leadId)).for("update");
      if (!lead) throw notFound("lead");
      if (!seesAllLeads(user) && lead.agentUserId !== user.id) throw forbidden("this lead is assigned to someone else");
      if (lead.status === "converted" || lead.status === "closed")
        throw conflict("lead_finished", "this lead is already closed");
      const home = await homeOfLead(tx, lead);
      await lockSchedule(tx, home);
      const policy = await checkSlot(ctx, tx, home, slot);
      const viewingId = await insertViewing(ctx, tx, home, leadId, slot, policy, `user:${user.id}`);
      await markViewingBooked(ctx, tx, leadId, `user:${user.id}`);
      return viewingId;
    });
  } catch (e) {
    if (isUniqueClash(e)) throw conflict("slot_taken", "that time was just taken, pick another");
    throw e;
  }
  await afterBooked(ctx, id, slot);
  return { viewingId: id };
}

async function homeOfViewing(tx: SpaTx, v: ViewingRow): Promise<PublicHome> {
  return {
    kind: v.listingId ? "listing" : "unit",
    id: (v.listingId ?? v.unitId)!,
    ref: "",
    title: "",
    agentUserId: v.agentUserId,
  };
}
async function homeOfLead(tx: SpaTx, lead: typeof spaLeads.$inferSelect): Promise<PublicHome> {
  return {
    kind: lead.propertyKind,
    id: (lead.listingId ?? lead.unitId)!,
    ref: "",
    title: "",
    agentUserId: lead.agentUserId,
  };
}

/** Free slots for one lead's home (staff pickers). A home that left the site has none. */
export async function freeSlotsForLead(ctx: SpaContext, leadId: string, user: Person, max = 12): Promise<string[]> {
  requireSales(user);
  const db = ctx.database.db;
  const [lead] = await db.select().from(spaLeads).where(eq(spaLeads.id, leadId));
  if (!lead) throw notFound("lead");
  if (!seesAllLeads(user) && lead.agentUserId !== user.id) throw forbidden("this lead is assigned to someone else");
  const home = await homeOfLead({ db }, lead);
  const taken = await takenInstants(db, home, ctx.clock.now());
  return freeViewingSlots(ctx.clock.now(), await slotPolicy(db), taken, max).map((d) => d.toISOString());
}

// ---------------------------------------------------------------------------------------------
// Email (jobs call this; safe to run twice: every mail is claimed once per milestone)

/**
 * Sends one viewing email. `invite`: the visitor's confirmation (with the cancel link) and the agent's "new viewing";
 * `reminder`: the visitor, from 24 hours before until the start, only while still booked; `cancel`: the visitor, once,
 * except for a reschedule (the new confirmation covers it). The mail table's unique (entity, purpose, milestone) makes a
 * second run a no-op.
 */
export async function sendViewingMail(
  ctx: SpaContext,
  viewingId: string,
  milestone: ViewingMailMilestone,
): Promise<void> {
  if (!ctx.mail) return;
  const db = ctx.database.db;
  const [v] = await db.select().from(spaViewings).where(eq(spaViewings.id, viewingId));
  if (!v) return;
  const [lead] = await db.select().from(spaLeads).where(eq(spaLeads.id, v.leadId));
  if (!lead) return;
  const property = await homeTitle(ctx, lead);
  const now = ctx.clock.now().getTime();
  if (milestone === "invite") {
    if (v.status !== "booked") return;
    await sendSpaMail(ctx, {
      entityKind: "viewing",
      entityId: v.id,
      purpose: "receipt",
      milestone: "invite",
      to: lead.email,
      parts: viewingConfirmationMail({
        name: lead.name,
        property,
        startsAt: v.startsAt,
        cancelUrl: cancelUrl(ctx, v.id),
      }),
    });
    if (v.agentUserId) {
      const [agent] = await db
        .select({ email: spaUsers.email })
        .from(spaUsers)
        .where(and(eq(spaUsers.id, v.agentUserId), eq(spaUsers.active, true)));
      if (agent)
        await sendSpaMail(ctx, {
          entityKind: "viewing",
          entityId: v.id,
          purpose: "notice",
          milestone: "agent:new",
          to: agent.email,
          parts: viewingNewMail({
            leadRef: lead.ref,
            property,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            startsAt: v.startsAt,
            message: await bookingMessage(ctx, lead.id),
            url: leadUrl(ctx, lead.id),
          }),
        });
    }
    return;
  }
  if (milestone === "reminder") {
    if (v.status !== "booked" || v.startsAt.getTime() <= now) return;
    if (now < v.startsAt.getTime() - REMINDER_HOURS * 60 * MIN) return;
    await sendSpaMail(ctx, {
      entityKind: "viewing",
      entityId: v.id,
      purpose: "reminder",
      milestone: "reminder",
      to: lead.email,
      parts: viewingReminderMail({ name: lead.name, property, startsAt: v.startsAt, cancelUrl: cancelUrl(ctx, v.id) }),
    });
    return;
  }
  // cancel
  if (v.status !== "cancelled" || v.cancelReason === RESCHEDULED_REASON) return;
  await sendSpaMail(ctx, {
    entityKind: "viewing",
    entityId: v.id,
    purpose: "notice",
    milestone: "cancel",
    to: lead.email,
    parts: viewingCancelledMail({
      name: lead.name,
      property,
      startsAt: v.startsAt,
      reason:
        v.cancelReason === VISITOR_CANCEL_REASON
          ? "visitor"
          : v.cancelReason === UNAVAILABLE_REASON
            ? "unavailable"
            : v.cancelReason === CLOSED_REASON
              ? "closed"
              : "agent",
    }),
  });
}

/** What the visitor wrote with their booking, when they wrote anything (the default line is not a message of theirs). */
async function bookingMessage(ctx: SpaContext, leadId: string): Promise<string | null> {
  const [m] = await ctx.database.db
    .select({ body: spaLeadMessages.body })
    .from(spaLeadMessages)
    .where(eq(spaLeadMessages.leadId, leadId))
    .orderBy(desc(spaLeadMessages.seq))
    .limit(1);
  return m && m.body !== DEFAULT_BOOKING_MESSAGE ? m.body : null;
}

/** Mail rows already stored for a viewing (tests and the lead record read this, never a body). */
export async function viewingMailRows(ctx: SpaContext, viewingId: string) {
  return ctx.database.db
    .select({
      milestone: outboundMessages.milestone,
      status: outboundMessages.status,
      subject: outboundMessages.subject,
    })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.entityId, viewingId), inArray(outboundMessages.entityKind, ["viewing"])));
}
