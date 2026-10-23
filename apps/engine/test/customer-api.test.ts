import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { type Database, customerAccounts } from "@leasing/db";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { addStaff, freshDatabase, noDb, testContext } from "./harness.ts";

const SECRET = "test-secret";
let database: Database;
let app: ReturnType<typeof createApi>;
let t: ReturnType<typeof testContext>;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const lastCode = () => /Your sign-in code is (\d{6})/.exec(t.mailer.sent.at(-1)!.text)![1]!;

async function login(email = "sara@example.com", ip = "1.1.1.1") {
  expect((await post("/api/customer/auth/code", { email }, { "x-forwarded-for": ip })).status).toBe(202);
  const r = await post("/api/customer/auth/verify", { email, code: lastCode() });
  expect(r.status).toBe(200);
  return (await r.json()) as { token: string; needsProfile: boolean; account: { id: string; email: string } };
}

describe.skipIf(noDb)("customer auth routes", () => {
  beforeEach(async () => {
    database = await freshDatabase();
    t = testContext(database, "2026-11-02T04:00:00Z");
    t.ctx.sessionSecret = SECRET;
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
  });

  test("full flow: code, verify, profile, me, logout", async () => {
    const sent = await post("/api/customer/auth/code", { email: "Sara@Example.com" });
    expect(await sent.json()).toEqual({ sent: true });
    const v = await login();
    expect(v.needsProfile).toBe(true);
    expect(v.account.email).toBe("sara@example.com");
    const h = bearer(v.token);
    const me = await app.request("/api/customer/me", { headers: h });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "sara@example.com", fullName: "" });
    const p = await post("/api/customer/profile", { fullName: "Sara Khan", phone: "050 123 4567" }, h);
    expect(p.status).toBe(200);
    expect(await p.json()).toMatchObject({ fullName: "Sara Khan", phone: "+971501234567" });
    expect((await post("/api/customer/logout", {}, h)).status).toBe(204);
    expect((await app.request("/api/customer/me", { headers: h })).status).toBe(401);
  });

  test("a wrong code is 401", async () => {
    await post("/api/customer/auth/code", { email: "sara@example.com" });
    const bad = lastCode() === "000000" ? "111111" : "000000";
    expect((await post("/api/customer/auth/verify", { email: "sara@example.com", code: bad })).status).toBe(401);
  });

  test("the cookie works like the bearer header", async () => {
    const v = await login();
    const r = await app.request("/api/customer/me", { headers: { cookie: `leasing_customer=${v.token}` } });
    expect(r.status).toBe(200);
  });

  test("tokens are not interchangeable between staff and customers", async () => {
    const v = await login();
    expect((await app.request("/api/me", { headers: bearer(v.token) })).status).toBe(401);
    const staff = issueToken(SECRET, (await addStaff(database, "admin")).id, Date.now());
    expect((await app.request("/api/customer/me", { headers: bearer(staff) })).status).toBe(401);
    expect((await app.request("/api/customer/me")).status).toBe(401);
  });

  test("logout bumps the session version", async () => {
    const v = await login();
    await post("/api/customer/logout", {}, bearer(v.token));
    const [a] = await database.db.select().from(customerAccounts).where(eq(customerAccounts.id, v.account.id));
    expect(a!.sessionVersion).toBe(1);
  });

  test("per-IP limit: 20 code requests an hour, then 429", async () => {
    for (let i = 0; i < 20; i++) {
      const r = await post(
        "/api/customer/auth/code",
        { email: `u${i}@example.com` },
        { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
      );
      expect(r.status).toBe(202);
    }
    const over = await post("/api/customer/auth/code", { email: "late@example.com" }, { "x-forwarded-for": "9.9.9.9" });
    expect(over.status).toBe(429);
    const other = await post(
      "/api/customer/auth/code",
      { email: "late@example.com" },
      { "x-forwarded-for": "8.8.8.8" },
    );
    expect(other.status).toBe(202);
  });

  test("bad input is 400", async () => {
    expect((await post("/api/customer/auth/code", { email: "nope" })).status).toBe(400);
    expect((await post("/api/customer/auth/verify", { email: "a@example.com", code: "12" })).status).toBe(400);
  });
});
