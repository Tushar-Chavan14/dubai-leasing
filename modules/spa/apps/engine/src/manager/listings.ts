import { newId } from "@platform/kernel/ids";
import { ListingInput, type ListingEvent, type SpaActor, type SpaRole } from "@spa/core";
import { listingOwners, listingParties, listings, listingSignatures, parties, withSpaTx } from "@spa/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { type AdvanceResult, moveProperty } from "./advance.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { matchOwners } from "@spa/helpers";
import { requireListings } from "./listing-reads.ts";
import { normaliseName, ownershipKey } from "./names.ts";

export { normaliseName } from "./names.ts";

/**
 * The listing the public page and the listing chat may show (S38, S61): `PUBLISHED` with a permit valid today. One
 * function for both, so the chat can never talk about a listing the page would hide. Null otherwise.
 */
export async function findPublicListing(ctx: SpaContext, ref: string): Promise<typeof listings.$inferSelect | null> {
  const [l] = await ctx.database.db
    .select()
    .from(listings)
    .where(and(eq(listings.ref, ref), eq(listings.state, "PUBLISHED")));
  if (!l?.permitExpiresOn || l.permitExpiresOn < ctx.clock.today()) return null;
  return l;
}

/** A brokerage listing in `DRAFT` with its seller parties (every co-owner, S14). */
export async function createListing(
  ctx: SpaContext,
  input: unknown,
  actor: SpaActor,
): Promise<{ id: string; ref: string }> {
  const parsed = ListingInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_listing",
      "the listing isn't valid",
      parsed.error.issues.map((i) => i.message),
    );
  const l = parsed.data;
  return withSpaTx(ctx.database, async (tx) => {
    const ids = l.sellers.map((s) => s.partyId);
    const known = await tx.db.select({ id: parties.id }).from(parties).where(inArray(parties.id, ids));
    if (known.length !== new Set(ids).size)
      throw unprocessable("unknown_party", "a seller on the listing doesn't exist");
    const id = newId();
    const [row] = await tx.db
      .insert(listings)
      .values({
        id,
        // Refs always come from the sequence (C7: a caller's ref could collide or be guessed).
        askingPriceFils: l.askingPriceFils,
        title: l.title,
        description: l.propertyDescription,
        community: l.community,
        bedrooms: l.bedrooms ?? null,
        sizeSqft: l.sizeSqft ?? null,
        permitNo: l.permitNo ?? null,
        permitIssuedOn: l.permitIssuedOn ?? null,
        permitExpiresOn: l.permitExpiresOn ?? null,
        agentUserId: l.agentUserId ?? null,
        createdAt: ctx.clock.now(),
      })
      .returning({ ref: listings.ref });
    await tx.db
      .insert(listingParties)
      .values(
        l.sellers.map((s) => ({ listingId: id, partyId: s.partyId, order: s.order, shareBps: s.shareBps ?? null })),
      );
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id },
      type: "LISTING_CREATED",
      toState: "DRAFT",
      actor,
      payload: { askingPriceFils: l.askingPriceFils, sellers: l.sellers.length },
    });
    return { id, ref: row!.ref };
  });
}

/**
 * C32 (S64): a staff member adds a listing draft from the Listings screen. The three sales roles only, and only in a
 * brokerage or `both` company; the listing itself is made by the same `createListing` (C5) with the same checks.
 */
export async function createListingDraft(
  ctx: SpaContext,
  input: unknown,
  user: { id: string; role: SpaRole },
): Promise<{ id: string; ref: string }> {
  await requireListings(ctx.database.db, user, "write");
  return createListing(ctx, input, `user:${user.id}`);
}

// The C5 match lives in `@spa/helpers` so the ownership-check eval can run without the engine; it is the same function.
export { matchOwners };

const Ownership = z.object({
  kind: z.enum(["title_deed", "oqood"]),
  ref: z.string().trim().min(1).max(60),
  ownersAsOnDocument: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
});

/**
 * Records the ownership document's owners and matches them to the sellers by code (S14): same number, each name equal
 * after normalising. A mismatch opens `seller_verification` for the sales manager.
 */
export async function recordOwnership(
  ctx: SpaContext,
  listingId: string,
  input: unknown,
  actor: SpaActor,
): Promise<{ matched: boolean; approvalId?: string }> {
  const parsed = Ownership.safeParse(input);
  if (!parsed.success) throw unprocessable("invalid_ownership", "the ownership document isn't valid");
  const o = parsed.data;
  return withSpaTx(ctx.database, async (tx) => {
    const [l] = await tx.db.select().from(listings).where(eq(listings.id, listingId)).for("update");
    if (!l) throw notFound("listing");
    if (l.state !== "DRAFT" && l.state !== "VERIFIED")
      throw conflict("listing_not_editable", `ownership can't change on a ${l.state} listing`);
    const sellers = await tx.db
      .select({ name: parties.fullNameEn })
      .from(listingParties)
      .innerJoin(parties, eq(parties.id, listingParties.partyId))
      .where(eq(listingParties.listingId, listingId));
    const docNames = o.ownersAsOnDocument.map(normaliseName);
    if (docNames.some((n) => n === ""))
      throw unprocessable("invalid_ownership", "an owner's name on the document has no letters");
    const { reasons } = matchOwners(
      o.ownersAsOnDocument,
      sellers.map((s) => s.name),
    );
    const matched = reasons.length === 0;
    await tx.db.delete(listingOwners).where(eq(listingOwners.listingId, listingId));
    await tx.db
      .insert(listingOwners)
      .values(o.ownersAsOnDocument.map((n, i) => ({ listingId, order: i + 1, nameAsOnDocument: n })));
    await tx.db
      .update(listings)
      .set({ ownershipKind: o.kind, ownershipRef: o.ref, ownershipMatched: matched })
      .where(eq(listings.id, listingId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id: listingId },
      type: "OWNERSHIP_RECORDED",
      actor,
      payload: { kind: o.kind, owners: o.ownersAsOnDocument.length, matched },
    });
    if (matched) return { matched };
    const p = await proposeApproval(
      ctx,
      {
        gate: "seller_verification",
        entity: { kind: "listing", id: listingId },
        dedupeKey: `${listingId}:seller_verification`,
        title: "Owners on the document don't match the sellers",
        // The approval covers exactly this document and these owners (review #2).
        proposal: { ownershipKind: o.kind, documentKey: ownershipKey(o.kind, o.ref, o.ownersAsOnDocument) },
        reasons,
        proposedBy: actor,
      },
      tx,
    );
    return { matched, approvalId: p.id };
  });
}

/** A seller signed the listing agreement (recorded by staff until e-sign, C28). Every co-owner signs (S14). */
export async function recordListingSignature(
  ctx: SpaContext,
  listingId: string,
  partyId: string,
  actor: SpaActor,
): Promise<void> {
  await withSpaTx(ctx.database, async (tx) => {
    const [isSeller] = await tx.db
      .select()
      .from(listingParties)
      .where(and(eq(listingParties.listingId, listingId), eq(listingParties.partyId, partyId)));
    if (!isSeller) throw unprocessable("not_a_seller", "only a seller of this listing signs its agreement");
    const done = await tx.db
      .insert(listingSignatures)
      .values({ listingId, partyId, signedAt: ctx.clock.now() })
      .onConflictDoNothing()
      .returning({ partyId: listingSignatures.partyId });
    if (done.length)
      await appendDealEvent(tx, ctx, {
        entity: { kind: "listing", id: listingId },
        type: "LISTING_AGREEMENT_SIGNED",
        actor,
        payload: { partyId },
      });
  });
}

const OWN_STEPS: readonly ListingEvent[] = ["VERIFY", "ACTIVATE", "PUBLISH", "UNPUBLISH", "WITHDRAW"];

/** A listing's own steps. Offer and sale steps move only with a deal (S35). */
export async function listingStep(
  ctx: SpaContext,
  listingId: string,
  event: "VERIFY" | "ACTIVATE" | "PUBLISH" | "UNPUBLISH" | "WITHDRAW",
  opts: { actor: SpaActor },
): Promise<AdvanceResult> {
  if (!OWN_STEPS.includes(event)) throw conflict("deal_only", `${event} happens only through a deal or an offer`);
  return withSpaTx(ctx.database, (tx) => moveProperty(ctx, tx, { kind: "listing", id: listingId }, event, opts));
}

/**
 * The daily permit sweep (S17, S38): every published listing whose permit's last valid day has passed is taken down.
 * Safe to run twice: an unpublished listing is no longer `PUBLISHED`.
 */
export async function expirePermits(ctx: SpaContext): Promise<{ unpublished: string[] }> {
  const today = ctx.clock.today();
  const due = await ctx.database.db
    .select({ id: listings.id })
    .from(listings)
    .where(and(eq(listings.state, "PUBLISHED"), lt(listings.permitExpiresOn, today)));
  const unpublished: string[] = [];
  for (const { id } of due) {
    // One listing failing never stops the rest; the next run retries it.
    await withSpaTx(ctx.database, async (tx) => {
      // Re-check under the row lock: another sweep or a person may have moved it meanwhile.
      const [row] = await tx.db.select().from(listings).where(eq(listings.id, id)).for("update");
      if (row?.state !== "PUBLISHED" || !row.permitExpiresOn || row.permitExpiresOn >= today) return;
      await moveProperty(ctx, tx, { kind: "listing", id }, "UNPUBLISH", {
        actor: "system:permit-expire",
        payload: { reason: "permit expired" },
      });
      unpublished.push(id);
    }).catch((e) => console.error(`permit sweep: listing ${id}:`, e instanceof Error ? e.message : e));
  }
  return { unpublished };
}
