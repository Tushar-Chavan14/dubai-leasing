import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { beforeAll, describe, expect, test } from "bun:test";
import { type Database, portalHandoffs, staffUsers } from "@leasing/db";
import { generatePortalKeyPair, issueToken, signPortalToken } from "@platform/kernel";
import { createApi } from "../src/api/app.ts";
import { addStaff, freshDatabase, noDb, testContext } from "./harness.ts";

const SECRET = "leasing-secret-".padEnd(40, "x");
const SPA_SECRET = "s".repeat(40);
// Staff sessions are checked against the real clock by requireUser, so the test starts from it.
const NOW = Date.now();
const keys = generatePortalKeyPair();

describe.skipIf(noDb)("POST /api/auth/portal-exchange (C38, S70)", () => {
  let database: Database;
  let now = NOW;
  let app: ReturnType<typeof createApi>;
  let officerEmail: string;
  const build = (over: Record<string, unknown> = {}) =>
    createApi(testContext(database, "2026-11-21T08:00:00Z").ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
      portalPublicKey: keys.publicKey,
      nowMs: () => now,
      ...over,
    } as never);
  const mint = (email: string, aud: "spa" | "leasing" = "leasing") =>
    signPortalToken(keys.privateKey, { sub: "acct", email, aud }, now);
  const post = (token: string, query = "", headers: Record<string, string> = {}) =>
    app.request(`/api/auth/portal-exchange${query}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ token }),
    });
  const staffCount = async () => (await database.db.select().from(staffUsers)).length;

  beforeAll(async () => {
    database = await freshDatabase();
    app = build();
    officerEmail = (await addStaff(database, "leasing_officer")).email;
  });

  test("an active staff user gets their own role as a session of the leasing secret", async () => {
    const r = await post(mint(officerEmail.toUpperCase()));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { token: string; user: { role: string } };
    expect(body.user.role).toBe("leasing_officer");
    const me = await app.request("/api/me", { headers: { authorization: `Bearer ${body.token}` } });
    expect(((await me.json()) as { role: string }).role).toBe("leasing_officer");
  });
  test("a token minted for the SPA is refused (wrong audience)", async () => {
    expect((await post(mint(officerEmail, "spa"))).status).toBe(401);
  });
  test("no active staff user: 403, one body, nothing created; an inactive user too", async () => {
    const gone = (await addStaff(database, "finance")).email;
    await database.pool.query("update staff_users set active = false where email = $1", [gone]);
    const before = await staffCount();
    const a = await post(mint("nobody@example.test"));
    const b = await post(mint(gone));
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(await a.json()).toEqual(await b.json());
    expect(await staffCount()).toBe(before);
  });
  test("a token works once and the jti is stored; an expired one is refused", async () => {
    const t = mint(officerEmail);
    expect((await post(t)).status).toBe(200);
    expect((await post(t)).status).toBe(401);
    expect((await database.db.select().from(portalHandoffs)).length).toBeGreaterThan(0);
    const late = mint(officerEmail);
    now += 61_000;
    expect((await post(late)).status).toBe(401);
    now = NOW;
  });
  test("portal_handoffs is append-only", async () => {
    const run = (sql: string) =>
      database.pool.query(sql).then(
        () => "accepted",
        (e: Error) => e.message,
      );
    expect(await run("update portal_handoffs set used_at = now()")).toContain("append-only");
    expect(await run("delete from portal_handoffs")).toContain("append-only");
    expect(await run("truncate portal_handoffs")).toContain("append-only");
  });
  test("check=1: active or not, no session, no jti spent", async () => {
    const t = mint(officerEmail);
    expect(await (await post(t, "?check=1")).json()).toEqual({ active: true });
    expect(await (await post(mint("nobody@example.test"), "?check=1")).json()).toEqual({ active: false });
    expect((await post(t)).status).toBe(200);
  });
  test("without the public key the route is off (404)", async () => {
    const off = build({ portalPublicKey: undefined });
    const r = await off.request("/api/auth/portal-exchange", { method: "POST", body: JSON.stringify({ token: "x" }) });
    expect(r.status).toBe(404);
  });
  test("rate limited per IP and per email", async () => {
    app = build();
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await post("garbage", "", { "x-client-ip": "10.0.0.7" })).status);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    app = build();
    const byEmail: number[] = [];
    for (let i = 0; i < 12; i++)
      byEmail.push((await post(mint("ghost@example.test"), "", { "x-client-ip": `10.0.1.${i}` })).status);
    expect(byEmail.slice(0, 10).every((c) => c === 403)).toBe(true);
    expect(byEmail.slice(10)).toEqual([429, 429]);
  });
  test("the SPA session secret never opens a leasing route (S33 extended)", async () => {
    const [u] = await database.db.select().from(staffUsers).limit(1);
    const opens = (secret: string) =>
      app.request("/api/me", { headers: { authorization: `Bearer ${issueToken(secret, u!.id, Date.now())}` } });
    expect((await opens(SPA_SECRET)).status).toBe(401);
    expect((await opens(SECRET)).status).toBe(200);
  });
});
