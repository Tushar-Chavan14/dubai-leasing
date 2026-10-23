import { beforeEach, describe, expect, test } from "bun:test";
import { type Database, customerAccounts, customerLoginCodes, leaseEvents, outboundMessages } from "@leasing/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  type CustomerEnv,
  issueCustomerToken,
  issueToken,
  requireCustomer,
  verifyCustomerToken,
  verifyToken,
} from "../src/api/auth.ts";
import { requestLoginCode, updateCustomerProfile, verifyLoginCode } from "../src/manager/customer-auth.ts";
import { freshDatabase, noDb, testContext } from "./harness.ts";

const START = "2026-11-02T04:00:00Z";
const SECRET = "test-session-secret";
let database: Database;

function setup(opts: { demoRecipient?: string } = {}) {
  const t = testContext(database, START, opts);
  t.ctx.sessionSecret = SECRET;
  return t;
}
/** The code from the latest email (tests read it the way a customer would). */
const lastCode = (mailer: { sent: { subject: string }[] }) =>
  /Your sign-in code: (\d{6})/.exec(mailer.sent.at(-1)!.subject)![1]!;
const wrong = (code: string) => (code === "000000" ? "111111" : "000000");

describe.skipIf(noDb)("customer email-code login", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("sends a code and logs in, creating the account", async () => {
    const { ctx, mailer } = setup();
    expect(await requestLoginCode(ctx, "Sara@Example.com", "ip1")).toEqual({ sent: true });
    const msgs = await database.db.select().from(outboundMessages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ template: "login_code", entityKind: "customer_account", purpose: "link" });
    const [row] = await database.db.select().from(customerLoginCodes);
    expect(msgs[0]!.entityId).toBe(row!.id);
    expect(msgs[0]!.milestone).toBe(`login:${row!.id}`);
    expect(row!.codeHash).not.toContain(lastCode(mailer));
    const r = await verifyLoginCode(ctx, "sara@example.com", lastCode(mailer));
    expect(r.needsProfile).toBe(true);
    expect(await database.db.select().from(customerAccounts)).toHaveLength(1);
    expect(r.account.email).toBe("sara@example.com");
    const [acc] = await database.db.select().from(customerAccounts);
    expect(acc!.lastLoginAt).not.toBeNull();
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityKind, "customer_account"));
    expect(events.map((e) => e.actor)).toContain(`customer:${acc!.id}`);
    expect(JSON.stringify(events)).not.toContain("sara@example.com");
  });

  test("normalises email: one account for any casing", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "  Sara@Example.COM ", "ip");
    const a = await verifyLoginCode(ctx, "SARA@example.com", lastCode(mailer));
    await requestLoginCode(ctx, "sara@EXAMPLE.com", "ip");
    const b = await verifyLoginCode(ctx, " sara@example.com", lastCode(mailer));
    expect(b.account.id).toBe(a.account.id);
    expect(await database.db.select().from(customerAccounts)).toHaveLength(1);
    const codes = await database.db.select().from(customerLoginCodes);
    expect(new Set(codes.map((c) => c.email))).toEqual(new Set(["sara@example.com"]));
  });

  test("same response over the limit and sends nothing", async () => {
    const { ctx, clock, mailer } = setup();
    for (let i = 0; i < 5; i++) expect(await requestLoginCode(ctx, "a@example.com", "ip")).toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(5);
    expect(await requestLoginCode(ctx, "A@example.com", "ip")).toEqual({ sent: true });
    expect(mailer.sent).toHaveLength(5);
    // An hour later the window has moved on.
    clock.set(new Date(new Date(START).getTime() + 61 * 60_000));
    await requestLoginCode(ctx, "a@example.com", "ip");
    expect(mailer.sent).toHaveLength(6);
  });

  test("wrong code five times kills it", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    const good = lastCode(mailer);
    for (let i = 0; i < 5; i++)
      await expect(verifyLoginCode(ctx, "a@example.com", wrong(good))).rejects.toMatchObject({
        status: 401,
        code: "unauthorised",
      });
    await expect(verifyLoginCode(ctx, "a@example.com", good)).rejects.toMatchObject({ status: 401 });
    expect(await database.db.select().from(customerAccounts)).toHaveLength(0);
  });

  test("four wrong tries then the right code still works", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    const good = lastCode(mailer);
    for (let i = 0; i < 4; i++) await verifyLoginCode(ctx, "a@example.com", wrong(good)).catch(() => {});
    expect((await verifyLoginCode(ctx, "a@example.com", good)).account.email).toBe("a@example.com");
  });

  test("expired code", async () => {
    const { ctx, clock, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    clock.set(new Date(new Date(START).getTime() + 11 * 60_000));
    await expect(verifyLoginCode(ctx, "a@example.com", lastCode(mailer))).rejects.toMatchObject({ status: 401 });
  });

  test("code is single use", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    const code = lastCode(mailer);
    await verifyLoginCode(ctx, "a@example.com", code);
    await expect(verifyLoginCode(ctx, "a@example.com", code)).rejects.toMatchObject({ status: 401 });
  });

  test("a code for one email does not work for another", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    await requestLoginCode(ctx, "b@example.com", "ip");
    const codeB = lastCode(mailer);
    await expect(verifyLoginCode(ctx, "a@example.com", codeB)).rejects.toMatchObject({ status: 401 });
  });

  test("new code voids the old one", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    const first = lastCode(mailer);
    await requestLoginCode(ctx, "a@example.com", "ip");
    const second = lastCode(mailer);
    const codes = await database.db.select().from(customerLoginCodes);
    expect(codes.filter((c) => c.voidedAt)).toHaveLength(1);
    if (first !== second)
      await expect(verifyLoginCode(ctx, "a@example.com", first)).rejects.toMatchObject({ status: 401 });
    expect((await verifyLoginCode(ctx, "a@example.com", second)).needsProfile).toBe(true);
  });

  test("malformed code or email is rejected", async () => {
    const { ctx } = setup();
    await expect(requestLoginCode(ctx, "not-an-email", "ip")).rejects.toThrow();
    await expect(verifyLoginCode(ctx, "a@example.com", "12ab56")).rejects.toThrow();
  });

  test("demo redirect records intended_to", async () => {
    const { ctx } = setup({ demoRecipient: "inbox@demo.test" });
    await requestLoginCode(ctx, "Sara@example.com", "ip");
    const [m] = await database.db.select().from(outboundMessages);
    expect(m).toMatchObject({ to: "inbox@demo.test", intendedTo: "sara@example.com", status: "sent" });
  });

  test("profile: name, phone normalised, invalid phone 422", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    const { account } = await verifyLoginCode(ctx, "a@example.com", lastCode(mailer));
    await expect(updateCustomerProfile(ctx, account.id, { fullName: "Sara K", phone: "12" })).rejects.toMatchObject({
      status: 422,
    });
    const upd = await updateCustomerProfile(ctx, account.id, { fullName: "  Sara Khan ", phone: "050 123 4567" });
    expect(upd).toMatchObject({ fullName: "Sara Khan", phone: "+971501234567" });
    await requestLoginCode(ctx, "a@example.com", "ip");
    expect((await verifyLoginCode(ctx, "a@example.com", lastCode(mailer))).needsProfile).toBe(false);
  });

  test("customer token and staff token are not interchangeable", () => {
    const now = 1_000_000;
    const ct = issueCustomerToken(SECRET, "acc-1", 0, now);
    const st = issueToken(SECRET, "user-1", now);
    expect(verifyToken(SECRET, ct, now)).toBeNull();
    expect(verifyCustomerToken(SECRET, st, now)).toBeNull();
    expect(verifyCustomerToken(SECRET, ct, now)).toEqual({ aid: "acc-1", sv: 0 });
    expect(verifyCustomerToken("other", ct, now)).toBeNull();
    expect(verifyCustomerToken(SECRET, ct, now + 31 * 86_400_000)).toBeNull();
    expect(verifyToken(SECRET, st, now)).toBe("user-1");
  });

  test("bumping sessionVersion logs out", async () => {
    const { ctx, mailer } = setup();
    await requestLoginCode(ctx, "a@example.com", "ip");
    const { account } = await verifyLoginCode(ctx, "a@example.com", lastCode(mailer));
    const app = new Hono<CustomerEnv>();
    app.use("*", requireCustomer(database, SECRET));
    app.get("/me", (c) => c.json({ id: c.get("customer").id }));
    const token = issueCustomerToken(SECRET, account.id, 0, Date.now());
    const get = (t?: string) => app.request("/me", { headers: t ? { authorization: `Bearer ${t}` } : {} });
    expect((await get(token)).status).toBe(200);
    expect((await get()).status).toBe(401);
    expect((await get(issueToken(SECRET, account.id, Date.now()))).status).toBe(401);
    await database.db.update(customerAccounts).set({ sessionVersion: 1 }).where(eq(customerAccounts.id, account.id));
    expect((await get(token)).status).toBe(401);
    expect((await get(issueCustomerToken(SECRET, account.id, 1, Date.now()))).status).toBe(200);
  });
});
