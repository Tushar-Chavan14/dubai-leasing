import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { beforeAll, describe, expect, test } from "bun:test";
import { type Database, withTx } from "@leasing/db";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { EngineDemoClock } from "../src/clock.ts";
import { bossScheduler } from "../src/jobs.ts";
import { sweepDueDeadlines } from "../src/manager/milestones.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, TEST_DB_URL, testContext, unitCsv } from "./harness.ts";

const SECRET = "test-secret";
let database: Database;

describe.skipIf(noDb)("HTTP API (Postgres)", () => {
  let app: ReturnType<typeof createApi>;
  let t: ReturnType<typeof testContext>;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    database = await freshDatabase();
    t = testContext(database, "2026-10-19T04:00:00Z");
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ["leasing_officer", "leasing_manager", "finance", "admin"] as const) {
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    }
  });

  const call = (role: string | null, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { "content-type": "application/json", ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}) },
    });

  test("every /api route needs a valid session", async () => {
    for (const path of ["/api/me", "/api/approvals", "/api/leases", "/api/units", "/api/tasks"]) {
      expect((await call(null, path)).status).toBe(401);
    }
    const bad = await app.request("/api/me", { headers: { authorization: "Bearer nope.nope" } });
    expect(bad.status).toBe(401);
  });

  test("import: managers and admins only", async () => {
    const csv = JSON.stringify({
      csv: leaseCsv([{ unit_code: "API-1", start_on: "2026-06-01", end_on: "2027-05-31" }]),
    });
    expect((await call("leasing_officer", "/api/import/leases", { method: "POST", body: csv })).status).toBe(403);
    expect((await call("finance", "/api/import/leases", { method: "POST", body: csv })).status).toBe(403);
    const ok = await call("admin", "/api/import/leases", { method: "POST", body: csv });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ imported: 1, errors: 0 });
  });

  test("units import: managers and admins only", async () => {
    const body = (code: string) => JSON.stringify({ csv: unitCsv([{ unit_code: code }]) });
    const post = (role: string, code: string) => call(role, "/api/import/units", { method: "POST", body: body(code) });
    expect((await post("leasing_officer", "API-U1")).status).toBe(403);
    expect((await post("finance", "API-U1")).status).toBe(403);
    const admin = await post("admin", "API-U1");
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({ imported: 1, skipped: 0, errors: 0, rows: [{ ref: "API-U1" }] });
    const manager = await post("leasing_manager", "API-U2");
    expect(manager.status).toBe(200);
    expect(await manager.json()).toMatchObject({ imported: 1, rows: [{ state: "PREP" }] });
  });

  test("lease list shows state and next deadline; PII masked in detail", async () => {
    const leases = (await (await call("leasing_officer", "/api/leases")).json()) as {
      id: string;
      state: string;
      nextDeadline: { milestone: string };
    }[];
    expect(leases[0]).toMatchObject({ state: "ACTIVE", nextDeadline: { milestone: "landlord_intent@2027-05-31" } });
    await call("admin", "/api/import/leases", {
      method: "POST",
      body: JSON.stringify({
        csv: leaseCsv([
          {
            unit_code: "API-2",
            tenant_name: "Phone Person",
            tenant_phone: "+971 50 123 4567",
            start_on: "2026-06-02",
            end_on: "2027-06-01",
          },
        ]),
      }),
    });
    const all = (await (await call("leasing_officer", "/api/leases")).json()) as { id: string; unitCode: string }[];
    const detail = await (
      await call("leasing_officer", `/api/leases/${all.find((l) => l.unitCode === "API-2")?.id}`)
    ).json();
    expect(JSON.stringify(detail)).not.toContain("123 4567");
  });

  test("approve over HTTP: wrong role 403, invalid body 400, manager 200", async () => {
    t.clock.advanceDays(104);
    await sweepDueDeadlines(t.ctx);
    const list = (await (await call("leasing_officer", "/api/approvals")).json()) as { id: string; gate: string }[];
    const notice = list.find((a) => a.gate === "renewal_notice");
    expect(notice).toBeDefined();
    const decide = (role: string, body: unknown) =>
      call(role, `/api/approvals/${notice?.id}/decide`, { method: "POST", body: JSON.stringify(body) });
    expect((await decide("leasing_officer", { decision: "approve" })).status).toBe(403);
    expect((await decide("admin", { decision: "approve" })).status).toBe(403);
    expect((await decide("leasing_manager", { decision: "reject" })).status).toBe(400); // reject needs a note
    expect(
      (await decide("leasing_manager", { decision: "edit", proposal: { proposedRentFils: 99_000_000 } })).status,
    ).toBe(422);
    expect((await decide("leasing_manager", { decision: "approve" })).status).toBe(200);
    const detail = await (await call("leasing_officer", `/api/approvals/${notice?.id}`)).json();
    expect(detail).toMatchObject({ status: "approved", gateDef: { approver: "leasing_manager" } });
  });

  test("demo routes are absent outside demo mode", async () => {
    expect((await call("admin", "/api/demo/fast-forward", { method: "POST", body: '{"days":1}' })).status).toBe(404);
  });
});

describe.skipIf(noDb)("demo clock routes (demo mode)", () => {
  test("fast-forward then back to today keeps data; finance can do neither", async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-10-19T04:00:00Z", { demoMode: true });
    const demoClock = new EngineDemoClock(database);
    await demoClock.refresh();
    const ctx = { ...t.ctx, clock: demoClock };
    const app = createApi(ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
      demoClock,
    });
    const tokens: Record<string, string> = {};
    for (const role of ["leasing_officer", "finance"] as const) {
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    }
    const call = (role: string, path: string, body?: unknown) =>
      app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const offset = async () =>
      ((await (await call("leasing_officer", "/api/demo/clock")).json()) as { offsetDays: number }).offsetDays;

    expect(await offset()).toBe(0);
    expect((await call("leasing_officer", "/api/demo/fast-forward", { days: 30 })).status).toBe(200);
    expect(await offset()).toBe(30);
    expect((await call("finance", "/api/demo/rewind", {})).status).toBe(403);
    expect(await offset()).toBe(30);
    const staffBefore = await database.pool.query("select count(*)::int as n from staff_users");
    expect((await call("leasing_officer", "/api/demo/rewind", {})).status).toBe(200);
    expect(await offset()).toBe(0);
    const staffAfter = await database.pool.query("select count(*)::int as n from staff_users");
    expect(staffAfter.rows[0].n).toBe(staffBefore.rows[0].n);
  });
});

describe.skipIf(noDb)("demo console: reset and Ejari rejection (demo mode)", () => {
  test("reset is admin-only, needs RESET, reseeds and keeps staff; reject-next needs the registry", async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-10-19T04:00:00Z", { demoMode: true });
    const demoClock = new EngineDemoClock(database);
    await demoClock.refresh();
    const app = createApi(
      { ...t.ctx, clock: demoClock },
      {
        sessionSecret: SECRET,
        mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
        demoClock,
        ejariMockUrl: "http://127.0.0.1:9", // nothing listens: the registry part reports false
      },
    );
    const tokens: Record<string, string> = {};
    for (const role of ["admin", "leasing_manager", "finance"] as const)
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    const call = (role: string, path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
        body: JSON.stringify(body),
      });
    expect((await call("leasing_manager", "/api/demo/reset", { confirm: "RESET" })).status).toBe(403);
    expect((await call("admin", "/api/demo/reset", { confirm: "yes" })).status).toBe(400);
    const r = await call("admin", "/api/demo/reset", { confirm: "RESET" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, mockReset: false });
    const leasesNow = await database.pool.query("select ref from leases");
    expect(leasesNow.rows.length).toBeGreaterThanOrEqual(4);
    // Staff stay signed in across a reset.
    expect((await call("admin", "/api/demo/reset", { confirm: "RESET" })).status).toBe(200);

    // Adding missing demo leases deletes nothing and is safe to repeat.
    const before = (await database.pool.query("select count(*)::int as n from leases")).rows[0].n as number;
    const added = (await (await call("leasing_manager", "/api/demo/seed-leases", {})).json()) as {
      results: { status: string }[];
    };
    expect(added.results.every((r) => r.status !== "imported")).toBe(true);
    expect((await database.pool.query("select count(*)::int as n from leases")).rows[0].n).toBe(before);
    expect((await call("finance", "/api/demo/seed-leases", {})).status).toBe(403);
    expect((await call("finance", "/api/demo/ejari/reject-next", {})).status).toBe(403);
    expect((await call("leasing_manager", "/api/demo/ejari/reject-next", {})).status).toBe(422);
  });
});

describe.skipIf(noDb)("pg-boss in the Manager's transaction", () => {
  test("a job sent in a rolled-back transaction never exists", async () => {
    database = await freshDatabase();
    const boss = new PgBoss({ connectionString: TEST_DB_URL ?? "", schema: "pgboss" });
    await boss.start();
    try {
      await boss.createQueue("tx.test", { policy: "exclusive" });
      const scheduler = bossScheduler(boss);
      await expect(
        withTx(database, async (tx) => {
          await scheduler.send(tx, { name: "tx.test", data: {}, singletonKey: "x:rolled-back" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await withTx(database, (tx) => scheduler.send(tx, { name: "tx.test", data: {}, singletonKey: "x:committed" }));
      // Same singleton key again: exclusive policy keeps one job.
      await withTx(database, (tx) => scheduler.send(tx, { name: "tx.test", data: {}, singletonKey: "x:committed" }));
      const rows = await database.db.execute<{ singleton_key: string }>(
        sql`select singleton_key from pgboss.job where name = 'tx.test'`,
      );
      expect(rows.rows.map((r) => r.singleton_key)).toEqual(["x:committed"]);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 30_000);
});
