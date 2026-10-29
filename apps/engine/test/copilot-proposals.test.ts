import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { inProcessClient, type ModelTurn, ScriptedModel, toolsFor } from "@leasing/copilot";
import { newId, type StaffUser } from "@leasing/core";
import {
  applications,
  copilotMessages,
  copilotProposals,
  copilotThreads,
  type Database,
  leaseEvents,
  parties,
  units,
} from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { APPLICATION_MAIL_JOB, createApplication } from "../src/manager/applications.ts";
import { addStaff, freshDatabase, noDb, testContext, testCompany } from "./harness.ts";

const START = "2026-11-02T04:00:00Z"; // Monday 08:00 Dubai → first free slot 12:00
const SLOT = "2026-11-02T12:00:00+04:00";
const SECRET = "test-secret";
let database: Database;

const call = (name: string, args: Record<string, unknown>): ModelTurn => ({
  content: "",
  toolCalls: [{ id: `c-${name}`, name, args }],
});
const say = (content: string): ModelTurn => ({ content, toolCalls: [] });

async function setup(script?: ModelTurn[]) {
  const model = script ? new ScriptedModel(script.map((turn) => () => turn)) : undefined;
  const t = testContext(database, START, model ? { copilot: model } : {});
  const landlordId = newId();
  await database.db.insert(parties).values({ id: landlordId, kind: "company", fullNameEn: "Fictional Holdings LLC" });
  const unitId = newId();
  await database.db.insert(units).values({
    companyId: await testCompany(database),
    id: unitId,
    code: "JVC-0412",
    building: "Demo Circle Residence",
    community: "Jumeirah Village Circle",
    bedrooms: 1,
    areaSqft: 812,
    furnished: false,
    state: "LISTED",
    askingRentFils: 7_400_000, // inside the 1-bed range: no price approval needed
    landlordPartyId: landlordId,
  });
  const officer = await addStaff(database, "leasing_officer");
  const otherOfficer = await addStaff(database, "leasing_officer");
  const manager = await addStaff(database, "leasing_manager");
  const finance = await addStaff(database, "finance");
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const as = (
    user: { id: string },
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  /** A thread whose user message names the applicant (proposals need that, D25). */
  const thread = async (
    user: StaffUser,
    said = "Book JVC-0412 for Priya Example, priya@example.com; also walkin@example.com Walk In",
  ) => {
    const id = newId();
    await database.db.insert(copilotThreads).values({ id, userId: user.id, title: "t", createdAt: t.clock.now() });
    await database.db
      .insert(copilotMessages)
      .values({ id: newId(), threadId: id, role: "user", content: said, at: t.clock.now() });
    return id;
  };
  const propose = async (user: StaffUser, threadId: string, over: Record<string, unknown> = {}) =>
    as(
      user,
      "/api/copilot/proposals",
      "POST",
      { unitCode: "JVC-0412", nameEn: "Priya Example", email: "priya@example.com", viewingAt: SLOT, ...over },
      { "x-copilot-thread": threadId },
    );
  const proposeOk = async (user: StaffUser = officer) => {
    const r = await propose(user, await thread(user));
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string; status: string };
  };
  return { ...t, unitId, officer, otherOfficer, manager, finance, app, as, thread, propose, proposeOk, model };
}

const ndjson = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe.skipIf(noDb)("copilot proposes, the user confirms (D25)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("end to end: the copilot finds the unit and proposes; nothing exists until Confirm; Confirm creates it once", async () => {
    const s = await setup([
      call("find_available_units", { bedrooms: 1 }),
      call("propose_application", {
        unitCode: "JVC-0412",
        applicantName: "Priya Example",
        email: "priya@example.com",
        viewingAt: SLOT,
      }),
      say("I've prepared the application. Please review the card and click Confirm."),
    ]);
    const res = await s.as(s.officer, "/api/copilot/chat", "POST", {
      message: "Book a viewing of a 1-bed for Priya Example, priya@example.com, first free slot",
    });
    const events = await ndjson(res);
    const found = s.model!.calls[1]!.messages.at(-1)!.content as string;
    // What the propose tool gave back to the model: no applicant name or email.
    const proposed = s.model!.calls[2]!.messages.at(-1)!.content as string;
    expect(proposed).toContain("JVC-0412");
    expect(proposed).not.toContain("priya@example.com");
    expect(proposed).not.toContain("Priya");
    expect(found).toContain("JVC-0412");
    expect(found).toContain("AED 74,000.00");
    expect(found).toContain(SLOT);
    const proposal = events.find((e) => e.type === "proposal")!.proposal as {
      id: string;
      status: string;
      summary: object;
    };
    expect(proposal).toMatchObject({
      status: "pending",
      summary: { unitCode: "JVC-0412", applicant: "Priya Example", email: "priya@example.com" },
    });
    // Proposing created nothing and queued no email.
    expect(await database.db.select().from(applications)).toHaveLength(0);
    expect(s.scheduler.jobs.filter((j) => j.name === APPLICATION_MAIL_JOB)).toHaveLength(0);

    const ok = await s.as(s.officer, `/api/copilot/proposals/${proposal.id}/confirm`, "POST");
    expect(ok.status).toBe(200);
    const confirmed = (await ok.json()) as { status: string; result: { applicationId: string; ref: string } };
    expect(confirmed.status).toBe("confirmed");
    const [app] = await database.db.select().from(applications);
    expect(app).toMatchObject({ id: confirmed.result.applicationId, state: "VIEWING", source: "copilot" });
    expect(app!.viewingAt!.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(s.scheduler.jobs.filter((j) => j.name === APPLICATION_MAIL_JOB)).toHaveLength(1);
    const evs = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, app!.id));
    expect(evs.find((e) => e.type === "APPLICATION_CREATED")).toMatchObject({
      actor: `copilot:${s.officer.id}`,
      payload: { source: "copilot" },
    });
    expect(evs.find((e) => e.type === "COPILOT_PROPOSAL_CONFIRMED")).toMatchObject({
      actor: `user:${s.officer.id}`,
      payload: { proposalId: proposal.id },
    });
    // Single use.
    expect((await s.as(s.officer, `/api/copilot/proposals/${proposal.id}/confirm`, "POST")).status).toBe(409);
    expect(await database.db.select().from(applications)).toHaveLength(1);
    // The thread shows the proposal's final state.
    const threadId = events.find((e) => e.type === "thread")!.threadId as string;
    const thread = (await (await s.as(s.officer, `/api/copilot/threads/${threadId}`)).json()) as {
      proposals: { status: string }[];
    };
    expect(thread.proposals).toEqual([expect.objectContaining({ status: "confirmed" })]);
  });

  test("only leasing officers and managers get the propose tool; the route refuses everyone else", async () => {
    const s = await setup();
    expect(toolsFor("leasing_officer", { tenancyOps: true }).map((t) => t.name)).toContain("propose_application");
    expect(toolsFor("leasing_manager", { tenancyOps: true }).map((t) => t.name)).toContain("propose_application");
    expect(toolsFor("finance", { tenancyOps: true }).map((t) => t.name)).not.toContain("propose_application");
    expect(toolsFor("admin", { tenancyOps: true }).map((t) => t.name)).not.toContain("propose_application");
    expect(toolsFor("finance", { tenancyOps: true }).map((t) => t.name)).toContain("find_available_units");
    expect((await s.propose(s.finance, await s.thread(s.finance))).status).toBe(403);
    expect((await s.propose(s.manager, await s.thread(s.manager))).status).toBe(201);
  });

  test("a proposal needs the user's own copilot thread", async () => {
    const s = await setup();
    const noThread = await s.as(s.officer, "/api/copilot/proposals", "POST", { unitCode: "JVC-0412" });
    expect(noThread.status).toBe(400);
    expect((await s.propose(s.officer, await s.thread(s.otherOfficer))).status).toBe(404);
  });

  test("only the user who proposed it can confirm or cancel it", async () => {
    const s = await setup();
    const p = await s.proposeOk(s.officer);
    for (const other of [s.otherOfficer, s.manager, s.finance]) {
      expect((await s.as(other, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(404);
      expect((await s.as(other, `/api/copilot/proposals/${p.id}/cancel`, "POST")).status).toBe(404);
    }
    expect(await database.db.select().from(applications)).toHaveLength(0);
  });

  test("validation when proposing: unit not bookable, past time, clash, bad email, already applied", async () => {
    const s = await setup();
    const t = await s.thread(s.officer);
    expect((await s.propose(s.officer, t, { unitCode: "NOPE-1" })).status).toBe(422);
    expect((await s.propose(s.officer, t, { viewingAt: "2026-11-01T10:00:00+04:00" })).status).toBe(422);
    expect((await s.propose(s.officer, t, { email: "not-an-email" })).status).toBe(400);
    await createApplication(
      s.ctx,
      {
        unitId: s.unitId,
        nameEn: "Walk In",
        email: "walkin@example.com",
        kind: "individual",
        viewingAt: new Date(SLOT),
      },
      `user:${s.officer.id}`,
    );
    const clash = await s.propose(s.officer, t, { viewingAt: "2026-11-02T12:15:00+04:00" });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { code: string }).code).toBe("viewing_slot_taken");
    const again = await s.propose(s.officer, t, {
      email: "walkin@example.com",
      viewingAt: "2026-11-02T14:00:00+04:00",
    });
    expect(((await again.json()) as { code: string }).code).toBe("already_applied");
    await database.db.update(units).set({ state: "PREP" }).where(eq(units.id, s.unitId));
    expect((await s.propose(s.officer, t, { viewingAt: "2026-11-02T15:00:00+04:00" })).status).toBe(422);
  });

  test("the applicant must be someone the user typed: not from tenant text or tool results", async () => {
    const s = await setup();
    const t = await s.thread(s.officer, "What does the tenant want on JVC-0310?");
    const r = await s.propose(s.officer, t, { nameEn: "Fake Person", email: "fake.person@example.com" });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe("applicant_not_from_user");
    const t2 = await s.thread(s.officer, "Book it for Priya, email priya@example.com");
    // A name with a word the user never typed is refused too.
    expect((await s.propose(s.officer, t2, { nameEn: "Priya Smith" })).status).toBe(422);
    expect((await s.propose(s.officer, t2, { nameEn: "Priya" })).status).toBe(201);
  });

  test("the unit code is matched exactly (ignoring case), never as a pattern", async () => {
    const s = await setup();
    const t = await s.thread(s.officer);
    for (const code of ["%%", "JVC_0412", "JVC%"]) {
      expect([code, (await s.propose(s.officer, t, { unitCode: code })).status]).toEqual([code, 422]);
    }
    expect((await s.propose(s.officer, t, { unitCode: "jvc-0412" })).status).toBe(201);
  });

  test("the unit stops being bookable before Confirm: failed, nothing created", async () => {
    const s = await setup();
    const p = await s.proposeOk();
    await database.db.update(units).set({ state: "PREP" }).where(eq(units.id, s.unitId));
    const r = await s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST");
    expect(((await r.json()) as { code: string }).code).toBe("unit_not_bookable");
    const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.id));
    expect(row!.status).toBe("failed");
    expect(await database.db.select().from(applications)).toHaveLength(0);
  });

  test("the viewing time passes before Confirm: failed", async () => {
    const s = await setup();
    const r0 = await s.propose(s.officer, await s.thread(s.officer), { viewingAt: "2026-11-02T08:20:00+04:00" });
    const p = (await r0.json()) as { id: string };
    s.clock.set(new Date(s.clock.now().getTime() + 25 * 60_000));
    const r = await s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST");
    expect(((await r.json()) as { code: string }).code).toBe("viewing_in_past");
    const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.id));
    expect(row!.status).toBe("failed");
  });

  test("two proposals for the same person and unit, confirmed at once: one application", async () => {
    const s = await setup();
    const a = await s.proposeOk();
    const b = (await (
      await s.propose(s.officer, await s.thread(s.officer), { viewingAt: "2026-11-02T15:00:00+04:00" })
    ).json()) as { id: string };
    const [ra, rb] = await Promise.all([
      s.as(s.officer, `/api/copilot/proposals/${a.id}/confirm`, "POST"),
      s.as(s.officer, `/api/copilot/proposals/${b.id}/confirm`, "POST"),
    ]);
    expect([ra.status, rb.status].toSorted()).toEqual([200, 409]);
    expect(await database.db.select().from(applications)).toHaveLength(1);
  });

  test("an expired proposal can't be confirmed", async () => {
    const s = await setup();
    const p = await s.proposeOk();
    s.clock.set(new Date(s.clock.now().getTime() + 31 * 60_000));
    const r = await s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST");
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("proposal_expired");
    expect(await database.db.select().from(applications)).toHaveLength(0);
  });

  test("a slot taken after proposing: Confirm fails cleanly and the proposal is marked failed", async () => {
    const s = await setup();
    const p = await s.proposeOk();
    await createApplication(
      s.ctx,
      {
        unitId: s.unitId,
        nameEn: "Walk In",
        email: "walkin@example.com",
        kind: "individual",
        viewingAt: new Date(SLOT),
      },
      `user:${s.otherOfficer.id}`,
    );
    const r = await s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST");
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("viewing_slot_taken");
    const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.id));
    expect(row).toMatchObject({ status: "failed", result: { code: "viewing_slot_taken" } });
    // The failed attempt left nothing behind (no party, no application of Priya's).
    const apps = await database.db.select().from(applications);
    expect(apps).toHaveLength(1);
    expect(await database.db.select().from(parties).where(eq(parties.email, "priya@example.com"))).toHaveLength(0);
  });

  test("cancel, then Confirm is refused", async () => {
    const s = await setup();
    const p = await s.proposeOk();
    const c = await s.as(s.officer, `/api/copilot/proposals/${p.id}/cancel`, "POST");
    expect(((await c.json()) as { status: string }).status).toBe("cancelled");
    expect((await s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(409);
    expect(await database.db.select().from(applications)).toHaveLength(0);
  });

  test("two Confirm clicks at once create one application", async () => {
    const s = await setup();
    const p = await s.proposeOk();
    const [a, b] = await Promise.all([
      s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST"),
      s.as(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST"),
    ]);
    expect([a.status, b.status].toSorted()).toEqual([200, 409]);
    expect(await database.db.select().from(applications)).toHaveLength(1);
  });

  test("the copilot's client can only store proposals: never confirm, cancel or any other write", async () => {
    const s = await setup();
    const p = await s.proposeOk();
    const client = inProcessClient(s.app, issueToken(SECRET, s.officer.id, Date.now()));
    for (const path of [
      `/api/copilot/proposals/${p.id}/confirm`,
      `/api/copilot/proposals/${p.id}/cancel`,
      "/api/applications",
      "/api/approvals/x/decide",
    ]) {
      await expect(client.propose(path, {})).rejects.toThrow("invalid engine path");
    }
    await expect(client.get("/api/copilot/proposals")).rejects.toThrow("invalid engine path");
    expect(await database.db.select().from(applications)).toHaveLength(0);
  });

  test("available units: listed with a settled price, rent from the record, next free slots", async () => {
    const s = await setup();
    const rows = (await (await s.as(s.finance, "/api/available-units?bedrooms=1")).json()) as {
      code: string;
      askingRent: string;
      nextViewingSlots: { at: string; label: string }[];
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "JVC-0412", askingRent: "AED 74,000.00" });
    expect(rows[0]!.nextViewingSlots[0]!.at).toBe(SLOT);
    expect(rows[0]!.nextViewingSlots).toHaveLength(6);
    expect(await (await s.as(s.finance, "/api/available-units?bedrooms=2")).json()).toEqual([]);
    // One unit by code (exact, ignoring case); never a pattern.
    const one = (await (await s.as(s.finance, "/api/available-units?code=jvc-0412")).json()) as { code: string }[];
    expect(one.map((u) => u.code)).toEqual(["JVC-0412"]);
    expect(await (await s.as(s.finance, "/api/available-units?code=JVC%25")).json()).toEqual([]);
    expect(await (await s.as(s.finance, "/api/available-units?maxRentFils=7000000")).json()).toEqual([]);
  });
});
