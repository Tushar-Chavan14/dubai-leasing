import { diffDays, toDubaiDate, type CalendarDate } from "@platform/kernel/dates";
import { type ListingEvent, listingMachine, type ListingState, type SpaRole, stageKey, stageLabel, UNIT_TYPES, hasAnyRole, rolesOf } from "@spa/core";
import {
  dealEvents,
  deals,
  type ListingDocumentKind,
  listingDocuments,
  listingOwners,
  listingParties,
  listingSignatures,
  listings,
  offers,
  parties,
  spaApprovals,
  spaUsers,
  type SpaDb,
} from "@spa/db";
import { and, desc, eq, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { notFound } from "./errors.ts";
import { requireListings } from "./listing-access.ts";
import { activityOf } from "./inventory-activity.ts";
import { coverMedia } from "./media-cover.ts";
import { listMedia } from "./media.ts";
import { Cursor, cursorOf, Limit, paged } from "./reads.ts";

/**
 * The staff listings screens (C32, S64, design §4.7): a table of listings and one record. Listings belong to
 * brokerage and `both` companies (S12); a developer's company has none. The table carries no owner name and no
 * document number; the record shows the sellers to the sales roles only. No compliance word is ever written here.
 */
type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
const SALES_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];

export { requireListings };

const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);
/** Filters come from the address, so a value that isn't understood is dropped, never an error and never SQL. */
export const ListingsQuery = z.object({
  scope: z.enum(["mine", "all"]).default("all"),
  state: opt(z.enum(["DRAFT", "VERIFIED", "ACTIVE", "PUBLISHED", "UNDER_OFFER", "SOLD", "WITHDRAWN"])),
  community: opt(z.string().trim().min(1).max(120)),
  type: opt(z.enum(UNIT_TYPES)),
  beds: opt(z.coerce.number().int().min(0).max(20)),
  minPriceFils: opt(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  maxPriceFils: opt(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  agent: opt(z.uuid()),
  limit: Limit,
  cursor: Cursor,
});
export type ListingsQuery = z.infer<typeof ListingsQuery>;

const STATE_LABELS: Record<ListingState, string> = {
  DRAFT: "Draft",
  VERIFIED: "Verified",
  ACTIVE: "Active",
  PUBLISHED: "Published",
  UNDER_OFFER: "Under offer",
  SOLD: "Sold",
  WITHDRAWN: "Withdrawn",
};
export const LISTING_DOCUMENT_LABELS: Record<ListingDocumentKind, string> = {
  title_deed: "Title deed",
  oqood: "Oqood certificate",
  listing_agreement: "Signed listing agreement",
  permit: "Advertising permit",
};
/** The one forward step each state offers on the record (S77); the later steps move with an offer or a deal. */
const NEXT_STEP: Partial<Record<ListingState, { event: ListingEvent; label: string }>> = {
  DRAFT: { event: "VERIFY", label: "Verify the listing" },
  VERIFIED: { event: "ACTIVATE", label: "Activate" },
  ACTIVE: { event: "PUBLISH", label: "Publish the page" },
};
const OFFER_LABELS = {
  SENT: "Open",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  WITHDRAWN: "Withdrawn",
} as const;
/** Warn this many days before the permit's last valid day (design §4.7). */
export const PERMIT_WARNING_DAYS = 7;

export type PermitView = {
  no: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  daysLeft: number | null;
  status: "none" | "valid" | "expiring" | "expired";
};
function permitOf(l: typeof listings.$inferSelect, today: CalendarDate): PermitView {
  const expiresOn = l.permitExpiresOn;
  const daysLeft = expiresOn ? diffDays(today, expiresOn as CalendarDate) : null;
  const status =
    daysLeft === null ? "none" : daysLeft < 0 ? "expired" : daysLeft <= PERMIT_WARNING_DAYS ? "expiring" : "valid";
  return { no: l.permitNo, issuedOn: l.permitIssuedOn, expiresOn, daysLeft, status };
}

/** The same rule as the public page (S38): published and a permit valid today. Published with a lapsed permit is hidden until the sweep takes it down. */
function pageOf(l: typeof listings.$inferSelect, permit: PermitView) {
  if (l.state === "PUBLISHED" && permit.status !== "none" && permit.status !== "expired")
    return { state: "live" as const, label: "Live" };
  if (l.state === "PUBLISHED") return { state: "hidden" as const, label: "Hidden: permit not valid" };
  return { state: "off" as const, label: "Not published" };
}

type SellerRow = {
  listingId: string;
  kind: "person" | "company";
  name: string;
  shareBps: number | null;
  order: number;
  partyId: string;
};

const sellerKindOf = (sellers: SellerRow[]): string =>
  sellers.some((s) => s.kind === "company") ? "Company" : sellers.length > 1 ? "Co-owners" : "Individual";

const latestOffers = async (db: SpaDb, listingIds: string[]) => {
  const rows = await db
    .select()
    .from(offers)
    .where(inArray(offers.listingId, listingIds))
    .orderBy(desc(offers.createdAt), desc(offers.id));
  const out = new Map<string, typeof offers.$inferSelect>();
  for (const r of rows) if (!out.has(r.listingId)) out.set(r.listingId, r);
  return out;
};

const sellersOf = (db: SpaDb, listingIds: string[]): Promise<SellerRow[]> =>
  db
    .select({
      listingId: listingParties.listingId,
      kind: parties.kind,
      name: parties.fullNameEn,
      shareBps: listingParties.shareBps,
      order: listingParties.order,
      partyId: parties.id,
    })
    .from(listingParties)
    .innerJoin(parties, eq(parties.id, listingParties.partyId))
    .where(inArray(listingParties.listingId, listingIds)) as Promise<SellerRow[]>;

/** The Listings table. Newest first; 100 at most a page. Seller names are read only to work out the kind, and never returned. */
export async function listListings(ctx: SpaContext, user: Person, q: ListingsQuery) {
  const db = ctx.database.db;
  await requireListings(db, user, "read");
  const cur = cursorOf(q.cursor);
  const where: (SQL | undefined)[] = [];
  if (q.scope === "mine") where.push(eq(listings.agentUserId, user.id));
  if (q.community) where.push(eq(listings.community, q.community));
  if (q.type) where.push(eq(listings.unitType, q.type));
  if (q.beds !== undefined) where.push(eq(listings.bedrooms, q.beds));
  if (q.minPriceFils !== undefined) where.push(sql`${listings.askingPriceFils} >= ${q.minPriceFils}`);
  if (q.maxPriceFils !== undefined) where.push(sql`${listings.askingPriceFils} <= ${q.maxPriceFils}`);
  if (q.agent) where.push(eq(listings.agentUserId, q.agent));
  // The status chips count what the other filters leave, whatever status is chosen.
  const countWhere = [...where];
  if (q.state) where.push(eq(listings.state, q.state));
  if (cur) where.push(sql`(${listings.createdAt}, ${listings.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await db
    .select()
    .from(listings)
    .where(and(...where))
    .orderBy(desc(listings.createdAt), desc(listings.id))
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }));
  const [communityRows, typeRows, bedRows, agentRows, stateRows] = await Promise.all([
    db.selectDistinct({ v: listings.community }).from(listings).where(isNotNull(listings.community)),
    db.selectDistinct({ v: listings.unitType }).from(listings).where(isNotNull(listings.unitType)),
    db.selectDistinct({ v: listings.bedrooms }).from(listings).where(isNotNull(listings.bedrooms)),
    db
      .selectDistinct({ id: spaUsers.id, name: spaUsers.name })
      .from(listings)
      .innerJoin(spaUsers, eq(spaUsers.id, listings.agentUserId))
      .orderBy(spaUsers.name),
    db
      .select({ state: listings.state, n: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(...countWhere))
      .groupBy(listings.state),
  ]);
  const facets = {
    communities: communityRows.map((r) => r.v!).toSorted(),
    types: typeRows.map((r) => r.v!).toSorted(),
    beds: bedRows.map((r) => r.v!).toSorted((a, b) => a - b),
    agents: agentRows,
    states: Object.fromEntries(stateRows.map((r) => [r.state, r.n])) as Partial<Record<ListingState, number>>,
  };
  if (!p.rows.length) return { items: [], nextCursor: null, facets };
  const ids = p.rows.map((r) => r.id);
  const [sellers, offerBy, covers] = await Promise.all([
    sellersOf(db, ids),
    latestOffers(db, ids),
    coverMedia(db, "listing", ids),
  ]);
  const agentNames = new Map(agentRows.map((a) => [a.id, a.name]));
  const today = ctx.clock.today();
  return {
    nextCursor: p.nextCursor,
    facets,
    items: p.rows.map((l) => {
      const permit = permitOf(l, today);
      const o = offerBy.get(l.id);
      return {
        id: l.id,
        ref: l.ref,
        title: l.title ?? l.ref,
        community: l.community,
        bedrooms: l.bedrooms,
        bathrooms: l.bathrooms,
        sizeSqft: l.sizeSqft,
        unitType: l.unitType,
        view: l.view,
        agent: l.agentUserId ? (agentNames.get(l.agentUserId) ?? null) : null,
        coverMediaId: covers.get(l.id) ?? null,
        sellerKind: sellerKindOf(sellers.filter((s) => s.listingId === l.id)),
        askingPriceFils: l.askingPriceFils,
        state: l.state,
        stateLabel: STATE_LABELS[l.state],
        permit,
        page: pageOf(l, permit),
        offer: o ? { state: o.status, label: OFFER_LABELS[o.status], validUntil: o.validUntil } : null,
      };
    }),
  };
}

/**
 * One listing. The sellers (names, kind, share, whether each signed the listing agreement) go to the three sales roles
 * only; an admin sees the listing without them. The ownership document shows its kind and whether the owners matched,
 * never its number or the names printed on it.
 */
export async function getListing(ctx: SpaContext, user: Person, listingId: string) {
  const db = ctx.database.db;
  await requireListings(db, user, "read");
  const [l] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!l) throw notFound("listing");
  const today = ctx.clock.today();
  const permit = permitOf(l, today);
  const offer = (await latestOffers(db, [l.id])).get(l.id);
  const sellers = await sellersOf(db, [l.id]);
  const signed = new Set(
    (
      await db
        .select({ id: listingSignatures.partyId })
        .from(listingSignatures)
        .where(eq(listingSignatures.listingId, l.id))
    ).map((s) => s.id),
  );
  const [agent] = l.agentUserId
    ? await db.select({ name: spaUsers.name }).from(spaUsers).where(eq(spaUsers.id, l.agentUserId))
    : [];
  const sales = hasAnyRole(user, SALES_ROLES);
  const step = NEXT_STEP[l.state];
  const transition = step && listingMachine.transitions.find((t) => t.from === l.state && t.event === step.event);
  const guard = transition?.guard?.(await ctx.facts.listing({ db }, l, today));
  const next =
    sales && step ? { event: step.event, label: step.label, reasons: guard && !guard.ok ? guard.reasons : [] } : null;
  const actions = !sales
    ? []
    : l.state === "PUBLISHED"
      ? (["UNPUBLISH", "WITHDRAW"] as const)
      : l.state === "DRAFT" || l.state === "VERIFIED" || l.state === "ACTIVE"
        ? (["WITHDRAW"] as const)
        : [];
  const documents = sales
    ? (
        await db
          .select()
          .from(listingDocuments)
          .where(eq(listingDocuments.listingId, l.id))
          .orderBy(listingDocuments.uploadedAt, listingDocuments.id)
      ).map((d) => ({
        id: d.id,
        kind: d.kind,
        kindLabel: LISTING_DOCUMENT_LABELS[d.kind],
        fileName: d.fileName,
        uploadedAt: d.uploadedAt.toISOString(),
      }))
    : null;
  const owners = sales
    ? (
        await db
          .select({ name: listingOwners.nameAsOnDocument })
          .from(listingOwners)
          .where(eq(listingOwners.listingId, l.id))
          .orderBy(listingOwners.order)
      ).map((o) => o.name)
    : null;
  const [waiting] = sales
    ? await db
        .select({ id: spaApprovals.id })
        .from(spaApprovals)
        .where(
          and(
            eq(spaApprovals.gate, "seller_verification"),
            eq(spaApprovals.entityKind, "listing"),
            eq(spaApprovals.entityId, l.id),
            eq(spaApprovals.status, "pending"),
          ),
        )
        .limit(1)
    : [];
  // The newest deal on this listing that isn't over (read only here; the deal itself is worked on its own screen).
  const [dealRow] = await db
    .select({ id: deals.id, ref: deals.ref, state: deals.state })
    .from(deals)
    .where(and(eq(deals.listingId, l.id), sql`${deals.state} not in ('HANDED_OVER', 'COMPLETED', 'CANCELLED')`))
    .orderBy(desc(deals.createdAt))
    .limit(1);
  let lastUnpublish: { on: string; reason: string } | null = null;
  if (l.state === "ACTIVE") {
    const [ev] = await db
      .select({ at: dealEvents.at, payload: dealEvents.payload })
      .from(dealEvents)
      .where(and(eq(dealEvents.entityKind, "listing"), eq(dealEvents.entityId, l.id), eq(dealEvents.type, "UNPUBLISH")))
      .orderBy(desc(dealEvents.at), desc(dealEvents.id))
      .limit(1);
    if (ev && sales) lastUnpublish = { on: toDubaiDate(ev.at), reason: String(ev.payload.reason ?? "") };
  }
  return {
    id: l.id,
    ref: l.ref,
    title: l.title ?? l.ref,
    community: l.community,
    description: l.description,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    sizeSqft: l.sizeSqft,
    unitType: l.unitType,
    floor: l.floor,
    view: l.view,
    parkingSpaces: l.parkingSpaces,
    furnished: l.furnished,
    askingPriceFils: l.askingPriceFils,
    state: l.state,
    stateLabel: STATE_LABELS[l.state],
    agent: agent?.name ?? null,
    agentUserId: l.agentUserId,
    sellerKind: sellerKindOf(sellers),
    sellers: sales
      ? sellers
          .toSorted((a, b) => a.order - b.order)
          .map((s) => ({
            partyId: s.partyId,
            name: s.name,
            kind: s.kind,
            shareBps: s.shareBps,
            signed: signed.has(s.partyId),
          }))
      : null,
    // The document's number and the names printed on it go to the sales roles only.
    ownership: l.ownershipKind
      ? {
          kind: l.ownershipKind,
          matched: l.ownershipMatched,
          ...(sales ? { ref: l.ownershipRef, owners, waitingForManager: Boolean(waiting) } : {}),
        }
      : null,
    media: await listMedia(db, { kind: "listing", id: l.id }),
    // A reason is a staff member's own sentence: the sales roles read it, nobody else.
    activity: (await activityOf(db, "listing", l.id)).map((a) => (sales ? a : { ...a, note: null })),
    documents,
    next,
    actions,
    lastUnpublish,
    openDeal: dealRow
      ? { id: dealRow.id, ref: dealRow.ref, stageLabel: stageLabel(stageKey(dealRow.state, rolesOf(user))) }
      : null,
    permit,
    page: pageOf(l, permit),
    offer: offer
      ? {
          state: offer.status,
          label: OFFER_LABELS[offer.status],
          priceFils: offer.priceFils,
          validUntil: offer.validUntil,
          createdAt: offer.createdAt.toISOString(),
        }
      : null,
  };
}

/** The agents a listing can be given to: active users with a sales role. Write roles only (they fill the form). */
export async function listAgents(ctx: SpaContext, user: Person): Promise<{ id: string; name: string }[]> {
  await requireListings(ctx.database.db, user, "write");
  return ctx.database.db
    .select({ id: spaUsers.id, name: spaUsers.name })
    .from(spaUsers)
    .where(and(eq(spaUsers.active, true), inArray(spaUsers.role, [...SALES_ROLES])))
    .orderBy(spaUsers.name);
}
