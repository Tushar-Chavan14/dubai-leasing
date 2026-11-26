/* oxlint-disable no-explicit-any -- response bodies read loosely in tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, issueToken } from "@platform/kernel";
import { deals, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { chaseDeal } from "../src/manager/chase.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { requestDocuments } from "../src/manager/kyc.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

describe.skipIf(!url)("chase routes and the deal record's Chasing section (C25, S60)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  let dealId: string;
  const mailer = new FakeMailer();
  const ctx = (): SpaContext => ({
    database,
    clock: new FixedClock(new Date(NOW)),
    facts: failClosedFacts,
    mail: { mailer, webBaseUrl: "https://spa.example.test" },
  });
  const call = (path: string, as?: keyof typeof users, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
      },
    });
  const post = async (path: string, as: keyof typeof users | undefined, body: unknown = {}) => {
    const r = await call(path, as, { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, text: await r.clone().text(), body: (await r.json()) as any };
  };
  const get = async (path: string, as: keyof typeof users) => {
    const r = await call(path, as);
    return { status: r.status, text: await r.clone().text(), body: (await r.json()) as any };
  };
  const TEMPLATE = {
    subject: "Documents needed · {property}",
    body: "Dear {party_name},\nWe still need:\n{items}\n{agent_name}",
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
    const made = await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "U-101" });
    dealId = made.dealId;
    await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, dealId));
    await requestDocuments(ctx(), dealId, users.officer!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("every chase route needs a session", async () => {
    expect((await post("/api/chase-templates", undefined, TEMPLATE)).status).toBe(401);
    expect((await post(`/api/chase-templates/${crypto.randomUUID()}/approve`, undefined)).status).toBe(401);
    expect((await post(`/api/deals/${dealId}/chase/pause`, undefined)).status).toBe(401);
    expect((await post(`/api/deals/${dealId}/chase/resume`, undefined)).status).toBe(401);
  });

  test("an admin saves and approves a chase email; others get 403; a bad text is 422; the body can't set who or when", async () => {
    expect((await post("/api/chase-templates", "officer", TEMPLATE)).status).toBe(403);
    expect((await post("/api/chase-templates", "manager", TEMPLATE)).status).toBe(403);
    const bad = await post("/api/chase-templates", "admin", { ...TEMPLATE, body: "{items} for AML" });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("invalid_chase_template");
    const unknown = await post("/api/chase-templates", "admin", { ...TEMPLATE, body: "{items} {secret}" });
    expect(unknown.status).toBe(422);
    const made = await post("/api/chase-templates", "admin", { ...TEMPLATE, createdBy: "user:x", status: "approved" });
    expect(made.status).toBe(422); // a field other than subject and body is refused
    const ok = await post("/api/chase-templates", "admin", TEMPLATE);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ version: 1, status: "draft" });
    expect((await post(`/api/chase-templates/${ok.body.id}/approve`, "officer")).status).toBe(403);
    const approved = await post(`/api/chase-templates/${ok.body.id}/approve`, "admin");
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ version: 1, status: "approved" });
    expect((await post(`/api/chase-templates/${ok.body.id}/approve`, "admin")).status).toBe(409);
    expect((await post(`/api/chase-templates/not-an-id/approve`, "admin")).status).toBe(404);
  });

  test("the record has a Chasing section: what is owed, the schedule, and no pause yet", async () => {
    const r = await get(`/api/deals/${dealId}`, "officer");
    expect(r.status).toBe(200);
    const s = r.body.sections.chasing;
    expect(s.paused).toBe(false);
    expect(s.template).toEqual({ version: 1 });
    expect(s.schedule).toEqual({ reminderDays: [2, 5], taskAfterDays: 7 });
    expect(s.open.map((o: any) => [o.item, o.reason, o.chased])).toEqual([
      ["Passport data page", "document not received yet", 0],
      ["Passport data page", "document not received yet", 0],
    ]);
    expect(r.text).not.toMatch(/\baml\b|launder|sanction|screening/i);
  });

  test("after a chase the section lists it with the template version and the fixed reason", async () => {
    await chaseDeal(ctx(), dealId);
    const r = await get(`/api/deals/${dealId}`, "manager");
    const s = r.body.sections.chasing;
    expect(s.history).toHaveLength(2);
    expect(s.history[0]).toMatchObject({ reason: "document not received yet", step: 0, templateVersion: 1 });
    expect(s.open.every((o: any) => o.chased === 1)).toBe(true);
    expect(JSON.stringify(s)).not.toContain("@example.test");
  });

  test("the agent pauses and resumes; legal and the compliance roles can't; the section says paused", async () => {
    expect((await post(`/api/deals/${dealId}/chase/pause`, "legal")).status).toBe(403);
    expect((await post(`/api/deals/${dealId}/chase/pause`, "compliance")).status).toBe(403);
    expect((await post(`/api/deals/${dealId}/chase/pause`, "officer", { paused: false })).status).toBe(200);
    const again = await post(`/api/deals/${dealId}/chase/pause`, "officer");
    expect(again.body).toEqual({ paused: true, changed: false });
    const rec = await get(`/api/deals/${dealId}`, "officer");
    expect(rec.body.sections.chasing.paused).toBe(true);
    expect(rec.body.sections.chasing.pausedSince).toBeTruthy();
    const resumed = await post(`/api/deals/${dealId}/chase/resume`, "manager");
    expect(resumed.body).toEqual({ paused: false, changed: true });
    expect((await get(`/api/deals/${dealId}`, "officer")).body.sections.chasing.paused).toBe(false);
    expect((await post(`/api/deals/${crypto.randomUUID()}/chase/pause`, "officer")).status).toBe(404);
    expect((await post(`/api/deals/nope/chase/pause`, "officer")).status).toBe(404);
  });

  test("a cancelled deal has no Chasing section and can't be paused", async () => {
    const made = await dealInDraft(ctx(), database, { type: "resale_ready" });
    await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, made.dealId));
    expect((await get(`/api/deals/${made.dealId}`, "officer")).body.sections).not.toHaveProperty("chasing");
    expect((await post(`/api/deals/${made.dealId}/chase/pause`, "officer")).status).toBe(409);
  });

  test("the timeline shows the chase and pause events to staff, with no names or documents in them", async () => {
    const r = await get(`/api/deals/${dealId}/events`, "officer");
    const types = r.body.items.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["CHASE_SENT", "CHASE_PAUSED", "CHASE_RESUMED"]));
    const sent = r.body.items.find((e: any) => e.type === "CHASE_SENT");
    expect(JSON.stringify(sent.payload)).not.toMatch(/Passport|Buyer One|example\.test/);
  });
});
