/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FixedClock, issueToken } from "@platform/kernel";
import { DEFAULT_SPA_POLICY, STAFF_EVENTS } from "@spa/core";
import { dealEvents, spaDemoSettings, spaPolicy, spaUsers, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { dubaiSales2026_01 } from "@spa/rulebook";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { currentPolicy, policyAt } from "../src/manager/policy.ts";
import {
  changeUser,
  PLAN_KEYS,
  RULEBOOK_AML_KEYS,
  RULEBOOK_SETTING_KEYS,
  SIGNING_KEYS,
  VIEWING_KEYS,
} from "../src/manager/settings-pages.ts";
import { company, party, seedUsers, type U } from "./prepare-fixtures.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-21T06:00:00Z");
const url = spaTestDatabaseUrl();
const KEYS = ["officer", "manager", "salesadmin", "legal", "finance", "compliance", "mlro", "admin"] as const;
const READ = new Set(["admin", "manager"]);

describe("S72: every rulebook key is classified for the Fees page", () => {
  test("a key in the rulebook that is in neither the shown list nor the omitted list fails this test", () => {
    const META = ["version", "emirate", "effectiveFrom", "sources", "pending"];
    const keys = Object.keys(dubaiSales2026_01).filter((k) => !META.includes(k));
    const known = new Set<string>([...RULEBOOK_SETTING_KEYS, ...RULEBOOK_AML_KEYS]);
    expect(keys.filter((k) => !known.has(k))).toEqual([]);
    // and nothing in the lists is a stale name
    expect([...known].filter((k) => !keys.includes(k))).toEqual([]);
    expect([...RULEBOOK_AML_KEYS].toSorted()).toEqual(
      ["amlCashThresholdFils", "amlNameMatchThreshold", "beneficialOwnerBps"].toSorted(),
    );
  });
  test("the page key lists are disjoint and name real policy keys", () => {
    for (const k of [...PLAN_KEYS, ...SIGNING_KEYS, ...VIEWING_KEYS]) expect(k in DEFAULT_SPA_POLICY).toBe(true);
    expect(PLAN_KEYS.filter((k) => (SIGNING_KEYS as readonly string[]).includes(k))).toEqual([]);
  });
  test("the three new events are classified", () => {
    for (const t of ["USER_ROLE_CHANGED", "USER_ACTIVE_SET", "DEMO_CLOCK_SET"]) expect(STAFF_EVENTS.has(t)).toBe(true);
  });
});

describe.skipIf(!url)("S72: the remaining Settings routes", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  let demoApp: ReturnType<typeof createApp>;
  const callOn =
    (a: () => ReturnType<typeof createApp>) =>
    async (method: string, path: string, as?: string | null, body?: unknown) => {
      const r = await a().request(path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(as ? { authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await r.text();
      return { status: r.status, text, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
    };
  const call = callOn(() => app);
  const callDemo = callOn(() => demoApp);
  const events = async (type: string) => (await database.db.select().from(dealEvents)).filter((e) => e.type === type);
  const policyRows = async () => (await database.db.select().from(spaPolicy)).length;

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    const deps = {
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      sessionSecret: SECRET,
      nowMs: () => NOW,
      models: { vision: "vision-tag:1b", chat: "chat-tag:4b", decision: null, assistant: "chat-tag:4b", copilot: null },
      integrations: { email: "simulated", registry: "not_set_up", models: "connected" },
    } as const;
    app = createApp({ ...deps, clock: new SpaDemoClock(database, false), demoMode: false });
    demoApp = createApp({ ...deps, clock: new SpaDemoClock(database, true), demoMode: true });
  });
  afterAll(async () => {
    await database?.close();
  });

  describe("the role matrix, all eight roles", () => {
    test("401 on every route without a session", async () => {
      for (const [m, p] of [
        ["GET", "/api/settings/company"],
        ["PUT", "/api/settings/company"],
        ["GET", "/api/settings/policy/plans"],
        ["PUT", "/api/settings/policy/plans"],
        ["GET", "/api/settings/rulebook"],
        ["GET", "/api/settings/users"],
        ["PUT", `/api/settings/users/${users.officer!.id}`],
        ["GET", "/api/settings/models"],
        ["GET", "/api/settings/integrations"],
        ["POST", "/api/demo/clock"],
      ] as const)
        expect((await call(m, p, null, {})).status, `${m} ${p}`).toBe(401);
    });
    for (const k of KEYS) {
      test(`${k}: reads and writes`, async () => {
        const reads = [
          "/api/settings/company",
          "/api/settings/policy/plans",
          "/api/settings/policy/signing",
          "/api/settings/rulebook",
          "/api/settings/models",
          "/api/settings/integrations",
        ];
        for (const p of reads) expect((await call("GET", p, k)).status, `${k} GET ${p}`).toBe(READ.has(k) ? 200 : 403);
        expect((await call("GET", "/api/settings/users", k)).status, `${k} users`).toBe(k === "admin" ? 200 : 403);
        const admin = k === "admin";
        // A write by a non-admin is refused before the body is read: a bad body is still 403.
        expect((await call("PUT", "/api/settings/company", k, { name: "", kind: "x" })).status).toBe(admin ? 422 : 403);
        expect((await call("PUT", "/api/settings/policy/plans", k, { nonsense: 1 })).status).toBe(admin ? 422 : 403);
        expect((await call("PUT", "/api/settings/policy/signing", k, { nonsense: 1 })).status).toBe(admin ? 422 : 403);
        expect(
          (await call("PUT", `/api/settings/users/${users.finance!.id}`, k, admin ? { active: true } : { nonsense: 1 }))
            .status,
        ).toBe(admin ? 200 : 403);
        // the demo clock: outside demo mode it is not there for anyone, inside it is the admin's
        expect((await call("POST", "/api/demo/clock", k, { rewind: true })).status).toBe(404);
        expect((await callDemo("POST", "/api/demo/clock", k, { rewind: true })).status).toBe(admin ? 200 : 403);
      });
    }
    test("a hand-typed policy page is 404 for an admin, 403 for others", async () => {
      expect((await call("GET", "/api/settings/policy/aml", "admin")).status).toBe(404);
      expect((await call("PUT", "/api/settings/policy/nocRules", "admin", {})).status).toBe(404);
      expect((await call("GET", "/api/settings/policy/aml", "officer")).status).toBe(403);
    });
  });

  describe("company and signatories", () => {
    test("an admin changes the name and kind; one COMPANY_SET event; a bad kind or empty name is 422", async () => {
      const before = (await events("COMPANY_SET")).length;
      const r = await call("PUT", "/api/settings/company", "admin", {
        name: "  Fictional Homes LLC ",
        kind: "developer",
      });
      expect(r.status).toBe(200);
      const read = await call("GET", "/api/settings/company", "manager");
      expect(read.json.company).toEqual({ name: "Fictional Homes LLC", kind: "developer" });
      expect((await events("COMPANY_SET")).length).toBe(before + 1);
      expect((await call("PUT", "/api/settings/company", "admin", { name: "", kind: "both" })).status).toBe(422);
      expect((await call("PUT", "/api/settings/company", "admin", { name: "X", kind: "bank" })).status).toBe(422);
      expect((await call("PUT", "/api/settings/company", "manager", { name: "X", kind: "both" })).status).toBe(403);
    });
    test("the signatory list shows names, title and authority, and no number, owner or document", async () => {
      const c = await company(database, "Fictional Sellers LLC", "LIC-9");
      await party(database, "Lone Company", { kind: "company" });
      const r = await call("GET", "/api/settings/company", "admin");
      const row = r.json.signatories.find((s: any) => s.companyName === "Fictional Sellers LLC");
      expect(row.signatories).toHaveLength(1);
      expect(Object.keys(row.signatories[0]).toSorted()).toEqual(["authority", "name", "title"]);
      expect(r.json.signatories.find((s: any) => s.companyName === "Lone Company").signatories).toEqual([]);
      expect(r.text).not.toMatch(/passport|emirates|LIC-9|X0000001|owner|documentId|shareBps/i);
      void c;
    });
  });

  describe("plans and signing write through publishPolicy", () => {
    test("a save changes only the page's keys, adds one version and one POLICY_PUBLISHED event", async () => {
      const read = await call("GET", "/api/settings/policy/plans", "manager");
      expect(Object.keys(read.json.values).toSorted()).toEqual([...PLAN_KEYS].toSorted());
      const v0 = read.json.version;
      const prior = await currentPolicy(database.db);
      const rows = await policyRows();
      const evs = (await events("POLICY_PUBLISHED")).length;
      const r = await call("PUT", "/api/settings/policy/plans", "admin", {
        baseVersion: v0,
        values: { holdDays: 9, maxDiscountBps: 300 },
      });
      expect(r.status).toBe(200);
      expect(r.json.version).toBe(v0 + 1);
      const now = await currentPolicy(database.db);
      expect(now.values).toEqual({ ...prior.values, holdDays: 9, maxDiscountBps: 300 });
      expect(await policyRows()).toBe(rows + 1);
      expect((await events("POLICY_PUBLISHED")).length).toBe(evs + 1);
      // the version a running deal pinned (S37) is unchanged
      expect(await policyAt(database.db, v0)).toEqual(prior.values);
    });
    test("the signing page changes only the link days and the signing order", async () => {
      const read = await call("GET", "/api/settings/policy/signing", "admin");
      expect(Object.keys(read.json.values).toSorted()).toEqual([...SIGNING_KEYS].toSorted());
      const prior = await currentPolicy(database.db);
      const r = await call("PUT", "/api/settings/policy/signing", "admin", {
        baseVersion: read.json.version,
        values: {
          signingLinkDays: 21,
          signingOrder: { ...prior.values.signingOrder, resale_ready: ["seller", "buyer"] },
        },
      });
      expect(r.status).toBe(200);
      const now = await currentPolicy(database.db);
      expect(now.values).toEqual({
        ...prior.values,
        signingLinkDays: 21,
        signingOrder: { ...prior.values.signingOrder, resale_ready: ["seller", "buyer"] },
      });
    });
    test("the viewings page (S79): an admin saves days, hours, slot, lead and horizon; others read or are refused; bad values are 422", async () => {
      const read = await call("GET", "/api/settings/policy/viewings", "manager");
      expect(read.status).toBe(200);
      expect(Object.keys(read.json.values).toSorted()).toEqual([...VIEWING_KEYS].toSorted());
      expect(read.json.values.viewings).toMatchObject({
        viewingDays: [1, 2, 3, 4, 5, 6],
        viewingStartHour: 10,
        viewingEndHour: 18,
        viewingSlotMinutes: 30,
        viewingLeadHours: 4,
        viewingHorizonDays: 14,
      });
      expect(read.json.values.leads).toEqual({ perEmailPerDay: 5 });
      expect((await call("GET", "/api/settings/policy/viewings", "officer")).status).toBe(403);
      const rows = await policyRows();
      const good = {
        ...read.json.values.viewings,
        viewingDays: [0, 1, 2],
        viewingSlotMinutes: 45,
        viewingHorizonDays: 21,
      };
      expect(
        (
          await call("PUT", "/api/settings/policy/viewings", "manager", {
            baseVersion: read.json.version,
            values: { viewings: good },
          })
        ).status,
      ).toBe(403);
      for (const bad of [
        { ...good, viewingStartHour: 18, viewingEndHour: 10 },
        { ...good, viewingStartHour: 10, viewingEndHour: 10 },
        { ...good, viewingSlotMinutes: 10 },
        { ...good, viewingSlotMinutes: 150 },
        { ...good, viewingHorizonDays: 0 },
        { ...good, viewingHorizonDays: 61 },
        { ...good, viewingDays: [] },
        { ...good, viewingDays: [7] },
      ]) {
        const r = await call("PUT", "/api/settings/policy/viewings", "admin", {
          baseVersion: read.json.version,
          values: { viewings: bad },
        });
        expect([r.status, r.json.code], JSON.stringify(bad)).toEqual([422, "invalid_policy"]);
      }
      expect(await policyRows()).toBe(rows);
      const saved = await call("PUT", "/api/settings/policy/viewings", "admin", {
        baseVersion: read.json.version,
        values: { viewings: good, leads: { perEmailPerDay: 3 } },
      });
      expect(saved.status).toBe(200);
      const now = await currentPolicy(database.db);
      expect(now.values.viewings).toEqual(good);
      expect(now.values.leads.perEmailPerDay).toBe(3);
      // The viewing slot code reads the new policy: Sunday is now a viewing day.
      const again = await call("GET", "/api/settings/policy/viewings", "admin");
      const restore = await call("PUT", "/api/settings/policy/viewings", "admin", {
        baseVersion: again.json.version,
        values: { viewings: DEFAULT_SPA_POLICY.viewings, leads: DEFAULT_SPA_POLICY.leads },
      });
      expect(restore.status).toBe(200);
    });
    test("a key from another page or from the policy at large is 422 and writes nothing", async () => {
      const v = (await call("GET", "/api/settings/policy/plans", "admin")).json.version;
      const rows = await policyRows();
      for (const [page, values] of [
        ["plans", { holdDays: 8, nocRules: [] }],
        ["plans", { signingLinkDays: 3 }],
        ["plans", { retentionYears: 1 }],
        ["signing", { holdDays: 8 }],
        ["signing", { signingLinkDays: 5, reminderDays: [1] }],
        ["plans", { __proto__: { x: 1 }, constructor: 1 }],
      ] as const) {
        const r = await call("PUT", `/api/settings/policy/${page}`, "admin", { baseVersion: v, values });
        expect(r.status, JSON.stringify(values)).toBe(422);
      }
      expect(await policyRows()).toBe(rows);
    });
    test("an invalid value is 422 invalid_policy; a missing baseVersion or values is 422; nothing is written", async () => {
      const v = (await call("GET", "/api/settings/policy/plans", "admin")).json.version;
      const rows = await policyRows();
      const bad = await call("PUT", "/api/settings/policy/plans", "admin", { baseVersion: v, values: { holdDays: 0 } });
      expect([bad.status, bad.json.code]).toEqual([422, "invalid_policy"]);
      expect((await call("PUT", "/api/settings/policy/plans", "admin", { values: { holdDays: 5 } })).status).toBe(422);
      expect((await call("PUT", "/api/settings/policy/plans", "admin", { baseVersion: v })).status).toBe(422);
      expect(await policyRows()).toBe(rows);
    });
    test("a stale baseVersion is 409 and writes nothing", async () => {
      const v = (await call("GET", "/api/settings/policy/plans", "admin")).json.version;
      const rows = await policyRows();
      const stale = await call("PUT", "/api/settings/policy/plans", "admin", {
        baseVersion: v - 1,
        values: { holdDays: 5 },
      });
      expect([stale.status, stale.json.code]).toEqual([409, "stale_policy"]);
      const ahead = await call("PUT", "/api/settings/policy/plans", "admin", {
        baseVersion: v + 5,
        values: { holdDays: 5 },
      });
      expect(ahead.status).toBe(409);
      expect(await policyRows()).toBe(rows);
    });
    test("two saves from the same base: one wins, the other is 409 and nothing is lost", async () => {
      const read = await call("GET", "/api/settings/policy/plans", "admin");
      const v = read.json.version;
      const [a, b] = await Promise.all([
        call("PUT", "/api/settings/policy/plans", "admin", { baseVersion: v, values: { holdDays: 11 } }),
        call("PUT", "/api/settings/policy/plans", "admin", { baseVersion: v, values: { offerValidityDays: 5 } }),
      ]);
      expect([a.status, b.status].toSorted()).toEqual([200, 409]);
    });
  });

  describe("fees and rulebook", () => {
    test("has a version, a start day and sources, no write route, and no AML key", async () => {
      const r = await call("GET", "/api/settings/rulebook", "admin");
      expect(r.json.rulesVersion).toBe("dubai-sales-2026-01");
      expect(r.json.effectiveFrom).toBe("2026-01-01");
      expect(r.json.sources.length).toBeGreaterThan(0);
      const keys = r.json.items.map((i: any) => i.key);
      expect(keys.toSorted()).toEqual([...RULEBOOK_SETTING_KEYS].toSorted());
      for (const k of RULEBOOK_AML_KEYS) expect(r.text).not.toContain(k);
      expect(r.text).not.toMatch(/aml|beneficial|screening|sanction/i);
      for (const m of ["PUT", "POST", "PATCH", "DELETE"] as const)
        for (const k of ["admin", "manager"])
          expect([404, 405], `${m} ${k}`).toContain((await call(m, "/api/settings/rulebook", k, {})).status);
    });
    test("a pending key says Pending and carries no value; a confirmed one carries its value", async () => {
      const r = await call("GET", "/api/settings/rulebook", "manager");
      const by = (k: string) => r.json.items.find((i: any) => i.key === k);
      expect(by("trusteeFeeFils")).toEqual(expect.objectContaining({ status: "pending" }));
      expect(Object.keys(by("trusteeFeeFils")).toSorted()).toEqual(["key", "kind", "label", "status"]);
      expect(Object.keys(by("registrationFeePayer")).toSorted()).toEqual(["key", "kind", "label", "status"]);
      expect(by("registrationFeeBps")).toEqual(expect.objectContaining({ status: "confirmed", bps: 400 }));
      expect(by("minBookingBps")).toEqual(expect.objectContaining({ status: "confirmed", bps: 1000 }));
    });
    test("the fee preview is refused (Pending) while the payer is pending, and uses the rulebook function in fils when confirmed", async () => {
      const pending = await call("GET", "/api/settings/rulebook", "admin");
      expect(pending.json.feePreview).toEqual({ priceFils: 100_000_000, status: "pending" });
      const confirmed = createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: new SpaDemoClock(database, false),
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW,
        rulebook: () => ({ ...dubaiSales2026_01, registrationFeePayer: "split", pending: [] }) as never,
      });
      const r = await confirmed.request("/api/settings/rulebook", {
        headers: { authorization: `Bearer ${issueToken(SECRET, users.admin!.id, NOW)}` },
      });
      const j: any = await r.json();
      expect(j.feePreview).toEqual({
        priceFils: 100_000_000,
        status: "ready",
        totalFils: 4_000_000,
        buyerFils: 2_000_000,
        sellerFils: 2_000_000,
      });
      expect(j.items.every((i: any) => i.status === "confirmed")).toBe(true);
    });
  });

  describe("users and roles", () => {
    test("the list has no password hash and marks you; every field is a fixed one", async () => {
      await database.db
        .update(spaUsers)
        .set({ passwordHash: "$argon2id$v=19$secret-hash" })
        .where(eq(spaUsers.id, users.officer!.id));
      const r = await call("GET", "/api/settings/users", "admin");
      expect(r.json.items).toHaveLength(8);
      expect(r.text).not.toMatch(/argon|password|secret-hash/i);
      for (const i of r.json.items)
        expect(Object.keys(i).toSorted()).toEqual(["active", "email", "id", "isYou", "name", "role"]);
      expect(r.json.items.filter((i: any) => i.isYou).map((i: any) => i.id)).toEqual([users.admin!.id]);
    });
    test("a role change and an active toggle are each one audit event; a no-op writes none", async () => {
      const roleEvs = (await events("USER_ROLE_CHANGED")).length;
      const activeEvs = (await events("USER_ACTIVE_SET")).length;
      const t = users.finance!.id;
      expect((await call("PUT", `/api/settings/users/${t}`, "admin", { role: "legal" })).status).toBe(200);
      expect((await events("USER_ROLE_CHANGED")).length).toBe(roleEvs + 1);
      const ev = (await events("USER_ROLE_CHANGED")).at(-1)!;
      expect(ev.payload).toEqual({ userId: t, from: "finance", to: "legal" });
      expect(ev.actor).toBe(`user:${users.admin!.id}`);
      expect((await call("PUT", `/api/settings/users/${t}`, "admin", { role: "legal" })).json.changed).toBe(false);
      expect((await events("USER_ROLE_CHANGED")).length).toBe(roleEvs + 1);
      expect((await call("PUT", `/api/settings/users/${t}`, "admin", { active: false })).status).toBe(200);
      expect((await events("USER_ACTIVE_SET")).length).toBe(activeEvs + 1);
      expect((await events("USER_ACTIVE_SET")).at(-1)!.payload).toEqual({ userId: t, active: false });
      // a deactivated user's session no longer works
      expect((await call("GET", "/api/me", "finance")).status).toBe(401);
      expect((await call("PUT", `/api/settings/users/${t}`, "admin", { active: true, role: "finance" })).status).toBe(
        200,
      );
      expect((await events("USER_ROLE_CHANGED")).length).toBe(roleEvs + 2);
      expect((await events("USER_ACTIVE_SET")).length).toBe(activeEvs + 2);
      expect(JSON.stringify(await events("USER_ROLE_CHANGED"))).not.toContain("@spa-demo.test");
    });
    test("you can't change yourself: role or active, nothing written", async () => {
      const before = (await database.db.select().from(dealEvents)).length;
      for (const body of [{ role: "legal" }, { active: false }, { role: "admin" }]) {
        const r = await call("PUT", `/api/settings/users/${users.admin!.id}`, "admin", body);
        expect([r.status, r.json.code]).toEqual([409, "self_change"]);
      }
      expect((await database.db.select().from(dealEvents)).length).toBe(before);
    });
    test("the last active admin can't be demoted or deactivated", async () => {
      const [other] = await database.db
        .insert(spaUsers)
        .values({
          id: crypto.randomUUID(),
          email: "second-admin@spa-demo.test",
          name: "second",
          role: "admin",
        })
        .returning();
      // the actor (an admin row) is deactivated underneath the request, as a concurrent change would do
      await database.db.update(spaUsers).set({ active: false }).where(eq(spaUsers.id, users.admin!.id));
      const ctx: SpaContext = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
      for (const change of [{ role: "legal" }, { active: false }])
        await expect(changeUser(ctx, users.admin!, other!.id, change)).rejects.toMatchObject({
          status: 409,
          code: "last_admin",
        });
      const [row] = await database.db.select().from(spaUsers).where(eq(spaUsers.id, other!.id));
      expect([row!.role, row!.active]).toEqual(["admin", true]);
      // with a second active admin the same change goes through
      await database.db.update(spaUsers).set({ active: true }).where(eq(spaUsers.id, users.admin!.id));
      await expect(changeUser(ctx, users.admin!, other!.id, { active: false })).resolves.toMatchObject({
        changed: true,
      });
    });
    test("bad bodies are 422 and an unknown user is 404; no create route and no password field", async () => {
      const t = users.legal!.id;
      for (const body of [
        {},
        { role: "boss" },
        { active: "yes" },
        { role: "legal", active: true, password: "x" },
        { password: "x" },
        { passwordHash: "x" },
      ])
        expect((await call("PUT", `/api/settings/users/${t}`, "admin", body)).status, JSON.stringify(body)).toBe(422);
      expect((await call("PUT", `/api/settings/users/${crypto.randomUUID()}`, "admin", { active: true })).status).toBe(
        404,
      );
      expect((await call("PUT", "/api/settings/users/not-a-uuid", "admin", { active: true })).status).toBe(404);
      expect([404, 405]).toContain((await call("POST", "/api/settings/users", "admin", { email: "a@b.test" })).status);
    });
  });

  describe("models and integrations", () => {
    test("models show tags from the engine env, with no URL, host or key", async () => {
      const r = await call("GET", "/api/settings/models", "manager");
      const by = (k: string) => r.json.items.find((i: any) => i.key === k);
      expect(by("vision")).toEqual(expect.objectContaining({ tag: "vision-tag:1b", status: "in_use" }));
      expect(by("decision")).toEqual(expect.objectContaining({ tag: null, status: "not_set_up" }));
      expect(r.text).not.toMatch(/https?:|:\/\/|localhost|127\.0|ollama|api[_ ]?key|secret|token/i);
    });
    test("a tag that is really an address is shown as in use without it", async () => {
      const odd = createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: new SpaDemoClock(database, false),
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW,
        models: { chat: "http://10.0.0.5:11434/m" },
      });
      const r = await odd.request("/api/settings/models", {
        headers: { authorization: `Bearer ${issueToken(SECRET, users.admin!.id, NOW)}` },
      });
      const text = await r.text();
      expect(text).not.toMatch(/10\.0\.0\.5|http/);
      expect(JSON.parse(text).items.find((i: any) => i.key === "chat").status).toBe("in_use");
    });
    test("integrations show a status only, from a fixed list, and no screening provider", async () => {
      const r = await call("GET", "/api/settings/integrations", "admin");
      expect(r.json.items.map((i: any) => [i.key, i.status])).toEqual([
        ["email", "simulated"],
        ["registry", "not_set_up"],
        ["documents", "not_set_up"],
        ["models", "connected"],
      ]);
      for (const i of r.json.items) expect(Object.keys(i).toSorted()).toEqual(["key", "label", "status"]);
      expect(r.text).not.toMatch(/https?:|:\/\/|localhost|host|smtp|ethereal|api[_ ]?key|secret|token|screen|aml/i);
    });
    test("without a status given, nothing claims to be connected", async () => {
      const bare = createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: new SpaDemoClock(database, false),
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW,
      });
      const r: any = await (
        await bare.request("/api/settings/integrations", {
          headers: { authorization: `Bearer ${issueToken(SECRET, users.admin!.id, NOW)}` },
        })
      ).json();
      expect(r.items.every((i: any) => i.status === "not_set_up")).toBe(true);
    });
  });

  describe("the demo clock", () => {
    test("outside demo mode the write is 404 for every role (admin included) and writes nothing", async () => {
      const evs = (await events("DEMO_CLOCK_SET")).length;
      const [before] = await database.db.select().from(spaDemoSettings);
      for (const k of KEYS) expect((await call("POST", "/api/demo/clock", k, { days: 3 })).status).toBe(404);
      expect((await events("DEMO_CLOCK_SET")).length).toBe(evs);
      expect((await database.db.select().from(spaDemoSettings))[0]?.clockOffsetMs).toBe(before?.clockOffsetMs);
    });
    test("an admin moves it forward by days, then rewinds; each is stored and audited", async () => {
      const already = (await events("DEMO_CLOCK_SET")).length;
      const r = await callDemo("POST", "/api/demo/clock", "admin", { days: 7 });
      expect(r.status).toBe(200);
      expect(r.json.offsetDays).toBe(7);
      expect((await callDemo("GET", "/api/demo/clock", "officer")).json.offsetDays).toBe(7);
      const [row] = await database.db.select().from(spaDemoSettings);
      expect(row!.clockOffsetMs).toBe(7 * 86_400_000);
      const rewind = await callDemo("POST", "/api/demo/clock", "admin", { rewind: true });
      expect(rewind.json.offsetDays).toBe(0);
      const evs = await events("DEMO_CLOCK_SET");
      expect(evs.slice(already).map((e) => e.payload)).toEqual([
        { days: 7, rewind: false, previousDays: 0 },
        { days: 0, rewind: true, previousDays: 7 },
      ]);
    });
    test("days must be a whole number from 1 to 365; a body with both or neither is refused", async () => {
      const before = (await events("DEMO_CLOCK_SET")).length;
      for (const body of [
        { days: 0 },
        { days: 366 },
        { days: 1.5 },
        { days: "3" },
        {},
        { days: 3, rewind: true },
        { rewind: false },
        { days: 3, extra: 1 },
      ])
        expect((await callDemo("POST", "/api/demo/clock", "admin", body)).status, JSON.stringify(body)).toBe(422);
      expect((await events("DEMO_CLOCK_SET")).length).toBe(before);
      expect((await callDemo("POST", "/api/demo/clock", "admin", { days: 365 })).status).toBe(200);
      expect((await callDemo("POST", "/api/demo/clock", "admin", { rewind: true })).status).toBe(200);
    });
  });

  test("the new settings code never reads the system clock", () => {
    const src = readFileSync(join(import.meta.dir, "../src/manager/settings-pages.ts"), "utf8");
    expect(src).not.toMatch(/Date\.now\s*\(|new Date\s*\(\s*\)/);
    expect(src).not.toMatch(/@leasing/);
  });
});
