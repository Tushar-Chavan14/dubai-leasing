import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPrivateKey, sign } from "node:crypto";
import { generatePortalKeyPair, issueToken, signPortalToken } from "@platform/kernel";
import { type SpaDatabase, portalHandoffs, spaUsers } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";

const SECRET = "s".repeat(40);
const LEASING_SECRET = "leasing-secret-".padEnd(40, "x");
const NOW = Date.parse("2026-11-21T08:00:00Z");
const url = spaTestDatabaseUrl();
const keys = generatePortalKeyPair();
const other = generatePortalKeyPair();

describe.skipIf(!url)("POST /api/auth/portal-exchange (C38, S70)", () => {
  let database: SpaDatabase;
  let now = NOW;
  const build = (over: Record<string, unknown> = {}) =>
    createApp({
      database,
      jobs: { boss: {} as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => now,
      portalPublicKey: keys.publicKey,
      ...over,
    } as never);
  let app: ReturnType<typeof build>;
  const mint = (email: string, aud: "spa" | "leasing" = "spa", at = now) =>
    signPortalToken(keys.privateKey, { sub: "acct", email, aud }, at);
  const post = (token: string, query = "", headers: Record<string, string> = {}) =>
    app.request(`/api/auth/portal-exchange${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ token }),
    });
  const me = (token: string) => app.request("/api/me", { headers: { authorization: `Bearer ${token}` } });
  const addUser = (email: string, role: string, active = true) =>
    database.pool.query(
      "insert into spa_users (id, email, name, role, active) values (gen_random_uuid(), $1, $2, $3, $4)",
      [email, `Name of ${role}`, role, active],
    );
  const countUsers = async () => (await database.db.select().from(spaUsers)).length;

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    app = build();
    await addUser("officer@spa-demo.test", "sales_officer");
    await addUser("former@spa-demo.test", "sales_officer", false);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("a user with an active SPA row gets that row's role as a session of the SPA's own secret", async () => {
    const r = await post(mint("Officer@SPA-Demo.test"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { token: string; user: { role: string; email: string } };
    expect(body.user).toMatchObject({ role: "sales_officer", email: "officer@spa-demo.test" });
    expect(((await (await me(body.token)).json()) as { role: string }).role).toBe("sales_officer");
    // the session is the SPA's own: another secret would not have produced it
    expect(
      (await app.request("/api/me", { headers: { authorization: `Bearer ${issueToken(LEASING_SECRET, "x", now)}` } }))
        .status,
    ).toBe(401);
  });
  test("a token minted for leasing is refused (wrong audience)", async () => {
    expect((await post(mint("officer@spa-demo.test", "leasing"))).status).toBe(401);
  });
  test("a token with a role claim is refused: no session, the user's row unchanged", async () => {
    const key = createPrivateKey({ key: Buffer.from(keys.privateKey, "base64"), format: "der", type: "pkcs8" });
    const b = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const data = `${b({ alg: "EdDSA", typ: "JWT" })}.${b({
      sub: "a",
      email: "officer@spa-demo.test",
      aud: "spa",
      jti: "role-claim-0001",
      iat: now / 1000,
      exp: now / 1000 + 60,
      role: "admin",
    })}`;
    const r = await post(`${data}.${sign(null, Buffer.from(data), key).toString("base64url")}`);
    expect(r.status).toBe(401);
    expect(JSON.stringify(await r.json())).not.toContain("token");
    const [u] = await database.pool
      .query("select role from spa_users where email = 'officer@spa-demo.test'")
      .then((x) => x.rows);
    expect(u.role).toBe("sales_officer");
  });
  test("an email with no active SPA user gets 403 with one body, and nothing is created", async () => {
    const before = await countUsers();
    const noRow = await post(mint("leasing.admin@example.test"));
    const inactive = await post(mint("former@spa-demo.test"));
    expect([noRow.status, inactive.status]).toEqual([403, 403]);
    expect(await noRow.json()).toEqual(await inactive.json());
    expect(await countUsers()).toBe(before);
  });
  test("the same email becomes a sales_officer session once the SPA has that row, never an admin", async () => {
    expect((await post(mint("new.person@example.test"))).status).toBe(403);
    await addUser("new.person@example.test", "sales_officer");
    const r = await post(mint("new.person@example.test"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { user: { role: string } }).user.role).toBe("sales_officer");
  });
  test("a token works once; the replay is refused and the jti is stored", async () => {
    const t = mint("officer@spa-demo.test");
    expect((await post(t)).status).toBe(200);
    expect((await post(t)).status).toBe(401);
    expect((await database.db.select().from(portalHandoffs)).length).toBeGreaterThan(0);
  });
  test("an expired token and an unsigned or foreign-signed token are refused", async () => {
    const t = mint("officer@spa-demo.test");
    now += 61_000;
    expect((await post(t)).status).toBe(401);
    now = NOW;
    expect(
      (await post(signPortalToken(other.privateKey, { sub: "a", email: "officer@spa-demo.test", aud: "spa" }, now)))
        .status,
    ).toBe(401);
    expect((await post("not-a-token")).status).toBe(401);
  });
  test("check=1 says whether the email has an active user, issues no session and spends nothing", async () => {
    const t = mint("officer@spa-demo.test");
    const yes = await post(t, "?check=1");
    expect(await yes.json()).toEqual({ active: true });
    expect(await (await post(t, "?check=1")).json()).toEqual({ active: true });
    expect(await (await post(mint("leasing.admin@example.test"), "?check=1")).json()).toEqual({ active: false });
    expect((await post(mint("officer@spa-demo.test", "leasing"), "?check=1")).status).toBe(401);
    expect((await post(t)).status).toBe(200);
  });
  test("without the public key the route is off (404) and nothing else changes", async () => {
    const off = build({ portalPublicKey: undefined });
    const r = await off.request("/api/auth/portal-exchange", {
      method: "POST",
      body: JSON.stringify({ token: mint("officer@spa-demo.test") }),
    });
    expect(r.status).toBe(404);
  });
  test("rate limited per IP and per email", async () => {
    app = build();
    const ip = { "x-client-ip": "10.0.0.7" };
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await post("garbage", "", ip)).status);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    app = build();
    const byEmail: number[] = [];
    for (let i = 0; i < 12; i++)
      byEmail.push((await post(mint("former@spa-demo.test"), "", { "x-client-ip": `10.0.1.${i}` })).status);
    expect(byEmail.slice(0, 10).every((c) => c === 403)).toBe(true);
    expect(byEmail.slice(10)).toEqual([429, 429]);
  });
  test("the SPA session never opens a leasing-style route and a leasing session never opens the SPA", async () => {
    const [u] = (await database.pool.query("select id from spa_users limit 1")).rows;
    expect(
      (await app.request("/api/me", { headers: { authorization: `Bearer ${issueToken(LEASING_SECRET, u.id, now)}` } }))
        .status,
    ).toBe(401);
    expect(
      (await app.request("/api/me", { headers: { authorization: `Bearer ${issueToken(SECRET, u.id, now)}` } })).status,
    ).toBe(200);
  });
});
