import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { newId } from "@leasing/core";
import { approvals, type Database, tasks } from "@leasing/db";
import { beforeAll, describe, expect, test } from "bun:test";
import { createApi } from "../src/api/app.ts";
import { freshDatabase, noDb, testContext } from "./harness.ts";

const KEY = "k".repeat(32);

describe.skipIf(noDb)("GET /summary for the launcher (C37, S69)", () => {
  let database: Database;
  let make: (key?: string) => ReturnType<typeof createApi>;
  const get = (a: ReturnType<typeof createApi>, headers: Record<string, string> = {}) =>
    a.request("/summary", { headers });
  const approval = (status: string, n: number) => ({
    id: newId(),
    gate: "final_contract" as const,
    entityKind: "lease" as const,
    entityId: newId(),
    dedupeKey: `d-${n}-${status}`,
    title: "Tenant Sara Example, passport X1234567",
    proposal: {},
    approverRole: "leasing_manager" as const,
    status: status as "pending",
    proposedBy: "system",
    createdAt: new Date("2026-11-02T04:00:00Z"),
  });
  const task = (status: string, n: number) => ({
    id: newId(),
    entityKind: "lease" as const,
    entityId: newId(),
    kind: "call_tenant",
    title: "Call the tenant on 0501234567",
    assigneeRole: "leasing_officer" as const,
    status: status as "open",
    dedupeKey: `t-${n}-${status}`,
    createdBy: "system",
    createdAt: new Date("2026-11-02T04:00:00Z"),
  });

  beforeAll(async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-11-02T04:00:00Z");
    make = (key) =>
      createApi(t.ctx, {
        sessionSecret: "s".repeat(32),
        mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
        ...(key ? { portalSummaryKey: key } : {}),
      });
    await database.db
      .insert(approvals)
      .values([approval("pending", 1), approval("pending", 2), approval("pending", 3), approval("approved", 4)]);
    await database.db.insert(tasks).values([task("open", 1), task("open", 2), task("done", 3), task("cancelled", 4)]);
  });

  test("without a configured key the route is 404, with or without a header", async () => {
    expect((await get(make())).status).toBe(404);
    expect((await get(make(), { "x-portal-key": KEY })).status).toBe(404);
  });
  test("a missing or wrong key is the same 404 as no key", async () => {
    const a = make(KEY);
    const none = await get(a);
    const wrong = await get(a, { "x-portal-key": "w".repeat(32) });
    expect(none.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).toBe(await none.text());
    expect((await get(a, { authorization: `Bearer ${KEY}` })).status).toBe(404);
  });
  test("with the key it returns two integers and nothing else", async () => {
    const r = await get(make(KEY), { "x-portal-key": KEY });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(["openWork", "waitingApprovals"]);
    for (const v of Object.values(body)) expect(Number.isInteger(v)).toBe(true);
    expect(body).toEqual({ openWork: 2, waitingApprovals: 3 });
  });
  test("no personal field: the answer holds no text", async () => {
    const text = await (await get(make(KEY), { "x-portal-key": KEY })).text();
    expect(text).toMatch(/^\{"openWork":\d+,"waitingApprovals":\d+\}$/);
    expect(text).not.toMatch(/sara|passport|050|@/i);
  });
});
