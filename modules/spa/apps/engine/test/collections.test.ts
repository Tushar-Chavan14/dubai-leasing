import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock } from "@platform/kernel";
import { DEFAULT_SPA_POLICY } from "@spa/core";
import { collectionReminders, deals, outboundMessages, paymentPlanRows, type SpaDatabase, spaTasks } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { asc, eq } from "drizzle-orm";
import { createBoss, INSTALMENT_REMIND_JOB, instalmentsRemindKey, startJobs } from "../src/jobs.ts";
import { remindInstalments } from "../src/manager/collections.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { type FactsLoader, failClosedFacts } from "../src/manager/facts.ts";
import { publishPolicy } from "../src/manager/policy.ts";
import { completeTask } from "../src/manager/tasks.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
afterAll(async () => {
  await database?.close();
});
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let users: Record<string, U> = {};
let mailer = new FakeMailer();
const facts: FactsLoader = failClosedFacts;
const ctx = (withMail = true): SpaContext => ({
  database,
  clock,
  facts,
  ...(withMail ? { mail: { mailer, webBaseUrl: "https://spa.example.test" } } : {}),
});
const on = (iso: string) => clock.set(new Date(`${iso}T06:00:00Z`));

interface Row {
  seq: number;
  due?: string;
  milestone?: string;
  amount: number;
}
const ROWS: Row[] = [
  { seq: 1, due: "2026-12-03", amount: 5_000_000 },
  { seq: 2, milestone: "On completion of the structure", amount: 7_000_000 },
  { seq: 3, due: "2026-12-01", amount: 1_000_000 },
];

/** A deal in INSTALMENTS with a plan and two buyers (so each reminder goes to both). */
async function world(rows: Row[] = ROWS, state = "INSTALMENTS") {
  const made = await dealInDraft(ctx(), database, { buyers: ["Buyer One", "Buyer Two"], unitNo: "U-101" });
  await database.db
    .update(deals)
    .set({ state: state as never })
    .where(eq(deals.id, made.dealId));
  for (const r of rows)
    await database.db.insert(paymentPlanRows).values({
      dealId: made.dealId,
      seq: r.seq,
      label: `Instalment ${r.seq}`,
      dueOn: r.milestone ? null : (r.due ?? null),
      milestone: r.milestone ?? null,
      amountFils: r.amount,
      enteredBy: "user:x",
    });
  return made.dealId;
}

/** A counted payment covering a plan row, written the way a finance confirmation leaves it. */
let n = 0;
async function countPayment(dealId: string, seq: number, amount: number) {
  const q = (sql: string, args: unknown[] = []) => database.pool.query(sql, args);
  const documentId = crypto.randomUUID();
  const tag = `r${++n}`;
  await q(
    `insert into documents (id, deal_id, kind, file_name, mime, size_bytes, sha256, storage_key, uploaded_by, uploaded_at)
     values ($1, $2, 'payment_receipt', 'r.png', 'image/png', 10, $3, $3, 'u', now())`,
    [documentId, dealId, tag + documentId],
  );
  const runId = crypto.randomUUID();
  await q(
    `insert into helper_runs (id, helper, deal_id, entity_kind, entity_id, status, result, reasons, prompt_version, rules_version, visibility, created_at)
     values ($1, 'spa_document_reader', $2, 'document', $3, 'ok', '{}', '[]', 'p', 'r', 'staff', now())`,
    [runId, dealId, documentId],
  );
  const readId = crypto.randomUUID();
  await q(
    `insert into document_reads (id, document_id, profile, fields, prompt_version, run_id, read_at)
     values ($1, $2, 'payment_receipt', '{}', 'p', $3, now())`,
    [readId, documentId, runId],
  );
  const id = crypto.randomUUID();
  await q(
    `insert into payments (id, deal_id, seq, document_id, read_id, status, method, amount_read_fils, into_escrow, payer_is_buyer, registered_by, created_at)
     values ($1, $2, $3, $4, $5, 'read', 'transfer', $6, true, true, 'u', now())`,
    [id, dealId, seq, documentId, readId, amount],
  );
  await q(
    `update payments set status = 'counted', amount_fils = $2, confirmed_by = 'user:f', confirmed_at = now() where id = $1`,
    [id, amount],
  );
}

const mails = () => mailer.sent.map((m) => ({ to: m.to, subject: m.subject, text: m.text }));
const sentRows = (dealId: string) =>
  database.db
    .select()
    .from(collectionReminders)
    .where(eq(collectionReminders.dealId, dealId))
    .orderBy(asc(collectionReminders.sentAt), asc(collectionReminders.milestone));
const tasksOf = (dealId: string) => database.db.select().from(spaTasks).where(eq(spaTasks.dealId, dealId));

describe.skipIf(!url)("collections: instalment reminders (C21)", () => {
  beforeEach(async () => {
    on("2026-11-19");
    mailer = new FakeMailer();
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });

  test("14 days before a dated unpaid instalment both buyers get the fixed mail with the plan's amount and date", async () => {
    const id = await world();
    await countPayment(id, 3, 1_000_000);
    const r = await remindInstalments(ctx());
    expect(r.sent).toBe(1);
    expect(mails()).toHaveLength(2);
    expect(mails().map((m) => m.subject)).toEqual(Array(2).fill("Instalment due 3 December 2026 · Unit U-101"));
    expect(mails()[0]!.text).toContain("AED 50,000");
    expect(mails()[0]!.text).toContain("3 December 2026");
    expect(mails()[0]!.text).toContain("Instalment 1");
    for (const m of mailer.sent)
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/\baml\b|launder|sanction|screening|\bpep\b/i);
    expect((await sentRows(id)).map((x) => [x.planSeq, x.milestone])).toEqual([[1, "T-14"]]);
    const stored = await database.db.select().from(outboundMessages).where(eq(outboundMessages.entityId, id));
    expect(stored.map((s) => [s.purpose, s.template, s.status])).toEqual(
      [0, 1].map(() => ["reminder", "instalment_reminder", "sent"]),
    );
    expect(await tasksOf(id)).toEqual([]);
  });

  test("a milestone row (no date) and a paid row get nothing, and a deal of only milestones sends nothing", async () => {
    const id = await world([
      { seq: 1, milestone: "On completion of the structure", amount: 100 },
      { seq: 2, due: "2026-12-03", amount: 1_000_000 },
    ]);
    await countPayment(id, 2, 1_000_000);
    for (const day of ["2026-11-19", "2026-12-02", "2026-12-04", "2027-02-01"]) {
      on(day);
      expect((await remindInstalments(ctx())).sent).toBe(0);
    }
    expect(mailer.sent).toEqual([]);
    expect(await tasksOf(id)).toEqual([]);
    expect(await sentRows(id)).toEqual([]);
  });

  test("each reminder goes once: running the job again the same day sends nothing more", async () => {
    const id = await world();
    await countPayment(id, 3, 1_000_000);
    await remindInstalments(ctx());
    await remindInstalments(ctx());
    await Promise.all([remindInstalments(ctx()), remindInstalments(ctx())]);
    expect(mailer.sent).toHaveLength(2);
    expect(await sentRows(id)).toHaveLength(1);
  });

  test("days between milestones send nothing; T-3 and T+1 each send once, and T-14 is not repeated", async () => {
    const id = await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]);
    await remindInstalments(ctx()); // 2026-11-19 = T-14
    on("2026-11-25");
    expect((await remindInstalments(ctx())).sent).toBe(0);
    on("2026-11-30"); // T-3
    expect((await remindInstalments(ctx())).sent).toBe(1);
    on("2026-12-02");
    expect((await remindInstalments(ctx())).sent).toBe(0);
    on("2026-12-03"); // the due date itself: nothing new
    expect((await remindInstalments(ctx())).sent).toBe(0);
    on("2026-12-04"); // T+1
    expect((await remindInstalments(ctx())).sent).toBe(1);
    on("2026-12-20");
    expect((await remindInstalments(ctx())).sent).toBe(0);
    expect((await sentRows(id)).map((x) => x.milestone).toSorted()).toEqual(["T+1", "T-14", "T-3"]);
    expect(mailer.sent).toHaveLength(6);
    expect(mailer.sent.at(-1)!.subject).toBe("Instalment overdue · Unit U-101");
    expect(mailer.sent.at(-1)!.text).toContain("was due on 3 December 2026");
  });

  test("a job that was down on the day sends the latest due reminder once, not a burst", async () => {
    const id = await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]);
    on("2026-12-01"); // T-14 and T-3 have passed: only T-3 goes
    expect((await remindInstalments(ctx())).sent).toBe(1);
    expect((await sentRows(id)).map((x) => x.milestone)).toEqual(["T-3"]);
    expect((await remindInstalments(ctx())).sent).toBe(0);
  });

  test("an instalment paid after a reminder gets no more", async () => {
    const id = await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]);
    await remindInstalments(ctx());
    await countPayment(id, 1, 5_000_000);
    on("2026-11-30");
    expect((await remindInstalments(ctx())).sent).toBe(0);
    on("2026-12-04");
    expect((await remindInstalments(ctx())).sent).toBe(0);
    expect(await tasksOf(id)).toEqual([]);
  });

  test("a part-paid instalment is reminded of what is outstanding", async () => {
    await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]).then((id) => countPayment(id, 1, 2_000_000));
    await remindInstalments(ctx());
    expect(mails()[0]!.text).toContain("AED 30,000");
  });

  test("a deal not in INSTALMENTS is left alone", async () => {
    await world(ROWS, "REGISTRATION");
    await world(ROWS, "COMPLETED");
    expect((await remindInstalments(ctx())).sent).toBe(0);
    expect(mailer.sent).toEqual([]);
  });

  test("at T+1 an unpaid row also opens one task for the sales officer; finishing it does not bring it back", async () => {
    const id = await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]);
    on("2026-12-03");
    await remindInstalments(ctx());
    expect(await tasksOf(id)).toEqual([]);
    on("2026-12-04");
    await remindInstalments(ctx());
    await remindInstalments(ctx());
    const tasks = await tasksOf(id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "instalment_overdue", role: "sales_officer", status: "open" });
    expect(tasks[0]!.title).not.toMatch(/aml|screening|sanction/i);
    expect(tasks[0]!.detail).toMatchObject({ seq: 1, dueOn: "2026-12-03" });
    await completeTask(ctx(), tasks[0]!.id, users.officer!);
    on("2026-12-05");
    await remindInstalments(ctx());
    expect(await tasksOf(id)).toHaveLength(1);
  });

  test("the deal's pinned policy sets the days; the milestone is named by them", async () => {
    await publishPolicy(
      ctx(),
      { ...DEFAULT_SPA_POLICY, instalmentReminders: { beforeDays: [10], afterDays: [2] } },
      users.admin!,
    );
    const id = await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]);
    expect((await remindInstalments(ctx())).sent).toBe(0); // 14 days before: not a milestone any more
    on("2026-11-23");
    expect((await remindInstalments(ctx())).sent).toBe(1);
    on("2026-12-04"); // 1 day after: still not
    expect((await remindInstalments(ctx())).sent).toBe(0);
    expect(await tasksOf(id)).toEqual([]);
    on("2026-12-05");
    expect((await remindInstalments(ctx())).sent).toBe(1);
    expect((await sentRows(id)).map((x) => x.milestone).toSorted()).toEqual(["T+2", "T-10"]);
    expect((await tasksOf(id)).map((t) => t.kind)).toEqual(["instalment_overdue"]);
  });

  test("a mail that fails is tried again the next run, and the reminder is recorded only when every buyer's mail is sent", async () => {
    const id = await world([{ seq: 1, due: "2026-12-03", amount: 5_000_000 }]);
    mailer.rejectNext = true; // the first buyer's mail bounces
    expect((await remindInstalments(ctx())).sent).toBe(0);
    expect(await sentRows(id)).toEqual([]);
    expect(mailer.sent).toHaveLength(1); // the second buyer's went
    on("2026-11-20");
    expect((await remindInstalments(ctx())).sent).toBe(1);
    expect(mailer.sent).toHaveLength(2); // only the first buyer's was sent again
    expect((await sentRows(id)).map((x) => x.milestone)).toEqual(["T-14"]);
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(2);
  });

  test("without mail configured nothing is sent, nothing is recorded and the job says so", async () => {
    const id = await world();
    await expect(remindInstalments(ctx(false))).rejects.toMatchObject({ code: "mail_unavailable" });
    expect(await sentRows(id)).toEqual([]);
  });

  test("one deal's failure (a missing policy version) is logged and does not stop the others", async () => {
    const one = [{ seq: 1, due: "2026-12-03", amount: 5_000_000 }];
    const bad = await world(one);
    const good = await world(one);
    // The pinned version can't be edited (trigger): lift it for this one corruption.
    await database.pool.query("alter table deals disable trigger user");
    await database.db.update(deals).set({ policyVersion: 999 }).where(eq(deals.id, bad));
    await database.pool.query("alter table deals enable trigger user");
    const quiet = console.error;
    const logged: string[] = [];
    console.error = (m: string) => void logged.push(String(m));
    try {
      expect((await remindInstalments(ctx())).sent).toBe(1);
    } finally {
      console.error = quiet;
    }
    expect(await sentRows(good)).toHaveLength(1);
    expect(await sentRows(bad)).toEqual([]);
    expect(logged.join(" ")).toContain(bad);
  });

  test("the job is named, keyed by Dubai date and runs once at startup after 08:00 Dubai (pg-boss)", async () => {
    expect(INSTALMENT_REMIND_JOB).toBe("spa.instalment.remind");
    expect(instalmentsRemindKey("2026-11-19")).toBe("instalments-remind:2026-11-19");
    const seen: number[] = [];
    clock.set(new Date("2026-11-19T06:00:00Z")); // 10:00 in Dubai
    const jobs = await startJobs(createBoss(url!), clock, { instalmentRemind: async () => void seen.push(1) });
    try {
      for (let i = 0; i < 50 && seen.length === 0; i++) await Bun.sleep(100);
      await Bun.sleep(300);
      expect(seen).toHaveLength(1);
    } finally {
      await jobs.stop();
    }
  });
  test("a restart before 08:00 in Dubai queues no reminder run", async () => {
    const seen: number[] = [];
    clock.set(new Date("2026-11-19T03:00:00Z")); // 07:00 in Dubai
    const jobs = await startJobs(createBoss(url!), clock, { instalmentRemind: async () => void seen.push(1) });
    try {
      await Bun.sleep(1500);
      expect(seen).toEqual([]);
    } finally {
      await jobs.stop();
    }
  });
});
