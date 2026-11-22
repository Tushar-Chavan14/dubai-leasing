/* oxlint-disable no-explicit-any -- rows read loosely in tests */
import { beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { deals, type SpaDatabase, spaApprovals } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { dealInDraft } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const KEY = "k".repeat(32);

describe.skipIf(!url)("GET /summary for the launcher (C37, S69)", () => {
  let database: SpaDatabase;
  const clock = new FixedClock(new Date("2026-11-10T00:00:00Z"));
  const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts });
  const app = (key?: string) =>
    createApp({
      database,
      jobs: { boss: {} as never, lastHeartbeat: () => null },
      clock: { today: () => clock.today(), now: () => clock.now(), refresh: async () => {}, offsetDays: 0 } as never,
      sessionSecret: "s".repeat(32),
      demoMode: false,
      nowMs: () => clock.now().getTime(),
      ...(key ? { portalSummaryKey: key } : {}),
    });
  const get = (a: ReturnType<typeof app>, headers: Record<string, string> = {}) => a.request("/summary", { headers });
  const gate = async (dealId: string, g: string, status = "pending") => {
    const id = newId();
    await database.db.insert(spaApprovals).values({
      id,
      gate: g as any,
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:${g}:${id}`,
      title: "A buyer called Fatima Example",
      proposal: {},
      approverRole: "sales_manager" as any,
      status: status as any,
      proposedBy: "system",
      createdAt: clock.now(),
    });
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    const a = await dealInDraft(ctx(), database, { type: "resale_ready" });
    const b = await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "U-202" } as any);
    await database.db
      .update(deals)
      .set({ state: "CANCELLED" as never })
      .where(eq(deals.id, b.dealId));
    await gate(a.dealId, "kyc_review");
    await gate(a.dealId, "agreement_approval");
    await gate(a.dealId, "kyc_review", "approved");
    await gate(a.dealId, "aml_flag");
    await gate(a.dealId, "aml_report");
    await gate(a.dealId, "edd_signoff");
  });

  test("without a configured key the route is 404, with or without a header", async () => {
    expect((await get(app())).status).toBe(404);
    expect((await get(app(), { "x-portal-key": KEY })).status).toBe(404);
  });
  test("a missing or wrong key is the same 404 as no key", async () => {
    const a = app(KEY);
    const none = await get(a);
    const wrong = await get(a, { "x-portal-key": "w".repeat(32) });
    expect(none.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).toBe(await none.text());
    expect((await get(a, { authorization: `Bearer ${KEY}` })).status).toBe(404);
  });
  test("with the key it returns two integers and nothing else", async () => {
    const r = await get(app(KEY), { "x-portal-key": KEY });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(["openWork", "waitingApprovals"]);
    for (const v of Object.values(body)) expect(Number.isInteger(v)).toBe(true);
  });
  test("open work is the open deals; waiting approvals leave out compliance gates and decided ones", async () => {
    const body = (await (await get(app(KEY), { "x-portal-key": KEY })).json()) as any;
    expect(body).toEqual({ openWork: 1, waitingApprovals: 2 });
  });
  test("no personal field: the answer holds no text", async () => {
    const text = await (await get(app(KEY), { "x-portal-key": KEY })).text();
    expect(text).toMatch(/^\{"openWork":\d+,"waitingApprovals":\d+\}$/);
    expect(text).not.toMatch(/fatima|aml|passport|@/i);
  });
});
