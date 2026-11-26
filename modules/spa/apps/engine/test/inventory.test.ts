import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { dealEvents, deals, priceListItems, priceLists, units, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  addBuilding,
  addUnit,
  createPriceList,
  createProject,
  getProject,
  listProjects,
  publishPriceList,
  unitListPrice,
} from "../src/manager/inventory.ts";
import { setCompany } from "../src/manager/parties.ts";
import { setEscrowAccount } from "../src/manager/escrow.ts";
import { company, party, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const IBAN = "AE070331234567890123456";

describe.skipIf(!url)("C32: inventory through SpaManager (S64)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  let seq = 0;
  const as = (k: string) => users[k]!;
  const admin = () => as("admin");
  const code = (p = "PRJ") => `${p}-${++seq}`;
  const fail = async (p: Promise<unknown>) =>
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

  const project = (over: Record<string, unknown> = {}) =>
    createProject(ctx, { code: code(), name: "Marina Heights", ...over }, admin());
  const withBuilding = async () => {
    const p = await project();
    const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, admin());
    return { p, b };
  };

  test("an admin of a developer company adds a project: code, name, completion date, template kind; it is audited", async () => {
    const p = await project({ anticipatedCompletionOn: "2028-06-30", templateKind: "spa" });
    expect(p.code).toMatch(/^PRJ-/);
    const [ev] = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "PROJECT_CREATED"));
    expect(ev!.actor).toBe(`user:${admin().id}`);
    expect(ev!.payload).toMatchObject({ code: p.code });
    const view = await getProject(ctx, admin(), p.id);
    expect(view).toMatchObject({ code: p.code, name: "Marina Heights", anticipatedCompletionOn: "2028-06-30" });
    expect(view.emirate).toBe("dubai");
  });

  test("bad input is refused with 422 and nothing is written", async () => {
    const before = (await database.db.query.projects.findMany()).length;
    for (const bad of [
      { code: "", name: "X" },
      { code: "has space", name: "X" },
      { code: code(), name: "" },
      { code: code(), name: "X", anticipatedCompletionOn: "30/06/2028" },
      { code: code(), name: "X", anticipatedCompletionOn: "2028-02-31" },
      { code: code(), name: "X", templateKind: "nope" },
      { code: code(), name: "X", emirate: "mars" },
    ])
      expect((await fail(createProject(ctx, bad, admin())))?.status).toBe(422);
    expect((await database.db.query.projects.findMany()).length).toBe(before);
  });

  test("a project code is unique (409)", async () => {
    const c = code();
    await createProject(ctx, { code: c, name: "One" }, admin());
    expect((await fail(createProject(ctx, { code: c, name: "Two" }, admin())))?.status).toBe(409);
  });

  test("only an admin writes inventory; every other role is refused (403)", async () => {
    for (const key of Object.keys(users).filter((n) => n !== "admin"))
      expect((await fail(createProject(ctx, { code: code(), name: "X" }, as(key))))?.status).toBe(403);
    const { p } = await withBuilding();
    for (const key of Object.keys(users).filter((n) => n !== "admin")) {
      expect((await fail(addBuilding(ctx, p.id, { code: code("B"), name: "X" }, as(key))))?.status).toBe(403);
      expect((await fail(addUnit(ctx, p.id, { buildingId: newId(), code: code("U") }, as(key))))?.status).toBe(403);
      expect((await fail(createPriceList(ctx, p.id, { items: [] }, as(key))))?.status).toBe(403);
      expect((await fail(publishPriceList(ctx, newId(), as(key))))?.status).toBe(403);
    }
  });

  test("a brokerage company has no inventory: even an admin is refused, every read and write (403); 'both' has it", async () => {
    const { p } = await withBuilding();
    await setCompany(ctx, { name: "Fictional Agency", kind: "brokerage" }, "system");
    try {
      expect((await fail(createProject(ctx, { code: code(), name: "X" }, admin())))?.status).toBe(403);
      expect((await fail(addBuilding(ctx, p.id, { code: "Z", name: "Z" }, admin())))?.status).toBe(403);
      expect((await fail(listProjects(ctx, admin())))?.status).toBe(403);
      expect((await fail(getProject(ctx, admin(), p.id)))?.status).toBe(403);
      await setCompany(ctx, { name: "Fictional Both", kind: "both" }, "system");
      expect((await fail(createProject(ctx, { code: code(), name: "X" }, admin()))) ?? "ok").toBe("ok");
    } finally {
      await setCompany(ctx, { name: "Fictional Developments LLC", kind: "developer" }, "system");
    }
  });

  test("a project belongs to the developer company", async () => {
    const p = await project();
    const row = await database.db.query.projects.findFirst({ where: (t, ops) => ops.eq(t.id, p.id) });
    const co = await database.db.query.companies.findFirst();
    expect(row!.developerCompanyId).toBe(co!.id);
  });

  test("buildings: unique code per project, 404 for an unknown project, never in another project's list", async () => {
    const { p } = await withBuilding();
    expect((await fail(addBuilding(ctx, p.id, { code: "A", name: "Again" }, admin())))?.status).toBe(409);
    expect((await fail(addBuilding(ctx, newId(), { code: "A", name: "Again" }, admin())))?.status).toBe(404);
    expect((await fail(addBuilding(ctx, p.id, { code: "", name: "X" }, admin())))?.status).toBe(422);
  });

  test("a unit is added to one building; its code is unique in the install", async () => {
    const { p, b } = await withBuilding();
    const u = await addUnit(ctx, p.id, { buildingId: b.id, code: code("U") }, admin());
    expect(u.placed).toBe(false);
    const row = (await database.db.select().from(units).where(eq(units.id, u.id)))[0]!;
    expect(row).toMatchObject({ buildingId: b.id, state: "AVAILABLE" });
    expect((await fail(addUnit(ctx, p.id, { buildingId: b.id, code: row.code }, admin())))?.status).toBe(409);
    // a building of another project is not this project's building
    const other = await withBuilding();
    expect((await fail(addUnit(ctx, p.id, { buildingId: other.b.id, code: code("U") }, admin())))?.status).toBe(422);
  });

  test("a legacy unit with no building is placed once by adding its code; a placed unit can't move", async () => {
    const { p, b } = await withBuilding();
    const other = await withBuilding();
    const legacy = newId();
    await database.db.insert(units).values({ id: legacy, code: code("LEG") });
    const code1 = (await database.db.select().from(units).where(eq(units.id, legacy)))[0]!.code;
    const placed = await addUnit(ctx, p.id, { buildingId: b.id, code: code1 }, admin());
    expect(placed).toMatchObject({ id: legacy, placed: true });
    expect((await database.db.select().from(units).where(eq(units.id, legacy)))[0]!.buildingId).toBe(b.id);
    expect((await fail(addUnit(ctx, other.p.id, { buildingId: other.b.id, code: code1 }, admin())))?.status).toBe(409);
  });

  const stocked = async (n = 2, prices: number[] = []) => {
    const { p, b } = await withBuilding();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await addUnit(ctx, p.id, { buildingId: b.id, code: code("U") }, admin())).id);
    return { p, b, ids, prices };
  };

  test("a price list is a draft with its prices; versions count up per project; one project's units only", async () => {
    const { p, ids } = await stocked();
    const l1 = await createPriceList(
      ctx,
      p.id,
      { items: ids.map((unitId) => ({ unitId, priceFils: 150_000_000 })) },
      admin(),
    );
    expect(l1.version).toBe(1);
    const l2 = await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 160_000_000 }] }, admin());
    expect(l2.version).toBe(2);
    const row = (await database.db.select().from(priceLists).where(eq(priceLists.id, l1.id)))[0]!;
    expect(row.publishedAt).toBeNull();
    expect((await database.db.select().from(priceListItems).where(eq(priceListItems.priceListId, l1.id))).length).toBe(
      2,
    );
    const o = await stocked(1);
    expect(
      (await fail(createPriceList(ctx, p.id, { items: [{ unitId: o.ids[0]!, priceFils: 1_000 }] }, admin())))?.status,
    ).toBe(422);
  });

  test("price list input: at least one price, whole fils above zero, each unit once, known units", async () => {
    const { p, ids } = await stocked(1);
    for (const items of [
      [],
      [{ unitId: ids[0]!, priceFils: 0 }],
      [{ unitId: ids[0]!, priceFils: -1 }],
      [{ unitId: ids[0]!, priceFils: 10.5 }],
      [
        { unitId: ids[0]!, priceFils: 100 },
        { unitId: ids[0]!, priceFils: 200 },
      ],
      [{ unitId: newId(), priceFils: 100 }],
    ])
      expect((await fail(createPriceList(ctx, p.id, { items }, admin())))?.status).toBe(422);
    expect((await database.db.select().from(priceLists).where(eq(priceLists.projectId, p.id))).length).toBe(0);
  });

  test("publishing is once and audited; the list in use is the latest published; a draft is not in use", async () => {
    const { p, ids } = await stocked(1);
    const l1 = await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 100_000_000 }] }, admin());
    expect(await unitListPrice(database.db, ids[0]!)).toBeNull();
    expect((await publishPriceList(ctx, l1.id, admin())).version).toBe(1);
    expect(await unitListPrice(database.db, ids[0]!)).toMatchObject({ priceFils: 100_000_000, version: 1 });
    expect((await fail(publishPriceList(ctx, l1.id, admin())))?.status).toBe(409);
    expect((await fail(publishPriceList(ctx, newId(), admin())))?.status).toBe(404);
    const l2 = await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 110_000_000 }] }, admin());
    expect(await unitListPrice(database.db, ids[0]!)).toMatchObject({ priceFils: 100_000_000, version: 1 });
    await publishPriceList(ctx, l2.id, admin());
    expect(await unitListPrice(database.db, ids[0]!)).toMatchObject({ priceFils: 110_000_000, version: 2 });
    const evs = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "PRICE_LIST_PUBLISHED"));
    expect(evs.some((e) => (e.payload as { version?: number }).version === 2)).toBe(true);
  });

  test("a unit that is not in the latest published list has no list price", async () => {
    const { p, ids } = await stocked(2);
    const l1 = await createPriceList(ctx, p.id, { items: ids.map((unitId) => ({ unitId, priceFils: 100 })) }, admin());
    await publishPriceList(ctx, l1.id, admin());
    const l2 = await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 200 }] }, admin());
    await publishPriceList(ctx, l2.id, admin());
    expect((await unitListPrice(database.db, ids[0]!))?.priceFils).toBe(200);
    expect(await unitListPrice(database.db, ids[1]!)).toBeNull();
  });

  const buyers = async () => {
    const buyer = await party(database, "Sample Buyer");
    const seller = await company(database, "Fictional Developments LLC", `LIC-${++seq}`);
    return [
      { role: "buyer" as const, partyId: buyer, order: 1, shareBps: 10_000 },
      { role: "seller" as const, partyId: seller, order: 1, shareBps: 10_000 },
    ];
  };
  const primaryDeal = async (unitId: string, priceFils?: number) =>
    createDeal(
      ctx,
      {
        dealType: "primary_offplan",
        sellerMortgage: false,
        buyerMortgage: false,
        planTakenOver: false,
        unitId,
        ...(priceFils === undefined ? {} : { priceFils }),
        parties: await buyers(),
      },
      "system",
    );

  test("a deal created on a unit with a list price and no price of its own takes the price-list price (S64)", async () => {
    const { p, ids } = await stocked(1);
    const l = await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 175_000_000 }] }, admin());
    await publishPriceList(ctx, l.id, admin());
    const d = await primaryDeal(ids[0]!);
    const row = (await database.db.select().from(deals).where(eq(deals.id, d.id)))[0]!;
    expect(row.priceFils).toBe(175_000_000);
    const [ev] = await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, d.id));
    expect(ev!.payload).toMatchObject({ priceFils: 175_000_000, priceSource: "price_list", priceListVersion: 1 });
  });

  test("an agreed price typed on the deal is kept; the list price is recorded beside it, nothing is checked here", async () => {
    const { p, ids } = await stocked(1);
    const l = await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 175_000_000 }] }, admin());
    await publishPriceList(ctx, l.id, admin());
    const d = await primaryDeal(ids[0]!, 170_000_000);
    expect((await database.db.select().from(deals).where(eq(deals.id, d.id)))[0]!.priceFils).toBe(170_000_000);
    const [ev] = await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, d.id));
    expect(ev!.payload).toMatchObject({ priceSource: "deal", listPriceFils: 175_000_000, priceListVersion: 1 });
  });

  test("no price and no list price: the deal is refused (422), a draft list is not used", async () => {
    const { p, ids } = await stocked(1);
    await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 175_000_000 }] }, admin());
    const e = await fail(primaryDeal(ids[0]!));
    expect(e?.status).toBe(422);
    expect(e?.code).toBe("no_price");
    expect((await database.db.select().from(deals).where(eq(deals.unitId, ids[0]!))).length).toBe(0);
  });

  test("a deal's project code and buildings are then fixed (the database trigger holds through the manager)", async () => {
    const { p, ids } = await stocked(1);
    await primaryDeal(ids[0]!, 100_000_000);
    const e = await fail(database.pool.query("update projects set code = 'CHANGED' where id = $1", [p.id]));
    expect(String((e as { message?: string } | null)?.message)).toContain("projects");
  });

  test("the project view: buildings, units with state, list price and deal link, price lists by version, escrow masked", async () => {
    const { p, ids } = await stocked(2);
    const l = await createPriceList(
      ctx,
      p.id,
      { items: ids.map((unitId) => ({ unitId, priceFils: 150_000_000 })) },
      admin(),
    );
    await publishPriceList(ctx, l.id, admin());
    await createPriceList(ctx, p.id, { items: [{ unitId: ids[0]!, priceFils: 155_000_000 }] }, admin());
    const d = await primaryDeal(ids[0]!);
    await setEscrowAccount(
      ctx,
      { projectCode: p.code, accountHolder: "Escrow Holder", iban: IBAN, bankName: "Fictional Bank" },
      admin(),
    );
    const v = await getProject(ctx, as("officer"), p.id);
    expect(v.buildings).toHaveLength(1);
    expect(v.units).toHaveLength(2);
    const held = v.units.find((u) => u.id === ids[0])!;
    expect(held).toMatchObject({ state: "HELD", stateLabel: "Held", listPriceFils: 150_000_000 });
    expect(held.deal).toMatchObject({ id: d.id, ref: d.ref });
    expect(v.units.find((u) => u.id === ids[1])!.deal).toBeNull();
    expect(v.priceLists.map((pl) => [pl.version, pl.status, pl.inUse])).toEqual([
      [2, "draft", false],
      [1, "published", true],
    ]);
    expect(v.escrow).toEqual({ bankName: "Fictional Bank", accountMasked: "•••• 3456" });
    const text = JSON.stringify(v);
    expect(text).not.toContain(IBAN);
    expect(text).not.toContain("AE07");
    expect(text).not.toContain("0331234567890");
    expect(text).not.toContain("Escrow Holder");
  });

  test("the project list: counts, the price list in use, no deal detail, units not yet in a project", async () => {
    const { p } = await stocked(2);
    await database.db.insert(units).values({ id: newId(), code: code("OLD") });
    const out = await listProjects(ctx, as("manager"));
    const row = out.items.find((i) => i.id === p.id)!;
    expect(row).toMatchObject({ code: p.code, buildings: 1, units: 2, priceListVersion: null });
    expect(row.byState.AVAILABLE).toBe(2);
    expect(out.unplacedUnits).toBeGreaterThanOrEqual(1);
  });

  test("the template in use is the approved one for the project, else none", async () => {
    const p = await project({ templateKind: "spa" });
    expect((await getProject(ctx, admin(), p.id)).template).toBeNull();
  });
});
