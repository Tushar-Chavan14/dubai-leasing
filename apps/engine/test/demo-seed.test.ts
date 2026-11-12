import { beforeAll, describe, expect, test } from "bun:test";
import {
  allowedAskingRange,
  DEMO_COMPANIES,
  DEMO_EMIRATE_UNITS,
  DEMO_LISTED_UNITS,
  DEMO_PROPERTIES,
  DEMO_RENT_RULES,
  DEMO_SRI,
  EMIRATES,
  type Emirate,
  demoPropertyNo,
} from "@leasing/core";
import { hasRulebookFor } from "@leasing/rulebook";
import {
  applications,
  approvals,
  companies,
  leaseEvents,
  leases,
  rentRules,
  sriAverages,
  staffUsers,
  tasks,
  units,
  withTx,
} from "@leasing/db";
import { eq } from "drizzle-orm";
import { listRecords, STAGES } from "../src/manager/workspace.ts";
import { drizzle } from "drizzle-orm/node-postgres";
import { bootstrap, reset } from "../../ejari-mock/src/db.ts";
import * as registry from "../../ejari-mock/src/schema.ts";
import { seedDemo } from "../src/demo/seed.ts";
import { priceRangeFor } from "../src/manager/pricing.ts";
import { freshDatabase, noDb } from "./harness.ts";

describe("demo emirate units (data)", () => {
  const other = EMIRATES.filter((e) => e !== "dubai");

  test("two units per other emirate: a residential apartment and a commercial or retail unit", () => {
    for (const e of other) {
      const us = DEMO_EMIRATE_UNITS.filter((u) => u.emirate === e);
      expect(us.map((u) => u.category === "residential")).toEqual([true, false]);
      expect(us[0]!.furnished).toBe(false);
      expect(us[1]!.areaSqft).toBeGreaterThan(0);
    }
    expect(DEMO_EMIRATE_UNITS).toHaveLength(12);
  });

  test("codes, property numbers, unit numbers and address codes are unique", () => {
    const all = [...DEMO_LISTED_UNITS, ...DEMO_EMIRATE_UNITS];
    expect(new Set(all.map((u) => u.code)).size).toBe(all.length);
    expect(new Set(all.map((u) => u.makaniNo)).size).toBe(all.length);
    expect(new Set(all.map((u) => u.unitNo)).size).toBe(all.length);
    expect(new Set(DEMO_PROPERTIES.map((p) => p[0])).size).toBe(DEMO_PROPERTIES.length);
  });

  test("DEMO_PROPERTIES includes every emirate unit with its usage", () => {
    for (const u of DEMO_EMIRATE_UNITS) {
      const p = DEMO_PROPERTIES.find((x) => x[0] === demoPropertyNo(u.emirate!, u.unitNo));
      expect(p, u.code).toBeDefined();
      expect(p![1]).toBe(u.unitNo);
      expect(p![2]).toBe(u.makaniNo);
      expect(p![4]).toBe(u.category === "residential" ? "residential" : "commercial");
    }
    expect(demoPropertyNo("dubai", "412")).toBe("DEMO-DLD-000412");
    expect(demoPropertyNo("abu_dhabi", "2101")).toBe("DEMO-AUH-002101");
  });

  test("each asking rent is inside the rent rule's range around the rent index row", () => {
    for (const u of DEMO_EMIRATE_UNITS) {
      const emirate: Emirate = u.emirate!;
      const rule = DEMO_RENT_RULES.find((r) => (r.emirate ?? "dubai") === emirate && r.category === u.category)!;
      const row = DEMO_SRI.find(
        (r) =>
          (r.emirate ?? "dubai") === emirate &&
          r.community === u.community &&
          r.category === u.category &&
          r.bedrooms === u.bedrooms,
      );
      expect(rule, `${u.code} rule`).toBeDefined();
      expect(row, `${u.code} index row`).toBeDefined();
      const range = allowedAskingRange(
        { category: u.category, areaSqft: u.areaSqft },
        {
          label: "demo",
          avgAnnualRentFils: (row!.avgAnnualRentAed ?? 0) * 100,
          avgAnnualRentPerSqftFils:
            row!.avgAnnualRentPerSqftAed === undefined ? null : row!.avgAnnualRentPerSqftAed * 100,
        },
        {
          minPctBp: rule.minPctBp,
          maxPctBp: rule.maxPctBp,
          minRentFils: rule.minRentAed === undefined ? null : rule.minRentAed * 100,
          maxRentFils: rule.maxRentAed === undefined ? null : rule.maxRentAed * 100,
        },
      );
      expect(range, u.code).not.toBeNull();
      expect(u.askingRentFils).toBeGreaterThanOrEqual(range!.min);
      expect(u.askingRentFils).toBeLessThanOrEqual(range!.max);
    }
    expect(other).toHaveLength(6);
  });
});

describe.skipIf(noDb)("demo seed", () => {
  let rows: (typeof units.$inferSelect)[];
  let database: Awaited<ReturnType<typeof freshDatabase>>;

  beforeAll(async () => {
    database = await freshDatabase();
    await seedDemo(database);
    rows = await database.db.select().from(units);
  });

  test("seeds one company and gives it every unit", async () => {
    const cs = await database.db.select().from(companies);
    expect(cs.map((c) => c.slug)).toEqual(DEMO_COMPANIES.map((c) => c.slug));
    expect(cs.map((c) => c.slug)).toEqual(["silverline"]);
    for (const u of rows) expect(u.companyId, `${u.code} is not Silverline's`).toBe(cs[0]!.id);
  });

  test("seeds the listed units, with rents inside the company's allowed range", async () => {
    const listed = rows.filter((u) => u.state === "LISTED");
    // JVC-0412 plus the extra fictional units; the extras have no leases.
    expect(listed.length).toBe(1 + DEMO_LISTED_UNITS.length + DEMO_EMIRATE_UNITS.length);
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

  test("two LISTED units per other emirate, a rulebook for every emirate, and re-seeding changes nothing", async () => {
    for (const e of EMIRATES.filter((x) => x !== "dubai")) {
      const listed = rows.filter((u) => u.emirate === e && u.state === "LISTED");
      expect(listed, e).toHaveLength(2);
    }
    const date = (await (await import("../src/clock.ts")).createEngineClock(database, true)).today();
    for (const e of EMIRATES) expect(hasRulebookFor(date, e), e).toBe(true);
    const before = rows.length;
    const sriBefore = (await database.db.select().from(sriAverages)).length;
    const rulesBefore = (await database.db.select().from(rentRules)).length;
    expect(sriBefore).toBe(DEMO_SRI.length);
    await seedDemo(database);
    expect((await database.db.select().from(units)).length).toBe(before);
    expect((await database.db.select().from(sriAverages)).length).toBe(sriBefore);
    expect((await database.db.select().from(rentRules)).length).toBe(rulesBefore);
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
    expect(rows.length).toBeGreaterThanOrEqual(7 + DEMO_LISTED_UNITS.length + DEMO_EMIRATE_UNITS.length);
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
