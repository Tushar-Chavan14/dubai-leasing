import { beforeAll, describe, expect, test } from "bun:test";
import { DEMO_COMPANIES, DEMO_LISTED_UNITS } from "@leasing/core";
import { applications, approvals, companies, leaseEvents, leases, staffUsers, tasks, units, withTx } from "@leasing/db";
import { eq } from "drizzle-orm";
import { listRecords, STAGES } from "../src/manager/workspace.ts";
import { drizzle } from "drizzle-orm/node-postgres";
import { bootstrap, reset } from "../../ejari-mock/src/db.ts";
import * as registry from "../../ejari-mock/src/schema.ts";
import { seedDemo } from "../src/demo/seed.ts";
import { priceRangeFor } from "../src/manager/pricing.ts";
import { freshDatabase, noDb } from "./harness.ts";

describe.skipIf(noDb)("demo seed", () => {
  let rows: (typeof units.$inferSelect)[];
  let database: Awaited<ReturnType<typeof freshDatabase>>;

  beforeAll(async () => {
    database = await freshDatabase();
    await seedDemo(database);
    rows = await database.db.select().from(units);
  });

  test("seeds the five companies and gives every unit one", async () => {
    const cs = await database.db.select().from(companies);
    expect(cs.map((c) => c.slug).toSorted()).toEqual(DEMO_COMPANIES.map((c) => c.slug).toSorted());
    const ids = new Set(cs.map((c) => c.id));
    for (const u of rows) expect(ids.has(u.companyId), `${u.code} has no company`).toBe(true);
    expect(new Set(rows.map((u) => u.companyId)).size).toBe(5);
    expect(DEMO_COMPANIES.map((c) => c.slug)).toEqual(
      expect.arrayContaining(["silverline", "qamar-realty", "al-noor-holdings", "sobha", "modon"]),
    );
    for (const slug of ["sobha", "modon"]) {
      const n = rows.filter((u) => u.companyId === cs.find((c) => c.slug === slug)!.id && u.state === "LISTED").length;
      expect(n, slug).toBeGreaterThanOrEqual(2);
      expect(n, slug).toBeLessThanOrEqual(3);
    }
  });

  test("seeds the listed units, with rents inside the company's allowed range", async () => {
    const listed = rows.filter((u) => u.state === "LISTED");
    // JVC-0412 plus the extra fictional units; the extras have no leases.
    expect(listed.length).toBe(1 + DEMO_LISTED_UNITS.length);
    expect(new Set(rows.map((u) => u.code)).size).toBe(rows.length);
    expect(new Set(rows.map((u) => u.makaniNo)).size).toBe(rows.length);
    expect(listed.some((u) => u.category === "commercial")).toBe(true);
    expect(listed.some((u) => u.category === "retail")).toBe(true);
    const today = (await import("../src/clock.ts")).createEngineClock;
    const date = (await today(database, true)).today();
    for (const u of listed) {
      const { range } = await withTx(database, (tx) => priceRangeFor(tx, u, date));
      expect(range, `${u.code} has no allowed range`).not.toBeNull();
      expect(u.askingRentFils!).toBeGreaterThanOrEqual(range!.min);
      expect(u.askingRentFils!).toBeLessThanOrEqual(range!.max);
      expect(u.description).toBeTruthy();
      expect(u.makaniNo).toBeTruthy();
      if (u.category !== "residential") expect(u.bedrooms).toBeNull();
    }
  });

  test("MRN-1502 (PREP) has an explicit asking rent of AED 100,000, inside its band", async () => {
    const u = rows.find((r) => r.code === "MRN-1502")!;
    expect(u.state).toBe("PREP");
    expect(u.askingRentFils).toBe(10_000_000);
    const date = (await (await import("../src/clock.ts")).createEngineClock(database, true)).today();
    const { range } = await withTx(database, (tx) => priceRangeFor(tx, u, date));
    expect(range).not.toBeNull();
    expect(u.askingRentFils!).toBeGreaterThanOrEqual(range!.min);
    expect(u.askingRentFils!).toBeLessThanOrEqual(range!.max);
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

  test("one record at every Workspace stage a person can see", async () => {
    const [officer] = await database.db.select().from(staffUsers).where(eq(staffUsers.role, "leasing_officer"));
    const recs = await listRecords(database.db, officer!, {});
    const by = (stage: string) => recs.filter((r) => r.stage === stage);
    // Reserved is a moment inside the Manager (the lease is created on entry), so nothing rests there.
    for (const stage of STAGES.filter((s) => s !== "Reserved")) expect(by(stage).length, stage).toBeGreaterThan(0);
    expect(by("Reserved")).toHaveLength(0);

    const appsAll = await database.db.select().from(applications);
    const open = await database.db.select().from(tasks).where(eq(tasks.status, "open"));
    const held = open.filter((t) => t.kind === "send_offer");
    expect(held).toHaveLength(1);
    expect(appsAll.find((a) => a.id === held[0]!.entityId)!.state).toBe("OFFER");
    expect(await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "OFFER_HELD"))).toHaveLength(1);
    const viewing = appsAll.filter((a) => a.state === "VIEWING");
    expect(viewing).toHaveLength(1);

    const pending = await database.db.select().from(approvals).where(eq(approvals.status, "pending"));
    const ejari = pending.filter((a) => a.gate === "ejari_submission");
    expect(ejari).toHaveLength(1);
    const [lease] = await database.db.select().from(leases).where(eq(leases.id, ejari[0]!.entityId));
    expect(lease!.state).toBe("REGISTRATION");
    const contractLeases = (await database.db.select().from(leases)).filter((l) => l.state === "CONTRACT");
    expect(contractLeases.length).toBeGreaterThanOrEqual(2);
  });
});
