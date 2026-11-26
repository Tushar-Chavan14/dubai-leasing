import type { CalendarDate } from "@platform/kernel/dates";
import { newId } from "@platform/kernel/ids";
import { ListingDraftInput, ListingEdit, ListingInput, type ListingEvent, type ListingState, type BuyerInput, type SellerInput, type SpaActor, type SpaRole, hasAnyRole } from "@spa/core";
import {
  companyDetails,
  LISTING_DOCUMENT_KINDS,
  listingDocuments,
  listingOwners,
  listingParties,
  listings,
  listingSignatures,
  parties,
  signatories,
  spaUsers,
  type SpaDb,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { type AdvanceResult, moveProperty } from "./advance.ts";
import { proposeApproval, withdrawPendingApprovals } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, SpaDomainError, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { matchOwners } from "@spa/helpers";
import { requireListings } from "./listing-reads.ts";
import { normaliseName, ownershipKey } from "./names.ts";
import { type DocumentStore, MAX_DOCUMENT_BYTES, sniffFile } from "./noc.ts";

export { normaliseName } from "./names.ts";

/**
 * The listing the public page and the listing chat may show (S38, S61): `PUBLISHED` with a permit number printed and valid today. One
 * function for both, so the chat can never talk about a listing the page would hide. Null otherwise.
 */
export function isPublicListing(l: typeof listings.$inferSelect, today: CalendarDate): boolean {
  return l.state === "PUBLISHED" && !!l.permitNo?.trim() && !!l.permitExpiresOn && l.permitExpiresOn >= today;
}

export async function findPublicListing(ctx: SpaContext, ref: string): Promise<typeof listings.$inferSelect | null> {
  const [l] = await ctx.database.db
    .select()
    .from(listings)
    .where(and(eq(listings.ref, ref), eq(listings.state, "PUBLISHED")));
  return l && isPublicListing(l, ctx.clock.today()) ? l : null;
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
  return withSpaTx(ctx.database, (tx) => insertListing(tx, ctx, l, actor));
}

type NewListing = Omit<ListingInput, "sellers"> & {
  sellers: { partyId: string; order: number; shareBps?: number | undefined }[];
};

/** The listing row, its seller links and its `LISTING_CREATED` event, inside the caller's transaction. */
async function insertListing(
  tx: SpaTx,
  ctx: SpaContext,
  l: NewListing,
  actor: SpaActor,
): Promise<{ id: string; ref: string }> {
  const ids = l.sellers.map((s) => s.partyId);
  const known = await tx.db.select({ id: parties.id }).from(parties).where(inArray(parties.id, ids));
  if (known.length !== new Set(ids).size) throw unprocessable("unknown_party", "a seller on the listing doesn't exist");
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
      unitType: l.unitType ?? null,
      bathrooms: l.bathrooms ?? null,
      floor: l.floor ?? null,
      view: l.view ?? null,
      parkingSpaces: l.parkingSpaces ?? null,
      furnished: l.furnished ?? null,
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
}

/**
 * C32 (S64, S74): a staff member adds a listing draft from the Listings screen, with its sellers typed in (a new person or
 * company party each) or picked from existing parties. The three sales roles only, and only in a brokerage or `both`
 * company. Parties, signatories, the listing and its event are written in one transaction: nothing is left half-made.
 */
export async function createListingDraft(
  ctx: SpaContext,
  input: unknown,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ id: string; ref: string }> {
  await requireListings(ctx.database.db, user, "write");
  const parsed = ListingDraftInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable("invalid_listing", "the listing isn't valid", parsed.error.issues.map(issueText));
  const { sellers, ...fields } = parsed.data;
  const actor = `user:${user.id}` as const;
  const agent = fields.agentUserId;
  return withSpaTx(ctx.database, async (tx) => {
    if (agent) await requireAgent(tx.db, agent);
    const links: NewListing["sellers"] = [];
    for (const [i, s] of sellers.entries()) {
      const order = i + 1;
      if ("partyId" in s) {
        links.push({ partyId: s.partyId, order, shareBps: s.shareBps });
        continue;
      }
      const name = s.kind === "person" ? s.fullNameEn : s.tradeName;
      if (normaliseName(name) === "") throw unprocessable("invalid_listing", "a seller's name has no letters");
      const partyId = await insertSellerParty(tx, ctx, s, actor);
      links.push({ partyId, order, shareBps: s.shareBps });
    }
    return insertListing(tx, ctx, { ...fields, sellers: links }, actor);
  });
}

/** "path: message" so a form can put the sentence under the field it names. */
const issueText = (i: { path: PropertyKey[]; message: string }) =>
  i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;

/** The listing agent must be an active user with a sales role. */
async function requireAgent(db: SpaDb, userId: string): Promise<void> {
  const [u] = await db
    .select({ role: spaUsers.role, active: spaUsers.active })
    .from(spaUsers)
    .where(eq(spaUsers.id, userId));
  if (!u?.active || !hasAnyRole(u, SALES_AGENT_ROLES))
    throw unprocessable("invalid_listing", "pick an agent from the list");
}
const SALES_AGENT_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];

/** A new company's signatory has no authority document on file yet: this id points to none, so nothing can mistake it for one. */
const NO_AUTHORITY_DOCUMENT = "00000000-0000-0000-0000-000000000000";

export async function insertSellerParty(
  tx: SpaTx,
  ctx: SpaContext,
  s: SellerInput | BuyerInput,
  actor: SpaActor,
): Promise<string> {
  const partyId = newId();
  const now = ctx.clock.now();
  await tx.db.insert(parties).values({
    id: partyId,
    kind: s.kind,
    fullNameEn: s.kind === "person" ? s.fullNameEn : s.tradeName,
    nationality: s.kind === "person" ? (s.nationality ?? null) : null,
    email: s.email,
    phone: s.kind === "person" ? (s.phone ?? null) : null,
    createdAt: now,
  });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "party", id: partyId },
    type: "PARTY_CREATED",
    actor,
    payload: { kind: s.kind },
  });
  if (s.kind === "company") {
    await tx.db.insert(companyDetails).values({
      partyId,
      tradeName: s.tradeName,
      licenceNo: s.licenceNo,
      licenceExpiresOn: s.licenceExpiresOn,
      issuingAuthority: s.issuingAuthority,
    });
    // The signatory is a person party. Their authority document is added later (not part of M3).
    const personId = newId();
    await tx.db.insert(parties).values({
      id: personId,
      kind: "person",
      fullNameEn: s.signatory.fullNameEn,
      email: s.signatory.email,
      createdAt: now,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "party", id: personId },
      type: "PARTY_CREATED",
      actor,
      payload: { kind: "person" },
    });
    const signatoryId = newId();
    await tx.db.insert(signatories).values({
      id: signatoryId,
      companyPartyId: partyId,
      personPartyId: personId,
      title: "Authorised signatory",
      authority: s.signatory.authority,
      documentId: NO_AUTHORITY_DOCUMENT,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "party", id: partyId },
      type: "SIGNATORY_ADDED",
      actor,
      payload: { signatoryId, personPartyId: personId, authority: s.signatory.authority },
    });
  }
  return partyId;
}

const EDITABLE: readonly ListingState[] = ["DRAFT", "VERIFIED", "ACTIVE", "PUBLISHED"];

/**
 * S74: edits a listing's own fields (never its sellers). Allowed until an offer is open. Moving a published listing's
 * permit end into the past unpublishes it in the same transaction (S17). The event names the fields, not their values.
 */
export async function updateListing(
  ctx: SpaContext,
  listingId: string,
  input: unknown,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<void> {
  await requireListings(ctx.database.db, user, "write");
  const parsed = ListingEdit.safeParse(input);
  if (!parsed.success)
    throw unprocessable("invalid_listing", "the listing isn't valid", parsed.error.issues.map(issueText));
  const e = parsed.data;
  const actor = `user:${user.id}` as const;
  await withSpaTx(ctx.database, async (tx) => {
    const [l] = await tx.db.select().from(listings).where(eq(listings.id, listingId)).for("update");
    if (!l) throw notFound("listing");
    if (!EDITABLE.includes(l.state)) throw conflict("listing_not_editable", `a ${l.state} listing can't be edited`);
    if (e.agentUserId) await requireAgent(tx.db, e.agentUserId);
    const issued = e.permitIssuedOn ?? l.permitIssuedOn;
    const expires = e.permitExpiresOn ?? l.permitExpiresOn;
    if (issued && expires && issued > expires)
      throw unprocessable("invalid_listing", "the permit can't expire before it is issued");
    const set: Partial<typeof listings.$inferInsert> = {
      ...(e.title !== undefined && { title: e.title }),
      ...(e.community !== undefined && { community: e.community }),
      ...(e.propertyDescription !== undefined && { description: e.propertyDescription }),
      ...(e.askingPriceFils !== undefined && { askingPriceFils: e.askingPriceFils }),
      ...(e.bedrooms !== undefined && { bedrooms: e.bedrooms }),
      ...(e.sizeSqft !== undefined && { sizeSqft: e.sizeSqft }),
      ...(e.unitType !== undefined && { unitType: e.unitType }),
      ...(e.bathrooms !== undefined && { bathrooms: e.bathrooms }),
      ...(e.floor !== undefined && { floor: e.floor }),
      ...(e.view !== undefined && { view: e.view }),
      ...(e.parkingSpaces !== undefined && { parkingSpaces: e.parkingSpaces }),
      ...(e.furnished !== undefined && { furnished: e.furnished }),
      ...(e.permitNo !== undefined && { permitNo: e.permitNo }),
      ...(e.permitIssuedOn !== undefined && { permitIssuedOn: e.permitIssuedOn }),
      ...(e.permitExpiresOn !== undefined && { permitExpiresOn: e.permitExpiresOn }),
      ...(e.agentUserId !== undefined && { agentUserId: e.agentUserId }),
    };
    const fields = Object.keys(e).filter((k) => (e as Record<string, unknown>)[k] !== undefined);
    if (!fields.length) return;
    await tx.db.update(listings).set(set).where(eq(listings.id, listingId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id: listingId },
      type: "LISTING_UPDATED",
      actor,
      payload: { fields },
    });
    if (l.state === "PUBLISHED" && (!expires || expires < ctx.clock.today()))
      await moveProperty(ctx, tx, { kind: "listing", id: listingId }, "UNPUBLISH", {
        actor,
        payload: { reason: "permit expired" },
      });
  });
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
    // A pending `seller_verification` is about the document as it was: when the owners now match it is stale, and when the
    // document changed it would carry an old key, so either way it is withdrawn first (a mismatch then opens a fresh one).
    await withdrawPendingApprovals(tx, ctx, {
      gate: "seller_verification",
      entity: { kind: "listing", id: listingId },
      reason: matched ? "ownership now matches" : "the ownership document changed",
      actor,
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
  opts: { actor: SpaActor; payload?: Record<string, unknown> },
): Promise<AdvanceResult> {
  if (!OWN_STEPS.includes(event)) throw conflict("deal_only", `${event} happens only through a deal or an offer`);
  return withSpaTx(ctx.database, (tx) => moveProperty(ctx, tx, { kind: "listing", id: listingId }, event, opts));
}

const Step = z.object({
  event: z.enum(["VERIFY", "ACTIVATE", "PUBLISH", "UNPUBLISH", "WITHDRAW"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

/**
 * M3 (S77): a sales role moves a listing one step from its record. Unpublish and withdraw need a reason, kept in the
 * event. A guard's refusal is a 409 `step_refused` carrying the machine's own sentences.
 */
export async function stepListing(ctx: SpaContext, listingId: string, input: unknown, user: Person) {
  await requireListings(ctx.database.db, user, "write");
  const parsed = Step.safeParse(input);
  if (!parsed.success) throw unprocessable("invalid_step", "that isn't a listing step");
  const { event, reason } = parsed.data;
  if ((event === "UNPUBLISH" || event === "WITHDRAW") && !reason)
    throw unprocessable("reason_required", "say why (3 to 500 characters)");
  try {
    // M6 (S81): withdrawing a listing whose offer is still out withdraws that offer by code, in the same transaction.
    if (event === "WITHDRAW") {
      // Loaded here, not at the top: offers.ts reads listings, and a static import would make a cycle.
      const { withdrawSentOfferFor } = await import("./offers.ts");
      return await withSpaTx(ctx.database, async (tx) => {
        const offerId = await withdrawSentOfferFor(ctx, tx, listingId, "system:listing-withdraw");
        return moveProperty(ctx, tx, { kind: "listing", id: listingId }, "WITHDRAW", {
          actor: `user:${user.id}`,
          payload: { ...(reason ? { reason } : {}), ...(offerId ? { withdrawnOfferId: offerId } : {}) },
        });
      });
    }
    return await listingStep(ctx, listingId, event, {
      actor: `user:${user.id}`,
      ...(reason ? { payload: { reason } } : {}),
    });
  } catch (e) {
    if (e instanceof SpaDomainError && e.code === "guard_failed")
      throw conflict("step_refused", "that step isn't allowed yet", e.reasons);
    throw e;
  }
}

/**
 * From the record, ownership and signatures change only while the listing is a draft (or, for a signature, verified):
 * once verified, a different document would not be re-checked by the later steps. 404 for a missing listing.
 */
async function requireDraft(ctx: SpaContext, listingId: string, why: string, allowVerified = false): Promise<void> {
  const [l] = await ctx.database.db.select({ state: listings.state }).from(listings).where(eq(listings.id, listingId));
  if (!l) throw notFound("listing");
  if (l.state !== "DRAFT" && !(allowVerified && l.state === "VERIFIED")) throw conflict("listing_not_editable", why);
}

/** A sales role enters the ownership document's owners from the record. */
export async function recordOwnershipAs(ctx: SpaContext, listingId: string, input: unknown, user: Person) {
  await requireListings(ctx.database.db, user, "write");
  await requireDraft(ctx, listingId, "the ownership document can only change while the listing is a draft");
  return recordOwnership(ctx, listingId, input, `user:${user.id}`);
}

/** A sales role records that a seller signed the listing agreement. */
export async function recordSignatureAs(ctx: SpaContext, listingId: string, partyId: unknown, user: Person) {
  await requireListings(ctx.database.db, user, "write");
  const id = z.uuid().safeParse(partyId);
  if (!id.success) throw unprocessable("not_a_seller", "only a seller of this listing signs its agreement");
  await requireDraft(ctx, listingId, "the listing agreement can only be signed while the listing is a draft", true);
  await recordListingSignature(ctx, listingId, id.data, `user:${user.id}`);
}

/**
 * M3 (S77): stores a listing's file by its first bytes (PDF, JPEG, PNG or WebP, 10 MB at most), hashed. The same file
 * for the same kind is one row and no second event. The event carries the kind, hash and size, never the name.
 */
export async function uploadListingDocument(
  ctx: SpaContext,
  store: DocumentStore,
  listingId: string,
  kind: unknown,
  file: { name: string; bytes: Uint8Array },
  user: Person,
): Promise<{ id: string; duplicate: boolean }> {
  await requireListings(ctx.database.db, user, "write");
  const k = z.enum(LISTING_DOCUMENT_KINDS).safeParse(kind);
  if (!k.success) throw unprocessable("invalid_file", "say which document it is");
  const type = file.bytes.byteLength > MAX_DOCUMENT_BYTES ? null : sniffFile(file.bytes);
  if (!type) throw unprocessable("unsupported_file", "a PDF or an image (JPEG, PNG, WebP) up to 10 MB");
  const [exists] = await ctx.database.db.select({ id: listings.id }).from(listings).where(eq(listings.id, listingId));
  if (!exists) throw notFound("listing");
  const stored = await store.put(file.bytes, type.ext);
  const actor = `user:${user.id}` as const;
  return withSpaTx(ctx.database, async (tx) => {
    const [l] = await tx.db.select().from(listings).where(eq(listings.id, listingId)).for("update");
    if (!l) throw notFound("listing");
    if (l.state === "WITHDRAWN" || l.state === "SOLD")
      throw conflict("listing_not_editable", `a ${l.state} listing takes no more documents`);
    const [dup] = await tx.db
      .select({ id: listingDocuments.id })
      .from(listingDocuments)
      .where(
        and(
          eq(listingDocuments.listingId, listingId),
          eq(listingDocuments.kind, k.data),
          eq(listingDocuments.sha256, stored.sha256),
        ),
      );
    if (dup) return { id: dup.id, duplicate: true };
    const id = newId();
    await tx.db.insert(listingDocuments).values({
      id,
      listingId,
      kind: k.data,
      fileName: file.name.replace(/^.*[\\/]/, "").slice(0, 200) || "file",
      mime: type.mime,
      sizeBytes: stored.bytes,
      sha256: stored.sha256,
      storageKey: stored.path,
      uploadedBy: actor,
      uploadedAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "listing", id: listingId },
      type: "LISTING_DOCUMENT_UPLOADED",
      actor,
      payload: { documentId: id, kind: k.data, sha256: stored.sha256, sizeBytes: stored.bytes },
    });
    return { id, duplicate: false };
  });
}

/** The file back, for a sales role (sellers' documents go to sales roles only). */
export async function readListingDocument(
  ctx: SpaContext,
  store: DocumentStore,
  listingId: string,
  docId: string,
  user: Person,
): Promise<{ bytes: Uint8Array; mime: string; fileName: string }> {
  await requireListings(ctx.database.db, user, "write");
  const [d] = await ctx.database.db
    .select()
    .from(listingDocuments)
    .where(and(eq(listingDocuments.id, docId), eq(listingDocuments.listingId, listingId)));
  if (!d || !store.read) throw notFound("document");
  return { bytes: await store.read(d.storageKey), mime: d.mime, fileName: d.fileName };
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
