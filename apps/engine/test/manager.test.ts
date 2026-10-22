import { beforeEach, describe, expect, test } from "bun:test";
import { calendarDate as d, newId } from "@leasing/core";
import {
  approvals,
  type Database,
  deadlines,
  leaseEvents,
  leases,
  parties,
  payments,
  tasks,
  units,
  withTx,
} from "@leasing/db";
import { getRulebook, rulebookValues } from "@leasing/rulebook";
import { and, eq, like } from "drizzle-orm";
import { advance } from "../src/manager/advance.ts";
import { decideApproval, requestApproval } from "../src/manager/approvals.ts";
import { importLeasesCsv, importUnitsCsv } from "../src/manager/import.ts";
import { fireDeadline, sweepDueDeadlines } from "../src/manager/milestones.ts";
import { sendRenewalNotice } from "../src/manager/outbound.ts";
import { createDraft, publishRulebook, updateDraft } from "../src/manager/rulebooks.ts";
import { addStaff, completeMoveInChecklist, freshDatabase, leaseCsv, noDb, testContext, unitCsv } from "./harness.ts";

// 08:00 Dubai on 2026-10-19.
const START = "2026-10-19T04:00:00Z";
let database: Database;
type Ctx = ReturnType<typeof testContext>["ctx"];

/** One imported lease. One cheque by default (already due, so assumed paid): these tests are about renewal. */
async function importOne(ctx: Ctx, row: Partial<Record<string, string>>) {
  const [r] = await importLeasesCsv(ctx, leaseCsv([{ cheques: "1", ...row }]), "import");
  if (!r?.leaseId) throw new Error(`import failed: ${JSON.stringify(r)}`);
  return r.leaseId;
}

const lease = async (id: string) => (await database.db.select().from(leases).where(eq(leases.id, id)))[0]!;
const events = (id: string) => database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, id));
const deadlineFor = async (leaseId: string, prefix: string) =>
  (
    await database.db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.entityId, leaseId), like(deadlines.milestone, `${prefix}@%`)))
  )[0]!;
/** Lease-lifecycle tasks (finance's import check of assumed-paid cheques is tested in tenancy.test.ts). */
const taskKinds = async (leaseId: string) =>
  (await database.db.select().from(tasks).where(eq(tasks.entityId, leaseId)))
    .map((t) => t.kind)
    .filter((k) => k !== "payment_import_check")
    .toSorted();
const fired = async (leaseId: string) =>
  (await events(leaseId))
    .filter((e) => e.type === "MILESTONE_FIRED")
    .map((e) => (e.payload as { milestone: string }).milestone);

/** Imports a lease ending 2027-05-31 and moves the clock to T−4 months so its notice is in the inbox. */
async function leaseWithPendingNotice() {
  const t = testContext(database, START);
  const id = await importOne(t.ctx, { start_on: "2026-06-01", end_on: "2027-05-31", annual_rent_aed: "80000" });
  t.clock.advanceDays(104); // 2027-01-31
  await sweepDueDeadlines(t.ctx);
  const [a] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
  return { ...t, leaseId: id, approval: a! };
}

function vacateProposal(leaseId: string, over: Record<string, unknown> = {}) {
  return {
    leaseId,
    rulesVersion: "dubai-2025-01",
    leaseEndOn: "2027-05-31",
    ground: "own_use",
    servedOn: "2026-05-15", // before T−12m = 2026-05-31
    deliveryMethod: "registered_mail",
    propertyKind: "residential",
    ...over,
  };
}

function requestVacate(ctx: Ctx, leaseId: string, proposal: Record<string, unknown>, onApprove?: "TERMINATED") {
  return withTx(database, (tx) =>
    requestApproval(ctx, tx, {
      gate: "vacate_notice",
      entity: { kind: "lease", id: leaseId },
      dedupeKey: `${leaseId}:vacate:${newId()}`,
      title: "Repossession notice",
      proposal,
      reasons: [],
      sources: [],
      proposedBy: "system",
      ...(onApprove ? { onApproveEvent: onApprove } : {}),
    }),
  );
}

describe.skipIf(noDb)("manager (Postgres)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  describe("units CSV import", () => {
    test("creates units in PREP with UNIT_CREATED events by the importing user", async () => {
      const { ctx } = testContext(database, START);
      const rows = await importUnitsCsv(
        ctx,
        unitCsv([
          { unit_code: "IMP-1", makani_no: "1234512345", asking_rent_aed: '"AED 85,000"' },
          { unit_code: "imp-2", kind: "commercial", virtual_tour_url: "https://tour.test.example/imp-2" },
        ]),
        "user:00000000-0000-7000-8000-000000000001",
      );
      expect(rows.map((r) => [r.row, r.status, r.ref, r.state])).toEqual([
        [2, "imported", "IMP-1", "PREP"],
        [3, "imported", "IMP-2", "PREP"],
      ]);
      const all = await database.db.select().from(units);
      expect(all.map((u) => [u.code, u.state, u.kind]).toSorted()).toEqual([
        ["IMP-1", "PREP", "residential"],
        ["IMP-2", "PREP", "commercial"],
      ]);
      expect(all.find((u) => u.code === "IMP-1")?.askingRentFils).toBe(8_500_000);
      const ev = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, rows[0]!.unitId!));
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        type: "UNIT_CREATED",
        toState: "PREP",
        actor: "user:00000000-0000-7000-8000-000000000001",
        payload: { code: "IMP-1", source: "import" },
      });
    });

    test("re-import skips existing codes", async () => {
      const { ctx } = testContext(database, START);
      const csv = unitCsv([{ unit_code: "IMP-1" }, { unit_code: "IMP-1" }]);
      const first = await importUnitsCsv(ctx, csv, "import");
      expect(first.map((r) => r.status)).toEqual(["imported", "skipped"]);
      const again = await importUnitsCsv(ctx, csv, "import");
      expect(again.map((r) => r.status)).toEqual(["skipped", "skipped"]);
      expect(again[0]?.reasons).toEqual(["unit already exists — edit it in Units"]);
      expect(await database.db.select().from(units)).toHaveLength(1);
    });

    test("an invalid row doesn't block the others", async () => {
      const { ctx } = testContext(database, START);
      const rows = await importUnitsCsv(
        ctx,
        unitCsv([{ unit_code: "IMP-1" }, { unit_code: "IMP-2", makani_no: "123" }, { unit_code: "IMP-3" }]),
        "import",
      );
      expect(rows.map((r) => r.status)).toEqual(["imported", "error", "imported"]);
      expect(rows[1]?.reasons).toEqual(["makani_no: Makani numbers have 10 digits"]);
      expect(await database.db.select().from(units)).toHaveLength(2);
    });

    test("landlord is linked and reused across rows", async () => {
      const { ctx } = testContext(database, START);
      const landlord = { landlord_name: "Test Holdings LLC", landlord_email: "owner@test.example" };
      const rows = await importUnitsCsv(
        ctx,
        unitCsv([{ unit_code: "IMP-1", ...landlord }, { unit_code: "IMP-2", ...landlord }, { unit_code: "IMP-3" }]),
        "import",
      );
      expect(rows.map((r) => r.status)).toEqual(["imported", "imported", "imported"]);
      const ps = await database.db.select().from(parties);
      expect(ps).toHaveLength(1);
      const byCode = Object.fromEntries(
        (await database.db.select().from(units)).map((u) => [u.code, u.landlordPartyId]),
      );
      expect(byCode).toEqual({ "IMP-1": ps[0]!.id, "IMP-2": ps[0]!.id, "IMP-3": null });
    });
  });

  describe("CSV import", () => {
    test("state from dates and Ejari", async () => {
      const { ctx } = testContext(database, START);
      const rows = await importLeasesCsv(
        ctx,
        leaseCsv([
          { unit_code: "A", start_on: "2026-06-01", end_on: "2027-05-31" }, // running, T−5m = 2026-12-31 → ACTIVE
          { unit_code: "B", start_on: "2026-01-01", end_on: "2026-12-31" }, // past T−5m → RENEWAL
          { unit_code: "C", start_on: "2026-12-01", end_on: "2027-11-30" }, // future + Ejari → MOVE_IN
          { unit_code: "D", start_on: "2026-12-01", end_on: "2027-11-30", ejari_no: "" }, // future, no Ejari
          { unit_code: "E", start_on: "2025-01-01", end_on: "2025-12-31" }, // ended
          { unit_code: "F", start_on: "2026-06-01", end_on: "2027-05-31", ejari_no: "" }, // running, no Ejari
          { unit_code: "G", start_on: "2026-06-01", end_on: "2027-05-31", annual_rent_aed: "80000.001" }, // bad amount
          { unit_code: "H", start_on: "2026-06-01", end_on: "2027-05-31", tenant_emirates_id: "784-1990-1234567-0" }, // bad EID
        ]),
        "import",
      );
      expect(rows.map((r) => [r.row, r.status, r.state ?? null])).toEqual([
        [2, "imported", "ACTIVE"],
        [3, "imported", "RENEWAL"],
        [4, "imported", "MOVE_IN"],
        [5, "imported", "REGISTRATION"],
        [6, "error", null],
        [7, "error", null],
        [8, "error", null],
        [9, "error", null],
      ]);
      // Contracted future leases take the unit off the market (READY), never LISTED.
      const unitStates = Object.fromEntries((await database.db.select().from(units)).map((u) => [u.code, u.state]));
      expect(unitStates).toEqual({ A: "OCCUPIED", B: "OCCUPIED", C: "READY", D: "READY" });
      expect(rows[6]?.reasons[0]).toContain("annual_rent_aed");
    });

    test("re-import skips rows already imported", async () => {
      const { ctx } = testContext(database, START);
      const csv = leaseCsv([{ unit_code: "A", start_on: "2026-06-01", end_on: "2027-05-31" }]);
      await importLeasesCsv(ctx, csv, "import");
      const again = await importLeasesCsv(ctx, csv, "import");
      expect(again[0]?.status).toBe("skipped");
      expect(await database.db.select().from(leases)).toHaveLength(1);
      // 6 renewal milestones + reminder and overdue checks for the 2 instalments still ahead; none twice.
      expect(await database.db.select().from(deadlines)).toHaveLength(10);
      expect(await database.db.select().from(payments)).toHaveLength(4);
    });

    test("overlapping lease on the same unit is refused", async () => {
      const { ctx } = testContext(database, START);
      await importOne(ctx, { unit_code: "A", start_on: "2026-06-01", end_on: "2027-05-31" });
      const [r] = await importLeasesCsv(
        ctx,
        leaseCsv([{ unit_code: "A", start_on: "2027-01-01", end_on: "2027-12-31", tenant_name: "Other" }]),
        "import",
      );
      expect(r?.status).toBe("error");
    });

    test("own-use lock blocks importing a new lease on the unit", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { unit_code: "L", start_on: "2026-06-01", end_on: "2027-05-31" });
      await database.db
        .update(units)
        .set({ ownUseLockUntil: d("2028-06-01") })
        .where(eq(units.code, "L"));
      await advance(ctx, { kind: "lease", id }, "TENANT_VACATE_NOTICE", { actor: "system" });
      const [r] = await importLeasesCsv(
        ctx,
        leaseCsv([{ unit_code: "L", start_on: "2027-07-01", end_on: "2028-06-30", tenant_name: "New" }]),
        "import",
      );
      expect(r?.status).toBe("error");
      expect(r?.reasons[0]).toContain("own-use lock");
    });

    test("database errors are reported without query parameters or PII", async () => {
      const { ctx } = testContext(database, START);
      await importOne(ctx, { unit_code: "P1", start_on: "2026-06-01", end_on: "2027-05-31" });
      // Take the ref the next row will want, so its insert hits the unique constraint.
      await database.db.update(leases).set({ ref: "P2/2026-06" });
      const [r] = await importLeasesCsv(
        ctx,
        leaseCsv([{ unit_code: "P2", start_on: "2026-06-01", end_on: "2027-05-31", tenant_phone: "+971 50 123 4567" }]),
        "import",
      );
      expect(r?.status).toBe("error");
      expect(r?.reasons.join(" ")).toContain("leases_ref_unique");
      expect(r?.reasons.join(" ")).not.toContain("params:");
      expect(r?.reasons.join(" ")).not.toContain("123 4567");
    });

    test("imported lease shows its next deadline; the landlord question catches up", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      const rows = await database.db.select().from(deadlines).where(eq(deadlines.entityId, id));
      const byId = Object.fromEntries(rows.map((r) => [r.milestone.split("@")[0], [r.dueOn, r.status]]));
      expect(byId).toEqual({
        landlord_intent: ["2026-10-19", "pending"], // was due 2026-04-30; asked today instead
        renewal_assess: ["2026-12-31", "pending"],
        notice_draft: ["2027-01-31", "pending"],
        notice_send: ["2027-02-20", "pending"],
        notice_deadline: ["2027-03-02", "pending"],
        lease_end: ["2027-05-31", "pending"],
      });
      await sweepDueDeadlines(ctx);
      const [t] = await database.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.entityId, id), eq(tasks.kind, "landlord_intent")));
      expect(t?.kind).toBe("landlord_intent");
      expect(t?.details).toMatchObject({ repossessionNoticeDeadline: "2026-05-31", possibleThisTerm: false });
    });

    test("late import inside the notice window drafts the notice today (catch-up)", async () => {
      const { ctx } = testContext(database, START);
      // End 2027-01-31: T−4m = 2026-09-30 (past), T−90 = 2026-11-02 (still ahead).
      const id = await importOne(ctx, { start_on: "2026-02-01", end_on: "2027-01-31" });
      const draft = await deadlineFor(id, "notice_draft");
      expect(draft.status).toBe("pending");
      expect(draft.dueOn).toBe(d("2026-10-19"));
      await sweepDueDeadlines(ctx);
      expect(await database.db.select().from(approvals).where(eq(approvals.entityId, id))).toHaveLength(1);
    });

    test("import after T−90 warns and raises the same-rent fallback task", async () => {
      const { ctx } = testContext(database, START);
      const [r] = await importLeasesCsv(ctx, leaseCsv([{ start_on: "2026-01-01", end_on: "2026-12-31" }]), "import");
      expect(r?.reasons.join(" ")).toContain("notice deadline has passed");
      expect(await taskKinds(r!.leaseId!)).toContain("renewal_same_rent_fallback");
    });
  });

  describe("deadlines fire exactly once", () => {
    test("fast-forward through renewal: each milestone once, in order", async () => {
      const { ctx, clock } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      expect((await sweepDueDeadlines(ctx)).map((r) => r.fired && r.milestone)).toEqual(["landlord_intent@2027-05-31"]);
      expect(await sweepDueDeadlines(ctx)).toEqual([]);

      clock.advanceDays(73); // 2026-12-31: T−5m
      expect((await sweepDueDeadlines(ctx)).map((r) => r.fired && r.milestone)).toEqual(["renewal_assess@2027-05-31"]);
      expect((await lease(id)).state).toBe("RENEWAL");
      expect(await sweepDueDeadlines(ctx)).toEqual([]);

      clock.advanceDays(31); // 2027-01-31: T−4m → approval
      await sweepDueDeadlines(ctx);
      await sweepDueDeadlines(ctx);
      const aps = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
      expect(aps).toHaveLength(1);
      expect(aps[0]).toMatchObject({ gate: "renewal_notice", approverRole: "leasing_manager" });

      clock.advanceDays(400);
      await sweepDueDeadlines(ctx);
      await sweepDueDeadlines(ctx);
      expect(await fired(id)).toEqual([
        "landlord_intent@2027-05-31",
        "renewal_assess@2027-05-31",
        "notice_draft@2027-05-31",
        "notice_send@2027-05-31",
        "notice_deadline@2027-05-31",
        "lease_end@2027-05-31",
      ]);
      // No notice approved → overdue task at T−100 and same-rent fallback task at T−90.
      expect(await taskKinds(id)).toEqual([
        "landlord_intent",
        "lease_end_undecided",
        "renewal_notice_overdue",
        "renewal_same_rent_fallback",
      ]);
    });

    test("concurrent fires of one deadline: only one wins", async () => {
      const { ctx, clock } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      clock.advanceDays(73);
      const dl = await deadlineFor(id, "renewal_assess");
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          fireDeadline(ctx, dl.id).catch((e: Error) => ({ fired: false, reason: e.message })),
        ),
      );
      expect(results.filter((r) => r.fired)).toHaveLength(1);
      expect((await events(id)).filter((e) => e.type === "RENEWAL_WINDOW_OPENED")).toHaveLength(1);
    });

    test("a deadline isn't fired before its due date", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      const dl = await deadlineFor(id, "renewal_assess");
      expect(await fireDeadline(ctx, dl.id)).toEqual({ fired: false, reason: "not pending or not due" });
    });

    test("one failing deadline doesn't stop the sweep", async () => {
      const { ctx, clock } = testContext(database, START);
      const bad = await importOne(ctx, { unit_code: "BAD", start_on: "2026-06-01", end_on: "2027-05-31" });
      const good = await importOne(ctx, { unit_code: "OK", start_on: "2026-06-01", end_on: "2027-05-31" });
      await database.db.update(leases).set({ rulesVersion: "unknown-version" }).where(eq(leases.id, bad));
      clock.advanceDays(73);
      const results = await sweepDueDeadlines(ctx);
      expect(results.filter((r) => !r.fired)).toHaveLength(2); // bad lease: landlord_intent + renewal_assess
      expect((await lease(good)).state).toBe("RENEWAL");
      expect((await deadlineFor(bad, "renewal_assess")).status).toBe("pending"); // retried next sweep
      expect(await taskKinds(bad)).toEqual(["deadline_failing", "deadline_failing"]);
    });

    test("a legal milestone that can't run is recorded as skipped and raises a task", async () => {
      const { ctx, clock } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      clock.advanceDays(73);
      await sweepDueDeadlines(ctx); // → RENEWAL
      await advance(ctx, { kind: "lease", id }, "DISPUTE_OPENED", { actor: "system" });
      clock.advanceDays(70); // past notice_draft, notice_send, notice_deadline
      await sweepDueDeadlines(ctx);
      const dl = await deadlineFor(id, "notice_deadline");
      expect(dl.status).toBe("skipped");
      expect(dl.note).toContain("DISPUTE");
      const notRun = (await database.db.select().from(tasks).where(eq(tasks.entityId, id))).filter(
        (x) => x.kind === "milestone_not_run",
      );
      expect(notRun.map((x) => (x.details as { milestone: string }).milestone).toSorted()).toEqual([
        "notice_deadline",
        "notice_draft",
        "notice_send",
      ]);
    });

    test("entering ACTIVE after T−5 months opens the renewal window and drafts the notice", async () => {
      const { ctx, clock } = testContext(database, START);
      // Short term: T−5m = 2026-09-28 (past), T−90 = 2026-11-30 (ahead).
      const id = await importOne(ctx, { start_on: "2026-11-01", end_on: "2027-02-28" });
      expect((await lease(id)).state).toBe("MOVE_IN");
      clock.advanceDays(13); // 2026-11-01
      await completeMoveInChecklist(ctx, id);
      await advance(ctx, { kind: "lease", id }, "MOVE_IN_COMPLETED", { actor: "system" });
      expect((await lease(id)).state).toBe("RENEWAL");
      const aps = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
      expect(aps.map((a) => a.gate)).toEqual(["renewal_notice"]);
      const [u] = await database.db.select().from(units);
      expect(u?.state).toBe("OCCUPIED");
    });

    test("outside demo mode each pending deadline gets a pg-boss job at Dubai midnight", async () => {
      const { ctx, scheduler } = testContext(database, START, { demoMode: false });
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      expect(scheduler.jobs).toHaveLength(6);
      const assess = scheduler.jobs.find((j) => j.singletonKey === `${id}:renewal_assess@2027-05-31`);
      expect(assess?.startAfter?.toISOString()).toBe("2026-12-30T20:00:00.000Z");
      expect((await deadlineFor(id, "renewal_assess")).jobId).toBeTruthy();
    });
  });

  describe("advance()", () => {
    test("illegal event → 409, nothing written", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      const before = (await events(id)).length;
      await expect(advance(ctx, { kind: "lease", id }, "EJARI_ISSUED", { actor: "system" })).rejects.toMatchObject({
        status: 409,
        code: "transition_not_allowed",
      });
      expect((await events(id)).length).toBe(before);
      expect((await lease(id)).state).toBe("ACTIVE");
    });

    test("transition writes state and an audited event with rulesVersion", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      const r = await advance(ctx, { kind: "lease", id }, "TENANT_VACATE_NOTICE", {
        actor: "user:abc",
        payload: { moveOutOn: "2027-05-31" },
      });
      expect(r).toMatchObject({ from: "ACTIVE", to: "MOVE_OUT" });
      const e = (await events(id)).find((x) => x.id === r.eventId);
      expect(e).toMatchObject({
        actor: "user:abc",
        fromState: "ACTIVE",
        toState: "MOVE_OUT",
        rulesVersion: "dubai-2025-01",
      });
      // Renewal milestones are cancelled once the tenant leaves; lease_end stays.
      const pending = (
        await database.db
          .select()
          .from(deadlines)
          .where(and(eq(deadlines.entityId, id), eq(deadlines.status, "pending")))
      ).map((x) => x.milestone);
      expect(pending).toEqual(["lease_end@2027-05-31"]);
    });

    test("unit events carry a rules version", async () => {
      const { ctx } = testContext(database, START);
      const id = newId();
      await database.db.insert(units).values({
        id,
        code: "RV",
        building: "b",
        community: "c",
        unitNo: "1",
        dldPropertyNo: "x",
        makaniNo: "y",
        dewaPremiseNo: "z",
        areaSqft: 500,
        bedrooms: 1,
        furnished: false,
        askingRentFils: 8_000_000,
      });
      await advance(ctx, { kind: "unit", id }, "MARK_READY", { actor: "system" });
      expect((await events(id))[0]?.rulesVersion).toBe("dubai-2025-01");
    });

    test("guard failure → 422 with reasons; state unchanged", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      await advance(ctx, { kind: "lease", id }, "TENANT_VACATE_NOTICE", { actor: "system" });
      await expect(advance(ctx, { kind: "lease", id }, "SETTLED", { actor: "system" })).rejects.toMatchObject({
        status: 422,
        reasons: ["deposit not settled", "Ejari not cancelled"],
      });
      expect((await lease(id)).state).toBe("MOVE_OUT");
    });

    test("tenant leaving cancels open renewal proposals; settling frees the unit", async () => {
      const { ctx, leaseId: id, approval } = await leaseWithPendingNotice();
      await advance(ctx, { kind: "lease", id }, "TENANT_VACATE_NOTICE", { actor: "system" });
      const [a] = await database.db.select().from(approvals).where(eq(approvals.id, approval.id));
      expect(a?.status).toBe("cancelled");
      expect((await events(id)).some((e) => e.type === "APPROVAL_CANCELLED")).toBe(true);
      await database.db
        .update(leases)
        .set({ depositSettledOn: d("2027-06-05"), ejariCancelledOn: d("2027-06-02") })
        .where(eq(leases.id, id));
      await advance(ctx, { kind: "lease", id }, "SETTLED", { actor: "system" });
      const [u] = await database.db.select().from(units);
      expect(u?.state).toBe("PREP");
      const pending = await database.db
        .select()
        .from(deadlines)
        .where(and(eq(deadlines.entityId, id), eq(deadlines.status, "pending")));
      expect(pending).toHaveLength(0);
    });

    test("unit cannot be published while a previous Ejari is active", async () => {
      const { ctx } = testContext(database, START);
      const id = await importOne(ctx, { unit_code: "Q", start_on: "2026-06-01", end_on: "2027-05-31" });
      await advance(ctx, { kind: "lease", id }, "TENANT_VACATE_NOTICE", { actor: "system" });
      const [u] = await database.db.select().from(units).where(eq(units.code, "Q"));
      await database.db.update(units).set({ state: "READY", askingRentFils: 8_000_000 }).where(eq(units.id, u!.id));
      await expect(advance(ctx, { kind: "unit", id: u!.id }, "PUBLISH", { actor: "system" })).rejects.toMatchObject({
        status: 422,
        reasons: ["a previous Ejari registration is still active"],
      });
    });
  });

  describe("landlord repossession (TERMINATED)", () => {
    test("needs an approved, valid notice and takes effect only at lease end", async () => {
      const { ctx, clock } = testContext(database, START);
      const manager = await addStaff(database, "leasing_manager");
      const id = await importOne(ctx, { unit_code: "T", start_on: "2026-06-01", end_on: "2027-05-31" });
      await expect(advance(ctx, { kind: "lease", id }, "TERMINATED", { actor: "system" })).rejects.toMatchObject({
        code: "guard_failed", // before lease end
      });

      const req = await requestVacate(ctx, id, vacateProposal(id));
      await decideApproval(ctx, req.id, manager, { decision: "approve" });
      // The approved notice replaces the renewal: no renewal notice is drafted.
      clock.set(new Date("2027-05-31T04:00:00Z"));
      await sweepDueDeadlines(ctx);
      expect((await deadlineFor(id, "notice_draft")).status).toBe("skipped");
      expect(await database.db.select().from(approvals).where(eq(approvals.gate, "renewal_notice"))).toHaveLength(0);

      await expect(advance(ctx, { kind: "lease", id }, "TERMINATED", { actor: "system" })).rejects.toMatchObject({
        code: "gate_required",
      });
      await advance(ctx, { kind: "lease", id }, "TERMINATED", { actor: `user:${manager.id}`, approvalId: req.id });
      expect((await lease(id)).state).toBe("MOVE_OUT");
      const [a] = await database.db.select().from(approvals).where(eq(approvals.id, req.id));
      expect(a?.consumedByEventId).toBeTruthy();
      // Own use: the unit can't be re-let for 2 years (residential).
      const [u] = await database.db.select().from(units).where(eq(units.code, "T"));
      expect(u?.ownUseLockUntil).toBe(d("2029-05-31"));
      // The tenant actually leaves later: the lock is extended from the move-out date, never shortened.
      clock.set(new Date("2027-06-20T04:00:00Z"));
      await database.db
        .update(leases)
        .set({ depositSettledOn: d("2027-06-20"), ejariCancelledOn: d("2027-06-18") })
        .where(eq(leases.id, id));
      await advance(ctx, { kind: "lease", id }, "SETTLED", { actor: "system" });
      const [u2] = await database.db.select().from(units).where(eq(units.code, "T"));
      expect(u2?.ownUseLockUntil).toBe(d("2029-06-20"));
      expect(u2?.state).toBe("PREP");
      // The used approval is marked consumed and no longer counts as a live repossession.
      const [used] = await database.db.select().from(approvals).where(eq(approvals.id, req.id));
      expect(used?.consumedByEventId).toBeTruthy();
    });

    test("a notice served late, by email or on another ground can't be approved", async () => {
      const { ctx } = testContext(database, START);
      const manager = await addStaff(database, "leasing_manager");
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      for (const bad of [{ servedOn: "2026-06-01" }, { deliveryMethod: "email" }, { ground: "rent_dispute" }]) {
        const req = await requestVacate(ctx, id, vacateProposal(id, bad));
        await expect(decideApproval(ctx, req.id, manager, { decision: "approve" })).rejects.toMatchObject({
          code: "rule_violation",
        });
      }
    });

    test("onApproveEvent applies the event as the approver", async () => {
      const { ctx, clock } = testContext(database, START);
      const manager = await addStaff(database, "leasing_manager");
      const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
      clock.set(new Date("2027-05-31T04:00:00Z"));
      const req = await requestVacate(ctx, id, vacateProposal(id, { ground: "sale" }), "TERMINATED");
      await decideApproval(ctx, req.id, manager, { decision: "approve" });
      const e = (await events(id)).find((x) => x.type === "TERMINATED");
      expect(e?.actor).toBe(`user:${manager.id}`);
    });
  });

  describe("renewal (RENEWED)", () => {
    test("applies exactly the approved term and rent, once", async () => {
      const { ctx, leaseId: id, approval } = await leaseWithPendingNotice();
      const manager = await addStaff(database, "leasing_manager");
      const term = { startOn: "2027-06-01", endOn: "2028-05-31" };
      // No approval → refused, even for a decrease.
      await expect(
        advance(ctx, { kind: "lease", id }, "RENEWED", {
          actor: "system",
          payload: { ...term, annualRentFils: 7_000_000 },
        }),
      ).rejects.toMatchObject({ code: "gate_required" });

      // Give the approval an SRI value so a 5% increase is within the cap, then approve an edit.
      await database.db
        .update(approvals)
        .set({ proposal: { ...approval.proposal, sriAverageFils: 9_500_000 } })
        .where(eq(approvals.id, approval.id));
      await expect(
        decideApproval(ctx, approval.id, manager, { decision: "edit", proposal: { proposedRentFils: 8_400_001 } }),
      ).rejects.toMatchObject({ code: "rule_violation" });
      await decideApproval(ctx, approval.id, manager, { decision: "edit", proposal: { proposedRentFils: 8_400_000 } });
      // An increase only stands once the notice has actually been sent (before T−90).
      const renewEarly = advance(ctx, { kind: "lease", id }, "RENEWED", {
        actor: "system",
        approvalId: approval.id,
        payload: { ...term, annualRentFils: 8_400_000 },
      });
      await expect(renewEarly).rejects.toMatchObject({ code: "gate_required" });
      expect(await sendRenewalNotice(ctx, approval.id)).toMatchObject({ sent: true });

      const renew = (payload: Record<string, unknown>) =>
        advance(ctx, { kind: "lease", id }, "RENEWED", { actor: "system", approvalId: approval.id, payload });
      await expect(renew({ ...term, annualRentFils: 8_399_999 })).rejects.toMatchObject({ code: "gate_required" });
      await expect(
        renew({ startOn: "2027-06-01", endOn: "2030-05-31", annualRentFils: 8_400_000 }),
      ).rejects.toMatchObject({ code: "gate_required" });
      await renew({ ...term, annualRentFils: 8_400_000 });

      expect(await lease(id)).toMatchObject({
        state: "ACTIVE",
        startOn: "2027-06-01",
        endOn: "2028-05-31",
        annualRentFils: 8_400_000,
      });
      const e = (await events(id)).find((x) => x.type === "RENEWED");
      expect(e?.payload).toMatchObject({
        previous: { startOn: "2026-06-01", endOn: "2027-05-31", annualRentFils: 8_000_000 },
      });
      expect(await taskKinds(id)).toContain("ejari_renewal");
      const next = await database.db
        .select()
        .from(deadlines)
        .where(and(eq(deadlines.entityId, id), eq(deadlines.milestone, "renewal_assess@2028-05-31")));
      expect(next).toHaveLength(1);
      // The approval is used up.
      await expect(renew({ ...term, annualRentFils: 8_400_000 })).rejects.toMatchObject({ status: 409 });
    });

    test("after a rejected notice, T−90 drafts a same-rent revision that can renew the lease", async () => {
      const { ctx, clock, leaseId: id, approval } = await leaseWithPendingNotice();
      const manager = await addStaff(database, "leasing_manager");
      await decideApproval(ctx, approval.id, manager, { decision: "reject", note: "landlord undecided" });
      clock.set(new Date("2027-03-02T04:00:00Z")); // T−90: still a legal send day, no fallback yet
      await sweepDueDeadlines(ctx);
      expect(await taskKinds(id)).not.toContain("renewal_same_rent_fallback");
      clock.set(new Date("2027-03-03T04:00:00Z")); // T−89: the deadline check runs
      await sweepDueDeadlines(ctx);
      const revs = await database.db
        .select()
        .from(approvals)
        .where(and(eq(approvals.entityId, id), eq(approvals.status, "pending")));
      expect(revs).toHaveLength(1);
      expect(revs[0]?.dedupeKey.endsWith("#2")).toBe(true);
      expect(await taskKinds(id)).toContain("renewal_same_rent_fallback");
      await decideApproval(ctx, revs[0]!.id, manager, { decision: "approve" });
      await advance(ctx, { kind: "lease", id }, "RENEWED", {
        actor: "system",
        approvalId: revs[0]!.id,
        payload: { startOn: "2027-06-01", endOn: "2028-05-31", annualRentFils: 8_000_000 },
      });
      expect((await lease(id)).state).toBe("ACTIVE");
    });

    test("the new term is pinned to the rulebook version active at renewal", async () => {
      const { ctx, leaseId: id, approval } = await leaseWithPendingNotice();
      const manager = await addStaff(database, "leasing_manager");
      const before = (await lease(id)).rulesVersion;
      // A stricter version (95-day notice) in force from today, and a later one that starts after
      // the new term begins and so must not apply to it.
      const draft = await createDraft(ctx, before, "user:admin-test");
      await updateDraft(
        ctx,
        draft.version,
        { values: { ...rulebookValues(getRulebook(before)), renewalNoticeDays: 95 } },
        "user:admin-test",
      );
      await publishRulebook(ctx, draft.version, {}, "user:admin-test");
      const later = await createDraft(ctx, draft.version, "user:admin-test");
      await updateDraft(ctx, later.version, { effectiveFrom: d("2027-06-02") }, "user:admin-test");
      await publishRulebook(ctx, later.version, {}, "user:admin-test");
      await decideApproval(ctx, approval.id, manager, { decision: "approve" });
      await advance(ctx, { kind: "lease", id }, "RENEWED", {
        actor: "system",
        approvalId: approval.id,
        payload: { startOn: "2027-06-01", endOn: "2028-05-31", annualRentFils: 8_000_000 },
      });
      expect((await lease(id)).rulesVersion).toBe(draft.version);
      const e = (await events(id)).find((x) => x.type === "RENEWED");
      // The renewal was checked under the old version; the next term uses the new one.
      expect(e?.rulesVersion).toBe(before);
      expect(e?.payload).toMatchObject({ nextTermRulesVersion: draft.version });
      // The new term's milestones use the new version's values.
      const [deadline] = await database.db
        .select()
        .from(deadlines)
        .where(and(eq(deadlines.entityId, id), eq(deadlines.milestone, "notice_deadline@2028-05-31")));
      expect(deadline).toMatchObject({ rulesVersion: draft.version, dueOn: "2028-02-26" });
    });

    test("a late milestone from the old term is skipped, not applied to the new one", async () => {
      const { ctx, clock, leaseId: id, approval } = await leaseWithPendingNotice();
      const manager = await addStaff(database, "leasing_manager");
      await decideApproval(ctx, approval.id, manager, { decision: "approve" });
      await advance(ctx, { kind: "lease", id }, "RENEWED", {
        actor: "system",
        approvalId: approval.id,
        payload: { startOn: "2027-06-01", endOn: "2028-05-31", annualRentFils: 8_000_000 },
      });
      const [old] = await database.db
        .select()
        .from(deadlines)
        .where(and(eq(deadlines.entityId, id), eq(deadlines.milestone, "notice_send@2027-05-31")));
      // Renewal retires the old term's remaining milestones.
      expect(old).toMatchObject({ status: "cancelled", note: "lease renewed for a new term" });
      if (!old) throw new Error("missing deadline");
      // Even if one were left pending (e.g. a job already queued), firing it does nothing.
      await database.db.update(deadlines).set({ status: "pending" }).where(eq(deadlines.id, old.id));
      clock.set(new Date("2027-03-01T04:00:00Z"));
      const r = await fireDeadline(ctx, old.id);
      expect(r).toMatchObject({ fired: true, skipped: expect.stringContaining("term ending 2027-05-31") });
    });
  });

  describe("approvals", () => {
    test("only the gate's approver role may decide", async () => {
      const { ctx, approval } = await leaseWithPendingNotice();
      for (const role of ["leasing_officer", "finance", "admin"] as const) {
        const u = await addStaff(database, role);
        await expect(decideApproval(ctx, approval.id, u, { decision: "approve" })).rejects.toMatchObject({
          status: 403,
        });
      }
      const m = await addStaff(database, "leasing_manager");
      await expect(decideApproval(ctx, approval.id, m, { decision: "approve" })).resolves.toMatchObject({
        status: "approved",
      });
    });

    test("decisions are recorded once and audited", async () => {
      const { ctx, approval, leaseId } = await leaseWithPendingNotice();
      const m = await addStaff(database, "leasing_manager");
      await decideApproval(ctx, approval.id, m, { decision: "reject", note: "talk to landlord first" });
      await expect(decideApproval(ctx, approval.id, m, { decision: "approve" })).rejects.toMatchObject({
        code: "already_decided",
      });
      const e = (await events(leaseId)).find((x) => x.type === "APPROVAL_DECIDED");
      expect(e?.actor).toBe(`user:${m.id}`);
      expect(e?.payload).toMatchObject({ status: "rejected", note: "talk to landlord first" });
    });

    test("a rent-increase notice can't be approved after T−90", async () => {
      const { ctx, clock, approval } = await leaseWithPendingNotice();
      const m = await addStaff(database, "leasing_manager");
      await database.db
        .update(approvals)
        .set({ proposal: { ...approval.proposal, sriAverageFils: 9_500_000 } })
        .where(eq(approvals.id, approval.id));
      clock.set(new Date("2027-03-03T04:00:00Z")); // T−89
      await expect(
        decideApproval(ctx, approval.id, m, { decision: "edit", proposal: { proposedRentFils: 8_200_000 } }),
      ).rejects.toMatchObject({ code: "rule_violation" });
      // Same rent is still fine.
      await expect(decideApproval(ctx, approval.id, m, { decision: "approve" })).resolves.toMatchObject({
        status: "approved",
      });
    });

    test("nobody approves their own proposal", async () => {
      const { ctx, leaseId } = await leaseWithPendingNotice();
      const m = await addStaff(database, "leasing_manager");
      const req = await withTx(database, (tx) =>
        requestApproval(ctx, tx, {
          gate: "vacate_notice",
          entity: { kind: "lease", id: leaseId },
          dedupeKey: newId(),
          title: "x",
          proposal: vacateProposal(leaseId),
          reasons: [],
          sources: [],
          proposedBy: `copilot:${m.id}`,
        }),
      );
      await expect(decideApproval(ctx, req.id, m, { decision: "approve" })).rejects.toMatchObject({ status: 403 });
    });

    test("same dedupe key returns the existing approval", async () => {
      const { ctx, leaseId } = await leaseWithPendingNotice();
      const make = () =>
        withTx(database, (tx) =>
          requestApproval(ctx, tx, {
            gate: "vacate_notice",
            entity: { kind: "lease", id: leaseId },
            dedupeKey: "k1",
            title: "x",
            proposal: {},
            reasons: [],
            sources: [],
            proposedBy: "system",
          }),
        );
      const a = await make();
      const b = await make();
      expect(b).toEqual({ id: a.id, created: false });
    });
  });

  test("lease_events is append-only (no UPDATE, DELETE or TRUNCATE)", async () => {
    const { ctx } = testContext(database, START);
    const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
    await expect(database.pool.query("UPDATE lease_events SET actor = 'x' WHERE entity_id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
    await expect(database.pool.query("DELETE FROM lease_events WHERE entity_id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
    await expect(database.pool.query("TRUNCATE lease_events")).rejects.toThrow(/append-only/);
  });

  test("event payloads are PII-masked", async () => {
    const { ctx } = testContext(database, START);
    const id = await importOne(ctx, { start_on: "2026-06-01", end_on: "2027-05-31" });
    await advance(ctx, { kind: "lease", id }, "TENANT_VACATE_NOTICE", {
      actor: "system",
      payload: { comment: "call me on +971 50 123 4567", phone: "0501234567" },
    });
    const e = (await events(id)).find((x) => x.type === "TENANT_VACATE_NOTICE");
    expect(JSON.stringify(e?.payload)).not.toContain("123 4567");
    expect(JSON.stringify(e?.payload)).not.toContain("0501234567");
  });
});
