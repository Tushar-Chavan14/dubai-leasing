import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock } from "@platform/kernel";
import { dealEvents, deals, units, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { addBuilding, addUnit, createProject, updateProject, updateUnit } from "../src/manager/inventory.ts";
import { setCompany } from "../src/manager/parties.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const clock = new FixedClock(new Date("2026-11-25T06:00:00Z"));

describe.skipIf(!url)("M2: unit and project details through SpaManager (S75)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  let seq = 0;
  const admin = () => users.admin!;
  const fail = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string }) => e,
    );

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    ctx = { database, clock, facts: failClosedFacts };
    users = await seedUsers(database);
    await setCompany(ctx, { name: "Fictional Developments LLC", kind: "developer" }, "system");
  });
  afterAll(async () => {
    await database?.close();
  });

  const stock = async () => {
    const p = await createProject(ctx, { code: `M2-${++seq}`, name: "Marina Heights" }, admin());
    const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, admin());
    const u = await addUnit(
      ctx,
      p.id,
      { buildingId: b.id, code: `M2U-${++seq}`, type: "apartment", bedrooms: 1 },
      admin(),
    );
    return { p, b, u };
  };
  const eventsOf = (kind: "unit" | "project", id: string, type: string) =>
    database.db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.entityKind, kind), eq(dealEvents.entityId, id), eq(dealEvents.type, type)));

  test("addUnit stores the detail fields", async () => {
    const { u } = await stock();
    const [row] = await database.db.select().from(units).where(eq(units.id, u.id));
    expect(row).toMatchObject({ type: "apartment", bedrooms: 1, view: null });
  });

  test("an admin updates bedrooms, view and description; the event names the fields, not the values", async () => {
    const { u } = await stock();
    await updateUnit(ctx, u.id, { bedrooms: 2, view: "Marina", description: "Corner unit" }, admin());
    const [row] = await database.db.select().from(units).where(eq(units.id, u.id));
    expect(row).toMatchObject({ bedrooms: 2, view: "Marina", description: "Corner unit" });
    const [ev] = await eventsOf("unit", u.id, "UNIT_UPDATED");
    expect(ev!.payload).toEqual({ changed: ["bedrooms", "view", "description"] });
    expect(JSON.stringify(ev!.payload)).not.toContain("Marina");
  });

  test("an update that changes nothing writes no event; null clears a field", async () => {
    const { u } = await stock();
    await updateUnit(ctx, u.id, { bedrooms: 1 }, admin());
    expect(await eventsOf("unit", u.id, "UNIT_UPDATED")).toHaveLength(0);
    await updateUnit(ctx, u.id, { bedrooms: null }, admin());
    const [row] = await database.db.select().from(units).where(eq(units.id, u.id));
    expect(row!.bedrooms).toBeNull();
  });

  test("a sales manager is refused (403)", async () => {
    const { u } = await stock();
    expect((await fail(updateUnit(ctx, u.id, { view: "Pool" }, users.manager!)))?.status).toBe(403);
  });

  test("bedrooms -1 is 422 invalid_unit; a missing unit is 404", async () => {
    const { u } = await stock();
    const e = await fail(updateUnit(ctx, u.id, { bedrooms: -1 }, admin()));
    expect(e).toMatchObject({ status: 422, code: "invalid_unit" });
    expect((await fail(updateUnit(ctx, crypto.randomUUID(), { view: "x" }, admin())))?.status).toBe(404);
  });

  test("a unit with an open deal: code can't change (409 unit_in_deal), description can", async () => {
    const { dealId } = await dealInDraft(ctx, database);
    const [d] = await database.db.select().from(deals).where(eq(deals.id, dealId));
    const target = d!.unitId!;
    const [row] = await database.db.select().from(units).where(eq(units.id, target));
    const e = await fail(updateUnit(ctx, target, { code: `${row!.code}-X` }, admin()));
    expect(e).toMatchObject({ status: 409, code: "unit_in_deal" });
    await updateUnit(ctx, target, { description: "still editable" }, admin());
  });

  test("a duplicate unit code is 409 unit_code_taken", async () => {
    const a = await stock();
    const b = await stock();
    const [other] = await database.db.select().from(units).where(eq(units.id, b.u.id));
    expect(await fail(updateUnit(ctx, a.u.id, { code: other!.code }, admin()))).toMatchObject({
      status: 409,
      code: "unit_code_taken",
    });
  });

  test("updateProject changes the community and audits it on the project", async () => {
    const { p } = await stock();
    await updateProject(ctx, p.id, { community: "Dubai Marina", description: "A fictional tower" }, admin());
    const [ev] = await eventsOf("project", p.id, "PROJECT_UPDATED");
    expect(ev!.payload).toEqual({ changed: ["community", "description"] });
    expect((await fail(updateProject(ctx, p.id, { community: "x".repeat(81) }, admin())))?.status).toBe(422);
    expect((await fail(updateProject(ctx, p.id, { community: "Other" }, users.officer!)))?.status).toBe(403);
  });

  test("a brokerage company is refused (403)", async () => {
    const { u, p } = await stock();
    await setCompany(ctx, { name: "Fictional Brokers", kind: "brokerage" }, "system");
    try {
      expect((await fail(updateUnit(ctx, u.id, { view: "Pool" }, admin())))?.status).toBe(403);
      expect((await fail(updateProject(ctx, p.id, { community: "Q" }, admin())))?.status).toBe(403);
    } finally {
      await setCompany(ctx, { name: "Fictional Developments LLC", kind: "developer" }, "system");
    }
  });
});
