import { newId } from "@platform/kernel/ids";
import { LEAD_CLOSED_STATUSES, NewDealInput, type SpaActor, type SpaRole } from "@spa/core";
import {
  companies,
  companyDetails,
  dealParties,
  deals,
  parties,
  spaLeads,
  type SpaTx,
  units,
  withSpaTx,
} from "@spa/db";
import { bpsOfFloor, discountCheck, registrationFee, salesRulebookOn, type SalesRulebook } from "@spa/rulebook";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { proposeApproval } from "./approvals.ts";
import { setBroker } from "./brokers.ts";
import { resolveBuyers } from "./buyers.ts";
import type { SpaContext } from "./context.ts";
import { createDeal } from "./deals.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { unitListPrice } from "./inventory.ts";
import { requireSales, seesAllLeads } from "./leads.ts";
import { normaliseName } from "./names.ts";
import { companyKind } from "./parties.ts";
import { currentPolicy } from "./policy.ts";

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

export interface DealQuote {
  listPriceFils: number | null;
  priceFils: number | null;
  discountBps: number | null;
  maxDiscountBps: number;
  withinPolicy: boolean;
  bookingMinBps: number;
  bookingMinFils: number | null;
  bookingFils: number | null;
  bookingOk: boolean;
  dldFeeFils: number | null;
  dldFeePayer: string;
  commission: { buyerSideBps: number; sellerSideBps: number };
  reasons: string[];
}

/**
 * Every price, discount, booking and fee figure a primary deal's form shows (M6, S81): computed here from the pinned
 * rulebook and the current policy, never in the browser. Pure over its inputs.
 */
export function computeQuote(
  input: { listPriceFils: number | null; priceFils?: number | undefined; bookingFils?: number | undefined },
  rb: SalesRulebook,
  policy: { maxDiscountBps: number; commission: { buyerSideBps: number; sellerSideBps: number } },
): DealQuote {
  const price = input.priceFils ?? input.listPriceFils;
  const reasons: string[] = [];
  let discountBps: number | null = null;
  let withinPolicy = true;
  if (input.listPriceFils === null) {
    // No price list price to measure a discount against: any agreed price needs a manager's approval.
    reasons.push("This home has no published price-list price, so the agreed price needs a sales manager's approval.");
    withinPolicy = false;
  } else if (price !== null) {
    const d = discountCheck(input.listPriceFils, price, policy.maxDiscountBps);
    discountBps = d.discountBps;
    if (!d.ok) {
      withinPolicy = false;
      reasons.push(...d.reasons);
    }
  }
  const bookingMinFils = price === null ? null : bpsOfFloor(price, rb.minBookingBps);
  const bookingFils = input.bookingFils ?? null;
  const bookingOk = bookingFils === null || bookingMinFils === null || bookingFils >= bookingMinFils;
  if (!bookingOk) reasons.push(`The booking is below the minimum of ${rb.minBookingBps / 100}% of the price.`);
  const fee = price === null ? null : registrationFee(price, rb);
  return {
    listPriceFils: input.listPriceFils,
    priceFils: price,
    discountBps,
    maxDiscountBps: policy.maxDiscountBps,
    withinPolicy,
    bookingMinBps: rb.minBookingBps,
    bookingMinFils,
    bookingFils,
    bookingOk,
    dldFeeFils: fee?.ok ? fee.totalFils : null,
    dldFeePayer: rb.registrationFeePayer,
    commission: { buyerSideBps: policy.commission.buyerSideBps, sellerSideBps: policy.commission.sellerSideBps },
    reasons,
  };
}

const QuoteQuery = z.object({
  unitId: z.uuid(),
  priceFils: z.coerce.number().int().positive().optional(),
  bookingFils: z.coerce.number().int().positive().optional(),
});

/** A primary deal is started by a sales role, in a company that has inventory (a brokerage has none). */
async function requireDealStarter(ctx: SpaContext, user: Person): Promise<void> {
  requireSales(user);
  if ((await companyKind(ctx.database.db)) === "brokerage") throw forbidden("this company keeps listings, not units");
}

/** `GET /api/deals/quote`: the figures for one unit at one price and booking. Sales roles only. */
export async function quoteDeal(ctx: SpaContext, user: Person, query: unknown): Promise<DealQuote> {
  await requireDealStarter(ctx, user);
  const q = QuoteQuery.safeParse(query);
  if (!q.success) throw unprocessable("invalid_quote", "send a unit and, optionally, a price and booking in fils");
  const db = ctx.database.db;
  const [u] = await db.select({ id: units.id }).from(units).where(eq(units.id, q.data.unitId));
  if (!u) throw notFound("unit");
  const rb = salesRulebookOn("dubai", ctx.clock.today());
  if (!rb) throw conflict("no_rulebook", `no sales rulebook is in force on ${ctx.clock.today()}`);
  const policy = (await currentPolicy(db)).values;
  const listed = await unitListPrice(db, q.data.unitId);
  return computeQuote({ listPriceFils: listed?.priceFils ?? null, ...q.data }, rb, policy);
}

/**
 * The developer's own party, the seller of every primary deal (S81): the party the company's earlier primary deals used,
 * else the company party named like the install's company. None: no deal (409), because a party made up here would carry
 * licence details nobody gave.
 */
async function developerParty(tx: SpaTx): Promise<string> {
  const [prior] = await tx.db
    .select({ id: dealParties.partyId })
    .from(dealParties)
    .innerJoin(deals, eq(deals.id, dealParties.dealId))
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(deals.dealType, "primary_offplan"), eq(dealParties.role, "seller"), eq(parties.kind, "company")))
    .orderBy(desc(deals.createdAt))
    .limit(1);
  if (prior) return prior.id;
  const [company] = await tx.db.select({ name: companies.name }).from(companies).limit(1);
  const named = await tx.db
    .select({ id: parties.id, name: parties.fullNameEn })
    .from(parties)
    .innerJoin(companyDetails, eq(companyDetails.partyId, parties.id));
  const match = company ? named.find((p) => normaliseName(p.name) === normaliseName(company.name)) : undefined;
  if (!match)
    throw conflict(
      "developer_party_missing",
      "the developer's company details aren't on file yet: add the developer as a company party first",
    );
  return match.id;
}

/** floor(booking x 10000 / price) by BigInt: the share a below-minimum booking asks the manager to approve. */
const shareBpsOf = (bookingFils: number, priceFils: number): number =>
  Number((BigInt(bookingFils) * 10_000n) / BigInt(priceFils));

/**
 * Starts a primary deal from an available unit (M6, S81): the buyers are created in the same transaction, the developer
 * is the seller, the deal opens in `OFFER_AGREED` with the unit HELD. A price outside the allowed discount, or a booking
 * below the rulebook's minimum, still creates the deal and opens `price_out_of_range` for a sales manager; until it is
 * approved the deal can't take its first step. A broker is set in the same transaction. A lead is converted and linked.
 */
export async function startDeal(
  ctx: SpaContext,
  input: unknown,
  user: Person,
): Promise<{ id: string; ref: string; gates: string[]; reasons: string[] }> {
  await requireDealStarter(ctx, user);
  const parsed = NewDealInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_deal",
      "the deal isn't valid",
      parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
    );
  const d = parsed.data;
  const actor: SpaActor = `user:${user.id}`;
  return withSpaTx(ctx.database, async (tx) => {
    // The unit's row is the lock: a second agent starting a deal on it waits, then sees the first one's deal (409).
    const [unit] = await tx.db.select({ id: units.id }).from(units).where(eq(units.id, d.unitId)).for("update");
    if (!unit) throw notFound("unit");
    const [open] = await tx.db
      .select({ id: deals.id, ref: deals.ref })
      .from(deals)
      .where(and(eq(deals.unitId, d.unitId), notInArray(deals.state, ["HANDED_OVER", "COMPLETED", "CANCELLED"])))
      .limit(1);
    if (open) throw conflict("open_deal_exists", `deal ${open.ref} is already open on this home`, [open.id, open.ref]);
    const rb = salesRulebookOn("dubai", ctx.clock.today());
    if (!rb) throw conflict("no_rulebook", `no sales rulebook is in force on ${ctx.clock.today()}`);
    const policy = (await currentPolicy(tx.db)).values;
    const listed = await unitListPrice(tx.db, d.unitId);
    const priceFils = d.priceFils ?? listed?.priceFils;
    if (priceFils === undefined)
      throw unprocessable("no_price", "this home has no price-list price: enter the agreed price");
    if (d.bookingFils !== undefined && d.bookingFils > priceFils)
      throw unprocessable("invalid_deal", "the booking can't be more than the price");
    const quote = computeQuote(
      { listPriceFils: listed?.priceFils ?? null, priceFils: d.priceFils, bookingFils: d.bookingFils },
      rb,
      policy,
    );
    const lead = d.leadId ? await readLead(tx, d.leadId, user, { kind: "unit", id: d.unitId }) : null;
    const buyers = await resolveBuyers(tx, ctx, d.buyers, actor);
    const developerId = await developerParty(tx);
    const made = await createDeal(
      ctx,
      {
        dealType: "primary_offplan",
        sellerMortgage: false,
        buyerMortgage: d.buyerMortgage,
        planTakenOver: false,
        unitId: d.unitId,
        ...(d.priceFils !== undefined ? { priceFils: d.priceFils } : {}),
        parties: [
          ...buyers.map((b) => ({ role: "buyer" as const, ...b })),
          { role: "seller" as const, partyId: developerId, order: 1, shareBps: 10_000 },
        ],
      },
      actor,
      { tx },
    );
    const gates: string[] = [];
    if (!quote.withinPolicy) {
      await proposeApproval(
        ctx,
        {
          gate: "price_out_of_range",
          entity: { kind: "deal", id: made.id },
          dedupeKey: `${made.id}:price`,
          title: "Price outside the allowed discount",
          proposal: {
            kind: "price",
            priceFils,
            listPriceFils: quote.listPriceFils,
            discountBps: quote.discountBps,
            maxDiscountBps: quote.maxDiscountBps,
          },
          reasons: quote.reasons.filter((r) => !r.startsWith("The booking")),
          proposedBy: actor,
        },
        tx,
      );
      gates.push("price_out_of_range");
    }
    if (!quote.bookingOk && d.bookingFils !== undefined) {
      await proposeApproval(
        ctx,
        {
          gate: "price_out_of_range",
          entity: { kind: "deal", id: made.id },
          dedupeKey: `${made.id}:booking`,
          title: "Booking below the minimum",
          proposal: {
            kind: "booking",
            bookingFils: d.bookingFils,
            bookingBps: shareBpsOf(d.bookingFils, priceFils),
            minBookingBps: quote.bookingMinBps,
            priceFils,
          },
          reasons: quote.reasons.filter((r) => r.startsWith("The booking")),
          proposedBy: actor,
        },
        tx,
      );
      if (!gates.includes("price_out_of_range")) gates.push("price_out_of_range");
    }
    if (d.broker) {
      const agencyId = newId();
      await tx.db.insert(parties).values({
        id: agencyId,
        kind: "company",
        fullNameEn: d.broker.agencyName,
        email: d.broker.agencyEmail,
        createdAt: ctx.clock.now(),
      });
      await appendDealEvent(tx, ctx, {
        entity: { kind: "party", id: agencyId },
        type: "PARTY_CREATED",
        actor,
        payload: { kind: "company" },
      });
      await setBroker(
        ctx,
        made.id,
        {
          side: "buyer",
          agencyPartyId: agencyId,
          agentName: d.broker.agentName,
          orn: d.broker.orn,
          brn: d.broker.brn,
          ...(d.broker.commissionBps !== undefined ? { commissionBps: d.broker.commissionBps } : {}),
        },
        actor,
        { tx },
      );
      // A commission other than the policy's opens its own `price_out_of_range` inside setBroker.
      if (d.broker.commissionBps !== undefined && !gates.includes("price_out_of_range")) {
        const policyBps = policy.commission.buyerSideBps;
        if (d.broker.commissionBps !== policyBps) gates.push("price_out_of_range");
      }
    }
    if (lead) {
      await tx.db
        .update(spaLeads)
        .set({ status: "converted", dealId: made.id, updatedAt: ctx.clock.now() })
        .where(eq(spaLeads.id, lead.id));
      await appendDealEvent(tx, ctx, {
        entity: { kind: "lead", id: lead.id },
        type: "LEAD_STATUS",
        fromState: lead.status,
        toState: "converted",
        actor,
        payload: { dealId: made.id },
      });
    }
    return { id: made.id, ref: made.ref, gates, reasons: quote.reasons };
  });
}

/** A lead a deal or offer starts from: the user may see it, it is open, and it is about this very home. */
export async function readLead(
  tx: SpaTx,
  leadId: string,
  user: Person,
  property: { kind: "unit" | "listing"; id: string },
) {
  const [lead] = await tx.db.select().from(spaLeads).where(eq(spaLeads.id, leadId)).for("update");
  if (!lead) throw notFound("lead");
  if (!seesAllLeads(user) && lead.agentUserId !== user.id) throw forbidden("this lead is assigned to someone else");
  if ((LEAD_CLOSED_STATUSES as readonly string[]).includes(lead.status))
    throw conflict("lead_finished", "this lead is already closed or converted");
  const same = property.kind === "unit" ? lead.unitId === property.id : lead.listingId === property.id;
  if (!same) throw unprocessable("lead_mismatch", "this lead is about another home");
  return lead;
}
