/* oxlint-disable no-explicit-any -- the mocked framework calls and the pages' elements are read loosely */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { FixedClock, issueToken } from "../../engine/test/session.ts";
import { dealEvents, spaPolicy, type SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { seedUsers, type U } from "../../engine/test/prepare-fixtures.ts";
import {
  clockRequest,
  companyRequest,
  policyRequest,
  settingsError,
  settingsSaved,
  userActiveRequest,
  userRoleRequest,
} from "../lib/settings-forms";

void FixedClock;
const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-21T06:00:00Z");
const url = spaTestDatabaseUrl();
const ROLE_KEYS = [
  ["officer", "sales_officer"],
  ["manager", "sales_manager"],
  ["salesadmin", "sales_admin"],
  ["legal", "legal"],
  ["finance", "finance"],
  ["compliance", "compliance_officer"],
  ["mlro", "mlro"],
  ["admin", "admin"],
] as const;
/** The words no page a non-compliance role can open may hold (S57, S63, S66, S72). */
const BANNED =
  /\baml\b|anti-money|money laundering|screen(ing|ed|s)?\b|sanction|\bpep\b|politically exposed|\bedd\b|due diligence|\brisk\b|mlro|suspicio|beneficial/i;
const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};

let session = "";
const redirects: string[] = [];
const revalidated: string[] = [];
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session }) }) }));
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
mock.module("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
mock.module("../lib/env", () => ({ engineUrl: () => "http://engine.test", sessionCookie: () => "spa_session" }));

describe("C40: the form builders read a fixed list of fields", () => {
  test("company: a name and a real kind; a stuffed field is never sent", () => {
    expect(companyRequest(form({ name: " Fictional LLC ", kind: "both", role: "admin", id: "x" }))).toEqual({
      method: "PUT",
      path: "/api/settings/company",
      body: { name: "Fictional LLC", kind: "both" },
    });
    expect(companyRequest(form({ name: "", kind: "both" }))).toBeNull();
    expect(companyRequest(form({ name: "X", kind: "bank" }))).toBeNull();
  });
  test("plans: percentages become whole basis points without floats; day lists become numbers", () => {
    const f = form({
      baseVersion: "3",
      maxDiscount: "5.25",
      commissionSeller: "2",
      commissionBuyer: "1.5",
      deposit: "10",
      holdDays: "7",
      offerDays: "3",
      remindBefore: "14, 3",
      remindAfter: "1 5",
      nocRules: "[]",
      role: "admin",
    });
    expect(policyRequest("plans", f)).toEqual({
      method: "PUT",
      path: "/api/settings/policy/plans",
      body: {
        baseVersion: 3,
        values: {
          maxDiscountBps: 525,
          commission: { sellerSideBps: 200, buyerSideBps: 150 },
          depositBps: 1000,
          holdDays: 7,
          offerValidityDays: 3,
          instalmentReminders: { beforeDays: [14, 3], afterDays: [1, 5] },
        },
      },
    });
    for (const bad of [
      { maxDiscount: "5.255" },
      { maxDiscount: "-1" },
      { maxDiscount: "100.01" },
      { holdDays: "x" },
      { remindBefore: "1,a" },
      { baseVersion: "" },
    ])
      expect(
        policyRequest(
          "plans",
          (() => {
            const g = new FormData();
            for (const [k, v] of f.entries()) g.set(k, v);
            for (const [k, v] of Object.entries(bad)) g.set(k, v);
            return g;
          })(),
        ),
      ).toBeNull();
    const empty = form({ ...(Object.fromEntries(f.entries()) as any), remindBefore: "", remindAfter: "" });
    expect((policyRequest("plans", empty) as any).body.values.instalmentReminders).toEqual({
      beforeDays: [],
      afterDays: [],
    });
  });
  test("signing: link days and who signs first per deal type", () => {
    const f = form({
      baseVersion: "0",
      signingLinkDays: "21",
      order_primary_offplan: "buyer_first",
      order_resale_ready: "seller_first",
      order_resale_offplan: "buyer_first",
      holdDays: "9",
    });
    expect(policyRequest("signing", f)).toEqual({
      method: "PUT",
      path: "/api/settings/policy/signing",
      body: {
        baseVersion: 0,
        values: {
          signingLinkDays: 21,
          signingOrder: {
            primary_offplan: ["buyer", "seller"],
            resale_ready: ["seller", "buyer"],
            resale_offplan: ["buyer", "seller"],
          },
        },
      },
    });
    f.set("order_resale_ready", "both");
    expect(policyRequest("signing", f)).toBeNull();
    expect(policyRequest("aml" as any, f)).toBeNull();
  });
  test("users: a real id and a role through the neutral names; the form never names the compliance role", () => {
    const id = "01931f5e-7b2a-7c3d-8e4f-0123456789ab";
    expect(userRoleRequest(form({ userId: id, role: "legal", actor: "x" }))).toEqual({
      method: "PUT",
      path: `/api/settings/users/${id}`,
      body: { role: "legal" },
    });
    expect((userRoleRequest(form({ userId: id, role: "compliance_senior" })) as any).body).toEqual({ role: "mlro" });
    expect(userRoleRequest(form({ userId: id, role: "mlro" }))).toBeNull();
    expect(userRoleRequest(form({ userId: "x", role: "legal" }))).toBeNull();
    expect(userRoleRequest(form({ userId: id, role: "boss" }))).toBeNull();
    expect(userActiveRequest(form({ userId: id, active: "no" }))?.body).toEqual({ active: false });
    expect(userActiveRequest(form({ userId: id, active: "yes" }))?.body).toEqual({ active: true });
    expect(userActiveRequest(form({ userId: id, active: "maybe" }))).toBeNull();
  });
  test("the demo clock: days from 1 to 365, or rewind", () => {
    expect(clockRequest(form({ days: "30" }))?.body).toEqual({ days: 30 });
    expect(clockRequest(form({ rewind: "yes" }))?.body).toEqual({ rewind: true });
    for (const d of ["0", "366", "1.5", "x", ""]) expect(clockRequest(form({ days: d }))).toBeNull();
    expect(clockRequest(form({ days: "3", rewind: "yes" }))?.body).toEqual({ rewind: true });
  });
  test("the new words name no compliance subject", () => {
    for (const c of ["stale", "blocked", "refused", "invalid"]) expect(settingsError(c)).not.toMatch(BANNED);
    for (const c of ["company", "user", "clock"]) expect(settingsSaved(c)).toBeTruthy();
    expect(settingsError("stale")).not.toBe(settingsError("whatever"));
  });
});

describe.skipIf(!url)("C40: the new Settings pages and actions against the real engine, per role", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  let plain: ReturnType<typeof createApp>;
  let demo: ReturnType<typeof createApp>;
  const realFetch = globalThis.fetch;
  const asUser = (k: string) => (session = issueToken(SECRET, users[k]!.id, NOW));
  const page = async (mod: string, props: Record<string, unknown> = {}): Promise<string | "404"> => {
    const m = await import(mod);
    try {
      const el = await m.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}), ...props });
      return render(el);
    } catch (e) {
      if (String((e as Error).message) === "NEXT_NOT_FOUND") return "404";
      throw e;
    }
  };
  const run = async (mod: string, name: string, f: FormData) => {
    const actions = await import(mod);
    redirects.length = 0;
    revalidated.length = 0;
    await (actions as any)[name](f).catch(() => {});
    return redirects[0];
  };
  const base = "../app/(staff)/settings";
  const events = async (type: string) => (await database.db.select().from(dealEvents)).filter((e) => e.type === type);

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    // Names and emails are data, not page wording: the scan below is of what the pages say.
    await database.pool.query(
      "update spa_users set name = 'Second Compliance', email = 'second@spa-demo.test' where id = $1",
      [users.mlro!.id],
    );
    const deps = {
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      sessionSecret: SECRET,
      nowMs: () => NOW,
      models: { vision: "vision-tag:1b", chat: "chat-tag:4b" },
      integrations: { email: "simulated", registry: "simulated", models: "connected" },
    } as const;
    plain = createApp({ ...deps, clock: new SpaDemoClock(database, false), demoMode: false });
    demo = createApp({ ...deps, clock: new SpaDemoClock(database, true), demoMode: true });
    app = plain;
    globalThis.fetch = ((input: string, init?: RequestInit) =>
      app.request(String(input).replace("http://engine.test", ""), init)) as never;
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await database?.close();
  });

  const pages = [
    { name: "company", mod: `${base}/company/page`, who: ["manager", "admin"] },
    { name: "plans", mod: `${base}/plans/page`, who: ["manager", "admin"] },
    { name: "signing", mod: `${base}/signing/page`, who: ["manager", "admin"] },
    { name: "fees", mod: `${base}/fees/page`, who: ["manager", "admin"] },
    { name: "users", mod: `${base}/users/page`, who: ["admin"] },
    { name: "models", mod: `${base}/models/page`, who: ["manager", "admin"] },
    { name: "integrations", mod: `${base}/integrations/page`, who: ["manager", "admin"] },
  ] as const;

  test("every page opens for the right roles only and is not there for the rest, for all eight roles", async () => {
    for (const p of pages)
      for (const [key] of ROLE_KEYS) {
        asUser(key);
        const html = await page(p.mod);
        expect(html === "404", `${p.name} / ${key}`).toBe(!(p.who as readonly string[]).includes(key));
      }
  });

  test("the demo clock page is absent outside demo mode for every role, and the admin's inside it", async () => {
    for (const [key] of ROLE_KEYS) {
      asUser(key);
      expect(await page(`${base}/demo-clock/page`), key).toBe("404");
    }
    app = demo;
    for (const [key] of ROLE_KEYS) {
      asUser(key);
      expect((await page(`${base}/demo-clock/page`)) === "404", key).toBe(key !== "admin");
    }
    app = plain;
  });

  test("no AML, screening, risk or sanction word on any Settings page, for all eight roles", async () => {
    let scanned = 0;
    app = demo;
    const all = [
      ...pages,
      { name: "clock", mod: `${base}/demo-clock/page`, who: ["admin"] },
      { name: "hub", mod: `${base}/page`, who: ["manager", "admin", "legal"] },
    ];
    for (const p of all)
      for (const [key] of ROLE_KEYS) {
        asUser(key);
        const html = await page(p.mod);
        if (html === "404") continue;
        scanned++;
        expect(html, `${p.name} / ${key}`).not.toMatch(BANNED);
      }
    app = plain;
    expect(scanned).toBe(17);
  });

  test("the hub lists each page for the roles that open it; the placeholder is gone; the clock card only in demo mode", async () => {
    asUser("manager");
    const m = (await page(`${base}/page`)) as string;
    for (const h of ["company", "plans", "fees", "signing", "models", "integrations"])
      expect(m).toContain(`href="/settings/${h}"`);
    expect(m).not.toContain("/settings/users");
    expect(m).not.toContain("/settings/demo-clock");
    expect(m).not.toContain("More settings are coming");
    asUser("admin");
    const a = (await page(`${base}/page`)) as string;
    expect(a).toContain('href="/settings/users"');
    expect(a).not.toContain("/settings/demo-clock");
    expect(a).not.toContain("More settings are coming");
    app = demo;
    expect((await page(`${base}/page`)) as string).toContain('href="/settings/demo-clock"');
    app = plain;
    asUser("legal");
    const l = (await page(`${base}/page`)) as string;
    for (const h of ["company", "plans", "fees", "signing", "users", "models", "integrations"])
      expect(l).not.toContain(`/settings/${h}`);
  });

  test("the fees page: percentages and dirhams, Pending with no value, the sample preview, the version, and no AML key", async () => {
    asUser("manager");
    const html = (await page(`${base}/fees/page`)) as string;
    expect(html).toContain("dubai-sales-2026-01");
    expect(html).toContain("4%");
    expect(html).toContain("Pending");
    expect(html).toContain("AED 1,000,000");
    expect(html).not.toMatch(/<(input|form|button)/);
    expect(html).not.toMatch(/threshold|beneficial|name match/i);
    // a pending key shows no number next to it
    expect(html.match(/Trustee fee[^<]*<[^]*?Pending/)).toBeTruthy();
  });

  test("the company page: the admin has the form, the manager a read-only view; signatories show names only", async () => {
    asUser("admin");
    const a = (await page(`${base}/company/page`)) as string;
    expect(a).toContain("<form");
    expect(a).toContain('name="name"');
    asUser("manager");
    const m = (await page(`${base}/company/page`)) as string;
    expect(m).not.toContain("<form");
    expect(m).toContain("Adding a signatory");
  });

  test("models and integrations show tags and statuses, never an address", async () => {
    asUser("admin");
    const models = (await page(`${base}/models/page`)) as string;
    expect(models).toContain("vision-tag:1b");
    expect(models).toContain("Not set up");
    const integ = (await page(`${base}/integrations/page`)) as string;
    expect(integ).toContain("Simulated");
    expect(integ).toContain("Not set up");
    for (const h of [models, integ]) expect(h).not.toMatch(/https?:|localhost|\b127\.|smtp|key\b/i);
  });

  test("company action: a forged form from a manager changes nothing; the admin saves", async () => {
    const A = `${base}/company/actions`;
    asUser("manager");
    expect(await run(A, "saveCompany", form({ name: "Forged", kind: "both" }))).toBe("/settings/company?error=refused");
    asUser("admin");
    expect(await run(A, "saveCompany", form({ name: "", kind: "both" }))).toBe("/settings/company?error=invalid");
    expect(await run(A, "saveCompany", form({ name: "Fictional Homes LLC", kind: "developer" }))).toBe(
      "/settings/company?saved=company",
    );
    expect((await page(`${base}/company/page`)) as string).toContain("Fictional Homes LLC");
    expect(JSON.stringify(await events("COMPANY_SET"))).not.toContain("Forged");
  });

  test("plans: the admin saves and the page says Saved, version N; a stale form is refused; a manager's forged save changes nothing", async () => {
    const A = `${base}/plans/actions`;
    const f = (over: Record<string, string> = {}) =>
      form({
        baseVersion: "0",
        maxDiscount: "5",
        commissionSeller: "2",
        commissionBuyer: "2",
        deposit: "10",
        holdDays: "9",
        offerDays: "3",
        remindBefore: "14, 3",
        remindAfter: "1",
        ...over,
      });
    const rows = async () => (await database.db.select().from(spaPolicy)).length;
    asUser("manager");
    expect(await run(A, "savePlans", f())).toBe("/settings/plans?error=refused");
    expect(await rows()).toBe(0);
    asUser("admin");
    expect(await run(A, "savePlans", f({ holdDays: "0" }))).toBe("/settings/plans?error=invalid");
    expect(await run(A, "savePlans", f())).toBe("/settings/plans?saved=policy");
    expect(await rows()).toBe(1);
    expect(await run(A, "savePlans", f())).toBe("/settings/plans?error=stale");
    expect(await rows()).toBe(1);
    const html = (await page(`${base}/plans/page`, { searchParams: Promise.resolve({ saved: "policy" }) })) as string;
    expect(html).toContain("Saved, version 1");
    expect(html).toContain('value="9"');
    expect((await events("POLICY_PUBLISHED")).length).toBe(1);
    const out = await page(`${base}/plans/page`, { searchParams: Promise.resolve({ saved: "policy" }) });
    expect(out).not.toMatch(BANNED);
  });

  test("signing: the admin saves the link days and the order on the version the page showed", async () => {
    const A = `${base}/signing/actions`;
    asUser("admin");
    const read = (await page(`${base}/signing/page`)) as string;
    expect(read).toContain('name="baseVersion" value="1"');
    const f = form({
      baseVersion: "1",
      signingLinkDays: "20",
      order_primary_offplan: "buyer_first",
      order_resale_ready: "seller_first",
      order_resale_offplan: "buyer_first",
    });
    expect(await run(A, "saveSigning", f)).toBe("/settings/signing?saved=policy");
    const after = (await page(`${base}/signing/page`, {
      searchParams: Promise.resolve({ saved: "policy" }),
    })) as string;
    expect(after).toContain("Saved, version 2");
    expect(after).toContain('value="20"');
  });

  test("users: a role change and an active toggle go through; yourself and a bad id are refused; no hash on the page", async () => {
    const A = `${base}/users/actions`;
    const id = users.finance!.id;
    asUser("manager");
    expect(await run(A, "setUserRole", form({ userId: id, role: "legal" }))).toBe("/settings/users?error=refused");
    asUser("admin");
    expect(await run(A, "setUserRole", form({ userId: users.admin!.id, role: "legal" }))).toBe(
      "/settings/users?error=blocked",
    );
    expect(await run(A, "setUserRole", form({ userId: id, role: "boss" }))).toBe("/settings/users?error=invalid");
    expect(await run(A, "setUserRole", form({ userId: id, role: "legal" }))).toBe("/settings/users?saved=user");
    expect(await run(A, "setUserActive", form({ userId: id, active: "no" }))).toBe("/settings/users?saved=user");
    const html = (await page(`${base}/users/page`)) as string;
    expect(html).toContain("finance");
    expect(html).toContain("Inactive");
    expect(html).toContain("Compliance lead");
    expect(html).not.toMatch(/argon|password|spa-demo\.test/i);
    expect((await events("USER_ROLE_CHANGED")).length).toBe(1);
    expect((await events("USER_ACTIVE_SET")).length).toBe(1);
    await run(A, "setUserActive", form({ userId: id, active: "yes" }));
  });

  test("clock action: outside demo mode nothing is set; in demo mode the admin sets and rewinds", async () => {
    const A = `${base}/demo-clock/actions`;
    asUser("admin");
    expect(await run(A, "setClock", form({ days: "7" }))).toBe("/settings/demo-clock?error=refused");
    expect(await events("DEMO_CLOCK_SET")).toHaveLength(0);
    app = demo;
    asUser("manager");
    expect(await run(A, "setClock", form({ days: "7" }))).toBe("/settings/demo-clock?error=refused");
    asUser("admin");
    expect(await run(A, "setClock", form({ days: "7" }))).toBe("/settings/demo-clock?saved=clock");
    const html = (await page(`${base}/demo-clock/page`)) as string;
    expect(html).toContain("7 days");
    expect(await run(A, "setClock", form({ days: "400" }))).toBe("/settings/demo-clock?error=invalid");
    expect(await run(A, "setClock", form({ rewind: "yes" }))).toBe("/settings/demo-clock?saved=clock");
    expect((await events("DEMO_CLOCK_SET")).length).toBe(2);
    app = plain;
  });
});
