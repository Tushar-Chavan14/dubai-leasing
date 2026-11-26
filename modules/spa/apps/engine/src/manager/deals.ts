import { newId } from "@platform/kernel/ids";
import { DealInput, type SpaActor } from "@spa/core";
import { salesRulebookOn } from "@spa/rulebook";
import { dealParties, deals, listingParties, listings, offers, parties, type SpaTx, withSpaTx } from "@spa/db";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { moveProperty } from "./advance.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { unitListPrice } from "./inventory.ts";
import { currentPolicy } from "./policy.ts";

/**
 * Opens a deal in `OFFER_AGREED` (S13, S35): a primary deal holds its unit; a resale moves its listing under offer
 * (or keeps it there when an offer was accepted). Its parties must exist and are stored in `deal_parties` (C4).
 */
export async function createDeal(
  ctx: SpaContext,
  input: unknown,
  actor: SpaActor,
  /** Internal: accepting an offer creates its deal inside the answer's transaction (C7). */
  opts: { tx?: SpaTx; fromOfferId?: string } = {},
): Promise<{ id: string; ref: string }> {
  const parsed = DealInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_deal",
      "the deal isn't valid",
      parsed.error.issues.map((i) => i.message),
    );
  const d = parsed.data;
  const run = async (tx: SpaTx) => {
    // One open deal per unit or listing (final review #3; a partial unique index backs it).
    const open = await tx.db
      .select({ ref: deals.ref })
      .from(deals)
      .where(
        and(
          d.unitId ? eq(deals.unitId, d.unitId) : eq(deals.listingId, d.listingId!),
          notInArray(deals.state, ["HANDED_OVER", "COMPLETED", "CANCELLED"]),
        ),
      )
      .limit(1);
    if (open.length) throw conflict("open_deal_exists", `deal ${open[0]!.ref} is already open on this property`);
    if (d.listingId) {
      // A listing's open offer decides who buys (S18): only accepting it creates the deal.
      const [sent] = await tx.db
        .select({ id: offers.id })
        .from(offers)
        .where(and(eq(offers.listingId, d.listingId), eq(offers.status, "SENT")));
      if (sent && sent.id !== opts.fromOfferId)
        throw conflict("open_offer_exists", "this listing has an open offer; answer it first");
      // Resale sellers are exactly the listing's sellers (every co-owner, S14).
      const listed = await tx.db
        .select({ id: listingParties.partyId })
        .from(listingParties)
        .where(eq(listingParties.listingId, d.listingId));
      const want = listed.map((l) => l.id).toSorted();
      const got = d.parties
        .filter((p) => p.role === "seller")
        .map((p) => p.partyId)
        .toSorted();
      if (want.length !== got.length || want.some((w, i) => w !== got[i]))
        throw unprocessable("sellers_not_listing", "the deal's sellers must be the listing's sellers");
    }
    // The price (S64): a price typed on the deal is the agreed price and is kept (a discount is checked elsewhere);
    // a primary deal that names none takes the unit's price-list price; with neither, no deal.
    const listed = d.unitId ? await unitListPrice(tx.db, d.unitId) : null;
    const priceFils = d.priceFils ?? listed?.priceFils;
    if (priceFils === undefined)
      throw unprocessable("no_price", "this unit has no price-list price: enter the agreed price");
    // Pin the rulebook in force today (Dubai date) and the current policy (C3). No rulebook → no deal.
    const rb = salesRulebookOn("dubai", ctx.clock.today());
    if (!rb) throw conflict("no_rulebook", `no sales rulebook is in force on ${ctx.clock.today()}`);
    const policy = await currentPolicy(tx.db);
    const ids = [...new Set(d.parties.map((p) => p.partyId))];
    const known = await tx.db.select({ id: parties.id }).from(parties).where(inArray(parties.id, ids));
    if (known.length !== ids.length) throw unprocessable("unknown_party", "a party on the deal doesn't exist");
    const id = newId();
    const [row] = await tx.db
      .insert(deals)
      .values({
        id,
        dealType: d.dealType,
        sellerMortgage: d.sellerMortgage,
        buyerMortgage: d.buyerMortgage,
        planTakenOver: d.planTakenOver,
        unitId: d.unitId ?? null,
        listingId: d.listingId ?? null,
        priceFils,
        rulesVersion: rb.version,
        policyVersion: policy.version,
        createdBy: actor,
        createdAt: ctx.clock.now(),
      })
      .returning({ ref: deals.ref });
    await tx.db.insert(dealParties).values(
      d.parties.map((p) => ({
        dealId: id,
        partyId: p.partyId,
        role: p.role,
        order: p.order,
        shareBps: p.shareBps ?? null,
      })),
    );
    const step = { actor, rulesVersion: rb.version, payload: { dealId: id } };
    if (d.unitId) await moveProperty(ctx, tx, { kind: "unit", id: d.unitId }, "HOLD", step);
    else if (d.listingId) {
      const [l] = await tx.db.select().from(listings).where(eq(listings.id, d.listingId)).for("update");
      if (!l) throw notFound("listing");
      if (l.state !== "UNDER_OFFER") {
        if (l.state !== "ACTIVE" && l.state !== "PUBLISHED")
          throw conflict("transition_not_allowed", `a listing in ${l.state} can't start a deal`);
        await moveProperty(ctx, tx, { kind: "listing", id: d.listingId }, "OFFER_OPENED", step);
      }
    }
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id },
      type: "DEAL_CREATED",
      rulesVersion: rb.version,
      toState: "OFFER_AGREED",
      actor,
      payload: {
        dealType: d.dealType,
        priceFils,
        priceSource: d.priceFils === undefined ? "price_list" : "deal",
        ...(listed ? { listPriceFils: listed.priceFils, priceListVersion: listed.version } : {}),
        sellerMortgage: d.sellerMortgage,
        buyerMortgage: d.buyerMortgage,
        planTakenOver: d.planTakenOver,
        policyVersion: policy.version,
        parties: {
          buyers: d.parties.filter((p) => p.role === "buyer").length,
          sellers: d.parties.filter((p) => p.role === "seller").length,
        },
      },
    });
    return { id, ref: row!.ref };
  };
  return opts.tx ? run(opts.tx) : withSpaTx(ctx.database, run);
}
