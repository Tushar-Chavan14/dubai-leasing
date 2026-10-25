import { beforeAll, describe, expect, test } from "bun:test";
import { DEMO_LISTED_UNITS, defaultCompanyPolicy } from "@leasing/core";
import { units } from "@leasing/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { bootstrap, reset } from "../../ejari-mock/src/db.ts";
import * as registry from "../../ejari-mock/src/schema.ts";
import { seedDemo } from "../src/demo/seed.ts";
import { freshDatabase, noDb } from "./harness.ts";

describe.skipIf(noDb)("demo seed", () => {
  let rows: (typeof units.$inferSelect)[];
  let database: Awaited<ReturnType<typeof freshDatabase>>;

  beforeAll(async () => {
    database = await freshDatabase();
    await seedDemo(database);
    rows = await database.db.select().from(units);
  });

  test("seeds the listed homes for the public site, with rents inside the company range", () => {
    const listed = rows.filter((u) => u.state === "LISTED");
    // JVC-0412 plus the extra fictional homes; the extras have no leases.
    expect(listed.length).toBe(1 + DEMO_LISTED_UNITS.length);
    expect(new Set(rows.map((u) => u.code)).size).toBe(rows.length);
    for (const u of listed) {
      const range = defaultCompanyPolicy.askingRentRangeFils[String(u.bedrooms)]!;
      expect(u.askingRentFils!).toBeGreaterThanOrEqual(range.min);
      expect(u.askingRentFils!).toBeLessThanOrEqual(range.max);
      expect(u.description).toBeTruthy();
      expect(u.makaniNo).toBeTruthy();
    }
  });

  test("the simulated Ejari registry knows every seeded unit, with matching unit and Makani numbers", async () => {
    const mock = drizzle(database.pool, { schema: registry });
    await bootstrap(mock);
    await reset(mock);
    const reg = await mock.select().from(registry.properties);
    const byDld = new Map(reg.map((r) => [r.dldPropertyNo, r]));
    expect(rows.length).toBeGreaterThanOrEqual(7 + DEMO_LISTED_UNITS.length);
    for (const u of rows) {
      const p = byDld.get(u.dldPropertyNo!);
      expect(p, `${u.code} (${u.dldPropertyNo}) missing from the registry`).toBeDefined();
      expect(p!.unitNo).toBe(u.unitNo!);
      expect(p!.makaniNo).toBe(u.makaniNo ?? "");
    }
  });
});
