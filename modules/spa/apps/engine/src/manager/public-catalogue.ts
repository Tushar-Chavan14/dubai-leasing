import {
  type CatalogueQuery,
  FURNISHED_LABELS,
  type PublicProperty,
  PublicProperty as PublicPropertySchema,
  type PublicPropertyDetail,
  PublicPropertyDetail as PublicPropertyDetailSchema,
  UNIT_TYPE_LABELS,
  type UnitType,
} from "@spa/core";
import {
  buildings,
  companies,
  listings,
  priceListItems,
  priceLists,
  projects,
  spaMedia,
  spaUsers,
  units,
} from "@spa/db";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { isPublicListing } from "./listings.ts";

/**
 * The public catalogue (S78): resale listings and developer units on sale, as one allow-listed shape. Every field below
 * is named here on purpose; no row is ever spread into a response, and both Zod schemas are `.strict()`. Never read
 * here: sellers, parties, ownership, documents, offers, deals, floor prices, discounts, price-list internals.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const handoverLabel = (d: string | null): string | null => {
  if (!d) return null;
  const [y, m] = d.split("-");
  const month = MONTHS[Number(m) - 1];
  return y && month ? `${month} ${y}` : null;
};

const unitTypeLabel = (t: string | null): string | null => (t ? (UNIT_TYPE_LABELS[t as UnitType] ?? null) : null);

/** "2-bed apartment, Marina Vista" / "Studio apartment, Marina Vista". */
function unitTitle(type: string | null, beds: number | null, project: string): string {
  const kind = (unitTypeLabel(type) ?? "Home").toLowerCase();
  const head = beds === 0 ? `Studio ${kind}` : beds ? `${beds}-bed ${kind}` : kind[0]!.toUpperCase() + kind.slice(1);
  return `${head}, ${project}`;
}

/** The public reference of a developer unit. The unit's code is unique by itself; the project code makes it readable. */
export const unitPublicRef = (projectCode: string, unitCode: string): string => `U-${projectCode}-${unitCode}`;

type Item = { sort: number; p: PublicProperty; d: Omit<PublicPropertyDetail, keyof PublicProperty> };

/** Photo ids by owner, in the owner's order. */
async function photosOf(ctx: SpaContext, kind: "listing" | "unit" | "project", ids: string[]) {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = await ctx.database.db
    .select({ id: spaMedia.id, ownerId: spaMedia.ownerId })
    .from(spaMedia)
    .where(and(eq(spaMedia.ownerKind, kind), inArray(spaMedia.ownerId, ids)))
    .orderBy(asc(spaMedia.sort), asc(spaMedia.createdAt));
  for (const r of rows) out.set(r.ownerId, [...(out.get(r.ownerId) ?? []), r.id]);
  return out;
}

/** The units on sale: available, in a project, with a price in the project's latest published price list. */
async function publicUnitRows(ctx: SpaContext, only: { unitId?: string; projectId?: string } = {}) {
  const db = ctx.database.db;
  const lists = await db
    .select({ id: priceLists.id, projectId: priceLists.projectId, version: priceLists.version })
    .from(priceLists)
    .where(isNotNull(priceLists.publishedAt));
  const latest = new Map<string, { id: string; version: number }>();
  for (const l of lists) {
    const cur = latest.get(l.projectId);
    if (!cur || l.version > cur.version) latest.set(l.projectId, { id: l.id, version: l.version });
  }
  if (!latest.size) return [];
  const listIds = [...latest.values()].map((l) => l.id);
  return db
    .select({
      unitId: units.id,
      unitCode: units.code,
      type: units.type,
      bedrooms: units.bedrooms,
      bathrooms: units.bathrooms,
      sizeSqft: units.internalSqft,
      floor: units.floor,
      view: units.view,
      parkingSpaces: units.parkingSpaces,
      unitDescription: units.description,
      unitCreatedAt: units.createdAt,
      priceFils: priceListItems.priceFils,
      projectId: projects.id,
      projectCode: projects.code,
      projectName: projects.name,
      community: projects.community,
      projectDescription: projects.description,
      completion: projects.anticipatedCompletionOn,
      developerName: companies.name,
    })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(projects, eq(projects.id, buildings.projectId))
    .innerJoin(companies, eq(companies.id, projects.developerCompanyId))
    .innerJoin(priceListItems, and(eq(priceListItems.unitId, units.id), inArray(priceListItems.priceListId, listIds)))
    .where(
      and(
        eq(units.state, "AVAILABLE"),
        only.unitId ? eq(units.id, only.unitId) : undefined,
        only.projectId ? eq(projects.id, only.projectId) : undefined,
      ),
    );
}

async function allItems(ctx: SpaContext, only?: { ref: string }): Promise<Item[]> {
  const db = ctx.database.db;
  const today = ctx.clock.today();
  const wantListing = !only || !only.ref.startsWith("U-");
  const wantUnit = !only || only.ref.startsWith("U-");
  const out: Item[] = [];

  if (wantListing) {
    const rows = (
      await db
        .select()
        .from(listings)
        .where(
          only ? and(eq(listings.state, "PUBLISHED"), eq(listings.ref, only.ref)) : eq(listings.state, "PUBLISHED"),
        )
        .orderBy(desc(listings.createdAt))
    ).filter((l) => isPublicListing(l, today) && l.askingPriceFils !== null);
    const photos = await photosOf(
      ctx,
      "listing",
      rows.map((l) => l.id),
    );
    const agentIds = [...new Set(rows.map((l) => l.agentUserId).filter((a): a is string => !!a))];
    const agents = new Map(
      agentIds.length
        ? (
            await db
              .select({ id: spaUsers.id, name: spaUsers.name })
              .from(spaUsers)
              .where(and(inArray(spaUsers.id, agentIds), eq(spaUsers.active, true)))
          ).map((a) => [a.id, a.name])
        : [],
    );
    for (const l of rows) {
      const ids = photos.get(l.id) ?? [];
      out.push({
        sort: l.createdAt.getTime(),
        p: {
          ref: l.ref,
          source: "listing",
          title: l.title ?? "Home for sale",
          community: l.community,
          projectName: null,
          developerName: null,
          unitType: l.unitType,
          unitTypeLabel: unitTypeLabel(l.unitType),
          bedrooms: l.bedrooms,
          bathrooms: l.bathrooms,
          sizeSqft: l.sizeSqft,
          priceFils: l.askingPriceFils!,
          permitNo: l.permitNo,
          coverPhotoId: ids[0] ?? null,
          photoCount: ids.length,
          handover: null,
        },
        d: {
          description: l.description,
          floor: l.floor,
          view: l.view,
          parkingSpaces: l.parkingSpaces,
          furnishedLabel: l.furnished ? FURNISHED_LABELS[l.furnished] : null,
          photoIds: ids,
          agent: l.agentUserId && agents.has(l.agentUserId) ? { name: agents.get(l.agentUserId)! } : null,
          chat: true,
        },
      });
    }
  }

  if (wantUnit) {
    const rows = (await publicUnitRows(ctx)).filter(
      (u) => !only || unitPublicRef(u.projectCode, u.unitCode) === only.ref,
    );
    const unitPhotos = await photosOf(
      ctx,
      "unit",
      rows.map((u) => u.unitId),
    );
    const projectPhotos = await photosOf(ctx, "project", [...new Set(rows.map((u) => u.projectId))]);
    for (const u of rows) {
      // The unit's own photos first, then its project's.
      const ids = [...(unitPhotos.get(u.unitId) ?? []), ...(projectPhotos.get(u.projectId) ?? [])];
      out.push({
        sort: u.unitCreatedAt.getTime(),
        p: {
          ref: unitPublicRef(u.projectCode, u.unitCode),
          source: "developer",
          title: unitTitle(u.type, u.bedrooms, u.projectName),
          community: u.community,
          projectName: u.projectName,
          developerName: u.developerName,
          unitType: u.type,
          unitTypeLabel: unitTypeLabel(u.type),
          bedrooms: u.bedrooms,
          bathrooms: u.bathrooms,
          sizeSqft: u.sizeSqft,
          priceFils: u.priceFils,
          permitNo: null,
          coverPhotoId: ids[0] ?? null,
          photoCount: ids.length,
          handover: handoverLabel(u.completion),
        },
        d: {
          description: u.unitDescription ?? u.projectDescription,
          floor: u.floor,
          view: u.view,
          parkingSpaces: u.parkingSpaces,
          furnishedLabel: null,
          photoIds: ids,
          agent: null,
          chat: false,
        },
      });
    }
  }
  return out;
}

export async function listCatalogue(
  ctx: SpaContext,
  q: CatalogueQuery,
): Promise<{ items: PublicProperty[]; facets: { communities: string[]; types: string[] } }> {
  const all = await allItems(ctx);
  const community = q.community?.trim().toLowerCase();
  const items = all
    .filter(({ p }) => {
      if (q.source !== "all" && p.source !== q.source) return false;
      if (community && p.community?.toLowerCase() !== community) return false;
      if (q.type && p.unitType !== q.type) return false;
      if (q.beds !== undefined && (p.bedrooms === null || Math.min(p.bedrooms, 4) !== Math.min(q.beds, 4)))
        return false;
      if (q.min !== undefined && p.priceFils < q.min) return false;
      if (q.max !== undefined && p.priceFils > q.max) return false;
      return true;
    })
    .toSorted((a, b) =>
      q.sort === "price_asc"
        ? a.p.priceFils - b.p.priceFils
        : q.sort === "price_desc"
          ? b.p.priceFils - a.p.priceFils
          : b.sort - a.sort || a.p.ref.localeCompare(b.p.ref),
    )
    .map(({ p }) => PublicPropertySchema.parse(p));
  const communities = [...new Set(all.map((i) => i.p.community).filter((c): c is string => !!c))].toSorted();
  const types = [...new Set(all.map((i) => i.p.unitType).filter((t): t is string => !!t))].toSorted();
  return { items, facets: { communities, types } };
}

export async function getCatalogueItem(ctx: SpaContext, ref: string): Promise<PublicPropertyDetail | null> {
  const [hit] = await allItems(ctx, { ref });
  return hit ? PublicPropertyDetailSchema.parse({ ...hit.p, ...hit.d }) : null;
}

/**
 * Whether a photo may be served without sign-in: only when its owner is public right now: a published listing with a
 * valid permit, an available unit on a published price list, or the project of such a unit.
 */
export async function isPublicMediaOwner(
  ctx: SpaContext,
  kind: "listing" | "unit" | "project",
  ownerId: string,
): Promise<boolean> {
  const db = ctx.database.db;
  if (kind === "listing") {
    const [l] = await db.select().from(listings).where(eq(listings.id, ownerId));
    return !!l && isPublicListing(l, ctx.clock.today());
  }
  // One narrow query per photo, not a scan of every unit on sale.
  return (await publicUnitRows(ctx, kind === "unit" ? { unitId: ownerId } : { projectId: ownerId })).length > 0;
}
