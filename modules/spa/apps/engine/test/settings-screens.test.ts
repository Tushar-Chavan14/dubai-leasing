/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, issueToken } from "@platform/kernel";
import { DEFAULT_SPA_AML_POLICY, starterKycConfig } from "@spa/core";
import { spaAmlPolicy, spaKycConfigs, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { count, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

void FixedClock;
const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-21T06:00:00Z");
const url = spaTestDatabaseUrl();
const ROLES = ["officer", "manager", "salesadmin", "legal", "finance", "compliance", "mlro", "admin"] as const;
const KYC_READ = new Set(["admin", "manager"]);

describe.skipIf(!url)("C34: KYC form and compliance rules routes, per role (S66)", () => {
  let database: SpaDatabase;
  let app: ReturnType<typeof createApp>;
  let users: Record<string, U>;
  const call = async (method: string, path: string, as?: string | null, body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    return { status: r.status, text, json: (text ? JSON.parse(text) : null) as any };
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  describe("KYC forms", () => {
    const form = (label = "Full name as on the passport") => {
      const c = starterKycConfig("buyer_person");
      return { ...c, form: c.form.map((f) => (f.key === "full_name" ? { ...f, label } : f)) };
    };
    for (const role of ROLES) {
      test(`${role}: read, save a draft, publish`, async () => {
        const read = await call("GET", "/api/settings/kyc?role=buyer_person", role);
        const index = await call("GET", "/api/settings/kyc", role);
        expect([read.status, index.status]).toEqual(KYC_READ.has(role) ? [200, 200] : [403, 403]);
        const save = await call("PUT", "/api/settings/kyc", role, {
          role: "seller_person",
          config: starterKycConfig("seller_person"),
        });
        expect(save.status).toBe(role === "admin" ? 200 : 403);
        const publish = await call("POST", "/api/settings/kyc/publish", role, { role: "beneficial_owner" });
        // a non-admin is refused before the draft is looked at; the admin has no draft there: 409
        expect(publish.status).toBe(role === "admin" ? 409 : 403);
      });
    }
    test("401 on every route", async () => {
      expect((await call("GET", "/api/settings/kyc", null)).status).toBe(401);
      expect((await call("PUT", "/api/settings/kyc", null, {})).status).toBe(401);
      expect((await call("POST", "/api/settings/kyc/publish", null, {})).status).toBe(401);
    });
    test("the index lists every role and deal-type override with the version in force", async () => {
      const r = await call("GET", "/api/settings/kyc", "admin");
      expect(r.json.items).toHaveLength(16);
      expect(r.json.items.find((i: any) => i.role === "seller_person" && i.scope === "any").hasDraft).toBe(true);
      expect(r.json.items.find((i: any) => i.role === "buyer_person" && i.scope === "any").version).toBeNull();
    });
    test("a bad query, role or body is refused without a draft being written", async () => {
      expect((await call("GET", "/api/settings/kyc?role=judge", "admin")).status).toBe(422);
      expect((await call("PUT", "/api/settings/kyc", "admin", { role: "judge", config: {} })).status).toBe(422);
      expect(
        (await call("PUT", "/api/settings/kyc", "admin", { role: "buyer_person", config: { form: [] } })).status,
      ).toBe(422);
      expect(
        (await call("POST", "/api/settings/kyc/publish", "admin", { role: "buyer_person", dealType: "x" })).status,
      ).toBe(422);
    });
    test("a rule that screens on a protected trait is refused by the existing validation", async () => {
      const c = starterKycConfig("buyer_person");
      const bad = {
        ...c,
        rules: {
          ...c.rules,
          company: [
            {
              type: "ai_check",
              label: "Check nationality",
              severity: "warning",
              emailApplicant: false,
              instruction: "Warn when the nationality is not local",
            },
          ],
        },
      };
      const r = await call("PUT", "/api/settings/kyc", "admin", { role: "buyer_person", config: bad });
      expect(r.status).toBe(422);
      expect(r.json.code).toBe("invalid_kyc_config");
    });
    test("save, publish, then a new draft: the published version never changes and stays in force", async () => {
      expect(
        (
          await call("PUT", "/api/settings/kyc", "admin", {
            role: "buyer_person",
            config: form("Full name, first version"),
          })
        ).status,
      ).toBe(200);
      const pub = await call("POST", "/api/settings/kyc/publish", "admin", { role: "buyer_person" });
      expect(pub.json).toEqual({ version: 1 });
      expect((await call("POST", "/api/settings/kyc/publish", "admin", { role: "buyer_person" })).status).toBe(409);
      const before = (await database.db.select().from(spaKycConfigs).where(eq(spaKycConfigs.version, 1)))[0]!;
      expect(
        (
          await call("PUT", "/api/settings/kyc", "admin", {
            role: "buyer_person",
            config: form("Full name, second draft"),
          })
        ).status,
      ).toBe(200);
      const read = await call("GET", "/api/settings/kyc?role=buyer_person", "manager");
      expect(read.json.effective.version).toBe(1);
      expect(read.json.effective.config.form.find((f: any) => f.key === "full_name").label).toBe(
        "Full name, first version",
      );
      expect(read.json.draft.form.find((f: any) => f.key === "full_name").label).toBe("Full name, second draft");
      expect(read.json.versions).toHaveLength(1);
      const after = (await database.db.select().from(spaKycConfigs).where(eq(spaKycConfigs.id, before.id)))[0]!;
      expect(after.values).toEqual(before.values);
      expect(after.status).toBe("published");
      // and the database itself refuses an edit of a published row
      await expect(
        database.pool.query("update spa_kyc_configs set values = '{}'::jsonb where id = $1", [before.id]),
      ).rejects.toThrow();
      // the second draft publishes as version 2
      expect((await call("POST", "/api/settings/kyc/publish", "admin", { role: "buyer_person" })).json).toEqual({
        version: 2,
      });
    });
    test("a deal-type override is its own form; other deal types keep the role's", async () => {
      await call("PUT", "/api/settings/kyc", "admin", {
        role: "buyer_person",
        dealType: "resale_ready",
        config: form("Override name"),
      });
      await call("POST", "/api/settings/kyc/publish", "admin", { role: "buyer_person", dealType: "resale_ready" });
      const over = await call("GET", "/api/settings/kyc?role=buyer_person&dealType=resale_ready", "admin");
      expect(over.json.scope).toBe("resale_ready");
      expect(over.json.effective.scope).toBe("resale_ready");
      const other = await call("GET", "/api/settings/kyc?role=buyer_person&dealType=primary_offplan", "admin");
      expect(other.json.effective.scope).toBe("any");
      expect(other.json.draft).toBeNull();
    });
  });

  describe("compliance rules (the AML policy page)", () => {
    const policy = (high = ["XX"]) => ({ ...DEFAULT_SPA_AML_POLICY, highRiskCountries: high });
    for (const role of ROLES) {
      test(`${role}: read and publish`, async () => {
        const read = await call("GET", "/api/compliance/policy", role);
        expect(read.status).toBe(role === "compliance" || role === "mlro" ? 200 : 403);
        const before = (await database.db.select({ n: count() }).from(spaAmlPolicy))[0]!.n;
        const put = await call("PUT", "/api/compliance/policy", role, policy(["YY"]));
        expect(put.status).toBe(role === "compliance" ? 200 : 403);
        const after = (await database.db.select({ n: count() }).from(spaAmlPolicy))[0]!.n;
        expect(after - before).toBe(role === "compliance" ? 1 : 0);
      });
    }
    test("a refusal reads the same whatever the request was (no hint of what exists)", async () => {
      const a = await call("GET", "/api/compliance/policy", "admin");
      const b = await call("PUT", "/api/compliance/policy", "officer", { nonsense: true });
      expect(a.json.code).toBe("forbidden");
      expect(b.json.code).toBe("forbidden");
      expect(a.text).not.toMatch(/aml|screen|sanction|risk/i);
    });
    test("401, and an invalid policy is 422 with nothing written", async () => {
      expect((await call("GET", "/api/compliance/policy", null)).status).toBe(401);
      expect((await call("PUT", "/api/compliance/policy", null, policy())).status).toBe(401);
      const before = (await database.db.select({ n: count() }).from(spaAmlPolicy))[0]!.n;
      expect((await call("PUT", "/api/compliance/policy", "compliance", { nope: 1 })).status).toBe(422);
      const off = {
        ...policy(),
        rules: { ...policy().rules, sanctions: { on: false, severity: "flag", points: 100 } },
      };
      expect((await call("PUT", "/api/compliance/policy", "compliance", off)).status).toBe(422);
      expect((await database.db.select({ n: count() }).from(spaAmlPolicy))[0]!.n).toBe(before);
    });
    test("the page's data: version, values, history, mayPublish, and the placeholder flag until compliance publishes", async () => {
      const fresh = await freshSpaDatabase(url!);
      try {
        const own = createApp({
          database: fresh,
          jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
          clock: new SpaDemoClock(fresh, false),
          sessionSecret: SECRET,
          demoMode: false,
          nowMs: () => NOW,
        });
        const u = await seedUsers(fresh);
        const get = async (as: string) =>
          (
            await own.request("/api/compliance/policy", {
              headers: { authorization: `Bearer ${issueToken(SECRET, u[as]!.id, NOW)}` },
            })
          ).json() as Promise<any>;
        const v0 = await get("mlro");
        expect(v0.version).toBe(0);
        expect(v0.confirmWithCompliance).toBe(true);
        expect(v0.mayPublish).toBe(false);
        await own.request("/api/compliance/policy", {
          method: "PUT",
          headers: {
            authorization: `Bearer ${issueToken(SECRET, u.compliance!.id, NOW)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(policy()),
        });
        const v1 = await get("compliance");
        expect(v1.version).toBe(1);
        expect(v1.confirmWithCompliance).toBe(false);
        expect(v1.mayPublish).toBe(true);
        expect(v1.history).toHaveLength(1);
        expect(v1.values.highRiskCountries).toEqual(["XX"]);
      } finally {
        await fresh.close();
      }
    });
  });
});
