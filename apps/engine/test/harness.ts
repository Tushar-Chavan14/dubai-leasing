import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEjari, FakeMailer, LocalDiskStore } from "@leasing/adapters";
import type { CopilotModel } from "@leasing/copilot";
import { FakeLlm, type SystemOneResponse } from "@leasing/llm";
import { FixedClock, newId, type StaffRole, type StaffUser } from "@leasing/core";
import { createDatabase, type Database, runMigrations, staffUsers } from "@leasing/db";
import type { EngineContext, JobRequest, Scheduler } from "../src/context.ts";
import { syncRulebooks } from "../src/manager/rulebooks.ts";
import { activeRulesVersion } from "@leasing/rulebook";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
/** Integration suites skip when no test database is configured. */
export const noDb = !TEST_DB_URL;

let shared: Database | undefined;

/** Fresh schema for each test file. Never point TEST_DATABASE_URL at real data: it drops every table. */
export async function freshDatabase(): Promise<Database> {
  if (!TEST_DB_URL) throw new Error("TEST_DATABASE_URL not set");
  if (!/test/.test(new URL(TEST_DB_URL).pathname)) throw new Error("TEST_DATABASE_URL must name a *test* database");
  shared ??= createDatabase(TEST_DB_URL, { max: 5 });
  await shared.pool.query(
    "SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;",
  );
  await runMigrations(shared);
  // Base rulebook row + registry reset, so versions published by one test file don't leak.
  await syncRulebooks(shared);
  return shared;
}

export class FakeScheduler implements Scheduler {
  jobs: JobRequest[] = [];
  async send(_tx: unknown, job: JobRequest): Promise<string> {
    this.jobs.push(job);
    return `job-${this.jobs.length}`;
  }
}

/** Default decision-model answer for tests: agrees with a "renew" reply. */
export const agreeingDecision = (): SystemOneResponse => ({
  model: "tev1:test",
  answers: {
    intent: { type: "choice", choice: "renew", confidence: 0.96, probabilities: { renew: 0.96 } },
    legal_threat: { type: "noul", noul: 0.02 },
    system_instruction: { type: "noul", noul: 0.02 },
    asks_question: { type: "noul", noul: 0.02 },
  },
});

export function testContext(
  database: Database,
  startIso: string,
  opts: { demoMode?: boolean; llm?: FakeLlm; demoRecipient?: string; copilot?: CopilotModel; ejari?: FakeEjari } = {},
) {
  const clock = new FixedClock(new Date(startIso));
  const scheduler = new FakeScheduler();
  const mailer = new FakeMailer(opts.demoRecipient);
  const llm = opts.llm ?? new FakeLlm(agreeingDecision);
  const ejari = opts.ejari ?? new FakeEjari();
  const ctx: EngineContext = {
    database,
    clock,
    scheduler,
    // Same as the engine: the published version in force on the test clock's today.
    get rulesVersion() {
      return activeRulesVersion(clock.today()) ?? "dubai-2025-01";
    },
    demoMode: opts.demoMode ?? true,
    mailer,
    documents: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-docs-"))),
    uploads: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-uploads-"))),
    ejari,
    llm,
    webUrl: "http://portal.test",
    ...(opts.copilot ? { copilot: opts.copilot } : {}),
  };
  return { ctx, clock, scheduler, mailer, llm, ejari };
}

export async function addStaff(database: Database, role: StaffRole): Promise<StaffUser> {
  const user = { id: newId(), email: `${role}-${newId()}@test.example`, name: `Test ${role}`, role };
  await database.db.insert(staffUsers).values(user);
  return user;
}

const HEADER =
  "unit_code,building,community,unit_no,dld_property_no,makani_no,dewa_premise_no,bedrooms,area_sqft,furnished,landlord_name,landlord_email,tenant_name,tenant_email,tenant_phone,tenant_emirates_id,tenant_nationality,start_on,end_on,annual_rent_aed,cheques,deposit_aed,ejari_no";

export function leaseCsv(rows: Partial<Record<string, string>>[]): string {
  const keys = HEADER.split(",");
  const defaults: Record<string, string> = {
    building: "Test Tower",
    community: "Test Community",
    dld_property_no: "T-DLD-1",
    makani_no: "1234512345",
    dewa_premise_no: "T-DEWA-1",
    bedrooms: "1",
    area_sqft: "800",
    furnished: "no",
    landlord_name: "Test Landlord",
    landlord_email: "landlord@test.example",
    tenant_name: "Test Tenant",
    tenant_email: "tenant@test.example",
    tenant_phone: "",
    tenant_emirates_id: "",
    tenant_nationality: "",
    annual_rent_aed: "80000",
    cheques: "4",
    deposit_aed: "4000",
    ejari_no: "T-EJ-1",
  };
  return [
    HEADER,
    ...rows.map((r, i) =>
      keys.map((k) => r[k] ?? defaults[k] ?? (k === "unit_code" ? `U-${i}` : k === "unit_no" ? `${i}` : "")).join(","),
    ),
  ].join("\n");
}

const UNIT_HEADER =
  "unit_code,building,community,unit_no,kind,dld_property_no,makani_no,plot_no,dewa_premise_no,bedrooms,bathrooms,area_sqft,floor,parking_spaces,furnished,asking_rent_aed,description,virtual_tour_url,landlord_name,landlord_email";

/** Units import CSV; values containing commas must be passed already quoted. */
export function unitCsv(rows: Partial<Record<string, string>>[]): string {
  const keys = UNIT_HEADER.split(",");
  const defaults: Record<string, string> = {
    building: "Test Tower",
    community: "Test Community",
    bedrooms: "1",
    furnished: "no",
  };
  return [
    UNIT_HEADER,
    ...rows.map((r, i) => keys.map((k) => r[k] ?? defaults[k] ?? (k === "unit_code" ? `TU-${i}` : "")).join(",")),
  ].join("\n");
}

/**
 * Ticks every move-in checklist item and records a condition photo row per room (no file on
 * disk: the guard only checks the records). For tests that go MOVE_IN → ACTIVE.
 */
export async function completeMoveInChecklist(ctx: EngineContext, leaseId: string): Promise<void> {
  const { withTx, inspections, documents } = await import("@leasing/db");
  const { eq } = await import("drizzle-orm");
  const { ensureMoveInInspection } = await import("../src/manager/move-in.ts");
  await withTx(ctx.database, async (tx) => {
    const insp = await ensureMoveInInspection(ctx, tx, leaseId);
    const items = (insp.items as { id: string; label: string; kind: string; done: boolean }[]).map((i) => ({
      ...i,
      done: true,
      doneBy: "test",
    }));
    await tx.db.update(inspections).set({ items }).where(eq(inspections.id, insp.id));
    for (const room of items.filter((i) => i.kind === "room")) {
      await tx.db.insert(documents).values({
        id: newId(),
        leaseId,
        kind: "condition_photo",
        sha256: `test-${room.label}`,
        path: "test/none.jpg",
        mime: "image/jpeg",
        status: "uploaded",
        room: room.label,
        inspectionId: insp.id,
        uploadedBy: "user:test",
      });
    }
  });
}
