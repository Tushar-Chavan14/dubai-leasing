import {
  type Actor,
  type ChannelButton,
  type ChannelReply,
  type ChannelUpdate,
  type CompanyPolicy,
  type UnitCard,
  type EnquiryFlow,
  type EnquiryLanguage,
  formatAed,
  IDLE_FLOW,
  maskPiiText,
  newId,
  normalisePhone,
  type StaffUser,
} from "@leasing/core";
import { applications, conversations, messages, parties, tasks, type Tx, unitPhotos, units, withTx } from "@leasing/db";
import {
  enquiryCopy,
  formatSlot,
  type LeasingAssistantData,
  LeasingAssistantSchemas,
  leasingAssistant,
  type UnitFacts,
} from "@leasing/helpers";
import { sha256Hex } from "@leasing/core/tokens";
import { and, asc, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, DomainError, forbidden, notFound } from "../errors.ts";
import { createApplication } from "./applications.ts";
import {
  bookableFacets,
  type Filters,
  listedCommunities,
  listedUnit,
  listedUnits,
  takenViewings,
} from "./availability.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { createTask } from "./milestones.ts";
import { freeViewingSlots, parseSlotKey, slotKey } from "./viewing-slots.ts";

/**
 * Telegram enquiries (step 2, architecture §8, decision D24). One bot serves many customers:
 * each private chat is its own conversation row, and everything here works on the one row the
 * update belongs to. Commands, buttons, name and email are handled by code. Free text goes to
 * the Leasing Assistant (decision model; the chat model only answers questions about the picked
 * unit). Slow model calls run outside any transaction; the result is applied only if the
 * customer's flow hasn't moved on meanwhile. Booking creates the application through
 * `createApplication`, and the viewing invitation goes by email (rule 10). Nothing here approves
 * a gate or touches a lease.
 */

type ConvRow = typeof conversations.$inferSelect;
type UnitRow = typeof units.$inferSelect;

const MAX_MODEL_TEXT = 1000;
/** A message claimed this long ago without an answer is handled again on redelivery (the bot gives up after 60 s). */
const RECLAIM_AFTER_MS = 90_000;
/** Units described to the chat model for general questions (no prices). */
const MAX_LISTINGS = 25;
const MAX_SLOT_BUTTONS = 8;
/** One button per area, one more for "Any area"; the reply holds ten buttons. */
const MAX_AREA_BUTTONS = 9;
const OPEN_APPLICATION_STATES = ["ENQUIRY", "VIEWING", "SCREENING", "OFFER", "RESERVED"] as const;

const Name = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u);
const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** What a step produced: the reply, and the customer's next flow (if it changed). */
interface Outcome {
  reply: ChannelReply | null;
  /** Stored on the outbound message, for staff and for tests ("results", "handoff", ...). */
  kind: string;
  flow?: EnquiryFlow;
  language?: EnquiryLanguage;
}

export interface UpdateResult {
  conversationId: string;
  reply: ChannelReply | null;
}

const isWeb = (conv: ConvRow) => conv.channel === "web";
/** Telegram and web chat enquirers are both recorded as the conversation. */
const enquirer = (conv: ConvRow): Actor => `enquirer:${conv.id}`;
const langOf = (conv: ConvRow): EnquiryLanguage => (conv.language === "ar" ? "ar" : "en");

function inboundBody(u: ChannelUpdate): string {
  switch (u.kind) {
    case "text":
      return u.text;
    case "command":
      return `/${u.command}`;
    case "callback":
      return `[button] ${u.data}`;
    case "media":
      return "[photo or file: not stored]";
  }
}

// ---------------------------------------------------------------- entry point

/**
 * Handles one update from one customer. Returns the reply for that same chat (or null when no
 * reply is due: a duplicate still being answered, or a message to an officer in a handoff).
 */
export async function handleChannelUpdate(ctx: EngineContext, update: ChannelUpdate): Promise<UpdateResult> {
  // Phase 1: lock this customer's conversation, store the message, answer whatever needs no model.
  const first = await withTx(ctx.database, async (tx) => {
    const conv = await lockConversation(ctx, tx, update);
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    const now = ctx.clock.now();
    const [created] = await tx.db
      .insert(messages)
      .values({
        id: newId(),
        conversationId: conv.id,
        direction: "in",
        // Stored masked: an ID or phone number typed into the chat is not kept in clear (rule 8).
        body: maskPiiText(inboundBody(update)).slice(0, 4096),
        externalId: update.updateId,
        meta: { kind: update.kind, status: "pending", claimedAt: now.toISOString() },
        at: now,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    let inbound = created;
    if (!inbound) {
      // A redelivered update: answered → the same reply again; still being handled → nothing;
      // handling died without an answer (crash, timeout) → handle it again now.
      const [seen] = await tx.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.direction, "in"),
            eq(messages.externalId, update.updateId),
          ),
        );
      if (!seen) throw notFound("message");
      const claimedAt = Date.parse(String(seen.meta.claimedAt ?? "")) || seen.at.getTime();
      if (seen.meta.status === "answered" || now.getTime() - claimedAt < RECLAIM_AFTER_MS)
        return { done: true as const, conv, reply: await storedReply(tx, conv.id, update.updateId) };
      await tx.db
        .update(messages)
        .set({ meta: { ...seen.meta, claimedAt: now.toISOString() } })
        .where(eq(messages.id, seen.id));
      inbound = { id: seen.id };
    }
    await tx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conv.id));

    const [recent] = await tx.db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conv.id),
          eq(messages.direction, "in"),
          gte(messages.at, new Date(now.getTime() - 3_600_000)),
        ),
      );
    const n = recent?.n ?? 0;
    if (n > policy.enquiryMaxMessagesPerHour) {
      // Say it once; after that stay quiet until the hour has passed.
      const outcome: Outcome =
        n === policy.enquiryMaxMessagesPerHour + 1
          ? { reply: { text: enquiryCopy[langOf(conv)].rateLimited }, kind: "rate_limited" }
          : { reply: null, kind: "rate_limited" };
      return { done: true as const, conv, reply: await finish(ctx, tx, conv, outcome, update.updateId, inbound.id) };
    }

    const quick = await withoutModel(ctx, tx, conv, update, policy, inbound.id);
    if (quick)
      return { done: true as const, conv, reply: await finish(ctx, tx, conv, quick, update.updateId, inbound.id) };
    return { done: false as const, conv, policy, inboundId: inbound.id };
  });
  if (first.done) return { conversationId: first.conv.id, reply: first.reply };

  // Phase 2: the model, with no locks held (the chat model can take ~20 s on demo hardware).
  const { conv, policy, inboundId } = first;
  const text = maskPiiText((update as Extract<ChannelUpdate, { kind: "text" }>).text).slice(0, MAX_MODEL_TEXT);
  const prepared = await withTx(ctx.database, async (tx) => ({
    communities: await listedCommunities(tx),
    listings: (await listedUnits(tx, {}, policy, MAX_LISTINGS)).map((u) => unitFacts(u)),
    unit: conv.flow.unitId ? await listedUnit(tx, conv.flow.unitId, policy) : null,
  }));
  const entity = { kind: "conversation" as const, id: conv.id };
  const helperRunId = newId();
  const run = await runOnly(
    ctx,
    leasingAssistant(ctx.llm),
    LeasingAssistantSchemas,
    entity,
    "enquiry",
    {
      text,
      step: conv.flow.step,
      communities: prepared.communities,
      listings: prepared.listings,
      ...(prepared.unit ? { unit: unitFacts(prepared.unit) } : {}),
      minConfidence: policy.enquiryIntentMinConfidence,
      handoffThreshold: policy.enquiryHandoffThreshold,
    },
    ctx.rulesVersion,
    helperRunId,
  );

  // Phase 3: lock again; apply only if this customer's flow is where it was.
  const reply = await withTx(ctx.database, async (tx) => {
    const [now] = await tx.db.select().from(conversations).where(eq(conversations.id, conv.id)).for("update");
    if (!now) throw notFound("conversation");
    await recordRun(ctx, tx, "leasing_assistant", entity, ctx.rulesVersion, run, helperRunId);
    let outcome: Outcome;
    if (now.flowVersion !== conv.flowVersion || now.status !== "bot") {
      // Another message from the same customer (or an officer) got there first.
      outcome =
        now.status === "bot"
          ? { ...(await promptForStep(ctx, tx, now, policy)), kind: "stale_result" }
          : { reply: null, kind: "stale_result" };
    } else {
      outcome = await applyAssistant(ctx, tx, now, policy, run.result, inboundId);
    }
    return finish(ctx, tx, now, outcome, update.updateId, inboundId);
  });
  return { conversationId: conv.id, reply };
}

/**
 * Finds or creates the customer's conversation and locks it. A different sender is refused.
 * On web the chat id is the visitor id the web server set from its cookie.
 */
async function lockConversation(ctx: EngineContext, tx: Tx, u: ChannelUpdate): Promise<ConvRow> {
  const language = u.from.languageCode?.toLowerCase().startsWith("ar") ? "ar" : "en";
  await tx.db
    .insert(conversations)
    .values({
      id: newId(),
      channel: u.channel,
      externalChatId: u.chatId,
      externalUserId: u.from.id,
      language,
      flow: IDLE_FLOW,
      createdAt: ctx.clock.now(),
    })
    .onConflictDoNothing({ target: [conversations.channel, conversations.externalChatId] });
  const [conv] = await tx.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.channel, u.channel), eq(conversations.externalChatId, u.chatId)))
    .for("update");
  if (!conv) throw notFound("conversation");
  // Private chats only: the chat belongs to one Telegram user, and nobody else may act in it.
  if (conv.externalUserId && conv.externalUserId !== u.from.id) throw forbidden("this chat belongs to another user");
  if (!conv.externalUserId) {
    await tx.db.update(conversations).set({ externalUserId: u.from.id }).where(eq(conversations.id, conv.id));
    conv.externalUserId = u.from.id;
  }
  return conv;
}

/** The reply already sent for this update (a redelivered update gets the same answer, once more). */
async function storedReply(tx: Tx, conversationId: string, updateId: string): Promise<ChannelReply | null> {
  const rows = await tx.db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.at))
    .limit(20);
  const hit = rows.find((m) => m.meta.inReplyTo === updateId);
  if (!hit) return null;
  // Web replies are stored whole (cards and all).
  if (hit.meta.reply) return hit.meta.reply as ChannelReply;
  const buttons = hit.meta.buttons as ChannelButton[] | undefined;
  return { text: hit.body, ...(buttons?.length ? { buttons } : {}) };
}

/** Saves the next flow (bumping its version), the language and the outbound message; marks the inbound answered. */
async function finish(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  o: Outcome,
  inReplyTo: string,
  inboundId: string,
): Promise<ChannelReply | null> {
  await tx.db
    .update(messages)
    .set({ meta: sql`${messages.meta} || '{"status":"answered"}'::jsonb` })
    .where(eq(messages.id, inboundId));
  const set: Partial<typeof conversations.$inferInsert> = {};
  if (o.flow) {
    set.flow = o.flow;
    set.flowVersion = conv.flowVersion + 1;
  }
  if (o.language && o.language !== conv.language) set.language = o.language;
  if (Object.keys(set).length) await tx.db.update(conversations).set(set).where(eq(conversations.id, conv.id));
  if (o.reply) {
    await tx.db.insert(messages).values({
      id: newId(),
      conversationId: conv.id,
      direction: "out",
      body: o.reply.text,
      author: "system",
      meta: {
        kind: o.kind,
        inReplyTo,
        ...(o.reply.buttons ? { buttons: o.reply.buttons } : {}),
        ...(isWeb(conv) ? { reply: o.reply } : {}),
      },
      at: ctx.clock.now(),
    });
  }
  return o.reply;
}

// ---------------------------------------------------------------- code-only paths

/** Commands, buttons, name and email: answered without a model. Null means "free text for the assistant". */
async function withoutModel(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  u: ChannelUpdate,
  policy: CompanyPolicy,
  inboundId: string,
): Promise<Outcome | null> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  if (u.kind === "media") return { reply: { text: t.media }, kind: "media_refused" };

  if (conv.status !== "bot") {
    // An officer has this conversation: messages are for them. Commands get a pointer, text no reply.
    if (u.kind === "text") return { reply: null, kind: "for_officer" };
    if (u.kind === "callback" && u.data.startsWith("lang:")) return setLanguage(u.data.slice(5));
    return { reply: { text: t.inHandoff }, kind: "in_handoff" };
  }

  const contact = await contactStep(ctx, tx, conv, u, policy);
  if (contact) return contact;

  if (u.kind === "command") {
    switch (u.command) {
      case "contact":
        return contactStep(ctx, tx, conv, u, policy, true) as Promise<Outcome>;
      case "start":
        return { reply: { text: t.welcome, buttons: bedroomButtons(lang) }, kind: "welcome", flow: IDLE_FLOW };
      case "help":
        return { reply: { text: t.help }, kind: "help" };
      case "units":
        return { reply: { text: t.askBedrooms, buttons: bedroomButtons(lang) }, kind: "ask_bedrooms", flow: IDLE_FLOW };
      case "book":
        return conv.flow.unitId
          ? showUnit(ctx, tx, conv, conv.flow.unitId, policy)
          : { reply: { text: t.pickUnitFirst, buttons: bedroomButtons(lang) }, kind: "pick_unit_first" };
      case "mybooking":
        return myBooking(tx, conv);
      case "agent":
        return handoff(
          ctx,
          tx,
          conv,
          ["The enquirer asked for a leasing officer (/agent)."],
          inboundId,
          t.handoff,
          enquirer(conv),
        );
      case "language":
        return {
          reply: {
            text: t.pickLanguage,
            buttons: [
              { label: "English", data: "lang:en" },
              { label: "العربية", data: "lang:ar" },
            ],
          },
          kind: "pick_language",
        };
    }
  }

  if (u.kind === "callback") {
    const d = u.data;
    if (d.startsWith("lang:")) return setLanguage(d.slice(5));
    if (isWeb(conv)) {
      const web = await webCallback(ctx, tx, conv, d, policy);
      if (web) return web;
    }
    if (d === "units") return { reply: { text: t.askBedrooms, buttons: bedroomButtons(lang) }, kind: "ask_bedrooms" };
    const bed = /^bed:([0-4])$/.exec(d);
    if (bed) return search(tx, conv, { bedrooms: Number(bed[1]) }, policy);
    const unit = d.startsWith("unit:") ? z.uuid().safeParse(d.slice(5)) : null;
    if (unit?.success) return showUnit(ctx, tx, conv, unit.data, policy);
    const slot = parseSlotKey(d);
    if (slot) return pickSlot(ctx, tx, conv, slot, policy);
    return isWeb(conv)
      ? { reply: { text: t.autopilotCant, buttons: webMenuButtons(lang) }, kind: "unknown_button" }
      : { reply: { text: t.help }, kind: "unknown_button" };
  }

  // Free text that answers the step's question is taken as typed (validated), not classified.
  if (conv.flow.step === "asking_name") {
    const name = Name.safeParse(u.text);
    if (!name.success) return { reply: { text: t.badName }, kind: "bad_name" };
    // The email given at the start is the applicant's; no need to ask again.
    if (conv.contactEmail)
      return book(ctx, tx, { ...conv, flow: { ...conv.flow, nameEn: name.data } }, conv.contactEmail, policy);
    return {
      reply: { text: t.askEmail(name.data) },
      kind: "ask_email",
      flow: { ...conv.flow, step: "asking_email", nameEn: name.data },
    };
  }
  if (conv.flow.step === "asking_email") {
    const email = Email.safeParse(u.text);
    if (!email.success) return { reply: { text: t.badEmail }, kind: "bad_email" };
    return book(ctx, tx, conv, email.data, policy);
  }
  return null;
}

const EMAIL_IN_TEXT = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+/;
/** Commands and buttons that work before the enquirer has given an email. */
const BEFORE_CONTACT = new Set(["help", "language", "agent"]);

/**
 * Contact first (decision D24): every enquiry starts with an email address (required) and a
 * phone number (optional), so staff can identify the person and follow up even if no viewing is
 * booked. Returns null when the update isn't about the contact and the contact is known.
 * `show` answers /contact: the stored details with a Change button.
 */
async function contactStep(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  u: ChannelUpdate,
  policy: CompanyPolicy,
  show = false,
): Promise<Outcome | null> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  const askEmail = (again: boolean): Outcome => ({
    reply: { text: again ? t.askContactEmailAgain : t.askContactEmail },
    kind: "ask_contact_email",
    flow: { step: "asking_contact_email" },
  });
  const askPhone = (text: string, kind: string): Outcome => ({
    reply: { text, buttons: [{ label: t.skipCta, data: "contact:skip" }] },
    kind,
    flow: { step: "asking_contact_phone" },
  });
  const done = async (kind: string): Promise<Outcome> =>
    isWeb(conv)
      ? { ...(await askArea(tx, conv, policy, `${t.contactSavedWeb}\n\n`)), kind }
      : { reply: { text: t.contactSaved, buttons: bedroomButtons(lang) }, kind, flow: IDLE_FLOW };

  if (show && conv.contactEmail) {
    return {
      reply: {
        text: t.contactShow(conv.contactEmail, conv.contactPhone),
        buttons: [{ label: lang === "ar" ? "تغيير" : "Change", data: "contact:change" }],
      },
      kind: "contact_show",
    };
  }
  if (u.kind === "callback" && u.data === "contact:change") return askEmail(false);

  // The phone step: a number, or Skip. Anything else goes on as normal (the phone stays empty).
  if (conv.flow.step === "asking_contact_phone" && conv.contactEmail) {
    if (u.kind === "callback" && u.data === "contact:skip") return await done("contact_skip_phone");
    if (u.kind === "text") {
      const phone = normalisePhone(u.text);
      if (!phone) return askPhone(t.badPhone, "bad_phone");
      await tx.db
        .update(conversations)
        .set({ contactPhone: phone, contactAt: ctx.clock.now() })
        .where(eq(conversations.id, conv.id));
      await appendEvent(tx, ctx, {
        entity: { kind: "conversation", id: conv.id },
        rulesVersion: ctx.rulesVersion,
        type: "ENQUIRY_CONTACT_SET",
        actor: enquirer(conv),
        payload: { phone }, // masked by appendEvent
      });
      return await done("contact_saved");
    }
    return null;
  }

  const wantsEmail = !conv.contactEmail || conv.flow.step === "asking_contact_email";
  if (!wantsEmail) return null;
  if (u.kind === "command" && BEFORE_CONTACT.has(u.command)) return null;
  if (u.kind === "callback" && u.data.startsWith("lang:")) return null;
  if (u.kind !== "text")
    return show || u.kind === "command" ? askEmail(false) : askEmail(conv.flow.step === "asking_contact_email");

  const found = EMAIL_IN_TEXT.exec(u.text)?.[0];
  const email = found ? Email.safeParse(found.replace(/[.!?]+$/, "")) : null;
  if (!email?.success) return askEmail(conv.flow.step === "asking_contact_email");

  // A person we already know (a past applicant or tenant) is linked for staff; nothing about
  // them is ever shown to the enquirer, since anyone can type any email.
  const [known] = conv.partyId
    ? []
    : await tx.db
        .select({ id: parties.id })
        .from(parties)
        .where(eq(parties.email, email.data))
        .orderBy(desc(parties.createdAt))
        .limit(1);
  await tx.db
    .update(conversations)
    .set({
      contactEmail: email.data,
      contactAt: ctx.clock.now(),
      ...(conv.contactEmail && conv.contactEmail !== email.data ? { contactPhone: null } : {}),
      ...(known ? { partyId: known.id } : {}),
    })
    .where(eq(conversations.id, conv.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "conversation", id: conv.id },
    rulesVersion: ctx.rulesVersion,
    type: "ENQUIRY_CONTACT_SET",
    actor: enquirer(conv),
    payload: {
      email: email.data,
      ...(conv.contactEmail ? { previousEmail: conv.contactEmail } : {}),
      knownParty: !!known,
    },
  });
  return askPhone(t.askPhone, "ask_phone");
}

function setLanguage(code: string): Outcome {
  const lang: EnquiryLanguage = code === "ar" ? "ar" : "en";
  return { reply: { text: enquiryCopy[lang].languageSet }, kind: "language_set", language: lang };
}

function bedroomButtons(lang: EnquiryLanguage): ChannelButton[] {
  return [0, 1, 2, 3, 4].map((n) => ({ label: enquiryCopy[lang].bedrooms(n), data: `bed:${n}` }));
}

/** Web: only the sizes that have a bookable home (in the chosen area). Falls back to all sizes when none is bookable (unless `fallback` is false). */
async function webBedroomButtons(
  tx: Tx,
  lang: EnquiryLanguage,
  policy: CompanyPolicy,
  community?: string,
  fallback = true,
): Promise<ChannelButton[]> {
  const { bedrooms } = await bookableFacets(tx, policy, community ? { community } : {});
  const all = bedroomButtons(lang);
  const some = all.filter((b) => bedrooms.includes(Number(b.data.slice(4))));
  return some.length || !fallback ? some : all;
}

function furnishedButtons(lang: EnquiryLanguage): ChannelButton[] {
  const t = enquiryCopy[lang];
  return [
    { label: t.furnishedYes, data: "furn:yes" },
    { label: t.furnishedNo, data: "furn:no" },
    { label: t.furnishedAny, data: "furn:any" },
  ];
}

/** The two buttons every web reply can end on, so the customer is never at a dead end. */
function webMenuButtons(lang: EnquiryLanguage, first: "findHome" | "findAnother" = "findHome"): ChannelButton[] {
  const t = enquiryCopy[lang];
  return [
    { label: t[first], data: "units" },
    { label: t.changeEmail, data: "contact:change" },
  ];
}

/**
 * Buttons only the web chat has: the property-type questions (bedrooms, then furnished). The
 * Telegram callback strings (`units`, `bed:N`, `unit:<id>`, `slot:...`) keep their handlers.
 */
async function webCallback(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  d: string,
  policy: CompanyPolicy,
): Promise<Outcome | null> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  if (d === "units") return askArea(tx, conv, policy);
  const area = /^area:([0-9a-f]{10}|any)$/.exec(d);
  if (area) {
    // The key is a hash of the community name, matched against today's list; a stale or unknown key asks again.
    const community =
      area[1] === "any"
        ? undefined
        : (await bookableFacets(tx, policy)).communities.find((c) => areaKey(c) === area[1]);
    if (area[1] !== "any" && !community) return askArea(tx, conv, policy);
    return {
      reply: { text: t.askBedrooms, buttons: await webBedroomButtons(tx, lang, policy, community) },
      kind: "ask_bedrooms",
      flow: { step: "choosing_bedrooms", ...(community ? { community } : {}) },
    };
  }
  const bed = /^bed:([0-4])$/.exec(d);
  if (bed) {
    return {
      reply: { text: t.askFurnished, buttons: furnishedButtons(lang) },
      kind: "ask_furnished",
      flow: {
        step: "choosing_furnished",
        bedrooms: Number(bed[1]),
        ...(conv.flow.community ? { community: conv.flow.community } : {}),
      },
    };
  }
  const furn = /^furn:(yes|no|any)$/.exec(d);
  if (furn) {
    const furnished = furn[1] === "any" ? undefined : furn[1] === "yes";
    return search(tx, conv, { bedrooms: conv.flow.bedrooms, community: conv.flow.community, furnished }, policy);
  }
  return null;
}

/** The first web question: the area. Buttons come from communities with a bookable home (code), plus "Any area". */
async function askArea(tx: Tx, conv: ConvRow, policy: CompanyPolicy, lead = ""): Promise<Outcome> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  const communities = (await bookableFacets(tx, policy)).communities.slice(0, MAX_AREA_BUTTONS);
  return {
    reply: {
      text: `${lead}${t.askArea}`,
      buttons: [
        ...communities.map((c) => ({ label: buttonLabel(c), data: `area:${areaKey(c)}` })),
        { label: t.anyArea, data: "area:any" },
      ],
    },
    kind: "ask_area",
    flow: { step: "choosing_community" },
  };
}

/** What the web chat says where Telegram would pass the customer to an officer: nobody is handed anything. */
function autopilotDeclined(conv: ConvRow): Outcome {
  const lang = langOf(conv);
  return {
    reply: { text: enquiryCopy[lang].autopilotCant, buttons: webMenuButtons(lang) },
    kind: "autopilot_declined",
  };
}

/** Re-asks the current step's question (used when a slow model answer arrived too late). */
async function promptForStep(ctx: EngineContext, tx: Tx, conv: ConvRow, policy: CompanyPolicy) {
  const t = enquiryCopy[langOf(conv)];
  switch (conv.flow.step) {
    case "asking_contact_email":
      return { reply: { text: t.askContactEmailAgain } };
    case "asking_contact_phone":
      return { reply: { text: t.askPhone, buttons: [{ label: t.skipCta, data: "contact:skip" }] } };
    case "asking_name":
      return { reply: { text: t.askName } };
    case "asking_email":
      return { reply: { text: t.askEmail(conv.flow.nameEn ?? "") } };
    case "choosing_community":
      return askArea(tx, conv, policy);
    case "choosing_bedrooms":
      return {
        reply: {
          text: t.askBedrooms,
          buttons: isWeb(conv)
            ? await webBedroomButtons(tx, langOf(conv), policy, conv.flow.community)
            : bedroomButtons(langOf(conv)),
        },
      };
    case "choosing_furnished":
      return { reply: { text: t.askFurnished, buttons: furnishedButtons(langOf(conv)) } };
    case "choosing_slot":
      return conv.flow.unitId ? showUnit(ctx, tx, conv, conv.flow.unitId, policy) : { reply: null };
    default:
      return { reply: null };
  }
}

// ---------------------------------------------------------------- search, unit, slots, booking

/** Listing facts for the chat model, written by code. No rent: the price is printed by code on the unit card. */
export function unitFacts(u: UnitRow): UnitFacts {
  return {
    code: u.code,
    building: u.building,
    community: u.community,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    areaSqft: u.areaSqft,
    floor: u.floor,
    parkingSpaces: u.parkingSpaces,
    furnished: u.furnished,
    description: u.description,
  };
}

function unitSummary(u: UnitRow, lang: EnquiryLanguage): string {
  const t = enquiryCopy[lang];
  const size = [
    u.bedrooms !== null ? t.bedrooms(u.bedrooms) : null,
    u.areaSqft ? `${u.areaSqft} sq ft` : null,
    u.floor !== null ? (lang === "ar" ? `الطابق ${u.floor}` : `floor ${u.floor}`) : null,
  ].filter(Boolean);
  return [
    `${u.building}, ${u.community} (${u.code})`,
    size.join(" · "),
    u.askingRentFils !== null ? t.perYear(formatAed(u.askingRentFils)) : null,
    u.description ? u.description.slice(0, 500) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A stable button key for a community: the first 10 hex chars of the name's sha256. */
const areaKey = (community: string) => sha256Hex(community).slice(0, 10);

const buttonLabel = (s: string) => (s.length <= 64 ? s : `${s.slice(0, 63)}…`);

async function search(tx: Tx, conv: ConvRow, f: Filters, policy: CompanyPolicy): Promise<Outcome> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  // Only units with a settled rent are shown (a missing rent is never displayed as AED 0).
  const found = (await listedUnits(tx, f, policy)).filter((u) => u.askingRentFils !== null);
  const flow: EnquiryFlow = {
    step: "choosing_unit",
    ...(f.bedrooms !== undefined ? { bedrooms: f.bedrooms } : {}),
    ...(f.furnished !== undefined ? { furnished: f.furnished } : {}),
    ...(f.community ? { community: f.community } : {}),
  };
  if (!found.length) {
    // Web has no officer to pass to: say so plainly and offer what can match.
    if (isWeb(conv)) {
      return {
        reply: {
          text: t.noResultsWeb,
          buttons: [...(await webBedroomButtons(tx, lang, policy, undefined, false)), ...webMenuButtons(lang)],
        },
        kind: "no_results",
        flow: { ...flow, step: "choosing_bedrooms" },
      };
    }
    return { reply: { text: t.noResults, buttons: bedroomButtons(lang) }, kind: "no_results", flow };
  }
  return {
    reply: {
      // ChannelReply.cards holds at most 5.
      ...(isWeb(conv) ? { cards: await unitCards(tx, found.slice(0, 5)) } : {}),
      text: t.results(found.length),
      // The reply holds ten buttons; web leaves room for its two menu buttons.
      buttons: (isWeb(conv) ? found.slice(0, 8) : found).map((u) => ({
        label: buttonLabel(
          `${u.bedrooms !== null ? t.bedrooms(u.bedrooms) : u.code} · ${u.building} · ${formatAed(u.askingRentFils!).replace(/\.00$/, "")}`,
        ),
        data: `unit:${u.id}`,
      })),
    },
    kind: "results",
    flow,
  };
}

/** Where the web app fetches a unit's photo (the public photo route; listed units only). */
export const publicPhotoPath = (unitId: string, photoId: string) => `/public/units/${unitId}/photos/${photoId}`;

/** The units as the web chat shows them, each with its cover photo (sort 0) when it has one. */
async function unitCards(tx: Tx, rows: UnitRow[]): Promise<UnitCard[]> {
  const photos = rows.length
    ? await tx.db
        .select({ id: unitPhotos.id, unitId: unitPhotos.unitId })
        .from(unitPhotos)
        .where(
          inArray(
            unitPhotos.unitId,
            rows.map((u) => u.id),
          ),
        )
        .orderBy(desc(unitPhotos.sort), desc(unitPhotos.createdAt))
    : [];
  // Ordered last-first so the cover (lowest sort, oldest) is the one left in the map.
  const cover = new Map(photos.map((p) => [p.unitId, p.id]));
  return rows.flatMap((u) =>
    u.askingRentFils === null ? [] : [unitCard(u, u.askingRentFils, cover.get(u.id) ?? null)],
  );
}

/** A unit as the web chat shows it. The rent is formatted by code from the asking rent. */
function unitCard(u: UnitRow, rentFils: number, coverPhotoId: string | null): UnitCard {
  return {
    unitId: u.id,
    code: u.code,
    building: u.building,
    community: u.community,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    areaSqft: u.areaSqft,
    furnished: u.furnished ?? false,
    rent: formatAed(rentFils),
    photoUrl: coverPhotoId ? publicPhotoPath(u.id, coverPhotoId) : null,
  };
}

function slotButtons(slots: Date[], lang: EnquiryLanguage): ChannelButton[] {
  return [
    ...slots.slice(0, MAX_SLOT_BUTTONS).map((s) => ({ label: formatSlot(s, lang), data: slotKey(s) })),
    { label: enquiryCopy[lang].backCta, data: "units" },
  ];
}

async function showUnit(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  unitId: string,
  policy: CompanyPolicy,
  lead?: string,
): Promise<Outcome> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  const unit = await listedUnit(tx, unitId, policy);
  if (!unit) {
    const again = await search(
      tx,
      conv,
      { bedrooms: conv.flow.bedrooms, community: conv.flow.community, furnished: conv.flow.furnished },
      policy,
    );
    return { ...again, reply: again.reply && { ...again.reply, text: `${t.unitGone}\n\n${again.reply.text}` } };
  }
  const slots = freeViewingSlots(ctx.clock.now(), policy, await takenViewings(tx, unit.id), MAX_SLOT_BUTTONS);
  const flow: EnquiryFlow = { ...conv.flow, step: "choosing_slot", unitId: unit.id };
  delete flow.slot;
  const body = lead ?? t.unit(unitSummary(unit, lang));
  if (!slots.length)
    return {
      reply: {
        text: `${body}\n\n${isWeb(conv) ? t.noSlotsWeb : t.noSlots}`,
        ...(isWeb(conv) ? { buttons: webMenuButtons(lang) } : {}),
      },
      kind: "no_slots",
      flow,
    };
  return { reply: { text: `${body}\n\n${t.slots}`, buttons: slotButtons(slots, lang) }, kind: "unit", flow };
}

/** The slot must still be one we offer and still free; otherwise fresh slots are shown. */
async function pickSlot(ctx: EngineContext, tx: Tx, conv: ConvRow, at: Date, policy: CompanyPolicy): Promise<Outcome> {
  const t = enquiryCopy[langOf(conv)];
  if (!conv.flow.unitId) return search(tx, conv, {}, policy);
  if (!(await slotIsFree(ctx, tx, conv.flow.unitId, at, policy)))
    return { ...(await showUnit(ctx, tx, conv, conv.flow.unitId, policy, t.slotTaken)), kind: "slot_taken" };
  return {
    reply: { text: t.askName },
    kind: "ask_name",
    flow: { ...conv.flow, step: "asking_name", slot: at.toISOString() },
  };
}

async function slotIsFree(ctx: EngineContext, tx: Tx, unitId: string, at: Date, policy: CompanyPolicy) {
  const free = freeViewingSlots(ctx.clock.now(), policy, await takenViewings(tx, unitId), Number.POSITIVE_INFINITY);
  return free.some((s) => s.getTime() === at.getTime());
}

/**
 * Books the viewing for this customer. The unit row is locked first, so two customers racing
 * for one slot are served one after the other: the second sees the first booking and gets fresh
 * slots. The invitation (time, address, property page) goes by email from `bookViewing`.
 */
async function book(ctx: EngineContext, tx: Tx, conv: ConvRow, email: string, policy: CompanyPolicy): Promise<Outcome> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  const { unitId, slot, nameEn } = conv.flow;
  if (!unitId || !slot || !nameEn)
    return {
      reply: { text: t.pickUnitFirst, buttons: bedroomButtons(lang) },
      kind: "pick_unit_first",
      flow: IDLE_FLOW,
    };
  const [unit] = await tx.db.select().from(units).where(eq(units.id, unitId)).for("update");
  if (!unit || !(await listedUnit(tx, unitId, policy))) return showUnit(ctx, tx, conv, unitId, policy);
  const at = new Date(slot);

  // One open application per person per unit.
  const [open] = await tx.db
    .select({ viewingAt: applications.viewingAt, state: applications.state })
    .from(applications)
    .innerJoin(parties, eq(parties.id, applications.partyId))
    .where(
      and(
        eq(applications.unitId, unitId),
        eq(parties.email, email),
        inArray(applications.state, [...OPEN_APPLICATION_STATES]),
      ),
    )
    .limit(1);
  if (open) {
    const when = open.viewingAt ? formatSlot(open.viewingAt, lang) : "—";
    return {
      reply: {
        text: t.alreadyBooked(when),
        ...(isWeb(conv) ? { buttons: webMenuButtons(lang, "findAnother") } : {}),
      },
      kind: "already_booked",
      flow: IDLE_FLOW,
    };
  }
  if (!(await slotIsFree(ctx, tx, unitId, at, policy)))
    return { ...(await showUnit(ctx, tx, conv, unitId, policy, t.slotTaken)), kind: "slot_taken" };

  let created: { id: string; ref: string; partyId: string };
  try {
    created = await createApplication(
      ctx,
      {
        unitId,
        nameEn,
        email,
        phone: conv.contactPhone,
        kind: "individual",
        viewingAt: at,
        source: isWeb(conv) ? "web_chat" : "telegram",
      },
      enquirer(conv),
      tx,
    );
  } catch (e) {
    if (e instanceof DomainError && e.code === "viewing_slot_taken")
      return { ...(await showUnit(ctx, tx, conv, unitId, policy, t.slotTaken)), kind: "slot_taken" };
    // The unit stopped being bookable between the check and now (e.g. a lease is being signed).
    if (e instanceof DomainError && e.status === 409) return showUnit(ctx, tx, conv, unitId, policy);
    throw e;
  }
  await tx.db
    .update(conversations)
    .set({ partyId: created.partyId, applicationId: created.id })
    .where(eq(conversations.id, conv.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "conversation", id: conv.id },
    rulesVersion: ctx.rulesVersion,
    type: "VIEWING_BOOKED_BY_ENQUIRER",
    actor: enquirer(conv),
    payload: { applicationId: created.id, ref: created.ref, unitCode: unit.code, viewingAt: at.toISOString() },
  });
  return {
    reply: {
      text: t.booked(formatSlot(at, lang), `${unit.building}, ${unit.community}`),
      ...(isWeb(conv) ? { buttons: webMenuButtons(lang, "findAnother") } : {}),
    },
    kind: "booked",
    flow: IDLE_FLOW,
  };
}

async function myBooking(tx: Tx, conv: ConvRow): Promise<Outcome> {
  const lang = langOf(conv);
  const t = enquiryCopy[lang];
  if (!conv.applicationId) return { reply: { text: t.noBooking }, kind: "no_booking" };
  const [row] = await tx.db
    .select({ app: applications, unit: units })
    .from(applications)
    .innerJoin(units, eq(units.id, applications.unitId))
    .where(eq(applications.id, conv.applicationId));
  if (!row || row.app.state !== "VIEWING" || !row.app.viewingAt)
    return { reply: { text: t.noBooking }, kind: "no_booking" };
  return {
    reply: {
      text: t.myBooking(
        formatSlot(row.app.viewingAt, lang),
        `${row.unit.building}, ${row.unit.community}`,
        row.app.ref ?? row.app.id.slice(0, 8),
      ),
    },
    kind: "my_booking",
  };
}

// ---------------------------------------------------------------- the assistant's result

async function applyAssistant(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  policy: CompanyPolicy,
  result: { status: string; data?: LeasingAssistantData; reasons: string[] },
  inboundId: string,
): Promise<Outcome> {
  const data = result.data;
  const language: EnquiryLanguage | undefined =
    data?.language === "ar" || data?.language === "en" ? data.language : undefined;
  const c = { ...conv, language: language ?? conv.language };
  const lang = langOf(c);
  const t = enquiryCopy[lang];
  if (result.status !== "ok" || !data) {
    return { ...(await handoff(ctx, tx, c, result.reasons, inboundId, t.handoff)), ...(language ? { language } : {}) };
  }
  // Web: no records, uploads or officer here. An existing tenant is pointed to their email link.
  // Any other reason in the same message (complaint, injection, low confidence) still ends in the decline.
  if (isWeb(c) && data.intent === "existing_tenant" && result.reasons.length === 1) {
    return {
      reply: { text: t.existingTenantWeb, buttons: webMenuButtons(lang) },
      kind: "existing_tenant_web",
      ...(language ? { language } : {}),
    };
  }
  if (data.handoff) {
    const text = data.intent === "existing_tenant" ? t.existingTenant : t.handoff;
    return { ...(await handoff(ctx, tx, c, result.reasons, inboundId, text)), ...(language ? { language } : {}) };
  }
  const withLang = (o: Outcome): Outcome => (language ? { ...o, language } : o);
  const filters = {
    bedrooms: data.search.bedrooms ?? conv.flow.bedrooms,
    community: data.search.community ?? conv.flow.community,
    furnished: conv.flow.furnished,
  };
  switch (data.intent) {
    case "search_units":
      return withLang(
        filters.bedrooms === undefined && !filters.community
          ? isWeb(c)
            ? await askArea(tx, c, policy)
            : { reply: { text: t.askBedrooms, buttons: bedroomButtons(lang) }, kind: "ask_bedrooms" }
          : await search(tx, c, filters, policy),
      );
    case "unit_question":
    case "general_question": {
      // With a unit picked, the answer sits above that unit's slots; otherwise above the size picker.
      if (conv.flow.unitId) {
        return withLang({
          ...(await showUnit(ctx, tx, c, conv.flow.unitId, policy, data.answer ?? t.noAnswer)),
          kind: data.answer ? "answer" : "no_answer",
        });
      }
      const answer = data.answer ?? (isWeb(c) ? t.noGeneralAnswerWeb : t.noGeneralAnswer);
      const kind = data.answer ? "answer" : "no_answer";
      if (isWeb(c)) return withLang({ ...(await askArea(tx, c, policy, `${answer}\n\n`)), kind });
      return withLang({ reply: { text: `${answer}\n\n${t.askBedrooms}`, buttons: bedroomButtons(lang) }, kind });
    }
    case "book_viewing":
      if (conv.flow.unitId) return withLang(await showUnit(ctx, tx, c, conv.flow.unitId, policy));
      return withLang(
        filters.bedrooms !== undefined || filters.community
          ? await search(tx, c, filters, policy)
          : { reply: { text: t.pickUnitFirst, buttons: bedroomButtons(lang) }, kind: "pick_unit_first" },
      );
    default:
      return withLang({ reply: { text: t.greeting, buttons: bedroomButtons(lang) }, kind: "greeting" });
  }
}

/**
 * Hands the conversation to a leasing officer: status `handoff`, an `enquiry_handoff` task (one
 * per message that caused it) and an event. The bot stops answering free text until released.
 */
async function handoff(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  reasons: string[],
  inboundId: string,
  text: string,
  actor: Actor = "helper:leasing_assistant",
): Promise<Outcome> {
  // The web chat never hands over: no task, no status change, no event (customer chat design).
  if (isWeb(conv)) return autopilotDeclined(conv);
  const reason = reasons.join(" ").slice(0, 1000) || "Handed to an officer.";
  await tx.db
    .update(conversations)
    .set({ status: "handoff", handoffReason: reason })
    .where(eq(conversations.id, conv.id));
  await createTask(
    ctx,
    tx,
    conv.id,
    {
      kind: "enquiry_handoff",
      title: "Telegram enquiry needs a leasing officer",
      // The contact, so an officer can follow up by email even if the chat goes quiet.
      details: {
        conversationId: conv.id,
        reasons,
        email: conv.contactEmail ?? "no email yet",
        phoneGiven: !!conv.contactPhone,
      },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${conv.id}:handoff:${inboundId}`,
    },
    "conversation",
  );
  await appendEvent(tx, ctx, {
    entity: { kind: "conversation", id: conv.id },
    rulesVersion: ctx.rulesVersion,
    type: "ENQUIRY_HANDOFF",
    actor,
    payload: { reasons },
  });
  return { reply: { text }, kind: "handoff", flow: IDLE_FLOW };
}

// ---------------------------------------------------------------- staff side

/** An officer replies in the customer's chat. The conversation stays with officers until released. */
export async function staffReply(ctx: EngineContext, conversationId: string, user: StaffUser, text: string) {
  const [conv] = await ctx.database.db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv) throw notFound("conversation");
  if (isWeb(conv)) throw conflict("web chat conversations are not answered by staff", "web_chat_no_staff_reply");
  const sender = ctx.channel;
  if (!sender) throw new DomainError("the Telegram channel is not configured", 503, "channel_unavailable");
  if (conv.status === "closed") throw conflict("the conversation is closed", "conversation_closed");
  // Sent to this conversation's own chat id, from its row; never to anything the request names.
  const sent = await sender.reply(conv.externalChatId, { text });
  return withTx(ctx.database, async (tx) => {
    await tx.db.insert(messages).values({
      id: newId(),
      conversationId: conv.id,
      direction: "out",
      body: text,
      author: `user:${user.id}`,
      meta: { kind: "staff", telegramMessageId: sent.messageId },
      at: ctx.clock.now(),
    });
    if (conv.status === "bot") {
      await tx.db
        .update(conversations)
        .set({ status: "handoff", handoffReason: "An officer replied.", assignedTo: user.id })
        .where(eq(conversations.id, conv.id));
    } else if (!conv.assignedTo) {
      await tx.db.update(conversations).set({ assignedTo: user.id }).where(eq(conversations.id, conv.id));
    }
    await appendEvent(tx, ctx, {
      entity: { kind: "conversation", id: conv.id },
      rulesVersion: ctx.rulesVersion,
      type: "STAFF_REPLIED",
      actor: `user:${user.id}`,
      payload: { chars: text.length },
    });
    return { ok: true };
  });
}

/** Back to the bot: flow reset, open handoff tasks done. */
export async function releaseConversation(ctx: EngineContext, conversationId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    const [conv] = await tx.db.select().from(conversations).where(eq(conversations.id, conversationId)).for("update");
    if (!conv) throw notFound("conversation");
    if (conv.status !== "handoff") throw conflict(`the conversation is ${conv.status}`, "not_in_handoff");
    await tx.db
      .update(conversations)
      .set({ status: "bot", handoffReason: null, assignedTo: null, flow: IDLE_FLOW, flowVersion: conv.flowVersion + 1 })
      .where(eq(conversations.id, conv.id));
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(
        and(
          eq(tasks.entityKind, "conversation"),
          eq(tasks.entityId, conv.id),
          eq(tasks.kind, "enquiry_handoff"),
          eq(tasks.status, "open"),
        ),
      );
    await appendEvent(tx, ctx, {
      entity: { kind: "conversation", id: conv.id },
      rulesVersion: ctx.rulesVersion,
      type: "RETURNED_TO_BOT",
      actor: `user:${user.id}`,
    });
    return { ok: true };
  });
}

/** Staff list: handoffs first, then the most recent. */
export async function listConversations(ctx: EngineContext) {
  const db = ctx.database.db;
  const rows = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      language: conversations.language,
      handoffReason: conversations.handoffReason,
      lastMessageAt: conversations.lastMessageAt,
      applicationId: conversations.applicationId,
      applicationRef: applications.ref,
      partyName: parties.fullNameEn,
      contactEmail: conversations.contactEmail,
      contactPhone: conversations.contactPhone,
    })
    .from(conversations)
    .leftJoin(applications, eq(applications.id, conversations.applicationId))
    .leftJoin(parties, eq(parties.id, conversations.partyId))
    .where(ne(conversations.status, "closed"))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  return rows
    .map((r) => ({ ...r, contactPhone: r.contactPhone ? maskPiiText(r.contactPhone) : null }))
    .toSorted((a, b) => Number(b.status === "handoff") - Number(a.status === "handoff"));
}

export async function getConversation(ctx: EngineContext, id: string) {
  const db = ctx.database.db;
  const [conv] = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      language: conversations.language,
      handoffReason: conversations.handoffReason,
      lastMessageAt: conversations.lastMessageAt,
      applicationId: conversations.applicationId,
      applicationRef: applications.ref,
      partyName: parties.fullNameEn,
      contactEmail: conversations.contactEmail,
      contactPhone: conversations.contactPhone,
      flowStep: conversations.flow,
    })
    .from(conversations)
    .leftJoin(applications, eq(applications.id, conversations.applicationId))
    .leftJoin(parties, eq(parties.id, conversations.partyId))
    .where(eq(conversations.id, id));
  if (!conv) return null;
  const transcript = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      body: messages.body,
      author: messages.author,
      kind: messages.meta,
      at: messages.at,
    })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.at))
    .limit(500);
  // A person we already knew by this email (linked when the enquirer gave it).
  const knownApplications = conv.applicationId
    ? 0
    : conv.partyName
      ? ((
          await db
            .select({ n: count() })
            .from(applications)
            .innerJoin(conversations, eq(conversations.partyId, applications.partyId))
            .where(eq(conversations.id, id))
        )[0]?.n ?? 0)
      : 0;
  return {
    ...conv,
    knownApplications,
    flowStep: conv.flowStep.step,
    messages: transcript.map((m) => ({ ...m, kind: (m.kind.kind as string | undefined) ?? null })),
  };
}
