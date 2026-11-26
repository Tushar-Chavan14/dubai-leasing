import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { CatalogueQuery, PublicProperty, PublicPropertyDetail } from "@spa/core";
import { type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { createApp } from "../src/app.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { addBuilding, addUnit, createPriceList, createProject, publishPriceList } from "../src/manager/inventory.ts";
import { addMedia, readPublicMedia } from "../src/manager/media.ts";
import { setCompany } from "../src/manager/parties.ts";
import { listCatalogue } from "../src/manager/public-catalogue.ts";
import { seedSpaDemo } from "../src/seed.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const NOW = Date.parse("2026-11-25T06:00:00Z");
const SECRET = "test-secret-test-secret-test-secret";
const SECRETS = ["Hidden Seller Name", "Hidden Holdings LLC", "SECRET-DEED-1", "secret-seller@example.test"];

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
    ...chunk("IDAT", [1, 2, 3, seed & 0xff, seed >> 8]),
    ...chunk("IEND", []),
  ]);

describe.skipIf(!url)("M4: public catalogue (S78)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  let dir: string;
  let store: LocalDiskStore;
  let app: ReturnType<typeof createApp>;
  let seq = 0;
  const admin = () => users.admin!;
  const rows = async (sql: string, args: unknown[] = []) => (await database.pool.query(sql, args)).rows;
  const get = async (path: string) => {
    const res = await app.request(path);
    return { status: res.status, text: await res.text(), res };
  };

  /** A listing with sellers and a deed that must never show. */
  const listing = async (
    o: {
      state?: string;
      permit?: string | null;
      title?: string;
      price?: number | null;
      community?: string;
      beds?: number;
    } = {},
  ): Promise<{ id: string; ref: string }> => {
    const id = newId();
    const ref = `T-${++seq}-${id.slice(-6)}`;
    await rows(
      `insert into listings (id, ref, state, title, description, community, bedrooms, bathrooms, size_sqft, asking_price_fils, permit_no, permit_expires_on, agent_user_id, ownership_kind, ownership_ref, unit_type, furnished)
       values ($1, $2, $3, $4, 'Bright flat near the beach.', $5, $6, 2, 1200, $7, 'PRM-123456', $8, $9, 'title_deed', 'SECRET-DEED-1', 'apartment', 'semi')`,
      [
        id,
        ref,
        o.state ?? "PUBLISHED",
        o.title ?? "2BR Marina",
        o.community ?? "Dubai Marina",
        o.beds ?? 2,
        o.price === undefined ? 250_000_000 : o.price,
        o.permit === undefined ? "2026-12-31" : o.permit,
        users.officer!.id,
      ],
    );
    const party = newId();
    await rows(
      `insert into parties (id, kind, full_name_en, email, created_at) values ($1, 'person', 'Hidden Seller Name', 'secret-seller@example.test', now())`,
      [party],
    );
    await rows(`insert into listing_parties (listing_id, party_id, "order", share_bps) values ($1, $2, 1, 10000)`, [
      id,
      party,
    ]).catch(() => undefined);
    return { id, ref };
  };

  const project = async (o: { community?: string; prices?: number[]; publish?: boolean; name?: string } = {}) => {
    const n = ++seq;
    const p = await createProject(
      ctx,
      {
        code: `PC-${n}`,
        name: o.name ?? `Public Project ${n}`,
        community: o.community ?? "Business Bay",
        anticipatedCompletionOn: "2028-03-15",
      },
      admin(),
    );
    const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, admin());
    const unitIds: { id: string; code: string }[] = [];
    for (const [i] of (o.prices ?? [150_000_000]).entries()) {
      const code = `PU-${n}-${i}`;
      const u = await addUnit(
        ctx,
        p.id,
        { buildingId: b.id, code, type: "apartment", bedrooms: i + 1, internalSqft: 700 + i * 100 },
        admin(),
      );
      unitIds.push({ id: u.id, code });
    }
    if (o.prices) {
      const list = await createPriceList(
        ctx,
        p.id,
        { items: unitIds.map((u, i) => ({ unitId: u.id, priceFils: o.prices![i]! })) },
        admin(),
      );
      if (o.publish !== false) await publishPriceList(ctx, list.id, admin());
    }
    return { id: p.id, code: `PC-${n}`, units: unitIds };
  };
  const setUnit = (id: string, state: string) => rows("update units set state = $2 where id = $1", [id, state]);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spa-public-test-"));
    store = new LocalDiskStore(dir);
    database = await freshSpaDatabase(url!);
    const clock = new FixedClock(new Date(NOW));
    ctx = { database, clock, facts: failClosedFacts };
    users = await seedUsers(database);
    await setCompany(ctx, { name: "Fictional Developments LLC", kind: "both" }, "system");
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      // The app only reads `today()` and `now()` from it; a fixed clock stands in for the demo clock.
      clock: clock as never,
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      media: store,
    });
  });
  afterAll(async () => {
    await database?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("a published listing with a valid permit and an available unit with a published price are both listed", async () => {
    const l = await listing();
    const p = await project({ prices: [150_000_000] });
    const r = await get("/public/catalogue");
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text) as { items: PublicProperty[] };
    const refs = body.items.map((i) => i.ref);
    expect(refs).toContain(l.ref);
    const unitRef = `U-${p.code}-${p.units[0]!.code}`;
    expect(refs).toContain(unitRef);
    const unit = body.items.find((i) => i.ref === unitRef)!;
    expect(unit).toMatchObject({
      source: "developer",
      developerName: "Fictional Developments LLC",
      permitNo: null,
      priceFils: 150_000_000,
      handover: "Mar 2028",
      unitTypeLabel: "Apartment",
    });
    expect(body.items.find((i) => i.ref === l.ref)).toMatchObject({ source: "listing", permitNo: "PRM-123456" });
    for (const i of body.items) expect(PublicProperty.safeParse(i).success).toBe(true);
  });

  test("draft, active, withdrawn listings and held, sold units and units without a published price are absent", async () => {
    const draft = await listing({ state: "DRAFT" });
    const active = await listing({ state: "ACTIVE" });
    const withdrawn = await listing({ state: "WITHDRAWN" });
    const noPrice = await listing({ price: null });
    const p = await project({ prices: [100_000_000, 110_000_000, 120_000_000] });
    await setUnit(p.units[1]!.id, "HELD");
    await setUnit(p.units[2]!.id, "SOLD");
    const draftList = await project({ prices: [130_000_000], publish: false });
    const unpriced = await project();
    const refs = (JSON.parse((await get("/public/catalogue")).text) as { items: PublicProperty[] }).items.map(
      (i) => i.ref,
    );
    for (const l of [draft, active, withdrawn, noPrice]) expect(refs).not.toContain(l.ref);
    expect(refs).toContain(`U-${p.code}-${p.units[0]!.code}`);
    expect(refs).not.toContain(`U-${p.code}-${p.units[1]!.code}`);
    expect(refs).not.toContain(`U-${p.code}-${p.units[2]!.code}`);
    expect(refs).not.toContain(`U-${draftList.code}-${draftList.units[0]!.code}`);
    expect(refs).not.toContain(`U-${unpriced.code}-${unpriced.units[0]!.code}`);
    expect((await get(`/public/catalogue/${draft.ref}`)).status).toBe(404);
    expect((await get(`/public/catalogue/U-${p.code}-${p.units[1]!.code}`)).status).toBe(404);
  });

  test("the price shown is the latest published list; an unpublished newer draft never shows", async () => {
    const p = await project({ prices: [140_000_000] });
    const v2 = await createPriceList(
      ctx,
      p.id,
      { items: [{ unitId: p.units[0]!.id, priceFils: 150_000_000 }] },
      admin(),
    );
    const ref = `U-${p.code}-${p.units[0]!.code}`;
    expect((JSON.parse((await get(`/public/catalogue/${ref}`)).text) as PublicProperty).priceFils).toBe(140_000_000);
    await publishPriceList(ctx, v2.id, admin());
    expect((JSON.parse((await get(`/public/catalogue/${ref}`)).text) as PublicProperty).priceFils).toBe(150_000_000);
  });

  test("a permit ending today is listed; one that ended yesterday is absent and its page is 404", async () => {
    const today = await listing({ permit: "2026-11-25" });
    const yesterday = await listing({ permit: "2026-11-24" });
    const refs = (JSON.parse((await get("/public/catalogue")).text) as { items: PublicProperty[] }).items.map(
      (i) => i.ref,
    );
    expect(refs).toContain(today.ref);
    expect(refs).not.toContain(yesterday.ref);
    expect((await get(`/public/catalogue/${today.ref}`)).status).toBe(200);
    expect((await get(`/public/catalogue/${yesterday.ref}`)).status).toBe(404);
    expect((await get(`/public/listings/${yesterday.ref}`)).status).toBe(404);
  });

  test("filters: source, community, beds, price band and sort each narrow correctly", async () => {
    const hill = await project({ community: "Filter Hills", prices: [500_000_000, 700_000_000] });
    const l = await listing({ community: "Filter Hills", price: 600_000_000, beds: 2, title: "Filter listing" });
    const ids = (q: string) =>
      get(`/public/catalogue?community=Filter%20Hills${q}`).then(
        (r) => (JSON.parse(r.text) as { items: PublicProperty[] }).items,
      );
    expect((await ids("")).length).toBe(3);
    expect((await ids("&source=listing")).map((i) => i.ref)).toEqual([l.ref]);
    expect((await ids("&source=developer")).length).toBe(2);
    // bedrooms: unit 0 has 1 bed, unit 1 has 2, the listing has 2
    expect((await ids("&beds=2")).length).toBe(2);
    expect((await ids("&beds=1")).map((i) => i.ref)).toEqual([`U-${hill.code}-${hill.units[0]!.code}`]);
    expect((await ids("&min=550000000&max=650000000")).map((i) => i.ref)).toEqual([l.ref]);
    expect((await ids("&type=villa")).length).toBe(0);
    expect((await ids("&sort=price_asc")).map((i) => i.priceFils)).toEqual([500_000_000, 600_000_000, 700_000_000]);
    expect((await ids("&sort=price_desc")).map((i) => i.priceFils)).toEqual([700_000_000, 600_000_000, 500_000_000]);
    const all = JSON.parse((await get("/public/catalogue")).text) as { facets: { communities: string[] } };
    expect(all.facets.communities).toContain("Filter Hills");
    expect((await get("/public/catalogue?beds=abc")).status).toBe(400);
  });

  test("leak test: no seller, deed or email appears in the catalogue or a detail page, and the shape is strict", async () => {
    const l = await listing({ title: "Leak check listing" });
    const p = await project({ prices: [160_000_000] });
    const cat = await get("/public/catalogue");
    const detail = await get(`/public/catalogue/${l.ref}`);
    const legacy = await get(`/public/listings/${l.ref}`);
    const unit = await get(`/public/catalogue/U-${p.code}-${p.units[0]!.code}`);
    for (const r of [cat, detail, legacy, unit]) {
      expect(r.status).toBe(200);
      for (const s of SECRETS) expect(r.text).not.toContain(s);
      for (const k of ["ownership", "askingPriceFils", "agentUserId", "email", "partyId", "floorPrice"])
        expect(r.text).not.toContain(`"${k}"`);
    }
    for (const i of (JSON.parse(cat.text) as { items: unknown[] }).items)
      expect(PublicProperty.strict().safeParse(i).success).toBe(true);
    const d = JSON.parse(detail.text);
    expect(PublicPropertyDetail.strict().safeParse(d).success).toBe(true);
    expect(d.agent).toEqual({ name: "officer" });
    expect(d.chat).toBe(true);
    expect(JSON.parse(unit.text).chat).toBe(false);
  });

  test("a published listing with a valid date but no permit number is not public (the number is printed on every listing)", async () => {
    const l = await listing();
    await rows("update listings set permit_no = null where id = $1", [l.id]);
    const m = await addMedia(ctx, store, { kind: "listing", id: l.id }, png(201), null, users.officer!);
    const refs = (JSON.parse((await get("/public/catalogue")).text) as { items: PublicProperty[] }).items.map(
      (i) => i.ref,
    );
    expect(refs).not.toContain(l.ref);
    expect((await get(`/public/catalogue/${l.ref}`)).status).toBe(404);
    expect((await get(`/public/media/${m.media.id}/file`)).status).toBe(404);
  });

  test("an unknown ref is 404", async () => {
    expect((await get("/public/catalogue/L-9999")).status).toBe(404);
    expect((await get("/public/catalogue/U-NOPE-NOPE")).status).toBe(404);
    expect((await get("/public/listings/L-9999")).status).toBe(404);
  });

  test("public photos: served for a public listing, unit and project; 404 once the owner stops being public or never was", async () => {
    const l = await listing();
    const draft = await listing({ state: "DRAFT" });
    const p = await project({ prices: [170_000_000] });
    const other = await project();
    const lp = await addMedia(ctx, store, { kind: "listing", id: l.id }, png(101), null, users.officer!);
    const dp = await addMedia(ctx, store, { kind: "listing", id: draft.id }, png(102), null, users.officer!);
    const up = await addMedia(ctx, store, { kind: "unit", id: p.units[0]!.id }, png(103), null, admin());
    const pp = await addMedia(ctx, store, { kind: "project", id: p.id }, png(104), null, admin());
    const np = await addMedia(ctx, store, { kind: "unit", id: other.units[0]!.id }, png(105), null, admin());
    for (const m of [lp, up, pp]) {
      const r = await get(`/public/media/${m.media.id}/file`);
      expect(r.status).toBe(200);
      expect(r.res.headers.get("content-type")).toBe("image/png");
      expect(r.res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(r.res.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await get(`/public/media/${dp.media.id}/file`)).status).toBe(404);
    expect((await get(`/public/media/${np.media.id}/file`)).status).toBe(404);
    expect((await get(`/public/media/${newId()}/file`)).status).toBe(404);
    expect((await get(`/public/media/not-an-id/file`)).status).toBe(404);
    // the catalogue names the unit's own photo first, then its project's
    const detail = JSON.parse((await get(`/public/catalogue/U-${p.code}-${p.units[0]!.code}`)).text);
    expect(detail.photoIds).toEqual([up.media.id, pp.media.id]);
    // a withdrawn listing and a sold unit stop serving
    await rows("update listings set state = 'WITHDRAWN' where id = $1", [l.id]);
    await setUnit(p.units[0]!.id, "SOLD");
    expect((await get(`/public/media/${lp.media.id}/file`)).status).toBe(404);
    expect((await get(`/public/media/${up.media.id}/file`)).status).toBe(404);
    expect((await get(`/public/media/${pp.media.id}/file`)).status).toBe(404);
    expect(await readPublicMedia(ctx, store, lp.media.id)).toBeNull();
  });

  test("the public routes are rate limited per client", async () => {
    const hit = () => app.request("/public/catalogue/L-9999", { headers: { "x-forwarded-for": "198.51.100.9" } });
    let last = 0;
    for (let i = 0; i < 605; i++) last = (await hit()).status;
    expect(last).toBe(429);
  });
});

describe.skipIf(!url)("M4: the demo seed fills the public site (S78)", () => {
  test("at least 3 public listings and 4 public units across 2 projects, each with photos", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spa-public-seed-"));
    const database = await freshSpaDatabase(url!);
    try {
      const clock = new FixedClock(new Date(NOW));
      await seedSpaDemo(database, clock, { SPA_DEMO_MODE: true }, undefined, new LocalDiskStore(dir));
      const ctx: SpaContext = { database, clock, facts: failClosedFacts };
      const { items } = await listCatalogue(ctx, CatalogueQuery.parse({}));
      const listingsOnSale = items.filter((i) => i.source === "listing");
      const unitsOnSale = items.filter((i) => i.source === "developer");
      expect(listingsOnSale.length).toBeGreaterThanOrEqual(3);
      expect(unitsOnSale.length).toBeGreaterThanOrEqual(4);
      expect(new Set(unitsOnSale.map((u) => u.projectName)).size).toBeGreaterThanOrEqual(2);
      for (const i of items) {
        expect(i.photoCount).toBeGreaterThanOrEqual(2);
        expect(i.coverPhotoId).not.toBeNull();
      }
      expect(listingsOnSale.every((l) => !!l.permitNo)).toBe(true);
    } finally {
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
