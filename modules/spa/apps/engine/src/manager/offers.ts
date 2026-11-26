import { createHash, randomBytes } from "node:crypto";
import { addDays } from "@platform/kernel/dates";
import { newId } from "@platform/kernel/ids";
import { LEAD_CLOSED_STATUSES, MakeOfferInput, type SpaActor, type SpaRole, hasAnyRole } from "@spa/core";
import {
  deals,
  deposits,
  listingParties,
  listings,
  offerLinks,
  offerParties,
  offers,
  parties,
  spaLeads,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { offerAnswerLinkMail } from "@spa/helpers";
import { z } from "zod";
import { moveProperty } from "./advance.ts";
import type { SpaContext } from "./context.ts";
import { RECORDABLE } from "./deposit-states.ts";
import { createDeal } from "./deals.ts";
import { requireListings } from "./listing-access.ts";
import { SALES_ROLES } from "./leads.ts";
import { conflict, notFound, SpaDomainError, unavailable, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { sendSpaMail } from "./mail.ts";
import { normaliseName } from "./names.ts";
import { currentPolicy } from "./policy.ts";

const calDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const BuyerRefs = z
  .array(
    z.object({
      partyId: z.uuid(),
      order: z.number().int().min(1),
      shareBps: z.number().int().min(1).max(10_000).optional(),
    }),
  )
  .min(1);
const OfferBase = z.object({
  listingId: z.uuid(),
  /** The lead the offer is made for (M6): it converts only when the offer is accepted. */
  leadId: z.uuid().optional(),
  priceFils: z.number().int().positive(),
  buyerMortgage: z.boolean(),
  /** Required for an off-plan resale; a ready resale defaults both to false (S39 amendment). */
  sellerMortgage: z.boolean().optional(),
  planTakenOver: z.boolean().optional(),
  targetTransferOn: calDate.optional(),
  conditions: z.string().trim().max(1000).optional(),
  /** The last day the sellers can answer; default today + policy `offerValidityDays`. */
  validUntil: calDate.optional(),
});
const OfferInput = OfferBase.extend({ buyers: BuyerRefs });

const gone = (code: string, message: string) => new SpaDomainError(410, code, message);
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * Sends an offer on a listing (S18): one open offer at a time; the listing goes under offer; every seller gets a
 * single-use answer link, sent by email only (S54): the raw token exists in the email and nowhere else, and staff are
 * told only whether each mail went. Needs mail configured (503 `mail_unavailable` otherwise, nothing is created).
 */
export async function sendOffer(
  ctx: SpaContext,
  input: unknown,
  actor: SpaActor,
  /** Internal (M6): the buyers are created inside the offer's own transaction, so a refusal leaves no orphan party. */
  opts: {
    createBuyers?: (tx: SpaTx) => Promise<z.infer<typeof BuyerRefs>>;
    /** Checked inside the transaction with the listing locked, before anything is written. */
    beforeSend?: (tx: SpaTx) => Promise<void>;
  } = {},
): Promise<{ offerId: string; validUntil: string; emailed: { sellerPartyId: string; status: "sent" | "failed" }[] }> {
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so an offer can't be sent");
  const mail = ctx.mail;
  const parsed = (opts.createBuyers ? OfferBase : OfferInput).safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_offer",
      "the offer isn't valid",
      parsed.error.issues.map((i) => i.message),
    );
  const base = parsed.data as z.infer<typeof OfferBase> & { buyers?: z.infer<typeof BuyerRefs> };
  const made = await withSpaTx(ctx.database, async (tx) => {
    const [l] = await tx.db.select().from(listings).where(eq(listings.id, base.listingId)).for("update");
    if (!l) throw notFound("listing");
    const [open] = await tx.db
      .select({ id: offers.id })
      .from(offers)
      .where(and(eq(offers.listingId, l.id), eq(offers.status, "SENT")));
    if (open || l.state === "UNDER_OFFER")
      throw conflict("open_offer_exists", "this listing already has an open offer or deal");
    const offplan = l.ownershipKind === "oqood";
    if (offplan && (base.sellerMortgage === undefined || base.planTakenOver === undefined))
      throw unprocessable("invalid_offer", "an off-plan resale offer states sellerMortgage and planTakenOver");
    if (!offplan && base.planTakenOver)
      throw unprocessable("invalid_offer", "a plan can be taken over only on an off-plan resale");
    await opts.beforeSend?.(tx);
    const buyers = opts.createBuyers ? await opts.createBuyers(tx) : base.buyers!;
    const o = { ...base, buyers };
    const buyerIds = o.buyers.map((b) => b.partyId);
    const known = await tx.db.select({ id: parties.id }).from(parties).where(inArray(parties.id, buyerIds));
    if (known.length !== new Set(buyerIds).size) throw unprocessable("unknown_party", "a buyer doesn't exist");
    const sellers = await tx.db.select().from(listingParties).where(eq(listingParties.listingId, l.id));
    if (sellers.some((s) => buyerIds.includes(s.partyId)))
      throw unprocessable("invalid_offer", "a seller can't be a buyer on the same listing");
    if (!sellers.length) throw unprocessable("no_sellers", "the listing has no sellers to answer the offer");
    if (o.conditions) {
      // The public link shows the conditions and must never name a buyer (S39).
      const text = ` ${normaliseName(o.conditions)} `;
      const named = await tx.db.select({ name: parties.fullNameEn }).from(parties).where(inArray(parties.id, buyerIds));
      if (named.some((b) => normaliseName(b.name) && text.includes(` ${normaliseName(b.name)} `)))
        throw unprocessable("conditions_name_party", "the conditions can't name a buyer; the sellers' link shows them");
    }
    const policy = await currentPolicy(tx.db);
    const today = ctx.clock.today();
    const validUntil = o.validUntil ?? addDays(today, policy.values.offerValidityDays);
    if (validUntil < today) throw unprocessable("invalid_offer", "the offer can't be valid only in the past");
    const offerId = newId();
    await tx.db.insert(offers).values({
      id: offerId,
      listingId: l.id,
      priceFils: o.priceFils,
      buyerMortgage: o.buyerMortgage,
      sellerMortgage: o.sellerMortgage ?? false,
      planTakenOver: o.planTakenOver ?? false,
      targetTransferOn: o.targetTransferOn ?? null,
      conditions: o.conditions ?? null,
      leadId: o.leadId ?? null,
      validUntil,
      createdBy: actor,
      createdAt: ctx.clock.now(),
    });
    await tx.db
      .insert(offerParties)
      .values(o.buyers.map((b) => ({ offerId, partyId: b.partyId, order: b.order, shareBps: b.shareBps ?? null })));
    const links = sellers.map((s) => ({ sellerPartyId: s.partyId, token: randomBytes(32).toString("base64url") }));
    await tx.db
      .insert(offerLinks)
      .values(links.map((k) => ({ tokenHash: hashToken(k.token), offerId, sellerPartyId: k.sellerPartyId })));
    // Moves ACTIVE or PUBLISHED to UNDER_OFFER; any other state refuses (no offer on a draft or sold listing).
    await moveProperty(ctx, tx, { kind: "listing", id: l.id }, "OFFER_OPENED", { actor, payload: { offerId } });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id: l.id },
      type: "OFFER_SENT",
      actor,
      payload: {
        offerId,
        priceFils: o.priceFils,
        buyerMortgage: o.buyerMortgage,
        sellerMortgage: o.sellerMortgage ?? false,
        planTakenOver: o.planTakenOver ?? false,
        validUntil,
        buyers: o.buyers.length,
      },
    });
    const emails = await tx.db
      .select({ id: parties.id, email: parties.email })
      .from(parties)
      .where(
        inArray(
          parties.id,
          sellers.map((x) => x.partyId),
        ),
      );
    return {
      offerId,
      validUntil,
      title: l.title ?? l.ref,
      links: links.map((k) => ({ ...k, email: emails.find((e) => e.id === k.sellerPartyId)!.email })),
    };
  });
  // After the offer is committed: one email per seller. A failed mail is recorded and shown, and the offer stands.
  const emailed: { sellerPartyId: string; status: "sent" | "failed" }[] = [];
  for (const k of made.links) {
    const r = await sendSpaMail(
      { ...ctx, mail },
      {
        entityKind: "offer",
        entityId: made.offerId,
        purpose: "link",
        milestone: `answer:${k.sellerPartyId}`,
        to: k.email,
        parts: offerAnswerLinkMail({
          property: made.title,
          priceFils: base.priceFils,
          validUntil: made.validUntil,
          link: `${mail.webBaseUrl}/b/${k.token}/offer`,
        }),
      },
    );
    emailed.push({ sellerPartyId: k.sellerPartyId, status: r.status === "sent" ? "sent" : "failed" });
  }
  return { offerId: made.offerId, validUntil: made.validUntil, emailed };
}

async function closeOffer(
  ctx: SpaContext,
  tx: SpaTx,
  offerId: string,
  listingId: string,
  status: "REJECTED" | "EXPIRED" | "WITHDRAWN",
  actor: SpaActor,
  note?: string,
) {
  await tx.db.update(offers).set({ status }).where(eq(offers.id, offerId));
  await moveProperty(ctx, tx, { kind: "listing", id: listingId }, "OFFER_CLOSED", { actor, payload: { offerId } });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "listing", id: listingId },
    type: `OFFER_${status}`,
    actor,
    payload: { offerId, ...(note ? { reason: note } : {}) },
  });
}

/**
 * A seller answers through their link (S18, S39). One rejection rejects the offer and frees the listing; when every
 * seller has accepted, the deal is created at the offer price with the offer's buyers and the listing's sellers.
 */
export async function answerOffer(
  ctx: SpaContext,
  token: string,
  answer: "accept" | "reject",
): Promise<{ status: string; dealId?: string }> {
  return withSpaTx(ctx.database, async (tx) => {
    const [link] = await tx.db
      .select()
      .from(offerLinks)
      .where(eq(offerLinks.tokenHash, hashToken(token)))
      .for("update");
    if (!link) throw notFound("offer link");
    if (link.answer) throw gone("link_used", "this link has already been used");
    const [offer] = await tx.db.select().from(offers).where(eq(offers.id, link.offerId)).for("update");
    if (!offer) throw notFound("offer");
    if (offer.status !== "SENT") throw gone("offer_closed", `this offer is ${offer.status.toLowerCase()}`);
    if (offer.validUntil < ctx.clock.today()) throw gone("offer_expired", "this offer has expired");
    const actor: SpaActor = `party:${link.sellerPartyId}`;
    await tx.db
      .update(offerLinks)
      .set({ answer, answeredAt: ctx.clock.now() })
      .where(eq(offerLinks.tokenHash, link.tokenHash));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id: offer.listingId },
      type: "OFFER_ANSWERED",
      actor,
      payload: { offerId: offer.id, answer },
    });
    if (answer === "reject") {
      await closeOffer(ctx, tx, offer.id, offer.listingId, "REJECTED", actor);
      return { status: "REJECTED" };
    }
    const all = await tx.db.select().from(offerLinks).where(eq(offerLinks.offerId, offer.id));
    if (!all.every((k) => k.answer === "accept")) return { status: "SENT" };
    const [l] = await tx.db.select().from(listings).where(eq(listings.id, offer.listingId));
    const buyers = await tx.db.select().from(offerParties).where(eq(offerParties.offerId, offer.id));
    const sellers = await tx.db.select().from(listingParties).where(eq(listingParties.listingId, offer.listingId));
    const deal = await createDeal(
      ctx,
      {
        dealType: l?.ownershipKind === "oqood" ? "resale_offplan" : "resale_ready",
        sellerMortgage: offer.sellerMortgage,
        buyerMortgage: offer.buyerMortgage,
        planTakenOver: offer.planTakenOver,
        listingId: offer.listingId,
        priceFils: offer.priceFils,
        parties: [
          ...buyers.map((b) => ({
            role: "buyer" as const,
            partyId: b.partyId,
            order: b.order,
            ...(b.shareBps ? { shareBps: b.shareBps } : {}),
          })),
          ...sellers.map((s) => ({
            role: "seller" as const,
            partyId: s.partyId,
            order: s.order,
            ...(s.shareBps ? { shareBps: s.shareBps } : {}),
          })),
        ],
      },
      actor,
      { tx, fromOfferId: offer.id },
    );
    await tx.db.update(offers).set({ status: "ACCEPTED", dealId: deal.id }).where(eq(offers.id, offer.id));
    // M6 (S81): the lead the offer was made for converts only now, when every seller accepted.
    if (offer.leadId) {
      const [lead] = await tx.db.select().from(spaLeads).where(eq(spaLeads.id, offer.leadId)).for("update");
      if (lead && !LEAD_CLOSED_STATUSES.includes(lead.status)) {
        await tx.db
          .update(spaLeads)
          .set({ status: "converted", dealId: deal.id, updatedAt: ctx.clock.now() })
          .where(eq(spaLeads.id, lead.id));
        await appendDealEvent(tx, ctx, {
          entity: { kind: "lead", id: lead.id },
          type: "LEAD_STATUS",
          fromState: lead.status,
          toState: "converted",
          actor,
          payload: { dealId: deal.id, offerId: offer.id },
        });
      }
    }
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id: offer.listingId },
      type: "OFFER_ACCEPTED",
      actor,
      payload: { offerId: offer.id, dealId: deal.id },
    });
    return { status: "ACCEPTED", dealId: deal.id };
  });
}

/** What a seller's link shows (S39): the offer's terms and the listing title; never a buyer's or seller's name. */
export async function offerLinkSummary(ctx: SpaContext, token: string) {
  const [row] = await ctx.database.db
    .select({ offer: offers, title: listings.title })
    .from(offerLinks)
    .innerJoin(offers, eq(offers.id, offerLinks.offerId))
    .innerJoin(listings, eq(listings.id, offers.listingId))
    .where(eq(offerLinks.tokenHash, hashToken(token)));
  if (!row) return null;
  return {
    status: row.offer.status,
    listingTitle: row.title,
    priceFils: row.offer.priceFils,
    buyerMortgage: row.offer.buyerMortgage,
    targetTransferOn: row.offer.targetTransferOn,
    conditions: row.offer.conditions,
    validUntil: row.offer.validUntil,
  };
}

/** The daily offer sweep: open offers past their last valid day expire and free the listing. Safe to run twice. */
export async function expireOffers(ctx: SpaContext): Promise<{ expired: string[] }> {
  const today = ctx.clock.today();
  const due = await ctx.database.db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.status, "SENT"), lt(offers.validUntil, today)));
  const expired: string[] = [];
  for (const { id } of due) {
    await withSpaTx(ctx.database, async (tx) => {
      const [o] = await tx.db.select().from(offers).where(eq(offers.id, id)).for("update");
      if (o?.status !== "SENT" || o.validUntil >= today) return;
      await closeOffer(ctx, tx, o.id, o.listingId, "EXPIRED", "system:offer-expire");
      expired.push(id);
    }).catch((e) => console.error(`offer sweep: offer ${id}:`, e instanceof Error ? e.message : e));
  }
  return { expired };
}

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

/**
 * Makes an offer on a resale listing from the staff screen (M6, S81): the buyers are created in the offer's own
 * transaction, then the normal `sendOffer` runs (one open offer, every seller gets a single-use emailed link). The
 * deposit is the pinned policy's % when the cheque is recorded; it is not typed here. A lead is linked and converts only
 * when every seller accepts.
 */
export async function makeOffer(ctx: SpaContext, input: unknown, user: Person) {
  // The sales roles, in a company that keeps listings: a developer-only company has no resale.
  await requireListings(ctx.database.db, user, "write");
  const parsed = MakeOfferInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_offer",
      "the offer isn't valid",
      parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
    );
  // Loaded here, not at the top: these modules reach the listing screens, and offers.ts is read by an older chain of
  // imports (party-assistant) that a static import would turn into a cycle.
  const [{ resolveBuyers }, { readLead }] = await Promise.all([import("./buyers.ts"), import("./deal-start.ts")]);
  const { buyers, validDays, ...rest } = parsed.data;
  const actor: SpaActor = `user:${user.id}`;
  const validUntil = validDays === undefined ? undefined : addDays(ctx.clock.today(), validDays);
  return sendOffer(ctx, { ...rest, ...(validUntil ? { validUntil } : {}) }, actor, {
    createBuyers: (tx) => resolveBuyers(tx, ctx, buyers, actor),
    beforeSend: async (tx) => {
      if (rest.leadId) await readLead(tx, rest.leadId, user, { kind: "listing", id: rest.listingId });
    },
  });
}

/**
 * Withdraws a sent offer (M6, S81): the reason is kept in the event, the listing goes back to where it was and every
 * link stops working (an answer finds the offer closed). Only a SENT offer withdraws; nobody's answer is erased.
 */
export async function withdrawOffer(
  ctx: SpaContext,
  offerId: string,
  reason: unknown,
  user: Person,
  opts: { tx?: SpaTx; actor?: SpaActor } = {},
): Promise<void> {
  await requireListings(ctx.database.db, user, "write");
  const why = z.string().trim().min(3).max(500).safeParse(reason);
  if (!why.success) throw unprocessable("reason_required", "say why (3 to 500 characters)");
  const run = async (tx: SpaTx) => {
    const [o] = await tx.db.select().from(offers).where(eq(offers.id, offerId)).for("update");
    if (!o) throw notFound("offer");
    if (o.status !== "SENT") throw conflict("offer_closed", `this offer is ${o.status.toLowerCase()}`);
    await closeOffer(ctx, tx, o.id, o.listingId, "WITHDRAWN", opts.actor ?? `user:${user.id}`, why.data);
  };
  if (opts.tx) await run(opts.tx);
  else await withSpaTx(ctx.database, run);
}

/** A listing withdrawn while an offer is out withdraws that offer by code, in the same transaction (S81). */
export async function withdrawSentOfferFor(
  ctx: SpaContext,
  tx: SpaTx,
  listingId: string,
  actor: SpaActor,
): Promise<string | null> {
  const [o] = await tx.db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.listingId, listingId), eq(offers.status, "SENT")))
    .for("update");
  if (!o) return null;
  await closeOffer(ctx, tx, o.id, listingId, "WITHDRAWN", actor, "The listing was withdrawn.");
  return o.id;
}

const ANSWER_LABEL = { accept: "Accepted", reject: "Rejected" } as const;
const OFFER_LABEL: Record<string, string> = {
  SENT: "Waiting for the sellers",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
};

/**
 * A listing's offers, newest first (M6): terms, each seller's answer and, once accepted, the deal. The buyers' names and
 * emails go to the sales roles only; every other role gets the offers without them. Never a link or token.
 */
export async function listOffers(ctx: SpaContext, user: Person, listingId: string) {
  const db = ctx.database.db;
  await requireListings(db, user, "read");
  const [l] = await db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
  if (!l) throw notFound("listing");
  const sales = hasAnyRole(user, SALES_ROLES);
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.listingId, listingId))
    .orderBy(desc(offers.createdAt), desc(offers.id));
  const out = [];
  for (const o of rows) {
    const links = await db
      .select({ sellerPartyId: offerLinks.sellerPartyId, answer: offerLinks.answer, name: parties.fullNameEn })
      .from(offerLinks)
      .innerJoin(parties, eq(parties.id, offerLinks.sellerPartyId))
      .where(eq(offerLinks.offerId, o.id))
      .orderBy(asc(parties.fullNameEn));
    const buyers = sales
      ? await db
          .select({ name: parties.fullNameEn, email: parties.email, shareBps: offerParties.shareBps })
          .from(offerParties)
          .innerJoin(parties, eq(parties.id, offerParties.partyId))
          .where(eq(offerParties.offerId, o.id))
          .orderBy(asc(offerParties.order))
      : null;
    const [deal] = o.dealId
      ? await db.select({ id: deals.id, ref: deals.ref, state: deals.state }).from(deals).where(eq(deals.id, o.dealId))
      : [];
    // The security deposit the policy set for this deal: recorded (the amount, never the cheque number) or still to record.
    const [dep] = deal
      ? await db
          .select({ amountFils: deposits.amountFils, bank: deposits.bank, chequeOn: deposits.chequeOn })
          .from(deposits)
          .where(eq(deposits.dealId, deal.id))
      : [];
    out.push({
      id: o.id,
      status: o.status,
      statusLabel: OFFER_LABEL[o.status] ?? o.status,
      priceFils: o.priceFils,
      buyerMortgage: o.buyerMortgage,
      sellerMortgage: o.sellerMortgage,
      targetTransferOn: o.targetTransferOn,
      conditions: o.conditions,
      validUntil: o.validUntil,
      createdAt: o.createdAt.toISOString(),
      sellers: links.map((k) => ({
        name: sales ? k.name : "A seller",
        answer: k.answer ?? null,
        answerLabel: k.answer ? ANSWER_LABEL[k.answer] : "Waiting",
      })),
      buyers,
      deal: deal ? { id: deal.id, ref: deal.ref } : null,
      // The cheque details go to the sales roles only; every other reader gets neither the bank nor the date.
      deposit: sales ? (dep ?? null) : null,
      canRecordDeposit: sales && !!deal && !dep && RECORDABLE.has(deal.state),
      canWithdraw: sales && o.status === "SENT",
    });
  }
  const policy = (await currentPolicy(db)).values;
  return {
    offers: out,
    terms: { depositBps: policy.depositBps, validityDays: policy.offerValidityDays, validityMaxDays: 30 },
  };
}
