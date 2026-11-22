import { newId } from "@platform/kernel/ids";
import { formatAed } from "@platform/kernel/money";
import { maskPiiText } from "@platform/kernel/pii";
import { untrusted } from "@platform/llm/agent";
import { and, eq, ne, gte, asc } from "drizzle-orm";
import { listingEnquiries, listings, spaUsers } from "@spa/db";
import { listingChatTurn, listingEnquiryMail, type ListingBackend } from "@spa/helpers";
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
import { tooMany } from "./errors.ts";
import { findPublicListing } from "./listings.ts";
import { currentPolicy } from "./policy.ts";
import { sendSpaMail } from "./mail.ts";
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
        .select({ email: spaUsers.email })
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
      const id = newId();
      const now = ctx.clock.now();
      // Kept as the visitor wrote it, with the moment they consented (the chat only calls this with the box ticked).
      await db.insert(listingEnquiries).values({
        id,
        listingId: l.id,
        name: a.name,
        email: a.email.toLowerCase(),
        message: a.message,
        consentAt: now,
        createdAt: now,
      });
      const r = await sendSpaMail(ctx, {
        entityKind: "listing_enquiry",
        entityId: id,
        purpose: "notice",
        milestone: "enquiry:1",
        to: agent.email,
        parts: listingEnquiryMail({
          listingRef: l.ref,
          title: l.title ?? "",
          name: a.name,
          email: a.email,
          message: a.message,
        }),
      });
      if (r.status !== "sent") return { sent: false, reason: "mail_failed" };
      await db.update(listingEnquiries).set({ outboundMessageId: r.outboundId }).where(eq(listingEnquiries.id, id));
      return { sent: true };
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
