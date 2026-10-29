import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { toolsFor } from "@leasing/copilot";
import { type Database, deadlines, inboundEvents, leaseEvents, payments, tasks, withTx } from "@leasing/db";
import { and, eq, like } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { checkDecision } from "../src/manager/gate-rules.ts";
import { createLink } from "../src/manager/links.ts";
import { importLeasesCsv } from "../src/manager/import.ts";
import { backfillTenancySchedules, isTenancyMilestone, sweepDueDeadlines } from "../src/manager/milestones.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";
let database: Database;

async function setup(tenancyOps: boolean) {
  const t = testContext(database, "2026-10-19T04:00:00Z", { tenancyOps });
  const [r] = await importLeasesCsv(
    t.ctx,
    leaseCsv([{ start_on: "2026-06-01", end_on: "2027-05-31", annual_rent_aed: "80000" }]),
    "import",
    await testCompany(database),
  );
  const user = await addStaff(database, "admin");
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const send = (path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { ...t, leaseId: r!.leaseId!, send, app };
}

describe.skipIf(noDb)("TENANCY_OPS (Postgres)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("off: import creates no payments or deadlines; the lease is still imported", async () => {
    const s = await setup(false);
    expect(s.leaseId).toBeTruthy();
    expect(await database.db.select().from(payments).where(eq(payments.leaseId, s.leaseId))).toHaveLength(0);
    expect(await database.db.select().from(deadlines).where(eq(deadlines.entityId, s.leaseId))).toHaveLength(0);
  });

  test("on: import creates payments and deadlines", async () => {
    const s = await setup(true);
    expect((await database.db.select().from(payments).where(eq(payments.leaseId, s.leaseId))).length).toBeGreaterThan(
      0,
    );
    expect(
      (await database.db.select().from(deadlines).where(eq(deadlines.entityId, s.leaseId))).length,
    ).toBeGreaterThan(0);
  });

  const dueNoticeSend = async (leaseId: string) => {
    const [d] = await database.db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.entityId, leaseId), like(deadlines.milestone, "notice_send@%")));
    await database.db
      .update(deadlines)
      .set({ dueOn: "2026-10-01" as never })
      .where(eq(deadlines.id, d!.id));
    return d!.id;
  };

  test("off: a tenancy deadline is held (stays pending), one officer task and one MILESTONE_HELD; on again it fires", async () => {
    const s = await setup(true);
    const id = await dueNoticeSend(s.leaseId);
    const off = { ...s.ctx, tenancyOps: false } as typeof s.ctx;
    for (let i = 0; i < 2; i++) {
      const res = await sweepDueDeadlines(off);
      expect(res.some((r) => r.fired)).toBe(false);
    }
    const [after] = await database.db.select().from(deadlines).where(eq(deadlines.id, id));
    expect(after!.status).toBe("pending");
    expect(after!.firedAt).toBeNull();
    const held = (await database.db.select().from(tasks).where(eq(tasks.entityId, s.leaseId))).filter(
      (t) => t.dedupeKey === `${s.leaseId}:tenancy_off:${after!.milestone}`,
    );
    expect(held).toHaveLength(1);
    expect(held[0]!.assigneeRole).toBe("leasing_officer");
    expect(held[0]!.title).toStartWith("Tenancy operations are off: ");
    expect(held[0]!.title).toContain("is due");
    expect(held[0]!.dedupeKey).toBe(`${s.leaseId}:tenancy_off:${after!.milestone}`);
    const events = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "MILESTONE_HELD"))).filter(
      (e) => (e.payload as { milestone: string }).milestone === after!.milestone,
    );
    expect(events).toHaveLength(1);
    expect((await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "MILESTONE_SKIPPED"))).length).toBe(
      0,
    );
    // Flag on again: the same deadline is fired by the sweep.
    const res = await sweepDueDeadlines(s.ctx);
    expect(res.some((r) => r.fired && r.milestone === after!.milestone)).toBe(true);
    const [fired] = await database.db.select().from(deadlines).where(eq(deadlines.id, id));
    expect(fired!.status).not.toBe("pending");
  });

  test("on at startup: the backfill schedules active leases that have no deadlines, once", async () => {
    const s = await setup(true);
    await database.db.delete(payments).where(eq(payments.leaseId, s.leaseId));
    await database.db.delete(deadlines).where(eq(deadlines.entityId, s.leaseId));
    const off = { ...s.ctx, tenancyOps: false } as typeof s.ctx;
    expect(await backfillTenancySchedules(off)).toBe(0);
    expect(await backfillTenancySchedules(s.ctx)).toBe(1);
    const count = async () => ({
      d: (await database.db.select().from(deadlines).where(eq(deadlines.entityId, s.leaseId))).length,
      p: (await database.db.select().from(payments).where(eq(payments.leaseId, s.leaseId))).length,
    });
    const first = await count();
    expect(first.d).toBeGreaterThan(0);
    expect(first.p).toBeGreaterThan(0);
    expect(await backfillTenancySchedules(s.ctx)).toBe(0);
    expect(await count()).toEqual(first);
  });

  test("off: a non-tenancy lease deadline is not skipped by the sweep", async () => {
    const s = await setup(false);
    const id = crypto.randomUUID();
    await database.db.insert(deadlines).values({
      id,
      entityKind: "lease",
      entityId: s.leaseId,
      milestone: "contract_review@2026-10-01",
      dueOn: "2026-10-01" as never,
      status: "pending",
      note: "pre-move-in deadline",
      rulesVersion: "dubai-2025-01",
    });
    expect(isTenancyMilestone("contract_review@2026-10-01")).toBe(false);
    for (const m of ["rent_reminder@x", "move_out_date@2027-01-01", "notice_send@2027-05-31", "rent_payby@x#1"])
      expect(isTenancyMilestone(m)).toBe(true);
    await sweepDueDeadlines(s.ctx).catch(() => {});
    const [after] = await database.db.select().from(deadlines).where(eq(deadlines.id, id));
    expect(after!.note).not.toContain("TENANCY_OPS");
  });

  test("off: moved staff-work routes still answer (not 404), tenancy-only ones do", async () => {
    const s = await setup(false);
    const nil = "00000000-0000-0000-0000-000000000000";
    const notFoundRoute = async (path: string, method: string, body?: unknown) => {
      const r = await s.send(path, method, body);
      // A route that exists answers with its own domain error (a JSON body with a code), never the router's plain 404.
      return r.status === 404 && !(await r.text()).includes("code");
    };
    expect(await notFoundRoute("/api/tasks", "POST", {})).toBe(false);
    expect(await notFoundRoute(`/api/tasks/${nil}/done`, "POST", {})).toBe(false);
    expect(await notFoundRoute(`/api/approvals/${nil}/notes`, "GET")).toBe(false);
    expect(await notFoundRoute(`/api/approvals/${nil}/notes`, "POST", {})).toBe(false);
    expect(await notFoundRoute(`/api/copilot/drafts/${nil}`, "GET")).toBe(false);
    expect(await notFoundRoute(`/api/leases/${nil}/email`, "POST", {})).toBe(false);
    expect(await notFoundRoute(`/api/tasks/${nil}/landlord-answer`, "POST", {})).toBe(true);
  });

  test("off: tenancy routes 404, the rent index stays", async () => {
    const s = await setup(false);
    expect((await s.send(`/api/leases/${s.leaseId}/payments`)).status).toBe(404);
    expect((await s.send(`/api/leases/${s.leaseId}/renew`, "POST")).status).toBe(404);
    expect((await s.send("/api/sri")).status).toBe(200);
  });

  test("on: tenancy routes exist", async () => {
    const s = await setup(true);
    expect((await s.send(`/api/leases/${s.leaseId}/payments`)).status).toBe(200);
  });

  test("off: tenancy inbound is stored as needs-human with an officer task, never processed", async () => {
    const s = await setup(false);
    const link = await withTx(database, (tx) =>
      createLink(s.ctx, tx, {
        purpose: "tenancy",
        entity: { kind: "lease", id: s.leaseId },
        partyId: null,
        ttlDays: 30,
      }),
    );
    const post = (payload: unknown) =>
      s.app.request("/api/inbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: link.token, type: "COMPLAINT_SUBMITTED", payload }),
      });
    const body = { description: "The kitchen tap is dripping.", atRisk: false, photoIds: [] };
    const r = await post(body);
    expect(r.status).toBe(202);
    const again = await post(body);
    expect(again.status).toBe(200);
    const [row] = await database.db.select().from(inboundEvents).where(eq(inboundEvents.entityId, s.leaseId));
    expect(row!.status).toBe("stored_only");
    expect(row!.result).toMatchObject({ needsHuman: true });
    const jobs = s.scheduler.jobs.filter((j) => j.name === "inbound.process");
    expect(jobs).toHaveLength(0);
    const ts = (await database.db.select().from(tasks).where(eq(tasks.entityId, s.leaseId))).filter(
      (t) => t.kind === "tenancy_ops_off_inbound",
    );
    expect(ts).toHaveLength(1);
    expect(ts[0]!.title).toBe("Tenant reply received while tenancy operations are off");
    // An unknown link is still refused.
    const bad = await s.app.request("/api/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "nope", type: "COMPLAINT_SUBMITTED", payload: body }),
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});

describe("gate edits (pure)", () => {
  test("a rent edit on refund or kyc_review is refused; a note-only edit is allowed on editable gates", () => {
    const today = "2026-11-01" as never;
    for (const gate of ["refund", "kyc_review"] as const) {
      const problems = checkDecision(
        gate,
        { note: "a" },
        { decision: "edit", proposal: { proposedRentFils: 1 } },
        today,
      );
      expect(problems.join(" ")).toContain("proposedRentFils can't be edited");
    }
    expect(
      checkDecision("price_out_of_range", {}, { decision: "edit", proposal: { proposedRentFils: 1 } }, today).length,
    ).toBeGreaterThan(0);
  });
});

describe("TENANCY_OPS copilot tools", () => {
  test("off drops the tenancy tools; on keeps them", () => {
    const gone = [
      "compute_renewal_cap",
      "list_payments",
      "list_tickets",
      "get_case_pack",
      "summarise_case",
      "propose_approval",
    ];
    const off = toolsFor("leasing_manager", { tenancyOps: false }).map((t) => t.name);
    const on = toolsFor("leasing_manager", { tenancyOps: true }).map((t) => t.name);
    for (const n of gone) {
      expect(off).not.toContain(n);
      expect(on).toContain(n);
    }
    expect(off).toContain("find_available_units");
  });
});
