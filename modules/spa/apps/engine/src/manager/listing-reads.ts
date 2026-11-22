import { diffDays, type CalendarDate } from "@platform/kernel/dates";
import { type CompanyKind, type ListingState, type SpaRole } from "@spa/core";
import { listingParties, listingSignatures, listings, offers, parties, spaUsers, type SpaDb } from "@spa/db";
import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound } from "./errors.ts";
import { CATALOGUE_READERS } from "./inventory.ts";
import { companyKind } from "./parties.ts";
import { Cursor, cursorOf, Limit, paged } from "./reads.ts";

/**
 * The staff listings screens (C32, S64, design §4.7): a table of listings and one record. Listings belong to
 * brokerage and `both` companies (S12); a developer's company has none. The table carries no owner name and no
 * document number; the record shows the sellers to the sales roles only. No compliance word is ever written here.
 */
type Person = { id: string; role: SpaRole };
const SALES_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin"];

/** Reads: the catalogue readers. Writes (a draft): the three sales roles. A developer company has no listings, whoever asks. */
export async function requireListings(db: SpaDb, user: Person, mode: "read" | "write"): Promise<CompanyKind> {
  const kind = await companyKind(db);
  if (kind === "developer") throw forbidden("this company keeps inventory, not listings");
  const roles = mode === "write" ? SALES_ROLES : CATALOGUE_READERS;
  if (!roles.includes(user.role))
    throw forbidden(mode === "write" ? "only sales roles add a listing" : "you can't read the listings");
  return kind;
}

export const ListingsQuery = z.object({
  scope: z.enum(["mine", "all"]).default("all"),
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
const OFFER_LABELS = { SENT: "Open", ACCEPTED: "Accepted", REJECTED: "Rejected", EXPIRED: "Expired" } as const;
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
  if (cur) where.push(sql`(${listings.createdAt}, ${listings.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await db
    .select()
    .from(listings)
    .where(and(...where))
    .orderBy(desc(listings.createdAt), desc(listings.id))
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }));
  if (!p.rows.length) return { items: [], nextCursor: null };
  const ids = p.rows.map((r) => r.id);
  const [sellers, offerBy] = await Promise.all([sellersOf(db, ids), latestOffers(db, ids)]);
  const today = ctx.clock.today();
  return {
    nextCursor: p.nextCursor,
    items: p.rows.map((l) => {
      const permit = permitOf(l, today);
      const o = offerBy.get(l.id);
      return {
        id: l.id,
        ref: l.ref,
        title: l.title ?? l.ref,
        community: l.community,
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
  return {
    id: l.id,
    ref: l.ref,
    title: l.title ?? l.ref,
    community: l.community,
    description: l.description,
    bedrooms: l.bedrooms,
    sizeSqft: l.sizeSqft,
    askingPriceFils: l.askingPriceFils,
    state: l.state,
    stateLabel: STATE_LABELS[l.state],
    agent: agent?.name ?? null,
    sellerKind: sellerKindOf(sellers),
    sellers: SALES_ROLES.includes(user.role)
      ? sellers
          .toSorted((a, b) => a.order - b.order)
          .map((s) => ({ name: s.name, kind: s.kind, shareBps: s.shareBps, signed: signed.has(s.partyId) }))
      : null,
    ownership: l.ownershipKind ? { kind: l.ownershipKind, matched: l.ownershipMatched } : null,
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
