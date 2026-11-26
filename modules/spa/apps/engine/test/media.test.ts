import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock } from "@platform/kernel";
import { dealEvents, listings, spaMedia, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { addBuilding, addUnit, createProject } from "../src/manager/inventory.ts";
import { addMedia, listMedia, removeMedia, reorderMedia, readMedia } from "../src/manager/media.ts";
import { setCompany } from "../src/manager/parties.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { issueToken } from "./session.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const NOW = Date.parse("2026-11-25T06:00:00Z");
const SECRET = "test-secret-test-secret-test-secret";

// Tiny fictional image files built from bytes. `seed` makes each one different.
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const seg = (marker: number, body: number[]) => [
  0xff,
  marker,
  (body.length + 2) >> 8,
  (body.length + 2) & 0xff,
  ...body,
];
const jpeg = (seed: number, withExif = false) =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(withExif ? seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPSLatitude 25.08N")]) : []),
    ...seg(0xda, [1, 2, 3]),
    0x11,
    0x22,
    seed & 0xff,
    (seed >> 8) & 0xff,
    0xff,
    0xd9,
  ]);
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

describe.skipIf(!url)("M2: media (photos) through SpaManager (S75)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  let dir: string;
  let store: LocalDiskStore;
  let seq = 0;
  const admin = () => users.admin!;
  const fail = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string }) => e,
    );
  const unit = async () => {
    const p = await createProject(ctx, { code: `MED-${++seq}`, name: "Marina Heights" }, admin());
    const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, admin());
    return (await addUnit(ctx, p.id, { buildingId: b.id, code: `MU-${++seq}` }, admin())).id;
  };
  const listing = async () => {
    const id = crypto.randomUUID();
    await database.db.insert(listings).values({ id });
    return id;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spa-media-test-"));
    store = new LocalDiskStore(dir);
    database = await freshSpaDatabase(url!);
    ctx = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
    users = await seedUsers(database);
    await setCompany(ctx, { name: "Fictional Co", kind: "both" }, "system");
  });
  afterAll(async () => {
    await database?.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("an admin adds a unit photo: stored, listed, audited without the path", async () => {
    const id = await unit();
    const r = await addMedia(ctx, store, { kind: "unit", id }, png(1), "Living room", admin());
    expect(r.duplicate).toBe(false);
    expect(await listMedia(database.db, { kind: "unit", id })).toEqual([
      { id: r.media.id, caption: "Living room", sort: 0 },
    ]);
    const [ev] = await database.db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.entityId, id), eq(dealEvents.type, "MEDIA_ADDED")));
    expect(ev!.entityKind).toBe("unit");
    expect(ev!.payload).toMatchObject({ mediaId: r.media.id, sha256: r.media.sha256 });
    expect(JSON.stringify(ev!.payload)).not.toContain(r.media.path);
    expect((await readMedia(ctx, store, r.media.id, users.officer!)).mime).toBe("image/png");
  });

  test("role rules: a sales officer can't add to a unit (403) but can to a listing; a missing owner is 404", async () => {
    const u = await unit();
    expect((await fail(addMedia(ctx, store, { kind: "unit", id: u }, png(2), null, users.officer!)))?.status).toBe(403);
    const l = await listing();
    const r = await addMedia(ctx, store, { kind: "listing", id: l }, png(3), null, users.officer!);
    expect(r.duplicate).toBe(false);
    expect(
      (await fail(addMedia(ctx, store, { kind: "unit", id: crypto.randomUUID() }, png(4), null, admin())))?.status,
    ).toBe(404);
    // an admin is not a listing writer, and a finance user reads neither
    expect((await fail(addMedia(ctx, store, { kind: "listing", id: l }, png(5), null, users.finance!)))?.status).toBe(
      403,
    );
    expect((await fail(readMedia(ctx, store, r.media.id, users.finance!)))?.status).toBe(403);
  });

  test("on a brokerage company a sales officer adds to a listing; on a developer company listings are refused", async () => {
    const l = await listing();
    await setCompany(ctx, { name: "Fictional Co", kind: "brokerage" }, "system");
    try {
      expect((await addMedia(ctx, store, { kind: "listing", id: l }, png(6), null, users.officer!)).duplicate).toBe(
        false,
      );
      const u = await unit().catch(() => null);
      expect(u).toBeNull(); // inventory is closed to a brokerage
    } finally {
      await setCompany(ctx, { name: "Fictional Co", kind: "both" }, "system");
    }
  });

  test("file rules: duplicate, too large, wrong type", async () => {
    const id = await unit();
    const o = { kind: "unit" as const, id };
    const a = await addMedia(ctx, store, o, png(10), null, admin());
    const b = await addMedia(ctx, store, o, png(10), null, admin());
    expect(b.duplicate).toBe(true);
    expect(b.media.id).toBe(a.media.id);
    expect(await listMedia(database.db, o)).toHaveLength(1);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(png(1));
    expect(await fail(addMedia(ctx, store, o, big, null, admin()))).toMatchObject({ status: 422, code: "too_large" });
    expect(await fail(addMedia(ctx, store, o, new TextEncoder().encode("hello"), null, admin()))).toMatchObject({
      status: 422,
      code: "unsupported_type",
    });
  });

  test("the 25th photo is refused; two parallel adds at 23 let exactly one in", async () => {
    const id = await unit();
    const o = { kind: "unit" as const, id };
    for (let i = 0; i < 23; i++) await addMedia(ctx, store, o, png(100 + i), null, admin());
    const results = await Promise.all([
      fail(addMedia(ctx, store, o, png(900), null, admin())),
      fail(addMedia(ctx, store, o, png(901), null, admin())),
      fail(addMedia(ctx, store, o, png(902), null, admin())),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r?.code === "too_many")).toHaveLength(2);
    expect(await listMedia(database.db, o)).toHaveLength(24);
    expect(await fail(addMedia(ctx, store, o, png(903), null, admin()))).toMatchObject({
      status: 422,
      code: "too_many",
    });
  });

  test("reorder needs exactly the owner's set; the first becomes the cover", async () => {
    const id = await unit();
    const o = { kind: "unit" as const, id };
    const a = await addMedia(ctx, store, o, png(20), null, admin());
    const b = await addMedia(ctx, store, o, png(21), null, admin());
    expect(await fail(reorderMedia(ctx, o, [a.media.id], admin()))).toMatchObject({ status: 422 });
    expect(await fail(reorderMedia(ctx, o, [a.media.id, crypto.randomUUID()], admin()))).toMatchObject({ status: 422 });
    await reorderMedia(ctx, o, [b.media.id, a.media.id], admin());
    expect((await listMedia(database.db, o)).map((m) => m.id)).toEqual([b.media.id, a.media.id]);
  });

  test("remove deletes the row and the file, once no owner uses it", async () => {
    const u1 = await unit();
    const u2 = await unit();
    const bytes = png(30);
    const a = await addMedia(ctx, store, { kind: "unit", id: u1 }, bytes, null, admin());
    const b = await addMedia(ctx, store, { kind: "unit", id: u2 }, bytes, null, admin());
    await removeMedia(ctx, store, a.media.id, admin());
    expect((await readFile(join(dir, a.media.path))).length).toBeGreaterThan(0); // still used by u2
    await removeMedia(ctx, store, b.media.id, admin());
    expect(await readFile(join(dir, a.media.path)).catch(() => null)).toBeNull();
    expect(await database.db.select().from(spaMedia).where(eq(spaMedia.id, a.media.id))).toHaveLength(0);
  });

  test("metadata is stripped before the file reaches the disk", async () => {
    const id = await unit();
    const src = jpeg(40, true);
    expect(Buffer.from(src).includes("GPSLatitude")).toBe(true);
    const r = await addMedia(ctx, store, { kind: "unit", id }, src, null, admin());
    const onDisk = await readFile(join(dir, r.media.path));
    expect(onDisk.includes("GPSLatitude")).toBe(false);
    expect(onDisk.includes("Exif")).toBe(false);
  });

  test("routes: upload, list, caption, order, file and delete, each behind a session", async () => {
    const app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      media: store,
    });
    const id = await unit();
    const bearer = (k: string) => ({ authorization: `Bearer ${issueToken(SECRET, users[k]!.id, NOW)}` });
    expect((await app.request(`/api/media?kind=unit&id=${id}`)).status).toBe(401);
    const form = new FormData();
    form.set("kind", "unit");
    form.set("id", id);
    form.set("caption", "Entrance");
    form.set("file", new File([png(50)], "a.png", { type: "image/png" }));
    expect((await app.request("/api/media", { method: "POST", headers: bearer("officer"), body: form })).status).toBe(
      403,
    );
    const up = await app.request("/api/media", { method: "POST", headers: bearer("admin"), body: form });
    expect(up.status).toBe(201);
    const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
    const list = await app.request(`/api/media?kind=unit&id=${id}`, { headers: bearer("officer") });
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(1);
    const file = await app.request(`/api/media/${mediaId}/file`, { headers: bearer("officer") });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("cache-control")).toBe("private, max-age=300");
    const cap = await app.request(`/api/media/${mediaId}`, {
      method: "PATCH",
      headers: { ...bearer("admin"), "content-type": "application/json" },
      body: JSON.stringify({ caption: "Lobby" }),
    });
    expect(cap.status).toBe(200);
    const ord = await app.request("/api/media/order", {
      method: "PUT",
      headers: { ...bearer("admin"), "content-type": "application/json" },
      body: JSON.stringify({ kind: "unit", id, ids: [mediaId] }),
    });
    expect(ord.status).toBe(200);
    expect((await app.request(`/api/media/${mediaId}`, { method: "DELETE", headers: bearer("admin") })).status).toBe(
      204,
    );
    expect((await app.request(`/api/media/${mediaId}/file`, { headers: bearer("admin") })).status).toBe(404);
  });
});
