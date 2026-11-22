import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, issueToken } from "@platform/kernel";
import { parseSpaEnv } from "@spa/core/env";
import type { SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { createApp } from "../src/app.ts";
import { checkPassword, hashPassword } from "../src/auth.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { createBoss, HEARTBEAT_JOB, heartbeatKey, startJobs } from "../src/jobs.ts";
import { requireDemo, requireSpaDatabase, seedSpaDemo } from "../src/seed.ts";
import { DEMO_USERS } from "../src/seed-data.ts";

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
    await seedSpaDemo(database);
    // One user with a password, for the non-demo sign-in route.
    await database.pool.query("update spa_users set password_hash = $1 where email = $2", [
      await hashPassword("pass-word-1"),
      DEMO_USERS[0]!.email,
    ]);
  });
  afterAll(async () => {
    await database?.close();
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
});
