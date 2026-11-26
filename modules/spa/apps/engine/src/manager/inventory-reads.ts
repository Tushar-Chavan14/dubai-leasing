import { type SpaRole, stageKey, stageLabel, type UnitState, UNIT_TYPES, rolesOf } from "@spa/core";
import { buildings, deals, priceListItems, priceLists, projects, spaMedia, type SpaDb, units } from "@spa/db";
import { and, asc, desc, eq, ilike, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { BadQuery } from "./reads.ts";
import { notFound } from "./errors.ts";
import { requireInventory, unitListPrice } from "./inventory.ts";
import { coverMedia } from "./media-cover.ts";
import { activityOf } from "./inventory-activity.ts";

/**
 * The unit list and the unit record (S75): what the Inventory screens read. Filters come from the URL, so every field
 * drops a value it doesn't understand instead of failing or reaching SQL (`beds=99` is the unfiltered list).
 */
type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

const STATES = ["AVAILABLE", "HELD", "SOLD", "REGISTERED", "HANDED_OVER"] as const satisfies readonly UnitState[];
const FINAL_DEAL_STATES = ["HANDED_OVER", "COMPLETED", "CANCELLED"] as const;
const opt = <T extends z.ZodType>(t: T) => t.optional().catch(undefined);

export const UnitQuery = z.object({
  project: opt(z.uuid()),
  building: opt(z.uuid()),
  type: opt(z.enum(UNIT_TYPES)),
  beds: opt(z.coerce.number().int().min(0).max(10)),
  state: opt(z.enum(STATES)),
  minPriceFils: opt(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  maxPriceFils: opt(z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)),
  q: opt(z.string().trim().min(1).max(40)),
  cursor: opt(z.string().min(1).max(40)),
  limit: z.coerce.number().int().min(1).max(100).catch(50).default(50),
});
export type UnitQuery = z.infer<typeof UnitQuery>;

/** The price in the project's latest published price list, or null (the same rule as `unitListPrice`). */
const priceInUse = sql<number | null>`(
  select pli.price_fils::double precision from price_list_items pli
  join price_lists pl on pl.id = pli.price_list_id
  where pli.unit_id = ${units.id} and pl.project_id = ${buildings.projectId} and pl.published_at is not null
    and pl.version = (select max(v.version) from price_lists v where v.project_id = pl.project_id and v.published_at is not null)
)`;

export interface OpenDeal {
  id: string;
  ref: string;
  state: string;
  /** The stage in words for the viewer's role ("Offer accepted"), never the state code. */
  stageLabel: string;
}

/** The open deal of each unit (the newest one not yet over). */
async function openDeals(db: SpaDb, unitIds: string[], role: SpaRole): Promise<Map<string, OpenDeal>> {
  const out = new Map<string, OpenDeal>();
  if (!unitIds.length) return out;
  const rows = await db
    .select({ id: deals.id, ref: deals.ref, state: deals.state, unitId: deals.unitId })
    .from(deals)
    .where(and(inArray(deals.unitId, unitIds), sql`${deals.state} not in ('HANDED_OVER', 'COMPLETED', 'CANCELLED')`))
    .orderBy(desc(deals.createdAt));
  for (const r of rows)
    if (r.unitId && !out.has(r.unitId))
      out.set(r.unitId, { id: r.id, ref: r.ref, state: r.state, stageLabel: stageLabel(stageKey(r.state, role)) });
  return out;
}

const offsetOf = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const n = Number(text);
  if (!/^[0-9]{1,7}$/.test(text) || Buffer.from(text).toString("base64url") !== cursor || n > 1_000_000)
    throw new BadQuery("that page cursor is not valid");
  return n;
};

export async function listUnits(ctx: SpaContext, user: Person, raw: unknown) {
  const db = ctx.database.db;
  await requireInventory(db, user, "read");
  const q = UnitQuery.parse(raw ?? {});
  const offset = offsetOf(q.cursor);
  const where: SQL[] = [];
  if (q.project) where.push(eq(buildings.projectId, q.project));
  if (q.building) where.push(eq(units.buildingId, q.building));
  if (q.type) where.push(eq(units.type, q.type));
  if (q.beds !== undefined) where.push(eq(units.bedrooms, q.beds));
  const stateWhere = q.state ? eq(units.state, q.state) : undefined;
  if (stateWhere) where.push(stateWhere);
  if (q.minPriceFils !== undefined) where.push(sql`${priceInUse} >= ${q.minPriceFils}`);
  if (q.maxPriceFils !== undefined) where.push(sql`${priceInUse} <= ${q.maxPriceFils}`);
  if (q.q) where.push(ilike(units.code, `%${q.q.replace(/[\\%_]/g, "\\$&")}%`));
  // Project code then unit code; a unit placed in no building (made before projects) comes last.
  const rows = await db
    .select({
      u: units,
      projectId: projects.id,
      projectName: projects.name,
      buildingName: buildings.name,
      price: priceInUse,
    })
    .from(units)
    .leftJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(projects, eq(projects.id, buildings.projectId))
    .where(and(...where))
    .orderBy(sql`${projects.code} nulls last`, asc(units.code))
    .limit(q.limit + 1)
    .offset(offset);
  const page = rows.slice(0, q.limit);
  const ids = page.map((r) => r.u.id);
  const [open, covers] = await Promise.all([openDeals(db, ids, user.role), coverMedia(db, "unit", ids)]);
  // The status chips count the units the other filters leave, whatever status is chosen.
  const countWhere = where.filter((w) => w !== stateWhere);
  const [projectRows, typeRows, bedRows, stateRows] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).orderBy(asc(projects.code)),
    db.selectDistinct({ v: units.type }).from(units).where(isNotNull(units.type)),
    db.selectDistinct({ v: units.bedrooms }).from(units).where(isNotNull(units.bedrooms)),
    db
      .select({ state: units.state, n: sql<number>`count(*)::int` })
      .from(units)
      .leftJoin(buildings, eq(buildings.id, units.buildingId))
      .where(and(...countWhere))
      .groupBy(units.state),
  ]);
  return {
    items: page.map((r) => ({
      id: r.u.id,
      code: r.u.code,
      state: r.u.state,
      type: r.u.type,
      bedrooms: r.u.bedrooms,
      internalSqft: r.u.internalSqft,
      view: r.u.view,
      floor: r.u.floor,
      project: r.projectId ? { id: r.projectId, name: r.projectName! } : null,
      building: r.u.buildingId ? { id: r.u.buildingId, name: r.buildingName! } : null,
      priceFils: r.price,
      coverMediaId: covers.get(r.u.id) ?? null,
      openDeal: open.get(r.u.id) ?? null,
    })),
    next: rows.length > q.limit ? Buffer.from(String(offset + q.limit)).toString("base64url") : null,
    facets: {
      projects: projectRows,
      types: typeRows.map((t) => t.v!).toSorted(),
      beds: bedRows.map((b) => b.v!).toSorted((a, b) => a - b),
      states: Object.fromEntries(stateRows.map((r) => [r.state, r.n])) as Partial<Record<UnitState, number>>,
    },
  };
}

const isOpen = (s: string) => !(FINAL_DEAL_STATES as readonly string[]).includes(s);

export async function getUnit(ctx: SpaContext, user: Person, unitId: string) {
  const db = ctx.database.db;
  await requireInventory(db, user, "read");
  const [row] = await db
    .select({ u: units, b: buildings, p: projects })
    .from(units)
    .leftJoin(buildings, eq(buildings.id, units.buildingId))
    .leftJoin(projects, eq(projects.id, buildings.projectId))
    .where(eq(units.id, unitId));
  if (!row) throw notFound("unit");
  const u = row.u;
  const [media, history, current, dealRows, activity] = await Promise.all([
    db
      .select({ id: spaMedia.id, caption: spaMedia.caption, sort: spaMedia.sort })
      .from(spaMedia)
      .where(and(eq(spaMedia.ownerKind, "unit"), eq(spaMedia.ownerId, unitId)))
      .orderBy(asc(spaMedia.sort), asc(spaMedia.createdAt)),
    db
      .select({ version: priceLists.version, publishedAt: priceLists.publishedAt, priceFils: priceListItems.priceFils })
      .from(priceListItems)
      .innerJoin(priceLists, eq(priceLists.id, priceListItems.priceListId))
      .where(and(eq(priceListItems.unitId, unitId), isNotNull(priceLists.publishedAt)))
      .orderBy(asc(priceLists.version)),
    unitListPrice(db, unitId),
    db
      .select({ id: deals.id, ref: deals.ref, state: deals.state })
      .from(deals)
      .where(eq(deals.unitId, unitId))
      .orderBy(desc(deals.createdAt)),
    activityOf(db, "unit", unitId),
  ]);
  return {
    id: u.id,
    code: u.code,
    state: u.state,
    type: u.type,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    internalSqft: u.internalSqft,
    balconySqft: u.balconySqft,
    floor: u.floor,
    view: u.view,
    parkingSpaces: u.parkingSpaces,
    description: u.description,
    project: row.p ? { id: row.p.id, code: row.p.code, name: row.p.name, community: row.p.community } : null,
    building: row.b ? { id: row.b.id, code: row.b.code, name: row.b.name } : null,
    media,
    priceHistory: history.map((h) => ({
      version: h.version,
      publishedAt: h.publishedAt!.toISOString(),
      priceFils: h.priceFils,
    })),
    currentPriceFils: current?.priceFils ?? null,
    openDeal:
      dealRows
        .filter((d) => isOpen(d.state))
        .map((d) => ({
          id: d.id,
          ref: d.ref,
          state: d.state,
          stageLabel: stageLabel(stageKey(d.state, rolesOf(user))),
        }))[0] ?? null,
    pastDeals: dealRows.filter((d) => !isOpen(d.state)).map((d) => ({ id: d.id, ref: d.ref, state: d.state })),
    activity,
  };
}
