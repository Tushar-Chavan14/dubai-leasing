import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { type Addendum, type ContractFields, newId, type StaffRole, type StaffUser } from "@leasing/core";
import {
  applications,
  approvals,
  contracts,
  type Database,
  leaseEvents,
  leases,
  outboundMessages,
  parties,
  tasks,
  units,
} from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { importLeasesCsv } from "../src/manager/import.ts";
import { describeEntry, nextStepFor, STAGES, stageFor } from "../src/manager/workspace.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, testCompany, testContext } from "./harness.ts";

const START = "2026-11-01T04:00:00Z"; // 08:00 Dubai
const SECRET = "test-secret";

describe("nextStepFor and stageFor (pure)", () => {
  test("one plain sentence per stage, no dashes", () => {
    const copy = STAGES.map((stage) => nextStepFor({ stage }));
    expect(new Set(copy).size).toBe(STAGES.length);
    for (const c of copy) expect(c).not.toMatch(/[–—]/);
  });
  test.each([
    ["Enquiry", "Confirm a viewing time"],
    ["Viewing", "record whether the applicant came"],
    ["Documents", "checking the applicant's documents"],
    ["Offer", "Waiting for the applicant"],
    ["Reserved", "creating the lease"],
    ["Contract", "Approve the final contract"],
    ["Ejari", "Ejari submission"],
    ["Registered", "Nothing to do"],
  ] as const)("%s", (stage, part) => expect(nextStepFor({ stage })).toContain(part));
  test("held offer and held contract prep", () => {
    expect(nextStepFor({ stage: "Offer", offerHeld: true })).toBe("Send the offer to the applicant.");
    expect(nextStepFor({ stage: "Contract", contractHeld: true })).toBe("Prepare the contract.");
    expect(nextStepFor({ stage: "Contract", contractSent: true })).toBe("Waiting for the signers.");
  });
  test("stage mapping", () => {
    expect(stageFor({ kind: "application", state: "SCREENING" })).toBe("Documents");
    expect(stageFor({ kind: "application", state: "CONVERTED" })).toBeNull();
    expect(stageFor({ kind: "lease", state: "CONTRACT" })).toBe("Contract");
    expect(stageFor({ kind: "lease", state: "REGISTRATION" })).toBe("Ejari");
    expect(stageFor({ kind: "lease", state: "MOVE_OUT" })).toBe("Registered");
  });
  test("describeEntry sentences", () => {
    expect(describeEntry({ source: "event", type: "OFFER_MADE", payload: { revision: 1 }, subject: "Agent" })).toBe(
      "Agent drafted offer revision 1, within limits.",
    );
    expect(
      describeEntry({
        source: "approval",
        gate: "final_contract",
        status: "approved",
        subject: "You",
        canDecide: false,
      }),
    ).toBe("You approved the final contract.");
    expect(describeEntry({ source: "email", purpose: "offer", status: "sent" })).toBe("Email sent: offer link.");
    expect(describeEntry({ source: "event", type: "SOMETHING_NEW", payload: {}, subject: "Agent" })).toBe(
      "Something new by Agent.",
    );
  });
});

describe.skipIf(noDb)("workspace API", () => {
  let database: Database;
  let call: (role: StaffRole, path: string, method?: string, body?: unknown) => Promise<Response>;
  let staff: Record<StaffRole, StaffUser>;
  let ids: { enquiry: string; offer: string; screening: string; lease: string; contractLease: string };
  let managerGate: string;

  beforeAll(async () => {
    database = await freshDatabase();
    const t = testContext(database, START);
    const app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
    });
    staff = {} as Record<StaffRole, StaffUser>;
    for (const role of ["leasing_officer", "leasing_manager", "finance", "admin"] as const)
      staff[role] = await addStaff(database, role);
    call = async (role, path, method = "GET", body) =>
      app.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issueToken(SECRET, staff[role].id, Date.now())}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

    const db = database.db;
    const unit = async (code: string) => {
      const id = newId();
      await db.insert(units).values({
        companyId: await testCompany(database),
        id,
        code,
        building: "Demo Circle Residence",
        community: "Jumeirah Village Circle",
        unitNo: code,
        dldPropertyNo: `DEMO-${code}`,
        makaniNo: "2222233333",
        bedrooms: 1,
        furnished: false,
        state: "LISTED",
        askingRentFils: 7_400_000,
      });
      return id;
    };
    const app_ = async (code: string, name: string, state: "ENQUIRY" | "SCREENING" | "OFFER", extra: object = {}) => {
      const partyId = newId();
      await db.insert(parties).values({ id: partyId, kind: "individual", fullNameEn: name });
      const id = newId();
      await db.insert(applications).values({ id, unitId: await unit(code), partyId, state, source: "staff", ...extra });
      return id;
    };
    const viewing = await app_("U-VIEW", "Vera Viewer", "ENQUIRY");
    await db
      .update(applications)
      .set({ state: "VIEWING", viewingAt: new Date("2026-11-01T12:00:00Z") })
      .where(eq(applications.id, viewing));
    const enquiry = await app_("U-ENQ", "Eli Enquirer", "ENQUIRY", { ref: "A-ENQ1" });
    const screening = await app_("U-SCR", "Sam Screening", "SCREENING");
    const offer = await app_("U-OFF", "Olga Offer", "OFFER", { ref: "A-OFF1" });

    const [lr] = await importLeasesCsv(
      t.ctx,
      leaseCsv([
        {
          unit_code: "U-LEASE",
          unit_no: "L1",
          dld_property_no: "T-DLD-L",
          ejari_no: "T-EJ-L",
          start_on: "2026-06-01",
          end_on: "2027-05-31",
          tenant_name: "Tina Tenant",
          tenant_email: "tina@test.example",
        },
      ]),
      "import",
      await testCompany(database),
    );
    const lease = lr!.leaseId!;
    const [cr] = await importLeasesCsv(
      t.ctx,
      leaseCsv([
        {
          unit_code: "U-CONT",
          unit_no: "C1",
          dld_property_no: "T-DLD-C",
          ejari_no: "T-EJ-C",
          start_on: "2026-12-01",
          end_on: "2027-11-30",
          tenant_name: "Cara Contract",
          tenant_email: "cara@test.example",
        },
      ]),
      "import",
      await testCompany(database),
    );
    const contractLease = cr!.leaseId!;
    await db.update(leases).set({ state: "CONTRACT" }).where(eq(leases.id, contractLease));

    // Offer: held (open send_offer task) + events, email, manager approval.
    const at = (iso: string) => new Date(iso);
    await db.insert(leaseEvents).values([
      {
        id: newId(),
        entityKind: "application",
        entityId: offer,
        type: "OFFER_MADE",
        actor: "helper:offer",
        payload: { revision: 1 },
        at: at("2026-11-01T01:00:00Z"),
      },
      {
        id: newId(),
        entityKind: "application",
        entityId: offer,
        type: "OFFER_HELD",
        actor: "system",
        payload: { revision: 1 },
        at: at("2026-11-01T01:01:00Z"),
      },
      {
        id: newId(),
        entityKind: "lease",
        entityId: contractLease,
        type: "CONTRACT_PREPARED",
        actor: "helper:contract",
        at: at("2026-11-01T02:00:00Z"),
      },
      {
        id: newId(),
        entityKind: "lease",
        entityId: contractLease,
        type: "CONTRACT_SENT",
        actor: `user:${staff.leasing_officer.id}`,
        at: at("2026-11-01T02:30:00Z"),
      },
    ]);
    await db.insert(tasks).values({
      id: newId(),
      entityKind: "application",
      entityId: offer,
      kind: "send_offer",
      title: "Send offer revision 1 (A-OFF1)",
      assigneeRole: "leasing_officer",
      dedupeKey: `${offer}:send`,
      createdBy: "system",
      createdAt: at("2026-11-01T01:01:00Z"),
    });
    await db.insert(outboundMessages).values({
      id: newId(),
      entityKind: "application",
      entityId: offer,
      purpose: "offer",
      milestone: "r1",
      to: "o@test.example",
      intendedTo: "o@test.example",
      template: "offer",
      subject: "Offer",
      status: "sent",
      sentAt: at("2026-11-01T01:30:00Z"),
      createdAt: at("2026-11-01T01:30:00Z"),
    });
    managerGate = newId();
    await db.insert(approvals).values({
      id: managerGate,
      gate: "offer_out_of_limits",
      entityKind: "application",
      entityId: offer,
      dedupeKey: `${offer}:gate`,
      title: "Offer out of limits",
      proposal: {},
      approverRole: "leasing_manager",
      proposedBy: "helper:offer",
      createdAt: at("2026-11-01T01:02:00Z"),
    });
    await db.insert(approvals).values({
      id: newId(),
      gate: "final_contract",
      entityKind: "lease",
      entityId: contractLease,
      dedupeKey: `${contractLease}:fc`,
      title: "Final contract",
      proposal: {},
      approverRole: "leasing_officer",
      proposedBy: "helper:contract",
      createdAt: at("2026-11-01T02:01:00Z"),
    });
    const contract = (leaseId: string, status: "sent" | "signed") => ({
      id: newId(),
      leaseId,
      version: 1,
      status,
      fields: {} as ContractFields,
      sources: {},
      addendum: {} as Addendum,
      inputHash: "h",
      sha256: "s",
      createdBy: "helper:contract",
      createdAt: at("2026-11-01T02:00:00Z"),
    });
    // Counted: sent, lease in CONTRACT. Not counted: the lease is already ACTIVE (and signed).
    await db.insert(contracts).values([contract(contractLease, "sent"), contract(lease, "signed")]);
    // Stray open tasks that no record row owns: a unit, and a converted application with no lease row.
    const strayUnit = await unit("U-STRAY");
    const converted = await app_("U-CONV", "Connie Converted", "ENQUIRY");
    await db.update(applications).set({ state: "CONVERTED" }).where(eq(applications.id, converted));
    await db.insert(tasks).values(
      [
        ["unit", strayUnit],
        ["application", converted],
      ].map(([kind, entityId]) => ({
        id: newId(),
        entityKind: kind as "unit" | "application",
        entityId: entityId!,
        kind: "staff_task",
        title: "Stray task",
        assigneeRole: "leasing_officer" as const,
        dedupeKey: `${entityId}:stray`,
        createdBy: "system",
        createdAt: at("2026-11-01T03:00:00Z"),
      })),
    );
    ids = { enquiry, offer, screening, lease, contractLease };
  });

  const json = async <T>(r: Response) => (await r.json()) as T;
  type Row = {
    kind: string;
    id: string;
    stage: string;
    nextStep: string;
    waitingForMe: boolean;
    waitingOnReply: boolean;
    title: string;
    unitCode: string;
  };

  test("records list is grouped by stage and a lease replaces its application", async () => {
    const rows = await json<Row[]>(await call("leasing_officer", "/api/records"));
    const byStage = (s: string) => rows.filter((r) => r.stage === s).map((r) => r.title);
    expect(byStage("Enquiry")).toContain("Eli Enquirer");
    expect(byStage("Viewing")).toEqual(["Vera Viewer"]);
    expect(byStage("Documents")).toEqual(["Sam Screening"]);
    expect(byStage("Offer")).toEqual(["Olga Offer"]);
    expect(byStage("Contract")).toEqual(["Cara Contract"]);
    expect(byStage("Registered")).toEqual(["Tina Tenant"]);
    const offer = rows.find((r) => r.id === ids.offer)!;
    expect(offer.nextStep).toBe("Send the offer to the applicant.");
    expect(offer.waitingForMe).toBe(true);
    expect(rows.find((r) => r.id === ids.screening)!.waitingForMe).toBe(false);
    // `copilot_proactive_drafts` shows "Draft a reply" only where an applicant has to answer next.
    expect(rows.find((r) => r.id === ids.screening)!.waitingOnReply).toBe(true);
    expect(offer.waitingOnReply).toBe(false); // held: a person sends it first
    expect(rows.filter((r) => r.stage === "Enquiry").every((r) => !r.waitingOnReply)).toBe(true);
    // filters
    expect((await json<Row[]>(await call("leasing_officer", "/api/records?stage=Offer"))).length).toBe(1);
    expect((await json<Row[]>(await call("leasing_officer", "/api/records?q=u-scr"))).map((r) => r.id)).toEqual([
      ids.screening,
    ]);
    const mine = await json<Row[]>(await call("leasing_officer", "/api/records?mine=1"));
    expect(mine.every((r) => r.waitingForMe)).toBe(true);
    expect(mine.map((r) => r.id)).toContain(ids.contractLease);
  });

  test("a converted application is not listed again", async () => {
    await database.db.update(applications).set({ state: "CONVERTED" }).where(eq(applications.id, ids.enquiry));
    const rows = await json<Row[]>(await call("leasing_officer", "/api/records"));
    expect(rows.find((r) => r.id === ids.enquiry)).toBeUndefined();
    await database.db.update(applications).set({ state: "ENQUIRY" }).where(eq(applications.id, ids.enquiry));
  });

  test("a converted application's own ref finds its lease (get_record on A-… refs)", async () => {
    const { db } = database;
    await db.update(applications).set({ state: "CONVERTED" }).where(eq(applications.id, ids.enquiry));
    await db.update(leases).set({ applicationId: ids.enquiry }).where(eq(leases.id, ids.contractLease));
    const rows = await json<Row[]>(await call("leasing_officer", "/api/records?q=a-enq1"));
    expect(rows.map((r) => r.id)).toEqual([ids.contractLease]);
    const copilot = await json<{ total: number; rows: Row[] }>(
      await call("leasing_officer", "/api/copilot/records?q=A-ENQ1&limit=20"),
    );
    expect(copilot.rows.map((r) => r.id)).toEqual([ids.contractLease]);
    await db.update(leases).set({ applicationId: null }).where(eq(leases.id, ids.contractLease));
    await db.update(applications).set({ state: "ENQUIRY" }).where(eq(applications.id, ids.enquiry));
  });

  type Entry = {
    at: string;
    source: string;
    text: string;
    pending: boolean;
    actions: string[];
    actor: { kind: string; name: string };
  };
  test("log merges four sources, pending first, newest first after", async () => {
    const log = await json<Entry[]>(await call("leasing_manager", `/api/records/application/${ids.offer}/log`));
    expect(new Set(log.map((e) => e.source))).toEqual(new Set(["event", "approval", "email", "task"]));
    const firstDone = log.findIndex((e) => !e.pending);
    expect(log.slice(0, firstDone).every((e) => e.pending)).toBe(true);
    expect(log.slice(0, firstDone).length).toBe(2);
    const rest = log.slice(firstDone).map((e) => e.at);
    expect(rest).toEqual([...rest].sort().reverse());
    const task = log.find((e) => e.source === "task")!;
    // "Mark done" is not offered for a task that has its own action.
    expect(task.actions).toEqual(["send_offer"]);
    expect(log.some((e) => e.text === "Agent drafted offer revision 1, within limits.")).toBe(true);
    expect(log.some((e) => e.text === "Email sent: offer link.")).toBe(true);
    expect(log.find((e) => e.source === "approval")!.actions).toEqual(["approve", "reject", "edit"]);
  });

  test("an officer cannot approve a manager gate, in the log or on the route", async () => {
    const log = await json<Entry[]>(await call("leasing_officer", `/api/records/application/${ids.offer}/log`));
    const gate = log.find((e) => e.source === "approval")!;
    expect(gate.actions).toEqual([]);
    expect(gate.pending).toBe(false);
    const r = await call("leasing_officer", `/api/approvals/${managerGate}/decide`, "POST", { decision: "approve" });
    expect(r.status).toBe(403);
  });

  test("lease log covers contract events and the contract approval", async () => {
    const log = await json<Entry[]>(await call("leasing_officer", `/api/records/lease/${ids.contractLease}/log`));
    expect(log[0]!.pending).toBe(true);
    expect(log[0]!.text).toBe("Your approval is needed for the final contract.");
    expect(log.some((e) => e.text === "You sent the contract for signing.")).toBe(true);
    expect((await call("leasing_officer", `/api/records/lease/${newId()}/log`)).status).toBe(404);
  });

  test("home counts", async () => {
    const h = await json<{
      viewingsToday: number;
      offersOut: number;
      awaitingSignature: number;
      ejariPending: number;
      waitingForYou: number;
      agentToday: Entry[];
    }>(await call("leasing_officer", "/api/home"));
    expect(h.viewingsToday).toBe(1); // 12:00Z = 16:00 Dubai on 2026-11-01
    expect(h.offersOut).toBe(0); // the only offer is held
    expect(h.ejariPending).toBe(0);
    expect(h.waitingForYou).toBe(2); // final contract approval + send_offer task
    expect(h.awaitingSignature).toBe(1);
    expect(h.agentToday.length).toBeLessThanOrEqual(8);
    expect(h.agentToday.every((e) => !e.pending)).toBe(true);
    const mgr = await json<{ waitingForYou: number }>(await call("leasing_manager", "/api/home"));
    expect(mgr.waitingForYou).toBeGreaterThan(h.waitingForYou); // adds the manager-only gate
    const fin = await json<{ waitingForYou: number }>(await call("finance", "/api/home"));
    expect(fin.waitingForYou).toBeLessThan(h.waitingForYou); // no gate or officer task is theirs
  });

  test("home waitingForYou equals the pending items across the mine=1 rows", async () => {
    for (const role of ["leasing_officer", "leasing_manager", "finance"] as const) {
      const mine = await json<Row[]>(await call(role, "/api/records?mine=1"));
      let items = 0;
      for (const r of mine) {
        const log = await json<Entry[]>(await call(role, `/api/records/${r.kind}/${r.id}/log`));
        items += log.filter((e) => e.pending).length;
      }
      const home = await json<{ waitingForYou: number }>(await call(role, "/api/home"));
      expect(home.waitingForYou).toBe(items);
    }
    // The stray unit and converted-application tasks are not counted for the officer.
    const officer = await json<{ waitingForYou: number }>(await call("leasing_officer", "/api/home"));
    expect(officer.waitingForYou).toBe(2);
  });

  test("log punctuation and edit only on editable gates", async () => {
    expect(describeEntry({ source: "task", title: "Chase the landlord!", status: "open" })).toBe(
      "To do: Chase the landlord.",
    );
    const log = await json<Entry[]>(await call("leasing_manager", `/api/records/application/${ids.offer}/log`));
    // offer_out_of_limits allows editing the note only; final_contract has no editable fields.
    expect(log.find((e) => e.source === "approval")!.actions).toContain("edit");
    const fc = await json<Entry[]>(await call("leasing_officer", `/api/records/lease/${ids.contractLease}/log`));
    expect(fc.find((e) => e.source === "approval")!.actions).toEqual(["approve", "reject"]);
  });

  test("a passed viewing waits for its outcome (leasing roles only); a future one does not", async () => {
    const [v] = await database.db.select().from(applications).where(eq(applications.state, "VIEWING"));
    const logFor = async (role: StaffRole) =>
      (await (await call(role, `/api/records/application/${v!.id}/log`)).json()) as {
        actions: string[];
        refId: string;
      }[];
    const has = (rows: { actions: string[] }[]) => rows.some((e) => e.actions.includes("record_viewing_outcome"));
    expect(has(await logFor("leasing_officer"))).toBe(false);
    const original = v!.viewingAt;
    await database.db
      .update(applications)
      .set({ viewingAt: new Date("2026-10-31T12:00:00Z") })
      .where(eq(applications.id, v!.id));
    try {
      const officer = await logFor("leasing_officer");
      expect(has(officer)).toBe(true);
      expect(officer.find((e) => e.actions.includes("record_viewing_outcome"))!.refId).toBe(v!.id);
      expect(has(await logFor("leasing_manager"))).toBe(true);
      expect(has(await logFor("finance"))).toBe(false);
    } finally {
      await database.db.update(applications).set({ viewingAt: original }).where(eq(applications.id, v!.id));
    }
  });

  test("saved views CRUD, per user", async () => {
    const mk = await call("leasing_officer", "/api/views", "POST", {
      name: "Offers",
      filter: { stage: "Offer", mine: true },
    });
    expect(mk.status).toBe(201);
    const view = await json<{ id: string }>(mk);
    expect((await call("leasing_officer", "/api/views", "POST", { name: "Offers", filter: {} })).status).toBe(409);
    expect((await call("leasing_officer", "/api/views", "POST", { name: "", filter: {} })).status).toBe(400);
    expect(
      (await call("leasing_officer", "/api/views", "POST", { name: "Bad", filter: { stage: "Nope" } })).status,
    ).toBe(400);
    expect((await json<unknown[]>(await call("leasing_officer", "/api/views"))).length).toBe(1);
    expect((await json<unknown[]>(await call("leasing_manager", "/api/views"))).length).toBe(0);
    const viaView = await json<Row[]>(await call("leasing_officer", `/api/records?view=${view.id}`));
    expect(viaView.map((r) => r.stage)).toEqual(["Offer"]);
    expect((await call("leasing_manager", `/api/views/${view.id}`, "DELETE")).status).toBe(404);
    expect((await call("leasing_manager", `/api/records?view=${view.id}`)).status).toBe(404);
    expect((await call("leasing_officer", `/api/views/${view.id}`, "DELETE")).status).toBe(200);
    expect((await call("leasing_officer", `/api/views/${view.id}`, "DELETE")).status).toBe(404);
  });

  test("change markers: move after an appended event, for the record pair and the list; auth like other reads", async () => {
    const ver = async (path: string, role: StaffRole = "finance") =>
      (await json<{ version: string }>(await call(role, path))).version;
    const appPath = `/api/records/application/${ids.offer}/version`;
    const list0 = await ver("/api/records/version");
    const app0 = await ver(appPath);
    expect(await ver(appPath, "leasing_officer")).toBe(app0);
    const other0 = await ver(`/api/records/lease/${ids.contractLease}/version`);
    const append = (kind: "application" | "lease", entityId: string) =>
      database.db.insert(leaseEvents).values({
        id: newId(),
        entityKind: kind,
        entityId,
        type: "NOTE",
        actor: "system",
        payload: {},
        at: new Date("2026-11-01T05:00:00Z"),
      });
    await append("application", ids.offer);
    const app1 = await ver(appPath);
    expect(app1).not.toBe(app0);
    expect(await ver("/api/records/version")).not.toBe(list0);
    // Another record's marker is untouched.
    expect(await ver(`/api/records/lease/${ids.contractLease}/version`)).toBe(other0);
    // An event on the lease made from an application moves the application's marker too (one record).
    const [l] = await database.db.select().from(leases).where(eq(leases.id, ids.contractLease));
    if (l?.applicationId) {
      const before = await ver(`/api/records/application/${l.applicationId}/version`);
      await append("lease", ids.contractLease);
      expect(await ver(`/api/records/application/${l.applicationId}/version`)).not.toBe(before);
    }
    await append("lease", ids.contractLease);
    expect(await ver(`/api/records/lease/${ids.contractLease}/version`)).not.toBe(other0);
    // Unknown or malformed records are 404; no token is 401.
    expect((await call("finance", `/api/records/lease/${newId()}/version`)).status).toBe(404);
    expect((await call("finance", "/api/records/nope/x/version")).status).toBe(404);
  });
});
