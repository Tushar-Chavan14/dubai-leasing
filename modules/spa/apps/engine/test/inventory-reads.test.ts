import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock } from "@platform/kernel";
import { type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  addBuilding,
  addUnit,
  createPriceList,
  createProject,
  getProject,
  listProjects,
  publishPriceList,
  updateUnit,
} from "../src/manager/inventory.ts";
import { getUnit, listUnits } from "../src/manager/inventory-reads.ts";
import { addMedia } from "../src/manager/media.ts";
import { setCompany } from "../src/manager/parties.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";
import { issueToken } from "./session.ts";
import { deals, units } from "@spa/db";
import { eq } from "drizzle-orm";

const url = spaTestDatabaseUrl();
const NOW = Date.parse("2026-11-25T06:00:00Z");
const SECRET = "test-secret-test-secret-test-secret";
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (kind: string, data: number[]) => [...be32(data.length), ...ascii(kind), ...data, 0, 0, 0, 0];
const png = (seed: number) =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk("IDAT", [1, 2, 3, seed]),
    ...chunk("IEND", []),
  ]);

describe.skipIf(!url)("M2: unit list and unit record reads (S75)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  let dir: string;
  let projectId: string;
  let ids: string[];
  const admin = () => users.admin!;
  const fail = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string }) => e,
    );

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spa-reads-test-"));
    database = await freshSpaDatabase(url!);
    ctx = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
    users = await seedUsers(database);
    await setCompany(ctx, { name: "Fictional Developments LLC", kind: "developer" }, "system");
    const p = await createProject(ctx, { code: "RD-1", name: "Marina Heights" }, admin());
    projectId = p.id;
    const b = await addBuilding(ctx, projectId, { code: "A", name: "Tower A" }, admin());
    const mk = async (code: string, extra: Record<string, unknown>) =>
      (await addUnit(ctx, projectId, { buildingId: b.id, code, ...extra }, admin())).id;
    ids = [
      await mk("R-101", { type: "apartment", bedrooms: 0, view: "Marina" }),
      await mk("R-102", { type: "apartment", bedrooms: 2, view: "Pool" }),
      await mk("R-103", { type: "villa", bedrooms: 2 }),
      await mk("R-104", { type: "penthouse", bedrooms: 3 }),
    ];
    const l = await createPriceList(
      ctx,
      projectId,
      { items: ids.map((unitId, i) => ({ unitId, priceFils: (1 + i) * 100_000_000 })) },
      admin(),
    );
    await publishPriceList(ctx, l.id, admin());
  });
  afterAll(async () => {
    await database?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const codes = (r: { items: { code: string }[] }) => r.items.map((i) => i.code);

  test("filters: type, beds and state narrow the list; ordered by project then unit code", async () => {
    expect(codes(await listUnits(ctx, admin(), { type: "villa" }))).toEqual(["R-103"]);
    expect(codes(await listUnits(ctx, admin(), { beds: "2" }))).toEqual(["R-102", "R-103"]);
    expect(codes(await listUnits(ctx, admin(), { state: "HELD" }))).toEqual([]);
    expect(codes(await listUnits(ctx, admin(), {}))).toEqual(["R-101", "R-102", "R-103", "R-104"]);
    expect(codes(await listUnits(ctx, admin(), { q: "103" }))).toEqual(["R-103"]);
  });

  test("bad filter values are dropped: beds=99 or type=castle is the unfiltered list, not an error", async () => {
    const all = codes(await listUnits(ctx, admin(), {}));
    expect(codes(await listUnits(ctx, admin(), { beds: "99", type: "castle", state: "x", project: "nope" }))).toEqual(
      all,
    );
    expect(codes(await listUnits(ctx, admin(), { q: "x'; drop table units;--" }))).toEqual([]);
  });

  test("the price band uses the price in use; a newer version replaces the old price", async () => {
    expect(codes(await listUnits(ctx, admin(), { minPriceFils: "250000000" }))).toEqual(["R-103", "R-104"]);
    expect(codes(await listUnits(ctx, admin(), { maxPriceFils: "150000000" }))).toEqual(["R-101"]);
    const row = (await listUnits(ctx, admin(), { q: "R-101" })).items[0]!;
    expect(row.priceFils).toBe(100_000_000);
    expect(row.project).toMatchObject({ name: "Marina Heights" });
  });

  test("pagination: the cursor gives the second page without overlap; facets list what exists", async () => {
    const first = await listUnits(ctx, admin(), { limit: "2" });
    expect(codes(first)).toEqual(["R-101", "R-102"]);
    expect(first.next).not.toBeNull();
    const second = await listUnits(ctx, admin(), { limit: "2", cursor: first.next });
    expect(codes(second)).toEqual(["R-103", "R-104"]);
    expect(second.next).toBeNull();
    expect(first.facets.types).toEqual(["apartment", "penthouse", "villa"]);
    expect(first.facets.beds).toEqual([0, 2, 3]);
    expect(first.facets.projects).toEqual([{ id: projectId, name: "Marina Heights" }]);
    expect(await fail(listUnits(ctx, admin(), { cursor: "@@@" }))).toBeTruthy();
  });

  test("a role outside the readers is refused (403); a sales officer reads", async () => {
    expect((await fail(listUnits(ctx, users.finance!, {})))?.status).toBe(403);
    expect((await fail(getUnit(ctx, users.legal!, ids[0]!)))?.status).toBe(403);
    expect(codes(await listUnits(ctx, users.officer!, {}))).toHaveLength(4);
  });

  test("getUnit: price history after v1 and v2 has two entries, oldest first, v2 current", async () => {
    const unit = ids[1]!;
    const l2 = await createPriceList(ctx, projectId, { items: [{ unitId: unit, priceFils: 333_000_000 }] }, admin());
    await publishPriceList(ctx, l2.id, admin());
    const u = await getUnit(ctx, admin(), unit);
    expect(u.priceHistory.map((h) => [h.version, h.priceFils])).toEqual([
      [1, 200_000_000],
      [2, 333_000_000],
    ]);
    expect(u.currentPriceFils).toBe(333_000_000);
    expect(u).toMatchObject({ code: "R-102", view: "Pool", bedrooms: 2 });
    expect(u.project).toMatchObject({ code: "RD-1" });
    // a unit not in the latest list has no price in use, but keeps its history
    const other = await getUnit(ctx, admin(), ids[0]!);
    expect(other.currentPriceFils).toBeNull();
    expect(other.priceHistory).toHaveLength(1);
  });

  test("openDeal is set only for a non-final deal; a finished one is a past deal", async () => {
    const { dealId } = await dealInDraft(ctx, database);
    const [d] = await database.db.select().from(deals).where(eq(deals.id, dealId));
    const unitId = d!.unitId!;
    expect((await getUnit(ctx, admin(), unitId)).openDeal).toMatchObject({ id: dealId });
    await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, dealId));
    const after = await getUnit(ctx, admin(), unitId);
    expect(after.openDeal).toBeNull();
    expect(after.pastDeals.map((x) => x.id)).toEqual([dealId]);
    expect(await database.db.select({ id: units.id }).from(units).where(eq(units.id, unitId))).toHaveLength(1);
  });

  test("a photo becomes the cover; activity lists the changes with words and names", async () => {
    const store = new LocalDiskStore(dir);
    const unit = ids[2]!;
    const r = await addMedia(ctx, store, { kind: "unit", id: unit }, png(1), "Hall", admin());
    await updateUnit(ctx, unit, { view: "Park" }, admin());
    const item = (await listUnits(ctx, admin(), { q: "R-103" })).items[0]!;
    expect(item.coverMediaId).toBe(r.media.id);
    const u = await getUnit(ctx, admin(), unit);
    expect(u.media).toEqual([{ id: r.media.id, caption: "Hall", sort: 0 }]);
    expect(u.activity.map((a) => a.label)).toEqual(["Details changed", "Photo added", "Unit added"]);
    expect(u.activity[0]).toMatchObject({ actor: "admin", changed: ["view"] });
    expect(JSON.stringify(u.activity)).not.toMatch(/UNIT_|MEDIA_/);
  });

  test("getProject and listProjects carry the new fields", async () => {
    expect((await listProjects(ctx, admin())).items[0]).toMatchObject({ community: null, coverMediaId: null });
    expect(await getProject(ctx, admin(), projectId)).toMatchObject({ community: null, location: null, media: [] });
  });

  test("routes: GET /api/units drops bad params; GET /api/units/:id answers; a bad id is 404", async () => {
    const app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    const h = { authorization: `Bearer ${issueToken(SECRET, admin().id, NOW)}` };
    expect((await app.request("/api/units")).status).toBe(401);
    const r = await app.request("/api/units?beds=99&type=castle", { headers: h });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(4);
    expect((await app.request(`/api/units/${ids[0]}`, { headers: h })).status).toBe(200);
    expect((await app.request("/api/units/not-an-id", { headers: h })).status).toBe(404);
    expect((await app.request(`/api/units/${crypto.randomUUID()}`, { headers: h })).status).toBe(404);
    expect((await app.request("/api/units?cursor=@@@", { headers: h })).status).toBe(400);
  });
});
