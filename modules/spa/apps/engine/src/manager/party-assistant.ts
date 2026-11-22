import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { formatAed } from "@platform/kernel/money";
import { CHASE_REASONS, PARTY_GLOSSARY, PARTY_STATE_WORDS, stepsFor } from "@spa/core";
import { deals, listings, offerLinks, offers, parties, signatures, signingEnvelopes, spaUsers } from "@spa/db";
import { partyAssistantTurn, partyQuestionMail, type PartyBackend } from "@spa/helpers";
import { and, eq } from "drizzle-orm";
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
import { openChaseItems } from "./chase.ts";
import type { SpaContext } from "./context.ts";
import { tooMany } from "./errors.ts";
import type { DealRow } from "./facts.ts";
import { sendSpaMail } from "./mail.ts";
import { hashToken } from "./offers.ts";
import { planCoverage } from "./payment-facts.ts";
import { resolvePortalToken } from "./portal.ts";
import { hashLinkToken, propertyLabel } from "./signing.ts";

/**
 * The party portal assistant's engine side (S24, S61). A token resolves to exactly one deal and one party (or, for an
 * offer link, one offer and one seller): every tool below is closed over that scope and reads nothing else. The party's
 * words and the tools' fixed vocabulary are all that reach the model; a code guard stops any banned word on the way out.
 */
export interface PartyScope {
  kind: "sign" | "offer" | "portal";
  partyId: string;
  /** The party's side of the deal. */
  role: "buyer" | "seller" | "broker";
  dealId: string | null;
  offerId: string | null;
  /** The hash of the token: what a thread and a rate limit are keyed by. The token itself is never stored. */
  principal: string;
  /** For a sign link: whether every earlier signer has signed. */
  yourTurn: boolean | null;
}

const ROLE = { purchaser: "buyer", seller: "seller", broker: "broker" } as const;
/** `contact_agent` sends at most this many emails a day per link. */
export const PARTY_CONTACTS_PER_DAY = 5;
/** And the chat takes at most this many messages an hour per link. */
export const PARTY_MESSAGES_PER_HOUR = 60;

/**
 * The scope behind a party token, or null (unknown, used, expired or superseded: one answer for all, S54). Sign links
 * (C28), offer links (C7) and portal links of either purpose (C35, S67).
 */
export async function resolvePartyToken(ctx: SpaContext, token: string): Promise<PartyScope | null> {
  if (!token || token.length > 200) return null;
  const db = ctx.database.db;
  const [s] = await db
    .select({ s: signatures, e: signingEnvelopes })
    .from(signatures)
    .innerJoin(signingEnvelopes, eq(signingEnvelopes.id, signatures.envelopeId))
    .where(eq(signatures.linkTokenHash, hashLinkToken(token)));
  if (s) {
    if (s.e.status === "superseded" || s.s.linkUsedAt || s.s.signedAt) return null;
    if (s.s.linkExpiresAt.getTime() < ctx.clock.now().getTime()) return null;
    const all = await db.select().from(signatures).where(eq(signatures.envelopeId, s.s.envelopeId));
    return {
      kind: "sign",
      partyId: s.s.partyId,
      role: ROLE[s.s.role],
      dealId: s.e.dealId,
      offerId: null,
      principal: hashLinkToken(token),
      yourTurn: all.every((x) => x.seq >= s.s.seq || x.signedAt),
    };
  }
  const portal = await resolvePortalToken(ctx, token);
  if (portal)
    return {
      kind: "portal",
      partyId: portal.partyId,
      role: portal.role,
      dealId: portal.dealId,
      offerId: null,
      principal: portal.principal,
      yourTurn: null,
    };
  const [o] = await db
    .select({ link: offerLinks, offer: offers })
    .from(offerLinks)
    .innerJoin(offers, eq(offers.id, offerLinks.offerId))
    .where(eq(offerLinks.tokenHash, hashToken(token)));
  if (!o || o.link.answer || o.offer.status !== "SENT") return null;
  return {
    kind: "offer",
    partyId: o.link.sellerPartyId,
    role: "seller",
    dealId: null,
    offerId: o.offer.id,
    principal: o.link.tokenHash,
    yourTurn: null,
  };
}

const OFFER_WORDS = {
  SENT: "An offer is waiting for your answer.",
  ACCEPTED: "The offer was accepted.",
  REJECTED: "The offer was not accepted.",
  EXPIRED: "The offer has expired.",
} as const;

const BRING = [
  "Your original passport or Emirates ID",
  "For a company: the signatory's documents and any power of attorney your agent has asked for",
  "Anything else your agent tells you to bring",
];

/** The agent to email: the listing's agent, else the deal's owner (a user), else nobody. */
async function agentFor(
  ctx: SpaContext,
  s: PartyScope,
): Promise<{ email: string; ref: string; property: string; partyName: string } | null> {
  const db = ctx.database.db;
  let userId: string | null = null;
  let ref = "";
  let property = "";
  if (s.dealId) {
    const [d] = await db.select().from(deals).where(eq(deals.id, s.dealId));
    if (!d) return null;
    ref = d.ref;
    property = await propertyLabel({ db }, d);
    if (d.listingId) {
      const [l] = await db.select({ a: listings.agentUserId }).from(listings).where(eq(listings.id, d.listingId));
      userId = l?.a ?? null;
    }
    if (!userId && d.createdBy.startsWith("user:") && /^[0-9a-f-]{36}$/.test(d.createdBy.slice(5)))
      userId = d.createdBy.slice(5);
  } else if (s.offerId) {
    const [o] = await db
      .select({ l: listings })
      .from(offers)
      .innerJoin(listings, eq(listings.id, offers.listingId))
      .where(eq(offers.id, s.offerId));
    if (!o) return null;
    ref = o.l.ref;
    property = o.l.title ?? o.l.ref;
    userId = o.l.agentUserId;
  }
  if (!userId) return null;
  const [u] = await db
    .select({ email: spaUsers.email })
    .from(spaUsers)
    .where(and(eq(spaUsers.id, userId), eq(spaUsers.active, true)));
  if (!u) return null;
  const [p] = await db.select({ n: parties.fullNameEn }).from(parties).where(eq(parties.id, s.partyId));
  return { email: u.email, ref, property, partyName: p?.n ?? "A party" };
}

/** The tools' side: each method reads the token's own deal and party and nothing else. */
export function partyBackend(ctx: SpaContext, s: PartyScope, threadId: string): PartyBackend {
  const db = ctx.database.db;
  const deal = async (): Promise<DealRow | null> => {
    if (!s.dealId) return null;
    const [d] = await db.select().from(deals).where(eq(deals.id, s.dealId));
    return d ?? null;
  };
  return {
    async my_deal_status() {
      if (s.kind === "offer") {
        const [o] = await db
          .select({ offer: offers, title: listings.title })
          .from(offers)
          .innerJoin(listings, eq(listings.id, offers.listingId))
          .where(eq(offers.id, s.offerId!));
        if (!o) return { found: false };
        return {
          found: true,
          step: "Offer",
          status: OFFER_WORDS[o.offer.status],
          property: o.title ?? "the property",
          offerPriceFils: o.offer.priceFils,
          offerPrice: formatAed(o.offer.priceFils),
          answerBy: o.offer.validUntil,
        };
      }
      const d = await deal();
      if (!d) return { found: false };
      const flags = {
        sellerMortgage: d.sellerMortgage,
        buyerMortgage: d.buyerMortgage,
        planTakenOver: d.planTakenOver,
      };
      const step = stepsFor(d.dealType, flags).find((x) => x.states.includes(d.state));
      return {
        found: true,
        ref: d.ref,
        property: await propertyLabel({ db }, d),
        step: step?.label ?? null,
        status: PARTY_STATE_WORDS[d.state],
        yourRole: s.role,
        ...(s.yourTurn === null ? {} : { yourTurnToSign: s.yourTurn }),
        agreedPriceFils: d.priceFils,
        agreedPrice: formatAed(d.priceFils),
      };
    },
    async my_missing_documents() {
      const d = await deal();
      if (!d) return { items: [] };
      const mine = (await openChaseItems(db, d, ctx.clock.today())).find((p) => p.partyId === s.partyId);
      return {
        items: (mine?.items ?? []).map((i) =>
          i.reason === "additional_documents"
            ? { reason: CHASE_REASONS.additional_documents }
            : { document: i.label, reason: CHASE_REASONS[i.reason] },
        ),
      };
    },
    async my_payments() {
      const d = await deal();
      if (!d || s.role !== "buyer") return { applies: false };
      const rows = await planCoverage(db, d.id);
      return {
        applies: true,
        instalments: rows.map((r) => ({
          label: r.label,
          dueOn: r.dueOn,
          milestone: r.milestone,
          amountFils: r.amountFils,
          amount: formatAed(r.amountFils),
          recordedFils: r.paidFils,
          recorded: formatAed(r.paidFils),
        })),
      };
    },
    async transfer_day_info() {
      const d = await deal();
      return {
        targetDate: d?.targetTransferOn ?? null,
        note: "Your agent sets the target date and it can change. Ask your agent to confirm it.",
        bring: BRING,
      };
    },
    async explain_step(a) {
      const text = (PARTY_GLOSSARY as Record<string, string>)[a.step];
      if (!text) throw new Error("no such step");
      return { step: a.step, text };
    },
    async contact_agent(question) {
      if (!ctx.mail) return { sent: false, reason: "mail_unavailable" };
      const within = await takeRateLimit(ctx, {
        key: s.principal,
        bucket: `party-contact:${dayBucket(ctx)}`,
        limit: PARTY_CONTACTS_PER_DAY,
      });
      if (!within) return { sent: false, reason: "daily_limit" };
      const agent = await agentFor(ctx, s);
      if (!agent) return { sent: false, reason: "no_agent" };
      const r = await sendSpaMail(ctx, {
        entityKind: "party_question",
        entityId: threadId,
        purpose: "notice",
        milestone: `q:${newId()}`,
        to: agent.email,
        parts: partyQuestionMail({
          ref: agent.ref,
          property: agent.property,
          role: s.role === "broker" ? "buyer" : s.role,
          partyName: agent.partyName,
          question: question.slice(0, 2000),
        }),
      });
      return r.status === "sent" ? { sent: true } : { sent: false, reason: "mail_failed" };
    },
  };
}

export interface AssistantReply {
  threadId: string;
  reply: string;
  kind: string;
  verified: boolean;
  unverified: string[];
}

/** One message to the party assistant. Null: no such link. Throws `rate_limited` over the hourly limit. */
export async function runPartyAssistant(
  ctx: SpaContext,
  rt: AssistantRuntime,
  input: { token: string; text: string },
): Promise<AssistantReply | null> {
  const scope = await resolvePartyToken(ctx, input.token);
  if (!scope) return null;
  if (
    !(await takeRateLimit(ctx, {
      key: scope.principal,
      bucket: `party-chat:${hourBucket(ctx)}`,
      limit: PARTY_MESSAGES_PER_HOUR,
    }))
  )
    throw tooMany("too many messages, try again later");
  const threadId = await threadFor(ctx, {
    kind: "party",
    subjectId: `${scope.dealId ?? scope.offerId}:${scope.partyId}`,
    principal: scope.principal,
  });
  const history = await threadHistory(ctx, threadId);
  await storeUserMessage(ctx, threadId, input.text);
  const result = await partyAssistantTurn(
    { model: rt.model, llm: rt.llm, ...(rt.timeoutMs ? { timeoutMs: rt.timeoutMs } : {}) },
    partyBackend(ctx, scope, threadId),
    { text: input.text, history },
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
