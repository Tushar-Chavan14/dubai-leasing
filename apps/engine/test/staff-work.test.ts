import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { newId, type StaffRole, type StaffUser } from "@leasing/core";
import {
  approvals,
  copilotDrafts,
  copilotThreads,
  type Database,
  leaseEvents,
  outboundMessages,
  payments,
  tasks,
} from "@leasing/db";
import { and, eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import { importLeasesCsv } from "../src/manager/import.ts";
import { sweepDueDeadlines } from "../src/manager/milestones.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, testContext, testCompany } from "./harness.ts";

const START = "2026-10-19T04:00:00Z";
const SECRET = "test-secret";
let database: Database;

async function setup() {
  const t = testContext(database, START);
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const staff = {} as Record<StaffRole, StaffUser>;
  for (const role of ["leasing_officer", "leasing_manager", "finance", "admin"] as const)
    staff[role] = await addStaff(database, role);
  const as = (role: StaffRole, path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, staff[role].id, Date.now())}`,
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const lease = async (row: Record<string, string>) => {
    const [r] = await importLeasesCsv(
      t.ctx,
      leaseCsv([{ tenant_email: "tenant@test.example", ...row }]),
      "import",
      await testCompany(t.ctx.database),
    );
    return r!.leaseId!;
  };
  const thread = async (role: StaffRole) => {
    const id = newId();
    await database.db
      .insert(copilotThreads)
      .values({ id, userId: staff[role].id, title: "t", createdAt: t.clock.now() });
    return id;
  };
  return { ...t, app, staff, as, lease, thread };
}

describe.skipIf(noDb)("tasks and the landlord's answer", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("create a task (leasing roles), mark it done (its role or a manager)", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "T-1", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "1" });
    const body = {
      leaseId: id,
      title: "Call the tenant about the parking card",
      assigneeRole: "finance",
      dueOn: "2026-10-25",
    };
    expect((await s.as("finance", "/api/tasks", "POST", body)).status).toBe(403);
    const r = await s.as("leasing_officer", "/api/tasks", "POST", body);
    expect(r.status).toBe(201);
    const { taskId } = (await r.json()) as { taskId: string };
    const [t] = await database.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(t).toMatchObject({
      kind: "staff_task",
      assigneeRole: "finance",
      createdBy: `user:${s.staff.leasing_officer.id}`,
    });
    expect((await s.as("leasing_officer", `/api/tasks/${taskId}/done`, "POST", {})).status).toBe(403);
    expect((await s.as("finance", `/api/tasks/${taskId}/done`, "POST", { note: "done" })).status).toBe(200);
    expect((await s.as("finance", `/api/tasks/${taskId}/done`, "POST", {})).status).toBe(409);
  });

  test("landlord's answer: not reached keeps it open; own use after the deadline → a task for the next term", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "T-2", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "1" });
    await sweepDueDeadlines(s.ctx);
    const [task] = await database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.entityId, id), eq(tasks.kind, "landlord_intent")));
    expect((await s.as("leasing_officer", `/api/tasks/${task!.id}/done`, "POST", {})).status).toBe(409);
    const nr = await s.as("leasing_officer", `/api/tasks/${task!.id}/landlord-answer`, "POST", {
      answer: "not_reached",
    });
    expect(((await nr.json()) as { closed: boolean }).closed).toBe(false);
    const own = await s.as("leasing_officer", `/api/tasks/${task!.id}/landlord-answer`, "POST", {
      answer: "own_use",
      note: "Owner's son moving in",
    });
    expect(await own.json()).toMatchObject({ closed: true, possibleThisTerm: false, deadline: "2026-05-31" });
    const [next] = await database.db.select().from(tasks).where(eq(tasks.kind, "repossession_next_term"));
    expect(next?.title).toContain("by 2027-05-31");
    const evs = await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "LANDLORD_INTENT_RECORDED"));
    expect(evs.map((e) => e.payload.answer)).toEqual(["not_reached", "own_use"]);
  });

  test("a served 12-month notice goes to the inbox for a manager; late or future notices are refused", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "T-3", start_on: "2026-01-01", end_on: "2027-12-31", cheques: "1" });
    const vac = (body: Record<string, unknown>) =>
      s.as("leasing_officer", `/api/leases/${id}/vacate-notice`, "POST", body);
    expect((await vac({ ground: "sale", servedOn: "2026-10-25", deliveryMethod: "notary" })).status).toBe(422); // future
    expect(
      (
        await s.as("finance", `/api/leases/${id}/vacate-notice`, "POST", {
          ground: "sale",
          servedOn: "2026-10-15",
          deliveryMethod: "notary",
        })
      ).status,
    ).toBe(403);
    const ok = await vac({ ground: "sale", servedOn: "2026-10-15", deliveryMethod: "registered_mail" });
    expect(ok.status).toBe(201);
    const [a] = await database.db.select().from(approvals).where(eq(approvals.gate, "vacate_notice"));
    expect(a).toMatchObject({
      status: "pending",
      approverRole: "leasing_manager",
      proposedBy: `user:${s.staff.leasing_officer.id}`,
    });
    // One live notice per term; after a rejection a corrected one goes in as a new request.
    expect((await vac({ ground: "sale", servedOn: "2026-10-16", deliveryMethod: "notary" })).status).toBe(409);
    await decideApproval(
      s.ctx,
      a!.id,
      { ...s.staff.leasing_manager, email: "", name: "", role: "leasing_manager" },
      { decision: "reject", note: "wrong date" },
    );
    const again = await vac({ ground: "sale", servedOn: "2026-10-16", deliveryMethod: "notary" });
    expect(again.status).toBe(201);
    const all = await database.db.select().from(approvals).where(eq(approvals.gate, "vacate_notice"));
    expect(all.map((x) => x.status).sort()).toEqual(["pending", "rejected"]);
    const tx = (await again.json()) as { id: string; created: boolean };
    expect(tx.created).toBe(true);
    const late = await s.lease({ unit_code: "T-4", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "1" });
    const r = await s.as("leasing_officer", `/api/leases/${late}/vacate-notice`, "POST", {
      ground: "sale",
      servedOn: "2026-10-15",
      deliveryMethod: "notary",
    });
    expect(r.status).toBe(422);
  });
});

describe.skipIf(noDb)("people's own text: email the tenant, notes, copilot drafts", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("staff email goes through the mail adapter with evidence; a copilot draft is used once, by its owner", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "E-1", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "1" });
    const th = await s.thread("leasing_officer");
    const d = await s.as(
      "leasing_officer",
      "/api/copilot/drafts",
      "POST",
      { kind: "email", leaseId: id, subject: "Parking card", body: "Your parking card is ready at reception." },
      { "x-copilot-thread": th },
    );
    expect(d.status).toBe(201);
    const draft = (await d.json()) as { id: string };
    expect(s.mailer.sent).toHaveLength(0); // a draft sends nothing
    // Another user can't use it.
    expect(
      (
        await s.as("leasing_manager", `/api/leases/${id}/email`, "POST", {
          subject: "Parking card",
          body: "Your parking card is ready.",
          draftId: draft.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await s.as("admin", `/api/leases/${id}/email`, "POST", {
          subject: "Parking card",
          body: "Your parking card is ready.",
        })
      ).status,
    ).toBe(403);
    const sent = await s.as("leasing_officer", `/api/leases/${id}/email`, "POST", {
      subject: "Parking card",
      body: "Your parking card is ready at reception.",
      draftId: draft.id,
    });
    expect(sent.status).toBe(200);
    expect(s.mailer.sent.at(-1)).toMatchObject({ to: "tenant@test.example", subject: "Parking card" });
    expect(s.mailer.sent.at(-1)!.text).toMatch(/\/t\/[A-Za-z0-9_-]{30,64}/);
    const [o] = await database.db.select().from(outboundMessages).where(eq(outboundMessages.template, "staff_message"));
    expect(o).toMatchObject({ status: "sent" });
    expect(o?.bodySha256).toBeTruthy();
    const [row] = await database.db.select().from(copilotDrafts).where(eq(copilotDrafts.id, draft.id));
    expect(row?.status).toBe("used");
    // A draft only goes to the lease it was written for, and a failed send leaves it unused.
    const other = await s.lease({ unit_code: "E-2", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "1" });
    const d2 = (await (
      await s.as(
        "leasing_officer",
        "/api/copilot/drafts",
        "POST",
        { kind: "email", leaseId: id, subject: "Keys", body: "Your spare keys are at reception." },
        { "x-copilot-thread": th },
      )
    ).json()) as { id: string };
    const mismatch = await s.as("leasing_officer", `/api/leases/${other}/email`, "POST", {
      subject: "Keys",
      body: "Your spare keys are at reception.",
      draftId: d2.id,
    });
    expect(mismatch.status).toBe(422);
    s.mailer.failNext = new Error("smtp down");
    const failed = await s.as("leasing_officer", `/api/leases/${id}/email`, "POST", {
      subject: "Keys",
      body: "Your spare keys are at reception.",
      draftId: d2.id,
    });
    expect(failed.ok).toBe(false);
    const [d2row] = await database.db.select().from(copilotDrafts).where(eq(copilotDrafts.id, d2.id));
    expect(d2row?.status).toBe("draft");
    expect(
      (
        await s.as("leasing_officer", `/api/leases/${id}/email`, "POST", {
          subject: "Again",
          body: "Second time sending this.",
          draftId: draft.id,
        })
      ).status,
    ).toBe(409);
  });

  test("notes on an approval; a draft note prefills one", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "N-1", start_on: "2026-01-01", end_on: "2027-12-31", cheques: "1" });
    await s.as("leasing_officer", `/api/leases/${id}/vacate-notice`, "POST", {
      ground: "sale",
      servedOn: "2026-10-15",
      deliveryMethod: "notary",
    });
    const [a] = await database.db.select().from(approvals);
    const th = await s.thread("finance");
    const d = (await (
      await s.as(
        "finance",
        "/api/copilot/drafts",
        "POST",
        { kind: "approval_note", approvalId: a!.id, body: "Notary receipt checked." },
        { "x-copilot-thread": th },
      )
    ).json()) as { id: string };
    expect(
      (
        await s.as("finance", `/api/approvals/${a!.id}/notes`, "POST", {
          body: "Notary receipt checked.",
          draftId: d.id,
        })
      ).status,
    ).toBe(201);
    const notes = (await (await s.as("leasing_manager", `/api/approvals/${a!.id}/notes`)).json()) as {
      body: string;
      author: string;
    }[];
    expect(notes).toEqual([
      expect.objectContaining({ body: "Notary receipt checked.", author: `user:${s.staff.finance.id}` }),
    ]);
  });
});

describe.skipIf(noDb)("copilot v2 proposals (D26): tasks and approvals, created only on Confirm", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("create_task: nothing until Confirm; then a task by copilot:<user>", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "C-1", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "1" });
    const th = await s.thread("leasing_officer");
    const before = (await database.db.select().from(tasks)).length;
    const p = await s.as(
      "leasing_officer",
      "/api/copilot/proposals",
      "POST",
      { kind: "create_task", leaseId: id, title: "Chase the DEWA final bill", assigneeRole: "finance" },
      { "x-copilot-thread": th },
    );
    expect(p.status).toBe(201);
    const { id: pid } = (await p.json()) as { id: string };
    expect(await database.db.select().from(tasks)).toHaveLength(before);
    expect((await s.as("leasing_officer", `/api/copilot/proposals/${pid}/confirm`, "POST")).status).toBe(200);
    const [t] = await database.db.select().from(tasks).where(eq(tasks.kind, "staff_task"));
    expect(t).toMatchObject({ title: "Chase the DEWA final bill", createdBy: `copilot:${s.staff.leasing_officer.id}` });
    // Finance can't propose tasks (same as the UI).
    const th2 = await s.thread("finance");
    expect(
      (
        await s.as(
          "finance",
          "/api/copilot/proposals",
          "POST",
          { kind: "create_task", leaseId: id, title: "x y z", assigneeRole: "finance" },
          { "x-copilot-thread": th2 },
        )
      ).status,
    ).toBe(403);
  });

  test("propose_approval (formal reminder): on Confirm it lands in the inbox; the proposer can't approve it", async () => {
    const s = await setup();
    const id = await s.lease({ unit_code: "C-2", start_on: "2026-06-01", end_on: "2027-05-31", cheques: "4" });
    s.clock.advanceDays(43);
    const [p3] = await database.db
      .select()
      .from(payments)
      .where(and(eq(payments.leaseId, id), eq(payments.seq, 3)));
    const th = await s.thread("leasing_manager");
    const early = await s.as(
      "leasing_manager",
      "/api/copilot/proposals",
      "POST",
      { kind: "request_approval", gate: "formal_reminder", leaseId: id, paymentId: p3!.id },
      { "x-copilot-thread": th },
    );
    expect(early.status).toBe(409); // not overdue or bounced yet
    await s.as("finance", `/api/payments/${p3!.id}/record`, "POST", { outcome: "bounced" });
    const p = await s.as(
      "leasing_manager",
      "/api/copilot/proposals",
      "POST",
      { kind: "request_approval", gate: "formal_reminder", leaseId: id, paymentId: p3!.id },
      { "x-copilot-thread": th },
    );
    const { id: pid } = (await p.json()) as { id: string };
    expect(await database.db.select().from(approvals).where(eq(approvals.gate, "formal_reminder"))).toHaveLength(0);
    expect((await s.as("leasing_manager", `/api/copilot/proposals/${pid}/confirm`, "POST")).status).toBe(200);
    const [a] = await database.db.select().from(approvals).where(eq(approvals.gate, "formal_reminder"));
    expect(a).toMatchObject({ status: "pending", proposedBy: `copilot:${s.staff.leasing_manager.id}` });
    await expect(decideApproval(s.ctx, a!.id, s.staff.leasing_manager, { decision: "approve" })).rejects.toThrow();
  });
});
