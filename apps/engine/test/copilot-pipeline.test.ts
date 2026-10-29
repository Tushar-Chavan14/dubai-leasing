import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { copilotTools, inProcessClient } from "@leasing/copilot";
import type { StaffRole, StaffUser } from "@leasing/core";
import { staffUsers } from "@leasing/db";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { seedDemo } from "../src/demo/seed.ts";
import { freshDatabase, noDb, testContext } from "./harness.ts";

const SECRET = "test-secret";
const ROLES: StaffRole[] = ["leasing_officer", "leasing_manager", "finance", "admin"];
const STAGES = ["Enquiry", "Viewing", "Documents", "Offer", "Reserved", "Contract", "Ejari", "Registered"];

describe.skipIf(noDb)("copilot pipeline reads (demo seed)", () => {
  let app: ReturnType<typeof createApi>;
  let staff: Record<string, StaffUser>;
  let today: string;
  const as = (role: StaffRole | null, path: string) =>
    app.request(path, {
      headers: role ? { authorization: `Bearer ${issueToken(SECRET, staff[role]!.id, Date.now())}` } : {},
    });
  const json = async <T>(role: StaffRole, path: string) => (await (await as(role, path)).json()) as T;

  beforeAll(async () => {
    const database = await freshDatabase();
    const quiet = console.log;
    console.log = () => {};
    await seedDemo(database);
    console.log = quiet;
    const t = testContext(database, "2026-11-01T04:00:00Z");
    today = t.ctx.clock.today();
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
    });
    const rows = await database.db.select().from(staffUsers);
    staff = {};
    for (const r of rows) staff[r.role] ??= { id: r.id, email: r.email, name: r.name, role: r.role } as StaffUser;
  });

  test("every new route needs a session and answers every staff role", async () => {
    const paths = [
      "/api/copilot/pipeline",
      "/api/copilot/companies",
      "/api/copilot/records?stage=Offer&limit=5",
      "/api/copilot/contract-status?ref=MRN-1204",
    ];
    for (const p of paths) expect([p, (await as(null, p)).status]).toEqual([p, 401]);
    for (const role of ROLES)
      for (const p of paths) expect([role, p, (await as(role, p)).status]).toEqual([role, p, 200]);
  });

  test("pipeline_summary equals the Home tiles and the Workspace stage counts", async () => {
    for (const role of ROLES) {
      const sum = await json<{
        stages: Record<string, number>;
        offer: { sent: number; held: number };
        contract: { awaitingSignature: number; other: number };
        viewingsToday: number;
        waitingForYou: number;
        total: number;
      }>(role, "/api/copilot/pipeline");
      const home = await json<{
        viewingsToday: number;
        offersOut: number;
        awaitingSignature: number;
        ejariPending: number;
        waitingForYou: number;
      }>(role, "/api/home");
      const records = await json<{ stage: string }[]>(role, "/api/records");
      expect(sum.viewingsToday).toBe(home.viewingsToday);
      expect(sum.offer.sent).toBe(home.offersOut);
      expect(sum.contract.awaitingSignature).toBe(home.awaitingSignature);
      expect(sum.stages.Ejari!).toBe(home.ejariPending);
      expect(sum.waitingForYou).toBe(home.waitingForYou);
      expect(sum.total).toBe(records.length);
      for (const st of STAGES)
        expect([role, st, sum.stages[st]]).toEqual([role, st, records.filter((r) => r.stage === st).length]);
      expect(sum.offer.sent + sum.offer.held).toBe(sum.stages.Offer!);
      expect(sum.contract.awaitingSignature + sum.contract.other).toBe(sum.stages.Contract!);
    }
    // The tool returns the same numbers.
    const tool = copilotTools.find((t) => t.name === "pipeline_summary")!;
    const engine = inProcessClient(app, issueToken(SECRET, staff.leasing_officer!.id, Date.now()));
    const out = (await tool.run({}, { engine, user: staff.leasing_officer!, today })) as {
      stages: { stage: string; count: number }[];
    };
    const sum = await json<{ stages: Record<string, number> }>("leasing_officer", "/api/copilot/pipeline");
    expect(out.stages).toEqual(STAGES.map((stage) => ({ stage, count: sum.stages[stage]! })));
  });

  test("records: stage, company, limit and id filters; a count that ignores the limit", async () => {
    const all = await json<{ total: number; rows: { id: string; kind: string; ref: string; stage: string }[] }>(
      "leasing_manager",
      "/api/copilot/records?limit=20",
    );
    const web = await json<{ id: string; stage: string }[]>("leasing_manager", "/api/records");
    expect(all.total).toBe(web.length);
    const one = await json<{ total: number; rows: unknown[] }>("leasing_manager", "/api/copilot/records?limit=1");
    expect(one.rows).toHaveLength(1);
    expect(one.total).toBe(web.length);
    const stage = await json<{ total: number; rows: { stage: string }[] }>(
      "leasing_manager",
      "/api/copilot/records?stage=Viewing",
    );
    expect(stage.total).toBe(web.filter((r) => r.stage === "Viewing").length);
    expect(stage.rows.every((r) => r.stage === "Viewing")).toBe(true);
    const silver = await json<{ total: number }>("leasing_manager", "/api/copilot/records?company=silverline");
    const noor = await json<{ total: number }>("leasing_manager", "/api/copilot/records?company=Al%20Noor");
    expect(silver.total).toBeGreaterThan(0);
    expect(silver.total + noor.total).toBeLessThanOrEqual(all.total);
    expect((await as("finance", "/api/copilot/records?company=nonexistentco")).status).toBe(404);
    const byId = await json<{ rows: { id: string }[] }>(
      "leasing_manager",
      `/api/copilot/records?id=${all.rows[0]!.id}`,
    );
    expect(byId.rows.map((r) => r.id)).toEqual([all.rows[0]!.id]);
  });

  test("get_record and contract_status read a record and its contract", async () => {
    const user = staff.leasing_officer!;
    const engine = inProcessClient(app, issueToken(SECRET, user.id, Date.now()));
    const rows = await json<{ rows: { ref: string; kind: string; stage: string; id: string }[] }>(
      "leasing_officer",
      "/api/copilot/records?limit=20",
    );
    const getRecord = copilotTools.find((t) => t.name === "get_record")!;
    const status = copilotTools.find((t) => t.name === "contract_status")!;
    const row = rows.rows[0]!;
    const rec = (await getRecord.run({ ref: row.ref }, { engine, user, today })) as {
      record: { stage: string };
      recent: unknown[];
      ui: { cards: { href: string }[] };
    };
    expect(rec.record.stage).toBe(row.stage);
    expect(rec.recent.length).toBeLessThanOrEqual(10);
    expect(rec.ui.cards[0]!.href).toBe(`/work?kind=${row.kind}&id=${row.id}`);
    const byId = (await getRecord.run({ kind: row.kind, id: row.id }, { engine, user, today })) as {
      record: { stage: string };
    };
    expect(byId.record.stage).toBe(row.stage);
    expect(await getRecord.run({ ref: "ZZ-NOPE" }, { engine, user, today })).toMatchObject({ found: false });
    // Every record answers contract_status (an application says there is no contract yet).
    for (const r of rows.rows.slice(0, 6)) {
      const out = (await status.run({ ref: r.ref }, { engine, user, today })) as {
        contract: unknown;
        note: string | null;
        signers: unknown[];
      };
      expect(out.contract !== null || out.note !== null).toBe(true);
    }
    const lease = rows.rows.find((r) => r.stage === "Contract" || r.stage === "Ejari");
    if (lease) {
      const out = (await status.run({ ref: lease.ref }, { engine, user, today })) as {
        contract: { version: number; status: string } | null;
        leaseState: string;
      };
      expect(out.leaseState).toBeTruthy();
    }
  });

  test("companies with their listed units; available units filter by company and category, with cards", async () => {
    const companies = await json<{ name: string; kind: string; listedUnits: number }[]>(
      "finance",
      "/api/copilot/companies",
    );
    const silver = companies.find((c) => c.name.startsWith("Silverline"))!;
    expect(silver.listedUnits).toBeGreaterThan(0);
    const units = await json<
      { code: string; company: string; category: string; card: { unitId: string; rent: string } | null }[]
    >("finance", "/api/available-units?company=Silverline&category=all");
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((u) => u.company === silver.name && u.card !== null)).toBe(true);
    const comm = await json<{ category: string }[]>("finance", "/api/available-units?category=commercial");
    expect(comm.every((u) => u.category === "commercial")).toBe(true);
    const small = await json<{ category: string }[]>("finance", "/api/available-units?sizeBand=small");
    expect(small.every((u) => u.category === "commercial")).toBe(true);
    expect((await as("finance", "/api/available-units?company=nonexistentco")).status).toBe(404);
    const residential = await json<{ category: string }[]>("finance", "/api/available-units");
    expect(residential.every((u) => u.category === "residential")).toBe(true);
  });
});
