import { formatAed } from "@platform/kernel/money";
import { maskPiiText } from "@platform/kernel/pii";
import { untrusted } from "@platform/llm/agent";
import { and, eq, ne, gte, asc } from "drizzle-orm";
import { listings, spaUsers } from "@spa/db";
import { dubaiTimeLabel, listingChatTurn, type ListingBackend } from "@spa/helpers";
import {
  type AssistantRuntime,
  dayBucket,
  hourBucket,
  storeTurn,
  storeUserMessage,
  takeRateLimit,
  threadFor,
  threadHistory,
} from "./assistants.ts";
import type { SpaContext } from "./context.ts";
import { SpaDomainError, tooMany } from "./errors.ts";
import { recordLead } from "./leads.ts";
import { takeHomeAllowance } from "./public-leads.ts";
import { bookViewing, freeSlotsFor } from "./viewings.ts";
import { findPublicListing } from "./listings.ts";
import { currentPolicy } from "./policy.ts";
import type { AssistantReply } from "./party-assistant.ts";

/** At most this many messages an hour per visitor and listing, and this many enquiries a day (S24, S61). */
export const LISTING_MESSAGES_PER_HOUR = 20;
export const ENQUIRIES_PER_DAY = 3;
/** How many other listings the chat may list. */
const OTHER_LISTINGS = 5;

type ListingRow = typeof listings.$inferSelect;

/**
 * The listing chat's tools (S61): `listing_facts` and `other_published_listings` read the public fields only (the same
 * columns the public page returns; the description is fenced as data), and `send_enquiry` emails the listing's agent and
 * stores the enquiry. Nothing here can name a seller, an owner, a document or a lowest price: those columns are never
 * selected.
 */
function listingBackend(ctx: SpaContext, l: ListingRow, who: { client: string; threadId: string }): ListingBackend {
  const db = ctx.database.db;
  return {
    async listing_facts() {
      const [agent] = l.agentUserId
        ? await db
            .select({ name: spaUsers.name, email: spaUsers.email })
            .from(spaUsers)
            .where(and(eq(spaUsers.id, l.agentUserId), eq(spaUsers.active, true)))
        : [];
      return {
        ref: l.ref,
        title: l.title ? untrusted(l.title) : null,
        description: l.description ? untrusted(l.description) : null,
        community: l.community,
        bedrooms: l.bedrooms,
        sizeSqft: l.sizeSqft,
        askingPriceFils: l.askingPriceFils,
        askingPrice: l.askingPriceFils === null ? null : formatAed(l.askingPriceFils),
        permitNo: l.permitNo,
        agent: agent ?? null,
      };
    },
    async other_published_listings() {
      // This install is one company (S33), so "the same company" is every published, permitted listing but this one.
      const rows = await db
        .select()
        .from(listings)
        .where(
          and(eq(listings.state, "PUBLISHED"), ne(listings.id, l.id), gte(listings.permitExpiresOn, ctx.clock.today())),
        )
        .orderBy(asc(listings.ref))
        .limit(OTHER_LISTINGS);
      return {
        listings: rows.map((o) => ({
          ref: o.ref,
          title: o.title ? untrusted(o.title) : null,
          community: o.community,
          bedrooms: o.bedrooms,
          askingPriceFils: o.askingPriceFils,
          askingPrice: o.askingPriceFils === null ? null : formatAed(o.askingPriceFils),
        })),
      };
    },
    async send_enquiry(a) {
      if (!ctx.mail) return { sent: false, reason: "mail_unavailable" };
      if (!l.agentUserId) return { sent: false, reason: "no_agent" };
      const [agent] = await db
        .select({ id: spaUsers.id })
        .from(spaUsers)
        .where(and(eq(spaUsers.id, l.agentUserId), eq(spaUsers.active, true)));
      if (!agent) return { sent: false, reason: "no_agent" };
      const within = await takeRateLimit(ctx, {
        key: who.client,
        bucket: `listing-enquiry:${l.ref}:${dayBucket(ctx)}`,
        limit: ENQUIRIES_PER_DAY,
      });
      if (!within) return { sent: false, reason: "daily_limit" };
      // All visitors together (the visitor key can be shared or spoofed): a per-listing cap an hour.
      const cap = (await currentPolicy(db)).values.listingChat.enquiriesPerListingPerHour;
      const globalOk = await takeRateLimit(ctx, {
        key: `listing:${l.ref}`,
        bucket: `listing-enquiry-all:${l.ref}:${hourBucket(ctx)}`,
        limit: cap,
      });
      if (!globalOk) return { sent: false, reason: "daily_limit" };
      // The enquiry is a lead now (S79): one open lead per email and home, the visitor's own words as a message. The
      // listing page chat only calls this with the consent box ticked.
      try {
        await recordLead(
          ctx,
          { ref: l.ref, name: a.name, email: a.email, message: a.message, consent: true },
          "party:visitor:chat",
          { source: "listing_chat" },
        );
      } catch (e) {
        if (e instanceof SpaDomainError)
          return { sent: false, reason: e.code === "rate_limited" ? "daily_limit" : e.code };
        throw e;
      }
      return { sent: true };
    },
    async free_slots() {
      const slots = await freeSlotsFor(ctx, { kind: "listing", ref: l.ref }, 8);
      return { slots: slots.map((iso) => ({ iso, label: dubaiTimeLabel(iso) })) };
    },
    async book_viewing(a) {
      // Counts with the day's enquiries from this visitor (S61); the engine then refuses any time that isn't free.
      const within = await takeRateLimit(ctx, {
        key: who.client,
        bucket: `listing-enquiry:${l.ref}:${dayBucket(ctx)}`,
        limit: ENQUIRIES_PER_DAY,
      });
      if (!within) return { booked: false, reason: "daily_limit" };
      try {
        // All visitors together: the same per-home hourly cap the public form has.
        await takeHomeAllowance(ctx, l.ref);
        const r = await bookViewing(
          ctx,
          { ref: l.ref, slot: a.slot, name: a.name, email: a.email, phone: a.phone, consent: true },
          "party:visitor:chat",
          { source: "listing_chat" },
        );
        return { booked: true, label: dubaiTimeLabel(r.startsAt) };
      } catch (e) {
        if (e instanceof SpaDomainError)
          return { booked: false, reason: e.code === "rate_limited" ? "daily_limit" : e.code };
        throw e;
      }
    },
  };
}

/** One message to the listing chat. Null: no such published listing. Throws `rate_limited` over the hourly limit. */
export async function runListingChat(
  ctx: SpaContext,
  rt: AssistantRuntime,
  input: { ref: string; text: string; consent: boolean; client: string; session: string },
): Promise<AssistantReply | null> {
  const l = await findPublicListing(ctx, input.ref);
  if (!l) return null;
  if (
    !(await takeRateLimit(ctx, {
      key: input.client,
      bucket: `listing-chat:${l.ref}:${hourBucket(ctx)}`,
      limit: LISTING_MESSAGES_PER_HOUR,
    }))
  )
    throw tooMany("too many messages, try again later");
  const cap = (await currentPolicy(ctx.database.db)).values.listingChat.messagesPerListingPerHour;
  if (
    !(await takeRateLimit(ctx, {
      key: `listing:${l.ref}`,
      bucket: `listing-chat-all:${l.ref}:${hourBucket(ctx)}`,
      limit: cap,
    }))
  )
    throw tooMany("too many messages, try again later");
  const threadId = await threadFor(ctx, {
    kind: "listing",
    subjectId: l.ref,
    principal: `${input.client}:${input.session}`,
  });
  const history = await threadHistory(ctx, threadId);
  await storeUserMessage(ctx, threadId, input.text);
  const result = await listingChatTurn(
    { model: rt.model, llm: rt.llm, ...(rt.timeoutMs ? { timeoutMs: rt.timeoutMs } : {}) },
    listingBackend(ctx, l, { client: input.client, threadId }),
    { text: input.text, history },
    { consent: input.consent },
  );
  await storeTurn(ctx, threadId, result, rt.tag);
  return {
    threadId,
    reply: maskPiiText(result.reply),
    kind: result.kind,
    verified: result.verified,
    unverified: result.unverified,
  };
}
