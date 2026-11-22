/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { issueToken } from "@platform/kernel";
import { dealEvents, units, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { setEscrowAccount } from "../src/manager/escrow.ts";
import { createPriceList, createProject, addBuilding, addUnit, publishPriceList } from "../src/manager/inventory.ts";
import { createParty, setCompany } from "../src/manager/parties.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";
import { FixedClock } from "@platform/kernel/clock";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
const IBAN = "AE070331234567890123456";
const ROLES = ["officer", "manager", "salesadmin", "legal", "finance", "compliance", "mlro", "admin"] as const;
const READ = new Set(["officer", "manager", "salesadmin", "admin"]);
const SALES = new Set(["officer", "manager", "salesadmin"]);
const KINDS = ["developer", "brokerage", "both"] as const;

describe.skipIf(!url)("C32: inventory and listings routes, per role and company kind (S12, S64)", () => {
  let database: SpaDatabase;
  let app: ReturnType<typeof createApp>;
  let users: Record<string, U>;
  let ctx: SpaContext;
  let projectId: string;
  let projectCode: string;
  let buildingId: string;
  let unitId: string;
  let listId: string;
  let ownerId: string;
  const setKind = (k: (typeof KINDS)[number]) => setCompany(ctx, { name: "Fictional Co", kind: k }, "system");
  const call = async (method: string, path: string, as?: string, body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    return { status: r.status, text, body: text ? (JSON.parse(text) as any) : null };
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    ctx = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    await setKind("both");
    const admin = users.admin!;
    const p = await createProject(ctx, { code: "MH-1", name: "Marina Heights" }, admin);
    projectId = p.id;
    projectCode = p.code;
    buildingId = (await addBuilding(ctx, projectId, { code: "A", name: "Tower A" }, admin)).id;
    unitId = (await addUnit(ctx, projectId, { buildingId, code: "A-101" }, admin)).id;
    const l = await createPriceList(ctx, projectId, { items: [{ unitId, priceFils: 150_000_000 }] }, admin);
    listId = l.id;
    await publishPriceList(ctx, listId, admin);
    await setEscrowAccount(
      ctx,
      { projectCode, accountHolder: "Escrow Holder", iban: IBAN, bankName: "Fictional Bank" },
      admin,
    );
    ownerId = (
      await createParty(
        ctx,
        {
          kind: "person",
          fullNameEn: "Route Owner",
          nationality: "Testland",
          email: "ro@example.test",
          passportNo: "R123",
        },
        "system",
      )
    ).id;
  });
  afterAll(async () => {
    await database?.close();
  });

  test("every route needs a session (401)", async () => {
    for (const [m, p] of [
      ["GET", "/api/projects"],
      ["GET", `/api/projects/${projectId}`],
      ["POST", "/api/projects"],
      ["POST", `/api/projects/${projectId}/buildings`],
      ["POST", `/api/projects/${projectId}/units`],
      ["POST", `/api/projects/${projectId}/price-lists`],
      ["POST", `/api/price-lists/${listId}/publish`],
      ["GET", "/api/listings"],
      ["GET", `/api/listings/${projectId}`],
      ["POST", "/api/listings"],
    ] as const)
      expect((await call(m, p)).status, `${m} ${p}`).toBe(401);
  });

  test("inventory reads: sales roles and admin of a developer or both company; nobody in a brokerage; nobody else", async () => {
    for (const kd of KINDS) {
      await setKind(kd);
      for (const r of ROLES) {
        const ok = READ.has(r) && kd !== "brokerage";
        expect((await call("GET", "/api/projects", r)).status, `${r}/${kd} list`).toBe(ok ? 200 : 403);
        expect((await call("GET", `/api/projects/${projectId}`, r)).status, `${r}/${kd} record`).toBe(ok ? 200 : 403);
      }
    }
    await setKind("both");
  });

  test("listings reads: sales roles and admin of a brokerage or both company; nobody in a developer; nobody else", async () => {
    for (const kd of KINDS) {
      await setKind(kd);
      for (const r of ROLES) {
        const ok = READ.has(r) && kd !== "developer";
        expect((await call("GET", "/api/listings", r)).status, `${r}/${kd}`).toBe(ok ? 200 : 403);
        expect((await call("GET", `/api/listings/${projectId}`, r)).status, `${r}/${kd} record`).toBe(ok ? 404 : 403);
      }
    }
    await setKind("both");
  });

  test("inventory writes: only an admin, only in a developer or both company; every other role and kind is 403 and writes nothing", async () => {
    const before = (await database.db.select().from(units)).length;
    for (const kd of KINDS) {
      await setKind(kd);
      for (const r of ROLES) {
        const ok = r === "admin" && kd !== "brokerage";
        const tag = `${r}/${kd}`;
        const n = `${r}${kd}`.slice(0, 20);
        const proj = await call("POST", "/api/projects", r, { code: `W-${n}`, name: "Written" });
        expect(proj.status, `${tag} project`).toBe(ok ? 201 : 403);
        const b = await call("POST", `/api/projects/${projectId}/buildings`, r, { code: `B-${n}`, name: "Tower" });
        expect(b.status, `${tag} building`).toBe(ok ? 201 : 403);
        const u = await call("POST", `/api/projects/${projectId}/units`, r, { buildingId, code: `U-${n}` });
        expect(u.status, `${tag} unit`).toBe(ok ? 201 : 403);
        const pl = await call("POST", `/api/projects/${projectId}/price-lists`, r, {
          items: [{ unitId, priceFils: 1_000_000 }],
        });
        expect(pl.status, `${tag} price list`).toBe(ok ? 201 : 403);
        const pub = await call("POST", `/api/price-lists/${pl.body?.id ?? listId}/publish`, r);
        expect(pub.status, `${tag} publish`).toBe(ok ? 200 : 403);
      }
    }
    // admin wrote units only in the developer and both runs
    expect((await database.db.select().from(units)).length - before).toBe(2);
    await setKind("both");
  });

  test("listing draft write: the three sales roles, brokerage or both only (201); others 403", async () => {
    const body = () => ({
      title: "Studio, Route Tower",
      community: "Business Bay",
      propertyDescription: "A studio.",
      askingPriceFils: 90_000_000,
      sellers: [{ role: "seller", partyId: ownerId, order: 1, shareBps: 10_000 }],
    });
    for (const kd of KINDS) {
      await setKind(kd);
      for (const r of ROLES) {
        const ok = SALES.has(r) && kd !== "developer";
        const res = await call("POST", "/api/listings", r, body());
        expect(res.status, `${r}/${kd}`).toBe(ok ? 201 : 403);
        if (ok) expect(res.body.ref).toMatch(/^L-/);
      }
    }
    await setKind("both");
  });

  test("bad bodies are 422 or 400, an unknown or malformed id 404, never a 500; an unknown project is 404; a second publish is 409", async () => {
    expect((await call("POST", "/api/projects", "admin", { code: "", name: "" })).status).toBe(422);
    expect((await call("POST", "/api/projects", "admin", null)).status).toBe(422);
    expect((await call("POST", "/api/projects", "admin", { code: "MH-1", name: "Dup" })).status).toBe(409);
    expect(
      (await call("POST", `/api/projects/${crypto.randomUUID()}/buildings`, "admin", { code: "Q", name: "Q" })).status,
    ).toBe(404);
    expect((await call("POST", "/api/projects/not-a-uuid/buildings", "admin", { code: "Q", name: "Q" })).status).toBe(
      404,
    );
    expect((await call("POST", `/api/price-lists/${listId}/publish`, "admin")).status).toBe(409);
    expect((await call("GET", "/api/listings?scope=everything", "officer")).status).toBe(400);
    expect((await call("GET", "/api/listings?cursor=zzz", "officer")).status).toBe(400);
  });

  test("the escrow account is masked to its last four on every response, for every role that can read the project; the holder never shown", async () => {
    for (const r of READ) {
      const rec = await call("GET", `/api/projects/${projectId}`, r);
      expect(rec.body.escrow).toEqual({ bankName: "Fictional Bank", accountMasked: "•••• 3456" });
      for (const s of [IBAN, "AE07", "0331234567890", "Escrow Holder"]) expect(rec.text).not.toContain(s);
      const lst = await call("GET", "/api/projects", r);
      for (const s of [IBAN, "AE07", "3456", "Escrow Holder"]) expect(lst.text).not.toContain(s);
    }
    // and no event the writes made carries it
    const evs = await database.db.select().from(dealEvents);
    for (const e of evs.filter((ev) => ev.type !== "ESCROW_ACCOUNT_SET"))
      expect(JSON.stringify(e.payload)).not.toContain(IBAN);
  });

  test("the project record carries the unit's price-list price and no party name", async () => {
    const rec = await call("GET", `/api/projects/${projectId}`, "officer");
    // the write test above published newer versions: the price shown is the one in the latest published list
    const published = rec.body.priceLists.filter((l: any) => l.status === "published");
    expect(rec.body.priceLists.find((l: any) => l.inUse).version).toBe(
      Math.max(...published.map((l: any) => l.version)),
    );
    expect(rec.body.units.find((u: any) => u.code === "A-101").listPriceFils).toBe(1_000_000);
    expect(rec.text).not.toMatch(/aml|screening|sanction|\bpep\b|\bedd\b|\brisk\b|compliance/i);
  });

  test("the unit's row is as written", async () => {
    const [u] = await database.db.select().from(units).where(eq(units.id, unitId));
    expect(u!.buildingId).toBe(buildingId);
  });
});
