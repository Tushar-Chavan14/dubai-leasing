/* oxlint-disable no-explicit-any -- the mocked framework calls are read loosely */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { FixedClock, issueToken } from "../../engine/test/session.ts";
import { buildings, priceLists, projects, units, type SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { failClosedFacts } from "../../engine/src/manager/facts.ts";
import { setCompany } from "../../engine/src/manager/parties.ts";
import { seedUsers, type U } from "../../engine/test/prepare-fixtures.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

let session = "";
const redirects: string[] = [];
const revalidated: string[] = [];
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session }) }) }));
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
mock.module("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
mock.module("../lib/env", () => ({ engineUrl: () => "http://engine.test", sessionCookie: () => "spa_session" }));

describe.skipIf(!url)("C32: the Inventory server actions", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  const realFetch = globalThis.fetch;
  const asUser = (k: string) => (session = issueToken(SECRET, users[k]!.id, NOW));
  const run = async (name: string, f: Record<string, string>) => {
    const actions = await import("../app/(staff)/inventory/actions");
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.set(k, v);
    redirects.length = 0;
    revalidated.length = 0;
    await (actions as any)[name](form).catch(() => {});
    return redirects[0];
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    await setCompany(
      { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts },
      { name: "Fictional Co", kind: "developer" },
      "system",
    );
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    globalThis.fetch = ((input: string, init?: RequestInit) =>
      app.request(String(input).replace("http://engine.test", ""), init)) as never;
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await database?.close();
  });

  test("a sales role's forged form changes nothing: the engine refuses and the page shows its fixed words", async () => {
    asUser("officer");
    expect(await run("createProject", { code: "FORGED", name: "Forged", role: "admin" })).toBe(
      "/inventory?error=refused",
    );
    expect((await database.db.select().from(projects)).length).toBe(0);
    expect(revalidated).toEqual([]);
  });

  test("a bad form is refused before any request", async () => {
    asUser("admin");
    expect(await run("createProject", { code: "", name: "x" })).toBe("/inventory?error=invalid");
    expect((await database.db.select().from(projects)).length).toBe(0);
  });

  test("an admin adds a project, a building, a unit and a price list, publishes it, and comes back to the project page each time", async () => {
    asUser("admin");
    const to = await run("createProject", {
      code: "MV-01",
      name: "Marina Vista",
      anticipatedCompletionOn: "2028-06-30",
      templateKind: "spa",
    });
    const [p] = await database.db.select().from(projects);
    expect(to).toBe(`/inventory/${p!.id}?saved=project`);
    expect(revalidated).toContain("/inventory");
    expect(await run("createProject", { code: "MV-01", name: "Again" })).toBe("/inventory?error=exists");

    expect(await run("addBuilding", { projectId: p!.id, code: "A", name: "Tower A" })).toBe(
      `/inventory/${p!.id}?saved=building#buildings`,
    );
    const [b] = await database.db.select().from(buildings);
    expect(await run("addUnit", { projectId: p!.id, buildingId: b!.id, code: "U-101" })).toBe(
      `/inventory/${p!.id}?saved=unit#units`,
    );
    const [u] = await database.db.select().from(units);
    expect(u!.buildingId).toBe(b!.id);

    expect(await run("createPriceList", { projectId: p!.id, [`price_${u!.id}`]: "1,500,000" })).toBe(
      `/inventory/${p!.id}?saved=draft#price-lists`,
    );
    const [l] = await database.db.select().from(priceLists);
    expect(l!.publishedAt).toBeNull();
    expect(await run("publishPriceList", { projectId: p!.id, id: l!.id })).toBe(
      `/inventory/${p!.id}?saved=published#price-lists`,
    );
    expect((await database.db.select().from(priceLists))[0]!.publishedAt).not.toBeNull();
    // publishing twice is refused with the fixed "exists" word
    expect(await run("publishPriceList", { projectId: p!.id, id: l!.id })).toBe(`/inventory/${p!.id}?error=exists`);
  });

  test("a price in the form that isn't money refuses the whole form before any request", async () => {
    asUser("admin");
    const [p] = await database.db.select().from(projects);
    const [u] = await database.db.select().from(units);
    const before = (await database.db.select().from(priceLists)).length;
    expect(await run("createPriceList", { projectId: p!.id, [`price_${u!.id}`]: "12 million" })).toBe(
      `/inventory/${p!.id}?error=invalid`,
    );
    expect((await database.db.select().from(priceLists)).length).toBe(before);
  });

  test("a stuffed company id or role is never sent: the project belongs to the engine's own company", async () => {
    asUser("admin");
    await run("createProject", {
      code: "MV-02",
      name: "Second",
      developerCompanyId: "00000000-0000-7000-8000-000000000000",
      role: "sales_officer",
    });
    const rows = await database.db.select().from(projects);
    const second = rows.find((r) => r.code === "MV-02")!;
    const first = rows.find((r) => r.code === "MV-01")!;
    expect(second.developerCompanyId).toBe(first.developerCompanyId);
  });
});
