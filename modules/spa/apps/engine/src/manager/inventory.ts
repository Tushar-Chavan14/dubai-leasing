import { isCalendarDate } from "@platform/kernel";
import { newId } from "@platform/kernel/ids";
import { type CompanyKind, ProjectDetails, type SpaRole, stageKey, stageLabel, type UnitState, UnitDetails, hasAnyRole, hasRole, rolesOf } from "@spa/core";
import {
  buildings,
  companies,
  deals,
  priceListItems,
  priceLists,
  projects,
  SPA_TEMPLATE_KINDS,
  type SpaDb,
  spaMedia,
  spaTemplates,
  spaTemplateVersions,
  spaUsers,
  units,
  withSpaTx,
} from "@spa/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { currentEscrowAccount } from "./escrow.ts";
import { appendDealEvent } from "./events.ts";
import { activityOf } from "./inventory-activity.ts";
import { coverMedia } from "./media-cover.ts";
import { companyKind } from "./parties.ts";
import { POLICY_ENTITY } from "./policy.ts";

/**
 * The developer's inventory (C32, S64): projects, buildings, units and versioned price lists. Every write goes
 * through here and is audited; the database triggers (migration 0056) hold the same rules if someone bypasses it.
 */
type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };

/** Who may look at inventory and listings: the three sales roles and admin (the rail's rule, S33). Everyone else gets 403. */
export const CATALOGUE_READERS: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];

/**
 * Inventory belongs to developer and `both` companies (S12): a brokerage has none, whoever asks. Writes are an admin's
 * alone (S64 ruling 1). Reads are the catalogue readers'.
 */
export async function requireInventory(db: SpaDb, user: Person, mode: "read" | "write"): Promise<CompanyKind> {
  const kind = await companyKind(db);
  if (kind === "brokerage") throw forbidden("this company keeps listings, not inventory");
  if (mode === "write" ? !hasRole(user, "admin") : !hasAnyRole(user, CATALOGUE_READERS))
    throw forbidden(mode === "write" ? "only an admin changes the inventory" : "you can't read the inventory");
  return kind;
}

const Code = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, "use letters, digits, dot, dash or underscore (up to 40)");
const Name = z.string().trim().min(1).max(120);
const Fils = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const invalid = (code: string, what: string, e: z.ZodError) =>
  unprocessable(
    code,
    `${what} isn't valid`,
    e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`),
  );

const ProjectInput = ProjectDetails.extend({
  code: Code,
  name: Name,
  /** The SPA rulebook is Dubai's only (S37): other emirates arrive with their own rulebook. */
  emirate: z.enum(["dubai"]).default("dubai"),
  anticipatedCompletionOn: z
    .string()
    .refine((s) => isCalendarDate(s), "write the date as YYYY-MM-DD")
    .nullish(),
  templateKind: z.enum(SPA_TEMPLATE_KINDS).nullish(),
});
const BuildingInput = z.object({ code: Code, name: Name });
const UnitInput = UnitDetails.extend({ buildingId: z.uuid(), code: Code });
const UnitUpdate = UnitDetails.extend({ buildingId: z.uuid().optional(), code: Code.optional() });
const ProjectUpdate = ProjectDetails.extend({
  name: Name.optional(),
  /** S79: the agent who gets leads and viewings for this project's units; null clears it (they wait for the sales manager). */
  salesAgentUserId: z.uuid().nullish(),
  anticipatedCompletionOn: z
    .string()
    .refine((s) => isCalendarDate(s), "write the date as YYYY-MM-DD")
    .nullish(),
});
/** A deal in any of these states is over: it no longer ties its unit down. */
const FINAL_DEAL_STATES = ["HANDED_OVER", "COMPLETED", "CANCELLED"] as const;
const DETAIL_COLUMNS = [
  "type",
  "bedrooms",
  "bathrooms",
  "internalSqft",
  "balconySqft",
  "floor",
  "view",
  "parkingSpaces",
  "description",
] as const;
/** The detail fields of the parsed input that are present, as column values (null clears one). */
const detailValues = (d: UnitDetails) =>
  Object.fromEntries(DETAIL_COLUMNS.filter((k) => d[k] !== undefined).map((k) => [k, d[k] ?? null]));
const PriceListInput = z.object({
  items: z
    .array(z.object({ unitId: z.uuid(), priceFils: Fils }))
    .min(1, "add at least one price")
    .max(2000)
    .refine((a) => new Set(a.map((i) => i.unitId)).size === a.length, "each unit once"),
});

const actorOf = (u: Person) => `user:${u.id}` as const;

export async function createProject(
  ctx: SpaContext,
  input: unknown,
  user: Person,
): Promise<{ id: string; code: string }> {
  await requireInventory(ctx.database.db, user, "write");
  const parsed = ProjectInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_project", "the project", parsed.error);
  const p = parsed.data;
  return withSpaTx(ctx.database, async (tx) => {
    const [company] = await tx.db.select({ id: companies.id }).from(companies).limit(1);
    if (!company) throw conflict("company_not_set", "set the company and its kind before adding a project");
    const [dup] = await tx.db.select({ id: projects.id }).from(projects).where(eq(projects.code, p.code));
    if (dup) throw conflict("project_code_taken", `a project with code ${p.code} already exists`);
    const id = newId();
    await tx.db.insert(projects).values({
      id,
      code: p.code,
      name: p.name,
      emirate: p.emirate,
      developerCompanyId: company.id,
      anticipatedCompletionOn: p.anticipatedCompletionOn ?? null,
      community: p.community ?? null,
      location: p.location ?? null,
      description: p.description ?? null,
      templateKind: p.templateKind ?? null,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: POLICY_ENTITY,
      type: "PROJECT_CREATED",
      actor: actorOf(user),
      payload: { projectId: id, code: p.code, name: p.name },
    });
    return { id, code: p.code };
  });
}

export async function addBuilding(
  ctx: SpaContext,
  projectId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string }> {
  await requireInventory(ctx.database.db, user, "write");
  const parsed = BuildingInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_building", "the building", parsed.error);
  return withSpaTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!p) throw notFound("project");
    const [dup] = await tx.db
      .select({ id: buildings.id })
      .from(buildings)
      .where(and(eq(buildings.projectId, projectId), eq(buildings.code, parsed.data.code)));
    if (dup) throw conflict("building_code_taken", `this project already has a building ${parsed.data.code}`);
    const id = newId();
    await tx.db.insert(buildings).values({ id, projectId, ...parsed.data });
    await appendDealEvent(tx, ctx, {
      entity: POLICY_ENTITY,
      type: "BUILDING_ADDED",
      actor: actorOf(user),
      payload: { projectId, projectCode: p.code, buildingId: id, code: parsed.data.code },
    });
    return { id };
  });
}

/**
 * Adds a unit to a building of the project. A unit code is unique in the install (S12): when the code belongs to a unit
 * made before projects existed (no building), that unit is placed in the building instead, once. A placed unit never moves.
 */
export async function addUnit(
  ctx: SpaContext,
  projectId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string; placed: boolean }> {
  await requireInventory(ctx.database.db, user, "write");
  const parsed = UnitInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_unit", "the unit", parsed.error);
  const { buildingId, code, ...rest } = parsed.data;
  const details = detailValues(rest);
  return withSpaTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!p) throw notFound("project");
    const [b] = await tx.db
      .select()
      .from(buildings)
      .where(and(eq(buildings.id, buildingId), eq(buildings.projectId, projectId)));
    if (!b) throw unprocessable("unknown_building", "that building isn't in this project");
    const [existing] = await tx.db.select().from(units).where(eq(units.code, code)).for("update");
    if (existing && existing.buildingId) throw conflict("unit_code_taken", `unit ${code} already exists`);
    const id = existing?.id ?? newId();
    if (existing)
      await tx.db
        .update(units)
        .set({ buildingId, ...details })
        .where(eq(units.id, id));
    else await tx.db.insert(units).values({ id, code, buildingId, ...details, createdAt: ctx.clock.now() });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "unit", id },
      type: existing ? "UNIT_PLACED" : "UNIT_ADDED",
      actor: actorOf(user),
      payload: { projectCode: p.code, buildingCode: b.code, code, details: Object.keys(details) },
    });
    return { id, placed: !!existing };
  });
}

/**
 * Edits a unit (S75). Descriptive fields may change at any time. The `code` and the building of a unit with an open deal
 * may not (409 `unit_in_deal`); a placed unit never changes building at all (trigger, S64). The event names the fields
 * that changed, never their values.
 */
export async function updateUnit(
  ctx: SpaContext,
  unitId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string }> {
  await requireInventory(ctx.database.db, user, "write");
  const parsed = UnitUpdate.safeParse(input);
  if (!parsed.success) throw invalid("invalid_unit", "the unit", parsed.error);
  const { code, buildingId, ...rest } = parsed.data;
  const details = detailValues(rest);
  return withSpaTx(ctx.database, async (tx) => {
    const [u] = await tx.db.select().from(units).where(eq(units.id, unitId)).for("update");
    if (!u) throw notFound("unit");
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) if (u[k as keyof typeof u] !== v) set[k] = v;
    if (code !== undefined && code !== u.code) set.code = code;
    if (buildingId !== undefined && buildingId !== u.buildingId) set.buildingId = buildingId;
    if (set.code !== undefined || set.buildingId !== undefined) {
      const [open] = await tx.db
        .select({ id: deals.id })
        .from(deals)
        .where(and(eq(deals.unitId, unitId), notInArray(deals.state, [...FINAL_DEAL_STATES])))
        .limit(1);
      if (open) throw conflict("unit_in_deal", "this unit has a deal in progress: its code and building can't change");
      if (set.buildingId !== undefined) {
        if (u.buildingId) throw conflict("unit_placed", "a unit stays in the building it was placed in");
        const [b] = await tx.db.select().from(buildings).where(eq(buildings.id, buildingId!));
        if (!b) throw unprocessable("unknown_building", "that building doesn't exist");
      }
      if (set.code !== undefined) {
        const [dup] = await tx.db.select({ id: units.id }).from(units).where(eq(units.code, code!));
        if (dup) throw conflict("unit_code_taken", `unit ${code} already exists`);
      }
    }
    const changed = Object.keys(set);
    if (!changed.length) return { id: unitId };
    await tx.db.update(units).set(set).where(eq(units.id, unitId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "unit", id: unitId },
      type: "UNIT_UPDATED",
      actor: actorOf(user),
      payload: { changed },
    });
    return { id: unitId };
  });
}

/** Edits a project's name, community, location, description and handover date (S75). Its code never changes. */
export async function updateProject(
  ctx: SpaContext,
  projectId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string }> {
  await requireInventory(ctx.database.db, user, "write");
  const parsed = ProjectUpdate.safeParse(input);
  if (!parsed.success) throw invalid("invalid_project", "the project", parsed.error);
  return withSpaTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!p) throw notFound("project");
    if (parsed.data.salesAgentUserId) {
      const [a] = await tx.db
        .select({ id: spaUsers.id })
        .from(spaUsers)
        .where(
          and(
            eq(spaUsers.id, parsed.data.salesAgentUserId),
            eq(spaUsers.active, true),
            inArray(spaUsers.role, ["sales_officer", "sales_manager", "sales_admin"]),
          ),
        );
      if (!a) throw unprocessable("invalid_agent", "pick an active sales user");
    }
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      const value = v ?? null;
      if (k === "name" && value === null) continue;
      if (p[k as keyof typeof p] !== value) set[k] = value;
    }
    const changed = Object.keys(set);
    if (!changed.length) return { id: projectId };
    await tx.db.update(projects).set(set).where(eq(projects.id, projectId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "project", id: projectId },
      type: "PROJECT_UPDATED",
      actor: actorOf(user),
      payload: { changed },
    });
    return { id: projectId };
  });
}

/** A draft price list with every price it holds. A published list never changes (trigger): a new price is a new version. */
export async function createPriceList(
  ctx: SpaContext,
  projectId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string; version: number }> {
  await requireInventory(ctx.database.db, user, "write");
  const parsed = PriceListInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_price_list", "the price list", parsed.error);
  const items = parsed.data.items;
  return withSpaTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!p) throw notFound("project");
    const own = await tx.db
      .select({ id: units.id })
      .from(units)
      .innerJoin(buildings, eq(buildings.id, units.buildingId))
      .where(
        and(
          eq(buildings.projectId, projectId),
          inArray(
            units.id,
            items.map((i) => i.unitId),
          ),
        ),
      );
    if (own.length !== items.length)
      throw unprocessable("unit_not_in_project", "every price must be for a unit in a building of this project");
    const [top] = await tx.db
      .select({ v: sql<number>`coalesce(max(${priceLists.version}), 0)::int` })
      .from(priceLists)
      .where(eq(priceLists.projectId, projectId));
    const version = (top?.v ?? 0) + 1;
    const id = newId();
    await tx.db
      .insert(priceLists)
      .values({ id, projectId, version, createdBy: actorOf(user), createdAt: ctx.clock.now() });
    await tx.db.insert(priceListItems).values(items.map((i) => ({ priceListId: id, ...i })));
    await appendDealEvent(tx, ctx, {
      entity: POLICY_ENTITY,
      type: "PRICE_LIST_CREATED",
      actor: actorOf(user),
      payload: { projectCode: p.code, priceListId: id, version, prices: items.length },
    });
    return { id, version };
  });
}

/** Publishes a draft, once. From then on it is the version in use and nothing in it can change. */
export async function publishPriceList(
  ctx: SpaContext,
  priceListId: string,
  user: Person,
): Promise<{ id: string; version: number }> {
  await requireInventory(ctx.database.db, user, "write");
  return withSpaTx(ctx.database, async (tx) => {
    const [l] = await tx.db.select().from(priceLists).where(eq(priceLists.id, priceListId)).for("update");
    if (!l) throw notFound("price list");
    if (l.publishedAt) throw conflict("already_published", `version ${l.version} is already published`);
    const [p] = await tx.db.select().from(projects).where(eq(projects.id, l.projectId));
    await tx.db.update(priceLists).set({ publishedAt: ctx.clock.now() }).where(eq(priceLists.id, priceListId));
    await appendDealEvent(tx, ctx, {
      entity: POLICY_ENTITY,
      type: "PRICE_LIST_PUBLISHED",
      actor: actorOf(user),
      payload: { projectCode: p?.code, priceListId, version: l.version },
    });
    return { id: priceListId, version: l.version };
  });
}

/**
 * The price-list price of a unit (S64): its price in the project's latest published list, or null (no building, no
 * published list, or the unit isn't in the latest one). A draft is never used.
 */
export async function unitListPrice(
  db: SpaDb,
  unitId: string,
): Promise<{ priceFils: number; version: number; priceListId: string } | null> {
  const [row] = await db
    .select({ priceFils: priceListItems.priceFils, version: priceLists.version, priceListId: priceLists.id })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .innerJoin(priceLists, eq(priceLists.projectId, buildings.projectId))
    .innerJoin(priceListItems, and(eq(priceListItems.priceListId, priceLists.id), eq(priceListItems.unitId, units.id)))
    .where(
      and(
        eq(units.id, unitId),
        isNotNull(priceLists.publishedAt),
        // the latest published version of the project, not merely any published one holding this unit
        sql`${priceLists.version} = (select max(pl2.version) from price_lists pl2 where pl2.project_id = ${buildings.projectId} and pl2.published_at is not null)`,
      ),
    );
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Reads

const UNIT_LABELS: Record<UnitState, string> = {
  AVAILABLE: "Available",
  HELD: "Held",
  SOLD: "Sold",
  REGISTERED: "Registered",
  HANDED_OVER: "Handed over",
};
const OPEN_DEAL = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);

/** Only the last four characters of an account number ever leave the engine (rule 8). */
export const maskAccountLast4 = (iban: string): string => `•••• ${iban.slice(-4)}`;

const latestPublished = (db: SpaDb, projectIds: string[]) =>
  db
    .selectDistinctOn([priceLists.projectId], {
      id: priceLists.id,
      projectId: priceLists.projectId,
      version: priceLists.version,
    })
    .from(priceLists)
    .where(and(inArray(priceLists.projectId, projectIds), isNotNull(priceLists.publishedAt)))
    .orderBy(priceLists.projectId, desc(priceLists.version));

/** The projects table: counts by unit state and the price list in use. No deal detail here. */
export async function listProjects(ctx: SpaContext, user: Person) {
  const db = ctx.database.db;
  await requireInventory(db, user, "read");
  const rows = await db.select().from(projects).orderBy(asc(projects.code));
  const [unplacedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(units)
    .where(isNull(units.buildingId));
  const unplaced = unplacedRow?.n ?? 0;
  if (!rows.length) return { items: [], unplacedUnits: unplaced };
  const ids = rows.map((r) => r.id);
  const stock = await db
    .select({ projectId: buildings.projectId, state: units.state, n: sql<number>`count(*)::int` })
    .from(units)
    .innerJoin(buildings, eq(buildings.id, units.buildingId))
    .where(inArray(buildings.projectId, ids))
    .groupBy(buildings.projectId, units.state);
  const blds = await db
    .select({ projectId: buildings.projectId, n: sql<number>`count(*)::int` })
    .from(buildings)
    .where(inArray(buildings.projectId, ids))
    .groupBy(buildings.projectId);
  const inUse = await latestPublished(db, ids);
  const covers = await coverMedia(db, "project", ids);
  return {
    unplacedUnits: unplaced,
    items: rows.map((p) => {
      const byState: Record<UnitState, number> = { AVAILABLE: 0, HELD: 0, SOLD: 0, REGISTERED: 0, HANDED_OVER: 0 };
      for (const s of stock.filter((x) => x.projectId === p.id)) byState[s.state] = s.n;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        emirate: p.emirate,
        anticipatedCompletionOn: p.anticipatedCompletionOn,
        community: p.community,
        coverMediaId: covers.get(p.id) ?? null,
        buildings: blds.find((b) => b.projectId === p.id)?.n ?? 0,
        units: Object.values(byState).reduce((a, b) => a + b, 0),
        byState,
        priceListVersion: inUse.find((l) => l.projectId === p.id)?.version ?? null,
      };
    }),
  };
}

/**
 * One project: buildings, units (state, price-list price, deal link), price lists by version, the template in use and
 * the escrow account with only its last four characters. Seller and buyer names never appear.
 */
async function salesAgentOf(db: SpaDb, id: string | null): Promise<{ id: string; name: string } | null> {
  if (!id) return null;
  const [a] = await db.select({ id: spaUsers.id, name: spaUsers.name }).from(spaUsers).where(eq(spaUsers.id, id));
  return a ?? null;
}

export async function getProject(ctx: SpaContext, user: Person, projectId: string) {
  const db = ctx.database.db;
  await requireInventory(db, user, "read");
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw notFound("project");
  const blds = await db.select().from(buildings).where(eq(buildings.projectId, p.id)).orderBy(asc(buildings.code));
  const unitRows = blds.length
    ? await db
        .select()
        .from(units)
        .where(
          inArray(
            units.buildingId,
            blds.map((b) => b.id),
          ),
        )
        .orderBy(asc(units.code))
    : [];
  const lists = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.projectId, p.id))
    .orderBy(desc(priceLists.version));
  const counts = lists.length
    ? await db
        .select({ id: priceListItems.priceListId, n: sql<number>`count(*)::int` })
        .from(priceListItems)
        .where(
          inArray(
            priceListItems.priceListId,
            lists.map((l) => l.id),
          ),
        )
        .groupBy(priceListItems.priceListId)
    : [];
  const live = lists.find((l) => l.publishedAt);
  const prices = live
    ? new Map(
        (await db.select().from(priceListItems).where(eq(priceListItems.priceListId, live.id))).map((i) => [
          i.unitId,
          i.priceFils,
        ]),
      )
    : new Map<string, number>();
  const dealRows = unitRows.length
    ? await db
        .select({ id: deals.id, ref: deals.ref, unitId: deals.unitId, state: deals.state, at: deals.createdAt })
        .from(deals)
        .where(
          inArray(
            deals.unitId,
            unitRows.map((u) => u.id),
          ),
        )
        .orderBy(desc(deals.createdAt))
    : [];
  const dealOf = (unitId: string) => {
    const mine = dealRows.filter((d) => d.unitId === unitId);
    const d = mine.find((x) => !OPEN_DEAL.has(x.state)) ?? mine[0];
    if (!d) return null;
    const stage = stageKey(d.state, rolesOf(user));
    return { id: d.id, ref: d.ref, stage, stageLabel: stageLabel(stage), open: !OPEN_DEAL.has(d.state) };
  };
  const escrow = await currentEscrowAccount(db, p.code);
  const kind = p.templateKind ?? "spa";
  const [tpl] = await db
    .select({ name: spaTemplates.name, version: spaTemplateVersions.version })
    .from(spaTemplateVersions)
    .innerJoin(spaTemplates, eq(spaTemplates.id, spaTemplateVersions.templateId))
    .where(
      and(
        eq(spaTemplates.documentKind, kind),
        eq(spaTemplateVersions.status, "approved"),
        sql`(cardinality(${spaTemplates.projectCodes}) = 0 or ${p.code} = any(${spaTemplates.projectCodes}))`,
      ),
    )
    .orderBy(sql`(${p.code} = any(${spaTemplates.projectCodes})) desc`, desc(spaTemplateVersions.decidedAt))
    .limit(1);
  const template = tpl ? { name: tpl.name, version: tpl.version } : null;
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    emirate: p.emirate,
    anticipatedCompletionOn: p.anticipatedCompletionOn,
    community: p.community,
    location: p.location,
    description: p.description,
    // S79: who gets this project's leads; the choices are offered to the admin who edits it.
    salesAgent: await salesAgentOf(db, p.salesAgentUserId),
    salesAgentOptions:
      hasRole(user, "admin")
        ? await db
            .select({ id: spaUsers.id, name: spaUsers.name })
            .from(spaUsers)
            .where(
              and(eq(spaUsers.active, true), inArray(spaUsers.role, ["sales_officer", "sales_manager", "sales_admin"])),
            )
            .orderBy(asc(spaUsers.name))
        : [],
    media: await db
      .select({ id: spaMedia.id, caption: spaMedia.caption, sort: spaMedia.sort })
      .from(spaMedia)
      .where(and(eq(spaMedia.ownerKind, "project"), eq(spaMedia.ownerId, p.id)))
      .orderBy(asc(spaMedia.sort), asc(spaMedia.createdAt)),
    activity: await activityOf(db, "project", p.id),
    templateKind: p.templateKind,
    template,
    escrow: escrow ? { bankName: escrow.bankName, accountMasked: maskAccountLast4(escrow.iban) } : null,
    buildings: blds.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      units: unitRows.filter((u) => u.buildingId === b.id).length,
    })),
    units: unitRows.map((u) => ({
      id: u.id,
      code: u.code,
      buildingId: u.buildingId!,
      state: u.state,
      stateLabel: UNIT_LABELS[u.state],
      listPriceFils: prices.get(u.id) ?? null,
      deal: dealOf(u.id),
    })),
    priceLists: lists.map((l) => ({
      id: l.id,
      version: l.version,
      status: l.publishedAt ? ("published" as const) : ("draft" as const),
      publishedAt: l.publishedAt?.toISOString() ?? null,
      prices: counts.find((c) => c.id === l.id)?.n ?? 0,
      inUse: l.id === live?.id,
    })),
  };
}
