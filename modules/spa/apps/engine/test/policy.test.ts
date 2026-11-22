import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY, type SpaRole } from "@spa/core";
import { dealEvents, deals, parties as partiesTable, type SpaDatabase, spaUsers, units } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { advance } from "../src/manager/advance.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { currentPolicy, publishPolicy } from "../src/manager/policy.ts";
import { proposeApproval } from "../src/manager/approvals.ts";
import { seedSpaDemo } from "../src/seed.ts";
import { listings } from "@spa/db";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const users = {} as Record<SpaRole, { id: string; role: SpaRole }>;
const clock = new FixedClock(new Date("2026-11-18T06:00:00Z"));
const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts });
/** Two fictional parties in the database (deals need real parties, C4). */
async function realParties(db: SpaDatabase["db"]) {
  const ids = [newId(), newId()];
  await db.insert(partiesTable).values(
    ids.map((id, i) => ({
      id,
      kind: "person" as const,
      fullNameEn: `Sample Party ${i}`,
      email: `p${i}@example.test`,
      passportNo: "X0000001",
      createdAt: new Date("2026-11-18T06:00:00Z"),
    })),
  );
  return [
    { role: "buyer" as const, partyId: ids[0]!, order: 1, shareBps: 10_000 },
    { role: "seller" as const, partyId: ids[1]!, order: 1, shareBps: 10_000 },
  ];
}
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const newUnit = async () => {
  const id = newId();
  await database.db.insert(units).values({ id, code: `U-${id.slice(-6)}` });
  return id;
};
const deal = async (unitId: string) =>
  createDeal(
    ctx(),
    {
      dealType: "primary_offplan",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      unitId,
      priceFils: 1_000_000,
      parties: await realParties(database.db),
    },
    `user:${users.sales_officer.id}`,
  );

describe.skipIf(!url)("policy and version pinning (C3)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-18T06:00:00Z"));
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const role of ["admin", "sales_manager", "sales_officer"] as SpaRole[]) {
      const id = newId();
      users[role] = { id, role };
      await database.db.insert(spaUsers).values({ id, email: `${role}@spa-demo.test`, name: role, role });
    }
  });
  afterAll(async () => {
    await database?.close();
  });

  test("publishing makes new immutable versions; only admin publishes", async () => {
    expect((await currentPolicy(database.db)).version).toBe(0);
    expect((await publishPolicy(ctx(), DEFAULT_SPA_POLICY, users.admin)).version).toBe(1);
    expect((await publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, holdDays: 10 }, users.admin)).version).toBe(2);
    expect((await currentPolicy(database.db)).values.holdDays).toBe(10);
    expect(await fails(publishPolicy(ctx(), DEFAULT_SPA_POLICY, users.sales_manager))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, holdDays: 0 }, users.admin))).toEqual({
      status: 422,
      code: "invalid_policy",
    });
    const r = await database.pool.query("update spa_policy set created_by = 'x'").then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(r).toContain("immutable");
  });

  test("a deal pins the rulebook and policy; later versions don't change it; events carry the rulebook", async () => {
    await publishPolicy(ctx(), DEFAULT_SPA_POLICY, users.admin);
    const u = await newUnit();
    const d = await deal(u);
    await publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, holdDays: 9 }, users.admin);
    const [row] = await database.db.select().from(deals).where(eq(deals.id, d.id));
    expect([row?.rulesVersion, row?.policyVersion]).toEqual(["dubai-sales-2026-01", 1]);
    expect(row?.createdAt.toISOString()).toBe("2026-11-18T06:00:00.000Z");
    await advance(ctx(), { kind: "deal", id: d.id }, "CANCEL", { actor: `user:${users.sales_officer.id}` });
    const evs = await database.db.select().from(dealEvents);
    const mine = evs.filter((e) => e.entityId === d.id || e.entityId === u);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    expect(mine.every((e) => e.rulesVersion === "dubai-sales-2026-01")).toBe(true);
  });

  test("no rulebook in force: no deal", async () => {
    clock.set(new Date("2025-12-31T08:00:00Z"));
    expect(await fails(deal(await newUnit()))).toEqual({ status: 409, code: "no_rulebook" });
    expect(await database.db.select().from(deals)).toHaveLength(0);
  });

  test("the demo seed dates follow the clock it is given (demo offset)", async () => {
    clock.set(new Date("2027-03-01T06:00:00Z"));
    await seedSpaDemo(database, clock, { SPA_DEMO_MODE: true });
    const [l] = await database.db.select().from(listings);
    expect(l?.permitExpiresOn).toBe("2027-08-28");
    expect(l?.createdAt.toISOString()).toBe("2027-03-01T06:00:00.000Z");
  });
  test("review #5: a deal's pinned versions and terms can't change; approval events on a deal carry the rulebook", async () => {
    const d = await deal(await newUnit());
    for (const set of ["rules_version = 'x'", "policy_version = 9", "price_fils = 5", "deal_type = 'resale_ready'"]) {
      const r = await database.pool.query(`update deals set ${set} where id = $1`, [d.id]).then(
        () => "ok",
        (e: Error) => e.message,
      );
      expect(r).toContain("fixed");
    }
    await proposeApproval(ctx(), {
      gate: "cancellation",
      entity: { kind: "deal", id: d.id },
      dedupeKey: "c1",
      title: "x",
      proposal: {},
      proposedBy: `user:${users.sales_officer.id}`,
    });
    const [e] = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "APPROVAL_PROPOSED"));
    expect(e?.rulesVersion).toBe("dubai-sales-2026-01");
  });

  test("currentPolicy validates the stored values like policyAt", async () => {
    await database.pool.query(
      "insert into spa_policy (version, values, created_by, created_at) values (1, $1, 'system:test', now())",
      [JSON.stringify({ ...DEFAULT_SPA_POLICY, depositBps: -5 })],
    );
    await expect(currentPolicy(database.db)).rejects.toThrow();
  });
});
