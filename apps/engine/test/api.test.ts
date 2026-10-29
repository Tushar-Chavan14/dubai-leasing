import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { beforeAll, describe, expect, test } from "bun:test";
import { type Database, leaseEvents, withTx } from "@leasing/db";
import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { EngineDemoClock } from "../src/clock.ts";
import { bossScheduler } from "../src/jobs.ts";
import { sweepDueDeadlines } from "../src/manager/milestones.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, TEST_DB_URL, testCompany, testContext, unitCsv } from "./harness.ts";

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
    await testCompany(database);
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
    expect(
      (await call("leasing_officer", "/api/import/leases?company=test-co", { method: "POST", body: csv })).status,
    ).toBe(403);
    expect((await call("finance", "/api/import/leases?company=test-co", { method: "POST", body: csv })).status).toBe(
      403,
    );
    const ok = await call("admin", "/api/import/leases?company=test-co", { method: "POST", body: csv });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ imported: 1, errors: 0 });
  });

  test("units import: managers and admins only", async () => {
    const body = (code: string) => JSON.stringify({ csv: unitCsv([{ unit_code: code }]) });
    const post = (role: string, code: string) =>
      call(role, "/api/import/units?company=test-co", { method: "POST", body: body(code) });
    expect((await post("leasing_officer", "API-U1")).status).toBe(403);
    expect((await post("finance", "API-U1")).status).toBe(403);
    const admin = await post("admin", "API-U1");
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({ imported: 1, skipped: 0, errors: 0, rows: [{ ref: "API-U1" }] });
    const manager = await post("leasing_manager", "API-U2");
    expect(manager.status).toBe(200);
    expect(await manager.json()).toMatchObject({ imported: 1, rows: [{ state: "PREP" }] });
  });

  test("import: company is required (leases) or per row (units), and must exist", async () => {
    const body = JSON.stringify({ csv: unitCsv([{ unit_code: "API-C1" }]) });
    const none = await call("admin", "/api/import/units", { method: "POST", body });
    // Units: each row names its company (D44); with no `?company=` and no column the row is the error.
    expect(none.status).toBe(200);
    expect(await none.json()).toMatchObject({ imported: 0, errors: 1, rows: [{ status: "error" }] });
    expect((await call("admin", "/api/import/units?company=nope", { method: "POST", body })).status).toBe(404);
    expect((await call("admin", "/api/import/leases", { method: "POST", body })).status).toBe(400);
  });

  test("units import: category, subtype, kind alias, other company", async () => {
    await testCompany(database, { slug: "other-co", name: "Other" });
    const post = async (rows: Partial<Record<string, string>>[], company = "test-co") =>
      (await (
        await call("admin", `/api/import/units?company=${company}`, {
          method: "POST",
          body: JSON.stringify({ csv: unitCsv(rows) }),
        })
      ).json()) as { imported: number; rows: { reasons: string[]; unitId?: string }[] };
    const ok = await post([
      { unit_code: "API-R1", category: "retail", subtype: "shop" },
      { unit_code: "API-K1", kind: "commercial" },
    ]);
    expect(ok.imported).toBe(2);
    const bad = await post([
      { unit_code: "API-B1", category: "commercial", subtype: "villa" },
      { unit_code: "API-B2", category: "retail", kind: "commercial" },
      { unit_code: "API-B3", emirate: "abu_dhabi" },
    ]);
    expect(bad.rows[0]?.reasons.join()).toContain("subtype villa isn't a commercial type");
    expect(bad.rows[1]?.reasons.join()).toContain("differ");
    expect(bad.rows[2]?.reasons.join()).toContain("only Dubai units can be imported for now");
    const stored = await database.db.execute(
      sql`select u.code, u.category, u.subtype, c.slug from units u join companies c on c.id = u.company_id where u.code in ('API-R1','API-K1') order by u.code`,
    );
    expect(stored.rows).toMatchObject([
      { code: "API-K1", category: "commercial", subtype: null, slug: "test-co" },
      { code: "API-R1", category: "retail", subtype: "shop", slug: "test-co" },
    ]);
    const other = await post([{ unit_code: "API-R1" }], "other-co");
    expect(other.rows[0]?.reasons).toEqual(["unit belongs to another company"]);
    const lease = (await (
      await call("admin", "/api/import/leases?company=other-co", {
        method: "POST",
        body: JSON.stringify({
          csv: leaseCsv([{ unit_code: "API-R1", start_on: "2026-06-01", end_on: "2027-05-31" }]),
        }),
      })
    ).json()) as { errors: number; rows: { reasons: string[] }[] };
    expect(lease.errors).toBe(1);
    expect(lease.rows[0]?.reasons).toEqual(["unit belongs to another company"]);
  });

  test("lease list shows state and next deadline; PII masked in detail", async () => {
    const leases = (await (await call("leasing_officer", "/api/leases")).json()) as {
      id: string;
      state: string;
      nextDeadline: { milestone: string };
    }[];
    expect(leases[0]).toMatchObject({ state: "ACTIVE", nextDeadline: { milestone: "landlord_intent@2027-05-31" } });
    await call("admin", "/api/import/leases?company=test-co", {
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

  test("autopilot toggles: admin only, new policy version", async () => {
    const put = (role: string, body: unknown) =>
      call(role, "/api/policy/autopilot", { method: "PUT", body: JSON.stringify(body) });
    expect((await put("leasing_officer", { auto_kyc_verify: false })).status).toBe(403);
    expect((await put("leasing_manager", { auto_kyc_verify: false })).status).toBe(403);
    expect((await put("admin", { nope: true })).status).toBe(400);
    const r = await put("admin", { auto_kyc_verify: false });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { version: number }).version).toBe(1);
    const policy = (await (await call("leasing_officer", "/api/policy")).json()) as {
      autopilot: Record<string, boolean>;
    };
    expect(policy.autopilot).toMatchObject({ auto_kyc_verify: false, auto_prepare_contract: true });
    const r2 = await put("admin", { auto_prepare_contract: false });
    expect(((await r2.json()) as { version: number }).version).toBe(2);
    const p2 = (await (await call("admin", "/api/policy")).json()) as { autopilot: Record<string, boolean> };
    expect(p2.autopilot).toMatchObject({ auto_kyc_verify: false, auto_prepare_contract: false });
    // Audit: each change names the user, the toggle and the from/to values.
    const audit = (
      await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "AUTOPILOT_CHANGED"))
    ).toSorted((a, b) => (a.payload.policyVersion as number) - (b.payload.policyVersion as number));
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ entityKind: "company", actor: expect.stringMatching(/^user:/) });
    expect(audit[0]!.payload).toMatchObject({ changes: [{ step: "auto_kyc_verify", from: true, to: false }] });
    expect(audit[1]!.payload).toMatchObject({ changes: [{ step: "auto_prepare_contract", from: true, to: false }] });
  });

  test("autopilot: parallel saves serialize and a no-change save adds no version", async () => {
    const put = (body: unknown) =>
      call("admin", "/api/policy/autopilot", { method: "PUT", body: JSON.stringify(body) });
    const before = (await (await put({})).json()) as { version: number };
    const [a, b] = await Promise.all([put({ auto_send_offer: false }), put({ auto_send_counter: false })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const vs = [((await a.json()) as { version: number }).version, ((await b.json()) as { version: number }).version];
    expect(vs.toSorted()).toEqual([before.version + 1, before.version + 2]);
    const p = (await (await call("admin", "/api/policy")).json()) as { autopilot: Record<string, boolean> };
    expect(p.autopilot).toMatchObject({ auto_send_offer: false, auto_send_counter: false });
    const same = (await (await put({ auto_send_offer: false })).json()) as { version: number };
    expect(same.version).toBe(before.version + 2);
  });

  test("the 14 slice 4 agent switches: defaults, each saved in both states, numbers bounded, all audited", async () => {
    const put = (body: unknown) =>
      call("admin", "/api/policy/autopilot", { method: "PUT", body: JSON.stringify(body) });
    const read = async () =>
      ((await (await call("leasing_officer", "/api/policy")).json()) as { autopilot: Record<string, boolean | number> })
        .autopilot;
    // Defaults on a company that never saved a policy: today's behaviour or the safer option.
    expect(await read()).toMatchObject({
      agent_free_text_book: true,
      agent_free_text_apply: true,
      viewing_reminder: true,
      no_show_followup: false,
      kyc_chase: true,
      kyc_chase_hours: 48,
      ejari_draft_auto: true,
      sign_reminder: true,
      sign_reminder_days: 3,
      held_offer_auto_release: false,
      held_offer_release_hours: 24,
      agent_sri_answers: true,
      agent_suggest_alternatives: true,
      contract_ai_auto_approve_valueless: false,
      copilot_proactive_drafts: false,
      quiet_hours: true,
      quiet_hours_start: 22,
      quiet_hours_end: 8,
      agent_daily_action_cap: 5,
    });
    const slice4 = [
      "agent_free_text_book",
      "agent_free_text_apply",
      "viewing_reminder",
      "no_show_followup",
      "kyc_chase",
      "ejari_draft_auto",
      "sign_reminder",
      "held_offer_auto_release",
      "agent_sri_answers",
      "agent_suggest_alternatives",
      "contract_ai_auto_approve_valueless",
      "copilot_proactive_drafts",
      "quiet_hours",
    ];
    for (const k of slice4) {
      const was = (await read())[k] as boolean;
      expect((await put({ [k]: !was })).status).toBe(200);
      expect((await read())[k]).toBe(!was);
      expect((await put({ [k]: was })).status).toBe(200);
      expect((await read())[k]).toBe(was);
    }
    // Numbers: bounded, whole, never clamped.
    expect((await put({ agent_daily_action_cap: 12, kyc_chase_hours: 72 })).status).toBe(200);
    expect(await read()).toMatchObject({ agent_daily_action_cap: 12, kyc_chase_hours: 72 });
    for (const bad of [
      { agent_daily_action_cap: 0 },
      { agent_daily_action_cap: 51 },
      { kyc_chase_hours: 5 },
      { sign_reminder_days: 15 },
      { held_offer_release_hours: 0 },
      { quiet_hours_start: 24 },
      { quiet_hours_end: -1 },
      { viewing_reminder_hours: 2.5 },
    ]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect(await read()).toMatchObject({ agent_daily_action_cap: 12, kyc_chase_hours: 72 });
    // Quiet hours: the same start and end is refused with a clear 400, in one save or across two.
    const same = await put({ quiet_hours_start: 9, quiet_hours_end: 9 });
    expect(same.status).toBe(400);
    expect(JSON.stringify(await same.json())).toContain("Quiet hours must start and end at different hours");
    expect((await put({ quiet_hours_start: 8 })).status).toBe(400); // end is 8
    expect((await put({ quiet_hours_start: 21, quiet_hours_end: 7 })).status).toBe(200);
    // Every change is in the audit trail with from and to.
    const audit = await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "AUTOPILOT_CHANGED"));
    const changes = audit.flatMap(
      (e) => (e.payload as { changes: { step: string; from: unknown; to: unknown }[] }).changes,
    );
    expect(changes).toContainEqual({ step: "agent_daily_action_cap", from: 5, to: 12 });
    expect(changes.filter((c) => c.step === "quiet_hours")).toHaveLength(2);
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
