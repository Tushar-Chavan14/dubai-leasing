import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, issueToken } from "@platform/kernel";
import { parseSpaEnv } from "@spa/core/env";
import type { SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { createApp } from "../src/app.ts";
import { checkPassword, hashPassword } from "../src/auth.ts";
import { SpaDemoClock } from "../src/clock.ts";
import {
  createBoss,
  DEFAULT_CHECK_JOB,
  defaultCheckKey,
  HEARTBEAT_JOB,
  heartbeatKey,
  NOC_EXPIRY_JOB,
  startJobs,
} from "../src/jobs.ts";
import { requireDemo, requireSpaDatabase, seedSpaDemo } from "../src/seed.ts";
import { DEMO_USERS } from "../src/seed-data.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { setCompany } from "../src/manager/parties.ts";
import { deals, listings, units } from "@spa/db";
import { eq } from "drizzle-orm";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-18T08:00:00Z");
const url = spaTestDatabaseUrl();

describe("passwords and demo checks", () => {
  test("argon2id hashes verify; an unknown email is just a wrong password", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toStartWith("$argon2id$");
    expect(await checkPassword("correct horse", h)).toBe(true);
    expect(await checkPassword("wrong", h)).toBe(false);
    expect(await checkPassword("correct horse", null)).toBe(false);
  });
  test("seed and reset need demo mode", () => {
    const base = { SPA_DATABASE_URL: "postgres://u@localhost/spa", SPA_SESSION_SECRET: SECRET };
    expect(() => requireDemo(parseSpaEnv(base))).toThrow("SPA_DEMO_MODE must be true");
    expect(() => requireDemo(parseSpaEnv({ ...base, SPA_DEMO_MODE: "true" }))).not.toThrow();
  });
  test("seed and reset refuse any database that isn't the SPA one", () => {
    expect(requireSpaDatabase("postgres://u@localhost:5432/spa")).toBe("spa");
    expect(() => requireSpaDatabase("postgres://u@localhost:5432/leasing")).toThrow("not the SPA one");
    expect(() => requireSpaDatabase("postgres://u@localhost:5432/spa_leasing")).toThrow("not the SPA one");
    expect(() => requireSpaDatabase("not a url")).toThrow("not the SPA one");
  });
  test("one fictional demo user per SPA role", () => {
    expect(DEMO_USERS.map((u) => u.role).toSorted()).toEqual([
      "admin",
      "compliance_officer",
      "finance",
      "legal",
      "mlro",
      "sales_admin",
      "sales_manager",
      "sales_officer",
    ]);
    expect(DEMO_USERS.every((u) => u.email.endsWith("@spa-demo.test"))).toBe(true);
  });
  test("the heartbeat key is per Dubai day", () => {
    expect(heartbeatKey(new FixedClock(new Date("2026-11-17T21:30:00Z")).today())).toBe("engine:heartbeat:2026-11-18");
  });
});

describe.skipIf(!url)("SPA engine on spa_test (S2)", () => {
  let database: SpaDatabase;
  const call = (app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const appWith = (demoMode: boolean, queueUp = true) =>
    createApp({
      database,
      jobs: { boss: { getQueue: async () => (queueUp ? {} : null) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, demoMode),
      sessionSecret: SECRET,
      demoMode,
      nowMs: () => NOW,
    });
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    await seedSpaDemo(database, undefined, { SPA_DEMO_MODE: true });
    // One user with a password, for the non-demo sign-in route.
    await database.pool.query("update spa_users set password_hash = $1 where email = $2", [
      await hashPassword("pass-word-1"),
      DEMO_USERS[0]!.email,
    ]);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("the demo seed creates units, listings and a mix of deals (C30), idempotently", async () => {
    await seedSpaDemo(database, undefined, { SPA_DEMO_MODE: true });
    // five demo units (U-101 to U-105), the four available units of building B in the demo project, and (S78) the four units of the second project
    expect(await database.db.select().from(units)).toHaveLength(13);
    expect(await database.db.select().from(listings)).toHaveLength(12);
    expect(await database.db.select().from(deals)).toHaveLength(10);
    const [u101] = await database.db.select().from(units).where(eq(units.code, "U-101"));
    expect(u101?.state).toBe("HELD");
    const [l] = await database.db.select().from(listings).where(eq(listings.permitNo, "[PERMIT NO.]"));
    expect([l?.state, l?.permitNo]).toEqual(["UNDER_OFFER", "[PERMIT NO.]"]);
  });
  test("every demo role signs in from the demo picker and gets its own profile", async () => {
    const app = appWith(true);
    for (const u of DEMO_USERS) {
      const r = await call(app, "/api/auth/demo-sign-in", { method: "POST", body: JSON.stringify({ email: u.email }) });
      expect(r.status).toBe(200);
      const { token } = (await r.json()) as { token: string };
      const me = await call(app, "/api/me", { headers: { authorization: `Bearer ${token}` } });
      expect(((await me.json()) as { role: string }).role).toBe(u.role);
    }
  });
  test("C5: /api/me says the company kind, so the rail shows the right screens", async () => {
    const app = appWith(true);
    const sign = await call(app, "/api/auth/demo-sign-in", {
      method: "POST",
      body: JSON.stringify({ email: DEMO_USERS[0]!.email }),
    });
    const { token } = (await sign.json()) as { token: string };
    const me = async () =>
      (
        (await (await call(app, "/api/me", { headers: { authorization: `Bearer ${token}` } })).json()) as {
          companyKind: string;
        }
      ).companyKind;
    expect(await me()).toBe("both");
    await setCompany(
      { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts },
      { name: "Fictional Brokers", kind: "brokerage" },
      "system",
    );
    expect(await me()).toBe("brokerage");
  });
  test("a user without a password can't use the password sign-in", async () => {
    const r = await call(appWith(true), "/api/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: DEMO_USERS[1]!.email, password: "anything" }),
    });
    expect(r.status).toBe(401);
  });
  test("email case doesn't matter at sign-in; stored emails must be lower case", async () => {
    const app = appWith(true);
    const r = await call(app, "/api/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email: DEMO_USERS[0]!.email.toUpperCase(), password: "pass-word-1" }),
    });
    expect(r.status).toBe(200);
    const mixed = await database.pool
      .query(
        "insert into spa_users (id, email, name, role) values (gen_random_uuid(), 'Mixed@Spa-Demo.test', 'M', 'legal')",
      )
      .then(
        () => "accepted",
        (e: { constraint?: string }) => e.constraint ?? "refused",
      );
    expect(mixed).toBe("spa_users_email_lower");
  });
  test("a wrong password, an unknown email and a bad body all fail the same safe way", async () => {
    const app = appWith(true);
    const tryIt = (body: unknown) => call(app, "/api/auth/sign-in", { method: "POST", body: JSON.stringify(body) });
    const wrong = await tryIt({ email: DEMO_USERS[0]!.email, password: "nope" });
    const unknown = await tryIt({ email: "nobody@spa-demo.test", password: "nope" });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect((await tryIt({ email: "x" })).status).toBe(400);
  });
  test("a token signed with another secret (a leasing session) is refused", async () => {
    const app = appWith(true);
    const [u] = await database.db.query.spaUsers.findMany({ limit: 1 });
    const foreign = issueToken("leasing-secret-".padEnd(40, "x"), u!.id, NOW);
    expect((await call(app, "/api/me", { headers: { authorization: `Bearer ${foreign}` } })).status).toBe(401);
    expect((await call(app, "/api/me")).status).toBe(401);
  });
  test("demo sign-in and the demo user list exist only in demo mode", async () => {
    expect((await call(appWith(false), "/api/auth/demo-users")).status).toBe(404);
    expect(
      (
        await call(appWith(false), "/api/auth/demo-sign-in", {
          method: "POST",
          body: JSON.stringify({ email: DEMO_USERS[0]!.email }),
        })
      ).status,
    ).toBe(404);
    const list = await call(appWith(true), "/api/auth/demo-users");
    expect(((await list.json()) as unknown[]).length).toBe(DEMO_USERS.length);
    const r = await call(appWith(true), "/api/auth/demo-sign-in", {
      method: "POST",
      body: JSON.stringify({ email: DEMO_USERS[0]!.email }),
    });
    expect(r.status).toBe(200);
  });
  test("M5b: the demo user list marks the four-person cast first, with hints", async () => {
    const list = (await (await call(appWith(true), "/api/auth/demo-users")).json()) as {
      role: string;
      cast: boolean;
      hint: string;
      shortRole: string;
    }[];
    expect(list.slice(0, 4).map((u) => [u.role, u.cast])).toEqual([
      ["sales_officer", true],
      ["sales_manager", true],
      ["legal", true],
      ["admin", true],
    ]);
    expect(list[0]!.hint).toBe("Listings, leads, viewings, deals, documents");
    expect(list.slice(4).every((u) => !u.cast)).toBe(true);
    expect(list.find((u) => u.role === "compliance_officer")).toMatchObject({ hint: "AML review", cast: false });
  });
  test("M5b: the demo hand-off picks the cast member, else the first active user of the role, else nothing; 404 with demo off", async () => {
    expect((await call(appWith(false), "/api/demo/handoff?role=legal")).status).toBe(404);
    const get = async (role: string) => (await call(appWith(true), `/api/demo/handoff?role=${role}`)).json();
    expect(await get("legal")).toEqual({ name: "Omar Legal", email: "legal@spa-demo.test", roleLabel: "Legal" });
    expect(await get("compliance_officer")).toMatchObject({ name: "Sara Compliance", roleLabel: "Compliance" });
    expect((await call(appWith(true), "/api/demo/handoff?role=nope")).status).toBe(400);
    // A second legal user sorting first is not the cast; the cast member still wins.
    await database.pool.query(
      "insert into spa_users (id, email, name, role) values ('0198a1b2-0000-7000-8000-0000000000f1', 'aaron@spa-demo.test', 'Aaron Legal', 'legal')",
    );
    expect(await get("legal")).toMatchObject({ email: "legal@spa-demo.test" });
    // No active user for a role: null, so the card says no demo user has the role.
    await database.pool.query("update spa_users set active = false where role = 'mlro'");
    expect(await get("mlro")).toBeNull();
    await database.pool.query("update spa_users set active = true where role = 'mlro'");
    await database.pool.query("delete from spa_users where email = 'aaron@spa-demo.test'");
  });
  test("/health is green with the database and queue up, and says why when not", async () => {
    const ok = await call(appWith(true), "/health");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { db: boolean; jobs: boolean; clock: { today: string; offsetDays: number } };
    expect([body.db, body.jobs, body.clock.offsetDays]).toEqual([true, true, 0]);
    expect(body.clock.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const down = await call(appWith(true, false), "/health");
    expect(down.status).toBe(503);
    expect(((await down.json()) as { jobs: boolean }).jobs).toBe(false);
  });
  test("the demo clock reads spa_demo_settings; outside demo mode it is real time", async () => {
    await database.pool.query("update spa_demo_settings set clock_offset_ms = $1 where id = 1", [3 * 86_400_000]);
    const demo = new SpaDemoClock(database, true);
    await demo.refresh();
    expect(demo.offsetDays).toBe(3);
    const real = new SpaDemoClock(database, false);
    await real.refresh();
    expect(real.offsetDays).toBe(0);
    await database.pool.query("update spa_demo_settings set clock_offset_ms = 0 where id = 1");
  });
  test("pg-boss runs in the spa database: the heartbeat job runs once per key", async () => {
    const clock = new FixedClock(new Date(NOW));
    const jobs = await startJobs(createBoss(url!), clock);
    try {
      // A second send with the same key is dropped while the first is queued or active (exclusive queue).
      await jobs.boss.send(HEARTBEAT_JOB, {}, { singletonKey: heartbeatKey(clock.today()) });
      for (let i = 0; i < 50 && !jobs.lastHeartbeat(); i++) await Bun.sleep(100);
      expect(jobs.lastHeartbeat()?.toISOString()).toBe(new Date(NOW).toISOString());
      const r = await database.pool.query<{ n: number }>(
        "select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2",
        [HEARTBEAT_JOB, heartbeatKey(clock.today())],
      );
      expect(r.rows[0]!.n).toBe(1);
    } finally {
      await jobs.stop();
    }
  });
  test("C15: the NOC sweep is scheduled daily in Dubai time and runs once at start-up", async () => {
    const clock = new FixedClock(new Date(NOW));
    const seen = { runs: 0 };
    const jobs = await startJobs(createBoss(url!), clock, { nocSweep: async () => void seen.runs++ });
    try {
      for (let i = 0; i < 50 && seen.runs === 0; i++) await Bun.sleep(100);
      expect(seen.runs).toBe(1);
      const schedules = await jobs.boss.getSchedules();
      const s = schedules.find((x) => x.name === NOC_EXPIRY_JOB);
      expect([s?.cron, s?.timezone]).toEqual(["15 0 * * *", "Asia/Dubai"]);
      const r = await database.pool.query<{ n: number }>(
        "select count(*)::int as n from pgboss.job where name = $1 and singleton_key = $2",
        [NOC_EXPIRY_JOB, `noc-expiry:${clock.today()}`],
      );
      expect(r.rows[0]!.n).toBeGreaterThanOrEqual(1);
    } finally {
      await jobs.stop();
    }
  });
  test("C22: the default check runs at 00:20 Dubai time, once at start-up, and its key is per Dubai day", async () => {
    expect(DEFAULT_CHECK_JOB).toBe("spa.default.check");
    expect(defaultCheckKey("2026-11-19")).toBe("default-check:2026-11-19");
    const clock = new FixedClock(new Date(NOW));
    const seen = { runs: 0 };
    const jobs = await startJobs(createBoss(url!), clock, { defaultCheck: async () => void seen.runs++ });
    try {
      for (let i = 0; i < 50 && seen.runs === 0; i++) await Bun.sleep(100);
      expect(seen.runs).toBe(1);
      const s = (await jobs.boss.getSchedules()).find((x) => x.name === DEFAULT_CHECK_JOB);
      expect([s?.cron, s?.timezone]).toEqual(["20 0 * * *", "Asia/Dubai"]);
      // Sent again for the same day: the exclusive queue keeps at most one waiting job per key.
      await jobs.boss.send(DEFAULT_CHECK_JOB, {}, { singletonKey: defaultCheckKey(clock.today()) });
      await jobs.boss.send(DEFAULT_CHECK_JOB, {}, { singletonKey: defaultCheckKey(clock.today()) });
      const r = await database.pool.query<{ n: number }>(
        "select count(*)::int n from pgboss.job where name = $1 and singleton_key = $2 and state in ('created', 'retry')",
        [DEFAULT_CHECK_JOB, defaultCheckKey(clock.today())],
      );
      expect(r.rows[0]!.n).toBeLessThanOrEqual(1);
    } finally {
      await jobs.stop();
    }
  });
});
