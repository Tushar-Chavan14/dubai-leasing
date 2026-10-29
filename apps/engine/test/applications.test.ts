import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { addDays, defaultCompanyPolicy, newId } from "@leasing/core";
import {
  actionLinks,
  applications,
  approvals,
  companyPolicy,
  contractRules,
  contracts,
  type Database,
  deadlines,
  documents,
  leaseEvents,
  outboundMessages,
  leaseParties,
  helperRuns,
  inboundEvents,
  leases,
  parties,
  tasks,
  unitPhotos,
  units,
} from "@leasing/db";
import { FakeLlm } from "@leasing/llm";
import { and, eq, like, notLike } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { advance } from "../src/manager/advance.ts";
import {
  APPLICATION_MAIL_JOB,
  autoReleaseHeldOffer,
  createApplication,
  HELD_OFFER_RELEASE_JOB,
  sendApplicationMail,
  sendHeldOffer,
} from "../src/manager/applications.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import { CONTRACT_PREPARE_JOB, DEFAULT_ADDENDUM, prepareContract } from "../src/manager/contracts.ts";
import { INBOUND_JOB, processInbound } from "../src/manager/inbound.ts";
import { sweepDueDeadlines } from "../src/manager/milestones.ts";
import { UnitFields } from "../src/manager/units.ts";
import { isTimedAgentJob } from "../src/manager/agent-switches.ts";
import {
  addStaff,
  agreeingDecision,
  completeLegalDetails,
  freshDatabase,
  noDb,
  testContext,
  testCompany,
} from "./harness.ts";

const START = "2026-11-01T04:00:00Z"; // 08:00 Dubai
const VIEWING_AT = "2026-11-01T16:30:00+04:00"; // same day, 16:30 Dubai
const SECRET = "test-secret";
const SPECIMENS = join(import.meta.dir, "../../../packages/helpers/src/kyc/evals/specimens");
const png = (f: string) => new Uint8Array(readFileSync(join(SPECIMENS, f)));
let database: Database;

const hi = (value: string) => ({ value, confidence: 0.97 });
/** What the (scripted) vision model reads from Priya's fictional Emirates ID. */
const priyaFront = (expiry = "14/08/2029", confidence = 0.97) => ({
  documentType: "identity_card_front",
  idNumber: hi("784-1991-4820193-4"),
  name: { value: "Priya Example Rao", confidence },
  nationality: hi("India"),
  birthDate: hi("07/03/1991"),
  sex: hi("F"),
  expiryDate: hi(expiry),
});
const priyaBack = {
  documentType: "identity_card_back",
  cardNumber: hi("SPC4820193"),
  employer: hi("Fictional Trading LLC"),
};

async function setup(front: () => unknown = () => priyaFront()) {
  const llm = new FakeLlm(agreeingDecision, (_images, prompt) =>
    prompt.includes("back of an identity card") ? priyaBack : front(),
  );
  const t = testContext(database, START, { llm });
  const landlordId = await completeLegalDetails(database, await testCompany(database), {
    legalName: "Fictional Holdings LLC",
  });
  const unitId = newId();
  await database.db.insert(units).values({
    companyId: await testCompany(database),
    id: unitId,
    code: "JVC-0412",
    building: "Demo Circle Residence",
    community: "Jumeirah Village Circle",
    unitNo: "412",
    dldPropertyNo: "DEMO-DLD-000412",
    makaniNo: "2222233333",
    bedrooms: 1,
    furnished: false,
    state: "LISTED",
    askingRentFils: 7_400_000,
    priceApprovedAt: new Date("2026-10-01T08:00:00Z"),
  });
  const officer = await addStaff(database, "leasing_officer");
  const manager = await addStaff(database, "leasing_manager");
  const finance = await addStaff(database, "finance");
  const media = new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-")));
  const app = createApi(t.ctx, { sessionSecret: SECRET, mediaStore: media });
  const staff = (user: { id: string }, path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const portal = (path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const upload = (token: string, file: Uint8Array, kind: string, side: string) => {
    const form = new FormData();
    form.set("file", new File([file], "photo.png", { type: "image/png" }));
    form.set("kind", kind);
    form.set("side", side);
    return app.request(`/api/portal/${token}/documents`, { method: "POST", body: form });
  };
  /** Runs queued mail and inbound jobs (as the pg-boss workers would), in order. */
  let done = 0;
  const drain = async () => {
    while (done < t.scheduler.jobs.length) {
      const j = t.scheduler.jobs[done++]!;
      if (isTimedAgentJob(j)) continue; // a reminder pg-boss would hold until its startAfter
      if (j.name === APPLICATION_MAIL_JOB) {
        await sendApplicationMail(t.ctx, String(j.data.applicationId), j.data.kind as never, Number(j.data.seq));
      }
      if (j.name === INBOUND_JOB)
        await processInbound(t.ctx, String(j.data.inboundEventId), Number(j.data.attempt ?? 1));
    }
  };
  const lastMail = () => t.mailer.sent.at(-1)!;
  const tokens = (text: string) => ({
    upload: /\/t\/([A-Za-z0-9_-]{30,64})\/documents/.exec(text)?.[1],
    offer: /\/t\/([A-Za-z0-9_-]{30,64})\/offer/.exec(text)?.[1],
    status: /\/t\/([A-Za-z0-9_-]{30,64})(?![\w/-])/.exec(text)?.[1],
    property: /\/t\/([A-Za-z0-9_-]{30,64})\/property/.exec(text)?.[1],
  });
  return {
    ...t,
    llm,
    media,
    unitId,
    landlordId,
    officer,
    manager,
    finance,
    staff,
    portal,
    upload,
    drain,
    lastMail,
    tokens,
  };
}

const appRow = async (id: string) => (await database.db.select().from(applications).where(eq(applications.id, id)))[0]!;
const eventTypes = async (id: string) =>
  (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, id))).map((e) => e.type);

type S = Awaited<ReturnType<typeof setup>>;

/** Creates an application with a booked viewing; the first email is the viewing invitation. */
async function createWithViewing(s: S, body: Record<string, unknown> = {}) {
  const r = await s.staff(s.officer, "/api/applications", "POST", {
    unitId: s.unitId,
    nameEn: "Priya Example Rao",
    email: "priya.applicant@demo.example",
    viewingAt: VIEWING_AT,
    ...body,
  });
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  await s.drain();
  const mail = s.lastMail();
  expect(mail.subject).toContain("Your viewing");
  return { id, mail };
}

/** Records that the applicant came to the viewing; the upload-link email follows. */
async function attended(s: S, id: string) {
  const r = await s.staff(s.officer, `/api/applications/${id}/viewing-outcome`, "POST", { outcome: "attended" });
  expect(r.status).toBe(200);
  await s.drain();
}

/** Creates an application, records the viewing and submits Priya's two ID images; returns ids and links. */
async function toKyc(s: S, nameEn = "Priya Example Rao") {
  const { id, mail } = await createWithViewing(s, { nameEn, requestedMoveInOn: "2026-12-01" });
  expect(mail.text).toContain("Sunday 1 November 2026, 4:30 pm (Dubai time)");
  expect(s.tokens(mail.text).property).toBeDefined();
  expect(s.tokens(mail.text).upload).toBeUndefined();
  await attended(s, id);
  const { upload, status } = s.tokens(s.lastMail().text);
  const front = (await (await s.upload(upload!, png("priya-eid-front.png"), "emirates_id", "front")).json()) as {
    id: string;
  };
  const back = (await (await s.upload(upload!, png("priya-eid-back.png"), "emirates_id", "back")).json()) as {
    id: string;
  };
  const sub = await s.portal("/api/inbound", "POST", {
    token: upload,
    type: "DOCS_UPLOADED",
    payload: { documentIds: [front.id, back.id] },
  });
  expect(sub.status).toBe(202);
  await s.drain();
  return { id, upload: upload!, status: status!, docs: [front.id, back.id] };
}

describe.skipIf(noDb)("applications: screening, KYC, offer, reservation (Postgres)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("happy path: upload link → KYC verified → offer → in-limits counter → accept → reservation → lease in CONTRACT", async () => {
    const s = await setup();
    const { id, upload } = await toKyc(s);

    // KYC: verified, identity copied from the ID (never retyped), documents verified.
    let a = await appRow(id);
    expect(a.state).toBe("OFFER");
    const [p] = await database.db.select().from(parties).where(eq(parties.id, a.partyId));
    expect(p).toMatchObject({
      fullNameEn: "Priya Example Rao",
      emiratesIdNo: "784-1991-4820193-4",
      nationality: "India",
      birthDate: "1991-03-07",
      idExpiresOn: "2029-08-14",
    });
    const docs = await database.db.select().from(documents).where(eq(documents.applicationId, id));
    expect(docs.map((d) => d.status)).toEqual(["verified", "verified"]);
    expect(s.llm.visionCalls).toHaveLength(2);
    // The upload link is spent.
    expect((await s.upload(upload, png("priya-eid-front.png"), "emirates_id", "front")).status).toBe(404);

    // Offer 1 from policy, emailed with an offer link; expiry scheduled.
    expect(a.offer).toMatchObject({
      revision: 1,
      annualRentFils: 7_400_000,
      cheques: 4,
      depositFils: 370_000,
      moveInOn: "2026-12-01",
      endOn: "2027-11-30",
    });
    await s.drain();
    expect(s.lastMail().subject).toContain("Your offer");
    const offer1 = s.tokens(s.lastMail().text).offer!;
    const view = (await (await s.portal(`/api/portal/${offer1}`)).json()) as {
      canRespond: boolean;
      offer: { revision: number };
    };
    expect(view).toMatchObject({ canRespond: true, offer: { revision: 1 } });
    const [dl] = await database.db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.entityId, id), notLike(deadlines.milestone, "timed:%")));
    expect(dl).toMatchObject({ milestone: "offer_expiry@1", dueOn: "2026-11-09", status: "pending" });

    // Counter within limits (more cheques) → revision 2, sent automatically.
    const counter = await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { cheques: 6 } },
    });
    expect(counter.status).toBe(202);
    await s.drain();
    a = await appRow(id);
    expect(a.offer).toMatchObject({ revision: 2, cheques: 6, annualRentFils: 7_400_000, fromCounter: true });
    expect(s.lastMail().subject).toContain("Revised offer");
    expect(await database.db.select().from(approvals).where(eq(approvals.entityId, id))).toHaveLength(0);

    // Accept revision 2 → acceptance recorded, officer task, receipt email.
    const offer2 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer2,
      type: "OFFER_RESPONDED",
      payload: { revision: 2, choice: "accept" },
    });
    await s.drain();
    a = await appRow(id);
    expect(a.offerAcceptedAt).not.toBeNull();
    expect(s.lastMail().subject).toContain("Offer accepted");
    const openTasks = await database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.entityId, id), eq(tasks.status, "open")));
    expect(openTasks.map((t) => t.kind)).toContain("record_reservation");

    // The officer records the reservation → RESERVED → lease created in CONTRACT → CONVERTED.
    const res = await s.staff(s.officer, `/api/applications/${id}/reservation`, "POST", {
      paidOn: "2026-11-01",
      reference: "TRX-001",
    });
    expect(res.status).toBe(200);
    a = await appRow(id);
    expect(a.state).toBe("CONVERTED");
    expect(a.reservationFils).toBe(370_000);
    const [lease] = await database.db.select().from(leases).where(eq(leases.applicationId, id));
    // Contract fields come from the accepted offer, exactly.
    expect(lease).toMatchObject({
      state: "CONTRACT",
      ref: "JVC-0412/2026-12",
      startOn: "2026-12-01",
      endOn: "2027-11-30",
      annualRentFils: 7_400_000,
      cheques: 6,
      depositFils: 370_000,
      source: "engine",
    });
    const lp = await database.db.select().from(leaseParties).where(eq(leaseParties.leaseId, lease!.id));
    expect(lp.map((x) => [x.role, x.partyId]).toSorted()).toEqual([
      ["landlord", s.landlordId],
      ["tenant", a.partyId],
    ]);
    // Step 5 starts on its own: a job prepares the contract from the verified records.
    expect(s.scheduler.jobs.find((j) => j.name === CONTRACT_PREPARE_JOB)?.data).toEqual({ leaseId: lease!.id });
    const prepared = await prepareContract(s.ctx, lease!.id, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    expect(prepared.status).toBe("prepared");
    const [k] = await database.db.select().from(contracts).where(eq(contracts.leaseId, lease!.id));
    expect(k!.fields).toMatchObject({
      tenantNameEn: "Priya Example Rao",
      tenantEmiratesIdNo: "784-1991-4820193-4",
      landlordNameEn: "Fictional Holdings LLC",
      dldPropertyNo: "DEMO-DLD-000412",
      annualRentFils: 7_400_000,
      cheques: 6,
      depositFils: 370_000,
      moveInOn: "2026-12-01",
    });
    expect(await eventTypes(id)).toEqual(
      expect.arrayContaining([
        "APPLICATION_CREATED",
        "APPLIED",
        "KYC_VERIFIED",
        "OFFER_MADE",
        "OFFER_REVISED",
        "OFFER_ANSWERED",
        "RESERVATION_RECORDED",
        "OFFER_ACCEPTED",
        "LEASE_CREATED",
      ]),
    );
  });

  test("flagged KYC goes to a leasing officer; approving copies the identity; KYC can't be forced", async () => {
    const s = await setup(() => priyaFront("14/08/2029", 0.4)); // the name was read unsure
    const { id } = await toKyc(s);
    expect((await appRow(id)).state).toBe("SCREENING");
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap).toMatchObject({
      gate: "kyc_review",
      approverRole: "leasing_officer",
      status: "pending",
      onApproveEvent: "KYC_VERIFIED",
    });
    expect(ap!.reasons.join(" ")).toContain("weren't read clearly");
    // The proposal is shown masked.
    const shown = (await (await s.staff(s.manager, `/api/approvals/${ap!.id}`)).json()) as {
      proposal: { identity: { emiratesIdNo: string } };
    };
    expect(shown.proposal.identity.emiratesIdNo).not.toContain("4820193");
    // No one can skip the gate.
    await expect(
      advance(s.ctx, { kind: "application", id }, "KYC_VERIFIED", { actor: "system" }),
    ).rejects.toMatchObject({ code: "gate_required" });
    await decideApproval(s.ctx, ap!.id, s.officer, { decision: "approve" });
    const a = await appRow(id);
    expect(a.state).toBe("OFFER");
    const [p] = await database.db.select().from(parties).where(eq(parties.id, a.partyId));
    expect(p?.emiratesIdNo).toBe("784-1991-4820193-4");
  });

  const setAutopilot = async (patch: Partial<typeof defaultCompanyPolicy.autopilot>) => {
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: { ...defaultCompanyPolicy, autopilot: { ...defaultCompanyPolicy.autopilot, ...patch } },
      createdBy: "test",
    });
  };

  test("auto_kyc_verify off: a clean KYC run opens a kyc_review; approving verifies", async () => {
    await setAutopilot({ auto_kyc_verify: false });
    const s = await setup();
    const { id } = await toKyc(s);
    expect((await appRow(id)).state).toBe("SCREENING");
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap).toMatchObject({ gate: "kyc_review", status: "pending", onApproveEvent: "KYC_VERIFIED" });
    expect(ap!.reasons).toContain("Automatic KYC verification is switched off.");
    expect(ap!.proposal).toMatchObject({ policyVersion: 98 });
    await decideApproval(s.ctx, ap!.id, s.officer, { decision: "approve" });
    expect((await appRow(id)).state).toBe("OFFER");
    const [ev] = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, id), eq(leaseEvents.type, "KYC_VERIFIED")));
    expect(ev!.payload).toMatchObject({ policyVersion: 98 });
  });

  const offerMails = (s: S) => s.mailer.sent.filter((m) => /offer/i.test(m.subject));
  const evs = async (id: string, type: string) =>
    database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, id), eq(leaseEvents.type, type)));

  test("auto_send_offer off: revision 1 is held, then sent once from the send date", async () => {
    await setAutopilot({ auto_send_offer: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    const a = await appRow(id);
    expect(a.state).toBe("OFFER");
    expect(a.offer?.revision).toBe(1);
    expect(offerMails(s)).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(deadlines)
        .where(and(eq(deadlines.entityId, id), notLike(deadlines.milestone, "timed:%"))),
    ).toHaveLength(0);
    expect((await evs(id, "OFFER_HELD"))[0]!.payload).toMatchObject({ revision: 1, policyVersion: 98 });
    const [t] = await database.db.select().from(tasks).where(eq(tasks.entityId, id));
    expect(t).toMatchObject({ title: "Send offer revision 1 (" + (a.ref ?? id.slice(0, 8)) + ")", status: "open" });

    s.clock.advanceDays(3);
    const r = await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST");
    expect(r.status).toBe(200);
    await s.drain();
    expect(offerMails(s)).toHaveLength(1);
    expect((await evs(id, "OFFER_SENT"))[0]!.payload).toMatchObject({ revision: 1, policyVersion: 98 });
    const [dl] = await database.db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.entityId, id), notLike(deadlines.milestone, "timed:%")));
    expect(dl).toMatchObject({ milestone: "offer_expiry@1", status: "pending" });
    const sentOn = s.clock.today();
    const expiresOn = (await appRow(id)).offer!.expiresOn as string;
    expect(expiresOn).toBe(addDays(sentOn, 7));
    expect(dl!.dueOn).toBe(addDays(expiresOn as never, 1));
    const [t2] = await database.db.select().from(tasks).where(eq(tasks.entityId, id));
    expect(t2!.status).toBe("done");

    const again = await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code?: string }).code).toBe("offer_not_held");
    await s.drain();
    expect(offerMails(s)).toHaveLength(1);
  });

  test("held offer: Mark done is refused; sending re-checks the limits (422 offer_out_of_limits, approval opened)", async () => {
    await setAutopilot({ auto_send_offer: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    const [t] = await database.db.select().from(tasks).where(eq(tasks.entityId, id));
    expect(t!.kind).toBe("send_offer");
    const done = await s.staff(s.officer, `/api/tasks/${t!.id}/done`, "POST", {});
    expect(done.status).toBe(409);
    expect(((await done.json()) as { code: string }).code).toBe("use_the_action");
    // The approved asking rent rose while the offer was held: the offer is now below the limit.
    await database.db.update(units).set({ askingRentFils: 99_000_000 }).where(eq(units.id, s.unitId));
    const r = await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST");
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe("offer_out_of_limits");
    await s.drain();
    expect(offerMails(s)).toHaveLength(0);
    expect(await evs(id, "OFFER_SENT")).toHaveLength(0);
    const pending = (await database.db.select().from(approvals).where(eq(approvals.entityId, id))).filter(
      (a) => a.gate === "offer_out_of_limits" && a.status === "pending",
    );
    expect(pending).toHaveLength(1);
    expect((await database.db.select().from(tasks).where(eq(tasks.id, t!.id)))[0]!.status).toBe("open");
  });

  test("a stale offer-expiry deadline is inert once a held counter has replaced the revision", async () => {
    await setAutopilot({ auto_send_counter: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { cheques: 6 } },
    });
    await s.drain();
    expect((await appRow(id)).offer).toMatchObject({ revision: 2 });
    s.clock.advanceDays(30);
    await sweepDueDeadlines(s.ctx);
    const [dl1] = (await database.db.select().from(deadlines).where(eq(deadlines.entityId, id))).filter(
      (d) => d.milestone === "offer_expiry@1",
    );
    expect(dl1!.status).toBe("skipped");
    expect(dl1!.note).toContain("no longer open");
    expect((await appRow(id)).state).toBe("OFFER");
    expect((await evs(id, "OFFER_EXPIRED")).length).toBe(0);
  });

  test("hold then supersede: a held offer pushed to approval is replaced by the approved revision, never sent as revision 1", async () => {
    await setAutopilot({ auto_send_offer: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    await database.db.update(units).set({ askingRentFils: 99_000_000 }).where(eq(units.id, s.unitId));
    expect((await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST")).status).toBe(422);
    const [ap] = (await database.db.select().from(approvals).where(eq(approvals.entityId, id))).filter(
      (a) => a.gate === "offer_out_of_limits" && a.status === "pending",
    );
    await decideApproval(s.ctx, ap!.id, s.manager, { decision: "approve" });
    await s.drain();
    expect((await appRow(id)).offer!.revision).toBe(2);
    expect(
      (await evs(id, "OFFER_SENT")).filter((e) => (e.payload as { revision: number }).revision === 1),
    ).toHaveLength(0);
    const again = await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST");
    expect([200, 409]).toContain(again.status);
    if (again.status === 200)
      expect((await evs(id, "OFFER_SENT")).every((e) => (e.payload as { revision: number }).revision === 2)).toBe(true);
  });

  test("POST /applications/:id/events: APPLIED only from ENQUIRY (409 wrong_state), leasing roles only (403)", async () => {
    const s = await setup();
    const { id } = await createWithViewing(s);
    expect((await appRow(id)).state).toBe("VIEWING");
    const r = await s.staff(s.officer, `/api/applications/${id}/events`, "POST", { event: "APPLIED" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("wrong_state");
    expect((await appRow(id)).state).toBe("VIEWING");
    expect((await s.staff(s.finance, `/api/applications/${id}/events`, "POST", { event: "APPLIED" })).status).toBe(403);
  });

  test("auto_send_counter off: an in-limits counter is held, then sent", async () => {
    await setAutopilot({ auto_send_counter: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { cheques: 6 } },
    });
    await s.drain();
    expect((await appRow(id)).offer).toMatchObject({ revision: 2, cheques: 6 });
    expect(offerMails(s)).toHaveLength(1);
    expect((await evs(id, "OFFER_HELD"))[0]!.payload).toMatchObject({ revision: 2, policyVersion: 98 });
    const bad = await s.staff(s.manager, `/api/applications/${id}/offer/send`, "POST");
    expect(bad.status).toBe(200);
    await s.drain();
    expect(offerMails(s)).toHaveLength(2);
    expect(s.lastMail().subject).toContain("Revised offer");
    expect((await evs(id, "OFFER_SENT"))[0]!.payload).toMatchObject({ revision: 2 });
    expect((await s.staff(s.finance, `/api/applications/${id}/offer/send`, "POST")).status).toBe(403);
  });

  test("switching the toggle off after an offer went out changes nothing for it", async () => {
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    expect(offerMails(s)).toHaveLength(1);
    await setAutopilot({ auto_send_offer: false, auto_send_counter: false });
    expect((await evs(id, "OFFER_HELD")).length).toBe(0);
    const r = await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST");
    expect(r.status).toBe(409);
    expect(offerMails(s)).toHaveLength(1);
  });

  test("auto_kyc_verify on: KYC_VERIFIED records the policy version", async () => {
    await setAutopilot({});
    const s = await setup();
    const { id } = await toKyc(s);
    const ev = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, id), eq(leaseEvents.type, "KYC_VERIFIED")));
    expect(ev[0]!.payload).toMatchObject({ policyVersion: 98 });
  });

  test("auto_prepare_contract off: lease created, no job, CONTRACT_PREP_HELD and an officer task; manual prepare works", async () => {
    await setAutopilot({ auto_prepare_contract: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "accept" },
    });
    await s.drain();
    const res = await s.staff(s.officer, `/api/applications/${id}/reservation`, "POST", {
      paidOn: "2026-11-01",
      reference: "TRX-001",
    });
    expect(res.status).toBe(200);
    const [lease] = await database.db.select().from(leases).where(eq(leases.applicationId, id));
    expect(lease!.state).toBe("CONTRACT");
    expect(s.scheduler.jobs.find((j) => j.name === CONTRACT_PREPARE_JOB)).toBeUndefined();
    const held = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, lease!.id), eq(leaseEvents.type, "CONTRACT_PREP_HELD")));
    expect(held).toHaveLength(1);
    expect(held[0]!.payload).toMatchObject({ policyVersion: 98 });
    const [t] = await database.db.select().from(tasks).where(eq(tasks.entityId, lease!.id));
    expect(t).toMatchObject({ title: "Prepare the contract", status: "open", assigneeRole: "leasing_officer" });
    const r = await s.staff(s.officer, `/api/leases/${lease!.id}/contract/prepare`, "POST", DEFAULT_ADDENDUM);
    expect(r.status).toBe(201);
    const [t2] = await database.db.select().from(tasks).where(eq(tasks.id, t!.id));
    expect(t2!.status).toBe("done");
  });

  test("an expired ID can never be approved; the officer asks for new documents instead", async () => {
    const s = await setup(() => priyaFront("01/05/2026"));
    const { id } = await toKyc(s);
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap?.reasons.join(" ")).toContain("expired");
    await expect(decideApproval(s.ctx, ap!.id, s.officer, { decision: "approve" })).rejects.toMatchObject({
      status: 422,
    });
    await decideApproval(s.ctx, ap!.id, s.officer, { decision: "reject", note: "ask for the renewed ID" });
    const before = s.mailer.sent.length;
    expect((await s.staff(s.officer, `/api/applications/${id}/request-documents`, "POST")).status).toBe(200);
    await s.drain();
    expect(s.mailer.sent.length).toBe(before + 1);
    expect(s.tokens(s.lastMail().text).upload).toBeDefined();
  });

  test("a counter outside the limits goes to a leasing manager; approving sends it as the next revision", async () => {
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { annualRentFils: 6_000_000 } },
    });
    await s.drain();
    expect((await appRow(id)).offer?.revision).toBe(1);
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap).toMatchObject({
      gate: "offer_out_of_limits",
      approverRole: "leasing_manager",
      onApproveEvent: "OFFER_REVISED",
    });
    await expect(decideApproval(s.ctx, ap!.id, s.officer, { decision: "approve" })).rejects.toMatchObject({
      status: 403,
    });
    await decideApproval(s.ctx, ap!.id, s.manager, { decision: "approve" });
    await s.drain();
    const a = await appRow(id);
    expect(a.offer).toMatchObject({ revision: 2, annualRentFils: 6_000_000 });
    expect(s.lastMail().subject).toContain("Revised offer");
    // The old offer link no longer works.
    expect(
      (
        await s.portal("/api/inbound", "POST", {
          token: offer1,
          type: "OFFER_RESPONDED",
          payload: { revision: 1, choice: "accept" },
        })
      ).status,
    ).toBe(409);
  });

  test("a cheque counter without a contract rule says the company default limits applied", async () => {
    const s = await setup();
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 99,
      effectiveFrom: "2000-01-01" as never,
      values: { ...defaultCompanyPolicy, maxCheques: 4 },
      createdBy: "test",
    });
    const { id } = await toKyc(s);
    await s.drain();
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { cheques: 6 } },
    });
    await s.drain();
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap).toMatchObject({ gate: "offer_out_of_limits" });
    expect(JSON.stringify(ap)).toContain("company default limits; no contract rule for this unit");
  });

  test("offer cheque limits come from the company's contract rule", async () => {
    const s = await setup();
    await database.db.insert(contractRules).values({
      id: newId(),
      companyId: await testCompany(database),
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 2,
      createdBy: "test",
    });
    const { id } = await toKyc(s);
    await s.drain();
    expect((await appRow(id)).offer?.cheques).toBe(2);
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { cheques: 4 } },
    });
    await s.drain();
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap).toMatchObject({ gate: "offer_out_of_limits" });
    expect(JSON.stringify(ap)).toContain("4 cheques is outside the allowed 1–2.");
  });

  test("an unanswered offer lapses the morning after its last day", async () => {
    const s = await setup();
    const { id } = await toKyc(s);
    s.clock.set(new Date("2026-11-08T20:00:00Z")); // 9 Nov 00:00 Dubai
    await sweepDueDeadlines(s.ctx);
    expect((await appRow(id)).state).toBe("WITHDRAWN");
  });

  test("a decline whose comment needs a person is held, not applied", async () => {
    const llm = new FakeLlm(
      () => ({
        model: "tev1:test",
        answers: {
          intent: { type: "choice", choice: "accept", confidence: 0.9, probabilities: { accept: 0.9 } },
          legal_threat: { type: "noul", noul: 0.02 },
          system_instruction: { type: "noul", noul: 0.02 },
        },
      }),
      (_i, prompt) => (prompt.includes("back of an identity card") ? priyaBack : priyaFront()),
    );
    const s = await setup();
    s.ctx.llm = llm;
    const { id } = await toKyc(s);
    await s.drain();
    await s.portal("/api/inbound", "POST", {
      token: s.tokens(s.lastMail().text).offer,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "decline", comment: "Oops, I meant to accept" },
    });
    await s.drain();
    expect((await appRow(id)).state).toBe("OFFER");
    expect((await database.db.select().from(tasks).where(eq(tasks.entityId, id))).map((t) => t.kind)).toContain(
      "offer_reply_review",
    );
  });

  test("uploads: images only, a single-use link, and documents viewable by leasing staff only (audited)", async () => {
    const s = await setup();
    const { id } = await createWithViewing(s, { email: "p@demo.example" });
    await attended(s, id);
    const { upload } = s.tokens(s.lastMail().text);
    expect((await s.upload(upload!, new TextEncoder().encode("not an image"), "emirates_id", "front")).status).toBe(
      422,
    );
    const ok = (await (await s.upload(upload!, png("priya-eid-front.png"), "emirates_id", "front")).json()) as {
      id: string;
    };
    expect((await s.upload(upload!, png("priya-eid-front.png"), "emirates_id", "front")).status).toBe(200); // duplicate
    const view = (await (await s.portal(`/api/portal/${upload}`)).json()) as {
      canUpload: boolean;
      documents: unknown[];
    };
    expect(view).toMatchObject({ canUpload: true, documents: [expect.objectContaining({ id: ok.id })] });
    expect((await s.staff(s.finance, `/api/applications/${id}/documents/${ok.id}`)).status).toBe(403);
    const img = await s.staff(s.officer, `/api/applications/${id}/documents/${ok.id}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toContain("no-store");
    expect(await eventTypes(id)).toContain("DOCUMENT_VIEWED");
    // Another unit can't be applied for while a lease is being signed; a unit must be listed.
    await database.db.update(units).set({ state: "READY" }).where(eq(units.id, s.unitId));
    expect(
      (
        await s.staff(s.officer, "/api/applications", "POST", {
          unitId: s.unitId,
          nameEn: "X Y",
          email: "x@demo.example",
          viewingAt: VIEWING_AT,
        })
      ).status,
    ).toBe(409);
  });

  test("an Emirates ID already on file is never linked silently, and never takes over the existing record's contact details", async () => {
    const s = await setup();
    const tenantId = newId();
    await database.db.insert(parties).values({
      id: tenantId,
      kind: "individual",
      fullNameEn: "Priya Example Rao",
      email: "priya.current@demo.example",
      phone: "+971 50 000 0001",
      emiratesIdNo: "784-1991-4820193-4",
    });
    const { id } = await toKyc(s);
    expect((await appRow(id)).state).toBe("SCREENING");
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(ap?.reasons.join(" ")).toContain("already on file");
    await decideApproval(s.ctx, ap!.id, s.officer, { decision: "approve" });
    const a = await appRow(id);
    expect(a).toMatchObject({ state: "OFFER", partyId: tenantId });
    const [p] = await database.db.select().from(parties).where(eq(parties.id, tenantId));
    expect(p).toMatchObject({
      email: "priya.current@demo.example",
      phone: "+971 50 000 0001",
      idExpiresOn: "2029-08-14",
    });
    expect(await eventTypes(id)).toContain("PARTY_LINKED");
  });

  test("a review can't be approved once a document has expired, even if it was valid when read", async () => {
    const s = await setup(() => priyaFront("14/08/2029", 0.4));
    const { id } = await toKyc(s);
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    s.clock.set(new Date("2029-09-01T04:00:00Z"));
    await expect(decideApproval(s.ctx, ap!.id, s.officer, { decision: "approve" })).rejects.toMatchObject({
      status: 422,
    });
    expect((await appRow(id)).state).toBe("SCREENING");
  });

  test("forms are scoped: a lease link can't post application forms", async () => {
    const s = await setup();
    const { receiveInbound } = await import("../src/manager/inbound.ts");
    const { withTx } = await import("@leasing/db");
    const leaseId = newId();
    await database.db.insert(leases).values({
      id: leaseId,
      ref: "X/2026-01",
      unitId: s.unitId,
      state: "RENEWAL",
      startOn: "2026-01-01" as never,
      endOn: "2026-12-31" as never,
      annualRentFils: 7_000_000,
      cheques: 4,
      depositFils: 350_000,
      rulesVersion: "dubai-2025-01",
      source: "engine",
    });
    await expect(
      withTx(database, (tx) =>
        receiveInbound(s.ctx, tx, {
          type: "OFFER_RESPONDED",
          payload: { revision: 1, choice: "accept" },
          channel: "portal",
          actor: "tenant:x",
          entity: { kind: "lease", id: leaseId },
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("an acceptance whose comment needs a person is held; a stale out-of-limits approval can't be applied", async () => {
    const s = await setup();
    s.ctx.llm = new FakeLlm(
      () => ({
        model: "tev1:test",
        answers: {
          intent: { type: "choice", choice: "counter", confidence: 0.9, probabilities: { counter: 0.9 } },
          legal_threat: { type: "noul", noul: 0.02 },
          system_instruction: { type: "noul", noul: 0.02 },
        },
      }),
      (_i, prompt) => (prompt.includes("back of an identity card") ? priyaBack : priyaFront()),
    );
    const { id } = await toKyc(s);
    await s.drain();
    const offer1 = s.tokens(s.lastMail().text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offer1,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "accept", comment: "I accept if the rent is 60,000" },
    });
    await s.drain();
    const a = await appRow(id);
    expect(a.offerAcceptedAt).toBeNull();
    expect((await database.db.select().from(tasks).where(eq(tasks.entityId, id))).map((t) => t.kind)).toContain(
      "offer_reply_review",
    );
  });

  test("an out-of-limits counter decided after its terms lapsed can't be approved", async () => {
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    await s.portal("/api/inbound", "POST", {
      token: s.tokens(s.lastMail().text).offer,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "counter", counter: { annualRentFils: 6_000_000 } },
    });
    await s.drain();
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    // The current offer doesn't lapse while the manager decides…
    s.clock.set(new Date("2026-11-20T04:00:00Z"));
    await sweepDueDeadlines(s.ctx);
    expect((await appRow(id)).state).toBe("OFFER");
    // …but terms that lapsed can't be sent.
    await expect(decideApproval(s.ctx, ap!.id, s.manager, { decision: "approve" })).rejects.toMatchObject({
      status: 422,
    });
  });

  test("a reservation needs a future move-in, and the unit's other applications close when one converts", async () => {
    const s = await setup();
    const first = await toKyc(s);
    const second = await toKyc(s, "Priya Example Rao");
    void second;
    await s.drain();
    const mails = s.mailer.sent.filter((m) => m.subject.includes("Your offer"));
    const offerFirst = s.tokens(mails[0]!.text).offer!;
    await s.portal("/api/inbound", "POST", {
      token: offerFirst,
      type: "OFFER_RESPONDED",
      payload: { revision: 1, choice: "accept" },
    });
    await s.drain();
    s.clock.set(new Date("2026-12-02T04:00:00Z")); // past the move-in date (1 Dec)
    expect(
      (
        await s.staff(s.officer, `/api/applications/${first.id}/reservation`, "POST", {
          paidOn: "2026-12-01",
          reference: "TRX",
        })
      ).status,
    ).toBe(409);
    s.clock.set(new Date(START));
    expect(
      (
        await s.staff(s.officer, `/api/applications/${first.id}/reservation`, "POST", {
          paidOn: "2026-11-01",
          reference: "TRX",
        })
      ).status,
    ).toBe(200);
    expect((await appRow(first.id)).state).toBe("CONVERTED");
    expect((await appRow(second.id)).state).toBe("WITHDRAWN");
  });
});

describe.skipIf(noDb)("applications: viewing invitation and outcome (Postgres)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  const outcome = (s: S, user: { id: string }, id: string, body: unknown) =>
    s.staff(user, `/api/applications/${id}/viewing-outcome`, "POST", body);

  test("the invitation shows the tour button only when the unit has one; the manager can record attendance", async () => {
    const s = await setup();
    await database.db
      .update(units)
      .set({ virtualTourUrl: "https://tour.example.test/jvc-0412" })
      .where(eq(units.id, s.unitId));
    const { id, mail } = await createWithViewing(s);
    expect(mail.html).toContain("Virtual tour");
    expect(mail.html).toContain("https://tour.example.test/jvc-0412");
    const a = await appRow(id);
    expect(a.state).toBe("VIEWING");
    expect(a.viewingAt?.toISOString()).toBe("2026-11-01T12:30:00.000Z");
    expect(await eventTypes(id)).toEqual(expect.arrayContaining(["APPLICATION_CREATED", "VIEWING_BOOKED"]));
    expect((await outcome(s, s.manager, id, { outcome: "attended", note: "liked the view" })).status).toBe(200);
    await s.drain();
    expect(s.tokens(s.lastMail().text).upload).toBeDefined();
    const b = await appRow(id);
    expect(b).toMatchObject({ state: "SCREENING", viewingOutcome: "attended" });
    const [ev] = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, id), eq(leaseEvents.type, "APPLIED")));
    expect(ev?.payload).toMatchObject({ viewingOutcome: "attended", note: "liked the view" });
  });

  test("apply_without_viewing: off (default) refuses APPLIED from ENQUIRY with 409 viewing_required; on allows it and emails the upload link", async () => {
    const s = await setup();
    const mk = async (email: string) =>
      (await createApplication(s.ctx, { unitId: s.unitId, nameEn: "Walk In", email, kind: "individual" }, "system")).id;
    const off = await mk("walk1@demo.example");
    const refused = await s.staff(s.officer, `/api/applications/${off}/events`, "POST", { event: "APPLIED" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe("viewing_required");
    expect((await appRow(off)).state).toBe("ENQUIRY");

    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: {
        ...defaultCompanyPolicy,
        autopilot: { ...defaultCompanyPolicy.autopilot, apply_without_viewing: true },
      },
      createdBy: "test",
    });
    const ok = await s.staff(s.officer, `/api/applications/${off}/events`, "POST", { event: "APPLIED" });
    expect(ok.status).toBe(200);
    await s.drain();
    expect((await appRow(off)).state).toBe("SCREENING");
    expect(s.tokens(s.lastMail().text).upload).toBeDefined();
    const [ev] = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, off))).filter(
      (e) => e.type === "APPLIED",
    );
    expect(ev?.payload).toMatchObject({ viewingSkipped: true, policyVersion: 98 });
  });

  test("apply_without_viewing off: VIEWING → SCREENING after an attended viewing is unaffected", async () => {
    const s = await setup();
    const { id } = await createWithViewing(s);
    await attended(s, id);
    expect((await appRow(id)).state).toBe("SCREENING");
  });

  test("no-show after the viewing time closes the application; before it → 422", async () => {
    const s = await setup();
    const { id, mail } = await createWithViewing(s);
    const { property, status } = s.tokens(mail.text);
    expect((await outcome(s, s.officer, id, { outcome: "no_show" })).status).toBe(422);
    expect((await appRow(id)).state).toBe("VIEWING");
    s.clock.set(new Date("2026-11-01T12:30:00Z"));
    expect((await outcome(s, s.officer, id, { outcome: "no_show", note: "no answer on the phone" })).status).toBe(200);
    const a = await appRow(id);
    expect(a).toMatchObject({ state: "WITHDRAWN", viewingOutcome: "no_show" });
    expect(await eventTypes(id)).toContain("VIEWING_NO_SHOW");
    // Single-use links are spent; the reusable property and status views stay readable and show the closed state.
    const links = await database.db.select().from(actionLinks).where(eq(actionLinks.entityId, id));
    expect(links.filter((l) => l.singleUse && !l.usedAt)).toHaveLength(0);
    const view = (await (await s.portal(`/api/portal/${property}`)).json()) as { state: string };
    expect(view.state).toBe("WITHDRAWN");
    expect((await s.portal(`/api/portal/${status}`)).status).toBe(200);
    // No upload mail went out; the applicant must apply again.
    await s.drain();
    expect(s.mailer.sent.filter((m) => m.subject.includes("Upload"))).toHaveLength(0);
    expect((await outcome(s, s.officer, id, { outcome: "attended" })).status).toBe(409);
  });

  test("bookings: the time must be in the future; outcome only for a VIEWING application; finance and admin can't act", async () => {
    const s = await setup();
    const past = await s.staff(s.officer, "/api/applications", "POST", {
      unitId: s.unitId,
      nameEn: "Priya Example Rao",
      email: "p@demo.example",
      viewingAt: "2026-11-01T07:59:00+04:00",
    });
    expect(past.status).toBe(422);
    expect(await database.db.select().from(applications)).toHaveLength(0);
    const noTime = await s.staff(s.officer, "/api/applications", "POST", {
      unitId: s.unitId,
      nameEn: "Priya Example Rao",
      email: "p@demo.example",
    });
    expect(noTime.status).toBe(400);
    const { id } = await createWithViewing(s);
    const admin = await addStaff(database, "admin");
    for (const u of [s.finance, admin]) {
      expect((await outcome(s, u, id, { outcome: "attended" })).status).toBe(403);
      expect(
        (await s.staff(u, `/api/applications/${id}/viewing`, "POST", { viewingAt: "2026-11-02T10:00:00+04:00" }))
          .status,
      ).toBe(403);
    }
    expect((await outcome(s, s.officer, id, { outcome: "maybe" })).status).toBe(400);
    // Booking again on a VIEWING application is a conflict; so is an outcome on SCREENING.
    expect(
      (await s.staff(s.officer, `/api/applications/${id}/viewing`, "POST", { viewingAt: "2026-11-02T10:00:00+04:00" }))
        .status,
    ).toBe(409);
    await attended(s, id);
    expect((await outcome(s, s.officer, id, { outcome: "attended" })).status).toBe(409);
  });

  test("the viewing mail job is idempotent", async () => {
    const s = await setup();
    const { id } = await createWithViewing(s);
    const before = s.mailer.sent.length;
    expect(await sendApplicationMail(s.ctx, id, "viewing", 1)).toEqual({ sent: false });
    expect(s.mailer.sent.length).toBe(before);
  });

  test("an enquiry can be booked for a viewing later", async () => {
    const s = await setup();
    const appId = newId();
    const partyId = newId();
    await database.db
      .insert(parties)
      .values({ id: partyId, kind: "individual", fullNameEn: "Walk In", email: "w@demo.example" });
    await database.db
      .insert(applications)
      .values({ id: appId, unitId: s.unitId, partyId, state: "ENQUIRY", source: "staff", ref: "A-ENQ" });
    const past = await s.staff(s.officer, `/api/applications/${appId}/viewing`, "POST", {
      viewingAt: "2026-10-31T10:00:00+04:00",
    });
    expect(past.status).toBe(422);
    const r = await s.staff(s.manager, `/api/applications/${appId}/viewing`, "POST", {
      viewingAt: "2026-11-02T10:00:00+04:00",
    });
    expect(r.status).toBe(200);
    await s.drain();
    expect(s.lastMail().text).toContain("Monday 2 November 2026, 10:00 am (Dubai time)");
    expect((await appRow(appId)).state).toBe("VIEWING");
  });

  test("portal property view: unit facts only; photos served only for the application's own unit", async () => {
    const s = await setup();
    const own = await s.media.put(png("priya-eid-front.png"), "png");
    const ownPhotoId = newId();
    await database.db.insert(unitPhotos).values({
      id: ownPhotoId,
      unitId: s.unitId,
      sha256: own.sha256,
      path: own.path,
      mime: "image/png",
      bytes: own.bytes,
      caption: "Living room",
      uploadedBy: "test",
    });
    const otherUnit = newId();
    await database.db.insert(units).values({
      companyId: await testCompany(database),
      id: otherUnit,
      code: "JVC-0999",
      building: "Other",
      community: "JVC",
      state: "LISTED",
    });
    const otherPhotoId = newId();
    await database.db.insert(unitPhotos).values({
      id: otherPhotoId,
      unitId: otherUnit,
      sha256: own.sha256,
      path: own.path,
      mime: "image/png",
      bytes: own.bytes,
      uploadedBy: "test",
    });
    const { mail } = await createWithViewing(s);
    const { property } = s.tokens(mail.text);
    const res = await s.portal(`/api/portal/${property}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    const view = JSON.parse(body) as {
      purpose: string;
      viewingAt: string;
      property: {
        building: string;
        bedrooms: number;
        askingRentFils: number;
        photos: { id: string; caption: string }[];
      };
    };
    expect(view.purpose).toBe("viewing");
    expect(view.viewingAt).toBe("2026-11-01T12:30:00.000Z");
    expect(view.property).toMatchObject({ building: "Demo Circle Residence", bedrooms: 1, askingRentFils: 7_400_000 });
    expect(view.property.photos).toEqual([{ id: ownPhotoId, caption: "Living room" }]);
    // No landlord, no registry numbers, no applicant contact details.
    for (const leak of ["Fictional Holdings", s.landlordId, "DEMO-DLD-000412", "2222233333", "priya.applicant@"]) {
      expect(body).not.toContain(leak);
    }
    const ok = await s.portal(`/api/portal/${property}/photos/${ownPhotoId}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("cache-control")).toContain("private");
    expect((await s.portal(`/api/portal/${property}/photos/${otherPhotoId}`)).status).toBe(404);
    expect((await s.portal(`/api/portal/${"x".repeat(40)}/photos/${ownPhotoId}`)).status).toBe(404);
    // Only viewing/status links show the property: an upload link sees neither details nor photos.
    s.clock.set(new Date("2026-11-01T13:00:00Z"));
    await attended(s, (await database.db.select().from(applications))[0]!.id);
    const { upload } = s.tokens(s.lastMail().text);
    const up = (await (await s.portal(`/api/portal/${upload}`)).json()) as { property: unknown };
    expect(up.property).toBeNull();
    expect((await s.portal(`/api/portal/${upload}/photos/${ownPhotoId}`)).status).toBe(404);
    // Expired link → 404.
    s.clock.set(new Date("2026-12-15T00:00:00Z"));
    expect((await s.portal(`/api/portal/${property}/photos/${ownPhotoId}`)).status).toBe(404);
  });
});

describe("unit virtual tour link", () => {
  const tour = (v: string | null | undefined) => UnitFields.shape.virtualTourUrl.safeParse(v);
  test("https only, at most 500 characters, empty → null, optional", () => {
    expect(tour("https://tour.example.test/jvc-0412")).toMatchObject({
      success: true,
      data: "https://tour.example.test/jvc-0412",
    });
    expect(tour("")).toMatchObject({ success: true, data: null });
    expect(tour(undefined).success).toBe(true);
    expect(tour("http://tour.example.test/x").success).toBe(false);
    expect(tour("javascript:alert(1)").success).toBe(false);
    expect(tour(`https://tour.example.test/${"a".repeat(480)}`).success).toBe(false);
  });
});

describe.skipIf(noDb)("agent switches (D37): reminders, chases and held-offer release (Postgres)", () => {
  const setAutopilot = async (patch: Record<string, unknown>) => {
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: { ...defaultCompanyPolicy, autopilot: { ...defaultCompanyPolicy.autopilot, ...patch } },
      createdBy: "test",
    });
  };
  /** Real mode: timed jobs are pg-boss jobs with startAfter (demo mode routes them through deadlines). */
  const setupReal = async () => {
    const s = await setup();
    s.ctx.demoMode = false;
    return s;
  };
  const mailJobs = (s: S, kind: string) =>
    s.scheduler.jobs.filter((j) => j.name === APPLICATION_MAIL_JOB && j.data.kind === kind);
  const run = (s: S, j: (typeof s.scheduler.jobs)[number]) =>
    sendApplicationMail(
      s.ctx,
      String(j.data.applicationId),
      j.data.kind as never,
      Number(j.data.seq),
      j.data.variant as string | undefined,
    );
  const FAR_VIEWING = "2026-11-03T16:30:00+04:00"; // 12:30Z, two days out

  for (const on of [true, false]) {
    test(`viewing_reminder ${on ? "on" : "off"}: ${on ? "queued 24 h before, once, with a singletonKey" : "nothing is queued"}`, async () => {
      database = await freshDatabase();
      await setAutopilot({ viewing_reminder: on });
      const s = await setupReal();
      const { id } = await createWithViewing(s, { viewingAt: FAR_VIEWING });
      const jobs = mailJobs(s, "viewing_reminder");
      if (!on) {
        expect(jobs).toHaveLength(0);
        return;
      }
      expect(jobs).toHaveLength(1);
      const j = jobs[0]!;
      expect(j.startAfter?.toISOString()).toBe("2026-11-02T12:30:00.000Z");
      expect(j.singletonKey).toBe(`${id}:viewing_reminder#1@${new Date(FAR_VIEWING).getTime()}`);
      const before = s.mailer.sent.length;
      expect((await run(s, j)).sent).toBe(true);
      expect(s.lastMail().subject).toContain("Reminder: your viewing");
      expect(s.mailer.sent.length).toBe(before + 1);
      const [row] = await database.db
        .select()
        .from(outboundMessages)
        .where(and(eq(outboundMessages.entityId, id), eq(outboundMessages.template, "application_viewing_reminder")));
      expect(row).toMatchObject({ purpose: "reminder", status: "sent" });
      // A second run (the job twice) sends nothing more.
      expect((await run(s, j)).sent).toBe(false);
      expect(s.mailer.sent.length).toBe(before + 1);
    });
  }

  test("viewing_reminder: skipped when the viewing is already close, and when the application moved on", async () => {
    database = await freshDatabase();
    const s = await setupReal();
    // VIEWING_AT is 8 hours away: a 24 h reminder is already in the past.
    await createWithViewing(s);
    expect(mailJobs(s, "viewing_reminder")).toHaveLength(0);
    const far = await createWithViewing(s, { viewingAt: FAR_VIEWING, email: "other@demo.example" });
    const j = mailJobs(s, "viewing_reminder")[0]!;
    await database.db.update(applications).set({ state: "WITHDRAWN" }).where(eq(applications.id, far.id));
    const before = s.mailer.sent.length;
    expect((await run(s, j)).sent).toBe(false);
    expect(s.mailer.sent.length).toBe(before);
  });

  for (const quiet of [true, false]) {
    test(`quiet_hours ${quiet ? "on" : "off"}: a reminder due at 22:00 Dubai ${quiet ? "waits until 08:00" : "goes at 22:00"}`, async () => {
      database = await freshDatabase();
      await setAutopilot({ quiet_hours: quiet, viewing_reminder_hours: 12 });
      const s = await setupReal();
      await createWithViewing(s, { viewingAt: "2026-11-03T10:00:00+04:00" });
      const j = mailJobs(s, "viewing_reminder")[0]!;
      expect(j.startAfter?.toISOString()).toBe(quiet ? "2026-11-03T04:00:00.000Z" : "2026-11-02T18:00:00.000Z");
      // The sender checks again: inside quiet hours it queues a later job instead of sending.
      s.clock.set(new Date("2026-11-02T18:30:00Z"));
      const jobsBefore = s.scheduler.jobs.length;
      const r = await run(s, j);
      expect(r.sent).toBe(!quiet);
      if (quiet) {
        const later = s.scheduler.jobs.slice(jobsBefore).find((x) => x.data.kind === "viewing_reminder");
        expect(later?.startAfter?.toISOString()).toBe("2026-11-03T04:00:00.000Z");
      }
    });
  }

  for (const on of [true, false]) {
    test(`no_show_followup ${on ? "on" : "off"}: a recorded no-show ${on ? "gets one friendly email" : "gets nothing"}`, async () => {
      database = await freshDatabase();
      await setAutopilot({ no_show_followup: on });
      const s = await setupReal();
      const { id } = await createWithViewing(s);
      s.clock.set(new Date("2026-11-01T14:00:00Z")); // 18:00 Dubai, after the viewing
      const r = await s.staff(s.officer, `/api/applications/${id}/viewing-outcome`, "POST", { outcome: "no_show" });
      expect(r.status).toBe(200);
      const jobs = mailJobs(s, "no_show");
      if (!on) {
        expect(jobs).toHaveLength(0);
        return;
      }
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.singletonKey).toBe(`${id}:no_show#1`);
      expect((await run(s, jobs[0]!)).sent).toBe(true);
      expect(s.lastMail().subject).toContain("We missed you");
      expect((await run(s, jobs[0]!)).sent).toBe(false);
    });
  }

  for (const on of [true, false]) {
    test(`kyc_chase ${on ? "on" : "off"}: ${on ? "one reminder after 48 h without an upload" : "no reminder is queued"}`, async () => {
      database = await freshDatabase();
      await setAutopilot({ kyc_chase: on });
      const s = await setupReal();
      const { id } = await createWithViewing(s);
      await attended(s, id);
      const jobs = mailJobs(s, "docs_chase");
      if (!on) {
        expect(jobs).toHaveLength(0);
        return;
      }
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.startAfter?.toISOString()).toBe("2026-11-03T04:00:00.000Z");
      expect(jobs[0]!.singletonKey).toBe(`${id}:docs_chase#1@1`);
      s.clock.advanceDays(2);
      expect((await run(s, jobs[0]!)).sent).toBe(true);
      expect(s.lastMail().subject).toContain("Reminder: upload your ID documents");
      expect(s.tokens(s.lastMail().text).upload).toBeDefined();
    });
  }

  test("kyc_chase: the hours setting is used, and nothing is sent once documents were uploaded", async () => {
    database = await freshDatabase();
    await setAutopilot({ kyc_chase_hours: 24 });
    const s = await setupReal();
    const { id } = await createWithViewing(s);
    await attended(s, id);
    const j = mailJobs(s, "docs_chase")[0]!;
    expect(j.startAfter?.toISOString()).toBe("2026-11-02T04:00:00.000Z");
    const { upload } = s.tokens(s.lastMail().text);
    expect((await s.upload(upload!, png("priya-eid-front.png"), "emirates_id", "front")).status).toBeLessThan(300);
    const before = s.mailer.sent.length;
    expect((await run(s, j)).sent).toBe(false);
    expect(s.mailer.sent.length).toBe(before);
  });

  test("kyc_chase: a switch turned off after scheduling stops the reminder", async () => {
    database = await freshDatabase();
    const s = await setupReal();
    const { id } = await createWithViewing(s);
    await attended(s, id);
    const j = mailJobs(s, "docs_chase")[0]!;
    await setAutopilot({ kyc_chase: false });
    expect((await run(s, j)).sent).toBe(false);
    expect(
      await database.db.select().from(outboundMessages).where(eq(outboundMessages.template, "application_docs_chase")),
    ).toHaveLength(0);
    expect(id).toBeDefined();
  });

  test("reminders do not depend on TENANCY_OPS (pre-move-in steps)", async () => {
    database = await freshDatabase();
    const s = await setupReal();
    s.ctx.tenancyOps = false;
    // Only tenancy deadlines (renewal, rent, move-out) are held by the flag; these run before move-in.
    await createWithViewing(s, { viewingAt: FAR_VIEWING });
    expect(mailJobs(s, "viewing_reminder")).toHaveLength(1);
  });

  const toHeld = async (autopilot: Record<string, unknown>) => {
    database = await freshDatabase();
    await setAutopilot({ auto_send_offer: false, ...autopilot });
    const s = await setupReal();
    const { id } = await toKyc(s);
    await s.drain();
    return { s, id };
  };

  test("held_offer_auto_release on: after N hours the held offer is sent by system:auto-release, once", async () => {
    const { s, id } = await toHeld({ held_offer_auto_release: true, held_offer_release_hours: 6 });
    const jobs = s.scheduler.jobs.filter((j) => j.name === HELD_OFFER_RELEASE_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.singletonKey).toBe(`${id}:offer-release#1`);
    expect(jobs[0]!.startAfter?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(s.mailer.sent.filter((m) => /offer/i.test(m.subject))).toHaveLength(0);
    expect(await autoReleaseHeldOffer(s.ctx, id, 1)).toEqual({ released: true });
    await s.drain();
    expect(s.mailer.sent.filter((m) => /Your offer/i.test(m.subject))).toHaveLength(1);
    const sent = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, id), eq(leaseEvents.type, "OFFER_SENT")));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actor).toBe("system:auto-release");
    // Twice is safe.
    expect(await autoReleaseHeldOffer(s.ctx, id, 1)).toMatchObject({ released: false });
    expect(s.mailer.sent.filter((m) => /Your offer/i.test(m.subject))).toHaveLength(1);
  });

  test("held_offer_auto_release off: nothing is scheduled and a direct run does nothing", async () => {
    const { s, id } = await toHeld({ held_offer_auto_release: false });
    expect(s.scheduler.jobs.filter((j) => j.name === HELD_OFFER_RELEASE_JOB)).toHaveLength(0);
    expect(await autoReleaseHeldOffer(s.ctx, id, 1)).toEqual({ released: false, reason: "switch is off" });
    await s.drain();
    expect(s.mailer.sent.filter((m) => /Your offer/i.test(m.subject))).toHaveLength(0);
  });

  test("held_offer_auto_release: an offer now outside the limits is not sent; a manager is asked", async () => {
    const { s, id } = await toHeld({ held_offer_auto_release: true });
    await database.db.update(units).set({ askingRentFils: 99_000_000 }).where(eq(units.id, s.unitId));
    const r = await autoReleaseHeldOffer(s.ctx, id, 1);
    expect(r).toMatchObject({ released: false });
    await s.drain();
    expect(s.mailer.sent.filter((m) => /Your offer/i.test(m.subject))).toHaveLength(0);
    const pending = (await database.db.select().from(approvals).where(eq(approvals.entityId, id))).filter(
      (a) => a.gate === "offer_out_of_limits" && a.status === "pending",
    );
    expect(pending).toHaveLength(1);
  });

  test("held_offer_auto_release: an officer who sent it first wins, and quiet hours postpone the release", async () => {
    const { s, id } = await toHeld({ held_offer_auto_release: true });
    s.clock.set(new Date("2026-11-01T19:00:00Z")); // 23:00 Dubai
    const before = s.scheduler.jobs.length;
    expect(await autoReleaseHeldOffer(s.ctx, id, 1)).toEqual({ released: false, reason: "postponed: quiet hours" });
    const again = s.scheduler.jobs.slice(before).find((j) => j.name === HELD_OFFER_RELEASE_JOB);
    expect(again?.startAfter?.toISOString()).toBe("2026-11-02T04:00:00.000Z");
    s.clock.set(new Date("2026-11-02T05:00:00Z"));
    expect((await s.staff(s.officer, `/api/applications/${id}/offer/send`, "POST")).status).toBe(200);
    expect(await autoReleaseHeldOffer(s.ctx, id, 1)).toEqual({ released: false, reason: "the offer is not held" });
  });

  test("demo mode: timed jobs are deadlines the sweep fires; an earlier clock fires nothing, a later one does", async () => {
    database = await freshDatabase();
    await setAutopilot({ viewing_reminder: true });
    const s = await setup(); // demoMode is true
    const { id } = await createWithViewing(s, { viewingAt: FAR_VIEWING });
    // No pg-boss job with startAfter: a deadline row due on the Dubai date instead.
    expect(mailJobs(s, "viewing_reminder")).toHaveLength(0);
    const [d] = await database.db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.entityId, id), like(deadlines.milestone, "timed:%")));
    expect(d).toMatchObject({ dueOn: "2026-11-02", status: "pending" });
    // A negative offset (a clock before the due date) fires nothing.
    s.clock.set(new Date("2026-10-30T04:00:00Z"));
    expect((await sweepDueDeadlines(s.ctx)).filter((f) => f.fired)).toHaveLength(0);
    expect(mailJobs(s, "viewing_reminder")).toHaveLength(0);
    // Fast-forward past the due date: the sweep queues the job, whose handler sends the email.
    s.clock.set(new Date("2026-11-02T08:00:00Z")); // the Dubai date has come, the 12:30Z hour has not
    expect((await sweepDueDeadlines(s.ctx)).filter((f) => f.fired)).toHaveLength(0);
    s.clock.set(new Date("2026-11-02T12:31:00Z"));
    expect((await sweepDueDeadlines(s.ctx)).filter((f) => f.fired)).toHaveLength(1);
    const jobs = mailJobs(s, "viewing_reminder");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.startAfter).toBeUndefined();
    expect((await run(s, jobs[0]!)).sent).toBe(true);
    expect(s.lastMail().subject).toContain("Reminder: your viewing");
    // The sweep never fires it twice.
    expect((await sweepDueDeadlines(s.ctx)).filter((f) => f.fired)).toHaveLength(0);
  });

  for (const quiet of [true, false]) {
    test(`an hour-based reminder (12 h) behaves the same in demo and real mode (quiet hours ${quiet ? "on" : "off"})`, async () => {
      const viewingAt = "2026-11-03T10:00:00+04:00";
      const expected = quiet ? "2026-11-03T04:00:00.000Z" : "2026-11-02T18:00:00.000Z";
      // Real mode: a job with startAfter.
      database = await freshDatabase();
      await setAutopilot({ quiet_hours: quiet, viewing_reminder_hours: 12 });
      const real = await setupReal();
      await createWithViewing(real, { viewingAt });
      expect(mailJobs(real, "viewing_reminder")[0]!.startAfter?.toISOString()).toBe(expected);
      // Demo mode: the same instant is stored in the deadline.
      database = await freshDatabase();
      await setAutopilot({ quiet_hours: quiet, viewing_reminder_hours: 12 });
      const s = await setup();
      const { id } = await createWithViewing(s, { viewingAt });
      const [d] = await database.db
        .select()
        .from(deadlines)
        .where(and(eq(deadlines.entityId, id), like(deadlines.milestone, "timed:%")));
      expect(JSON.parse(d!.note!).startAfter).toBe(expected);
      // The due date has come (Dubai date) but the hour has not: nothing fires, the row stays pending.
      s.clock.set(new Date(new Date(expected).getTime() - 60_000));
      s.clock.set(new Date(Math.max(s.clock.now().getTime(), new Date("2026-11-02T08:00:00Z").getTime())));
      await sweepDueDeadlines(s.ctx);
      if (new Date(expected).getTime() > s.clock.now().getTime()) {
        expect(mailJobs(s, "viewing_reminder")).toHaveLength(0);
        const [still] = await database.db.select().from(deadlines).where(eq(deadlines.id, d!.id));
        expect(still!.status).toBe("pending");
      }
      s.clock.set(new Date(new Date(expected).getTime() + 60_000));
      expect((await sweepDueDeadlines(s.ctx)).filter((f) => f.fired)).toHaveLength(1);
      expect((await run(s, mailJobs(s, "viewing_reminder")[0]!)).sent).toBe(true);
    });
  }

  test("demo mode: the held-offer release is a deadline too, and an off switch at firing time still stops it", async () => {
    database = await freshDatabase();
    await setAutopilot({ auto_send_offer: false, held_offer_auto_release: true, held_offer_release_hours: 24 });
    const s = await setup();
    const { id } = await toKyc(s);
    await s.drain();
    expect(s.scheduler.jobs.filter((j) => j.name === HELD_OFFER_RELEASE_JOB)).toHaveLength(0);
    s.clock.advanceDays(2);
    await sweepDueDeadlines(s.ctx);
    const rel = s.scheduler.jobs.filter((j) => j.name === HELD_OFFER_RELEASE_JOB);
    expect(rel).toHaveLength(1);
    expect(await autoReleaseHeldOffer(s.ctx, id, Number(rel[0]!.data.revision))).toEqual({ released: true });
  });

  test("held_offer_auto_release: a newer held revision is never sent by the old job (checked under the lock)", async () => {
    const { s, id } = await toHeld({ held_offer_auto_release: true });
    // A newer revision is now the held one (a counter arrived between scheduling and firing).
    await database.db
      .update(applications)
      .set({ offer: { ...(await appRow(id)).offer!, revision: 2 } })
      .where(eq(applications.id, id));
    await database.db.insert(leaseEvents).values({
      id: newId(),
      entityKind: "application",
      entityId: id,
      type: "OFFER_HELD",
      actor: "system",
      payload: { revision: 2 },
      at: s.clock.now(),
    });
    expect(await autoReleaseHeldOffer(s.ctx, id, 1)).toMatchObject({ released: false });
    // Even past the pre-check, the send itself refuses a revision the caller did not mean.
    await expect(sendHeldOffer(s.ctx, id, "system:auto-release", 1)).rejects.toMatchObject({ code: "offer_not_held" });
    expect(
      await database.db
        .select()
        .from(leaseEvents)
        .where(and(eq(leaseEvents.entityId, id), eq(leaseEvents.type, "OFFER_SENT"))),
    ).toHaveLength(0);
  });
});

describe.skipIf(noDb)("document check: step log, timeouts, retry (Postgres)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  const logOf = async (s: S, user: { id: string }, id: string) =>
    (await (await s.staff(user, `/api/records/application/${id}/log`)).json()) as {
      text: string;
      actions: string[];
      pending: boolean;
    }[];
  const steps = async (id: string) =>
    (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, id)))
      .filter((e) => e.type.startsWith("KYC_") && e.type !== "KYC_VERIFIED")
      .sort((a, b) => a.at.getTime() - b.at.getTime());

  test("steps are written as audit events by helper:kyc, in words, with no ID numbers", async () => {
    const s = await setup();
    const { id } = await toKyc(s);
    const evs = await steps(id);
    expect(evs.map((e) => e.type)).toEqual([
      "KYC_CHECK_STARTED",
      "KYC_DOC_READ",
      "KYC_DOC_READ",
      "KYC_DECISION_STEP",
      "KYC_CHECK_FINISHED",
    ]);
    expect(evs.every((e) => e.actor === "helper:kyc")).toBe(true);
    expect(evs[0]!.payload).toMatchObject({ documents: 2, model: "fake-vision", attempt: 1 });
    expect(JSON.stringify(evs.map((e) => e.payload))).not.toMatch(/784-1991|4820193|SPC4820193/);
    const text = (await logOf(s, s.officer, id)).map((e) => e.text);
    expect(text).toContain("Checking 2 documents with fake-vision.");
    expect(text.some((t) => t.startsWith("Read the Emirates ID (front) (1 of 2)"))).toBe(true);
    expect(text).toContain("Document check finished: nothing flagged.");
  });

  test("a stuck model call times out, is retried once, then needs_human with an officer task; nothing advances", async () => {
    const s = await setup(() => new Promise(() => {}));
    s.ctx.kyc = { docTimeoutMs: 25 };
    const { id } = await toKyc(s);
    expect(s.llm.visionCalls).toHaveLength(2); // the first document, twice; the second never starts
    expect((await appRow(id)).state).toBe("SCREENING");
    const [run] = await database.db.select().from(helperRuns).where(eq(helperRuns.entityId, id));
    expect(run!.status).toBe("needs_human");
    const [t] = await database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.entityId, id), eq(tasks.kind, "kyc_check_failed")));
    expect(t).toMatchObject({ status: "open", assigneeRole: "leasing_officer" });
    expect(await database.db.select().from(approvals).where(eq(approvals.entityId, id))).toHaveLength(0);
    const types = (await steps(id)).map((e) => e.type);
    expect(types).toEqual(["KYC_CHECK_STARTED", "KYC_DOC_READ", "KYC_CHECK_FAILED"]);
    const log = await logOf(s, s.officer, id);
    const failed = log.find((e) => e.text.startsWith("Document check didn't finish:"));
    expect(failed).toBeDefined();
    expect(failed!.text).toContain("timed out twice");
    expect(failed!.actions).toEqual(["retry_kyc"]);
    // Finance can read the log but can't retry.
    expect(
      (await logOf(s, s.finance, id)).find((e) => e.text.startsWith("Document check didn't finish:"))!.actions,
    ).toEqual([]);
  });

  test("retry: leasing roles only, audited, one job per attempt, refused while running, then it completes", async () => {
    let hang = true;
    const s = await setup(() => (hang ? new Promise(() => {}) : priyaFront()));
    s.ctx.kyc = { docTimeoutMs: 25 };
    const { id } = await toKyc(s);
    const url = `/api/applications/${id}/kyc/retry`;
    expect((await s.staff(s.finance, url, "POST", {})).status).toBe(403);
    hang = false;
    const jobsBefore = s.scheduler.jobs.length;
    const ok = await s.staff(s.officer, url, "POST", {});
    expect(ok.status).toBe(202);
    expect(await ok.json()).toMatchObject({ queued: true, attempt: 2 });
    const queued = s.scheduler.jobs.slice(jobsBefore);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ name: INBOUND_JOB, singletonKey: `${id}:kyc:2`, data: { attempt: 2 } });
    // Running now: a second click is refused and queues nothing.
    const again = await s.staff(s.manager, url, "POST", {});
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code?: string }).code).toBe("check_running");
    expect(s.scheduler.jobs.slice(jobsBefore)).toHaveLength(1);
    const retryEvent = (await steps(id)).find((e) => e.type === "KYC_CHECK_RETRY_REQUESTED")!;
    expect(retryEvent.actor).toBe(`user:${s.officer.id}`);
    // The old task is closed; the run completes and the application moves on.
    await s.drain();
    expect((await appRow(id)).state).toBe("OFFER");
    const kycTasks = await database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.entityId, id), eq(tasks.kind, "kyc_check_failed")));
    expect(kycTasks.map((t) => t.status)).toEqual(["cancelled"]);
    // Nothing to retry any more.
    expect((await s.staff(s.officer, url, "POST", {})).status).toBe(409);
  });

  const reopenInbound = (id: string) =>
    database.db
      .update(inboundEvents)
      .set({ status: "received", result: null, processedAt: null })
      .where(eq(inboundEvents.entityId, id));
  const kycTasks = (id: string) =>
    database.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.entityId, id), eq(tasks.kind, "kyc_check_failed")));
  const policyWith = async (autopilot: Partial<typeof defaultCompanyPolicy.autopilot>) => {
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: { ...defaultCompanyPolicy, autopilot: { ...defaultCompanyPolicy.autopilot, ...autopilot } },
      createdBy: "test",
    });
  };

  test("a later successful run closes the open kyc_check_failed task and moves on (auto verify)", async () => {
    let hang = true;
    const s = await setup(() => (hang ? new Promise(() => {}) : priyaFront()));
    s.ctx.kyc = { docTimeoutMs: 25 };
    const { id } = await toKyc(s);
    expect((await kycTasks(id)).map((t) => t.status)).toEqual(["open"]);
    hang = false;
    // Not through the retry route (which cancels the task itself): a run that simply finishes later.
    await reopenInbound(id);
    const [ib] = await database.db.select().from(inboundEvents).where(eq(inboundEvents.entityId, id));
    await processInbound(s.ctx, ib!.id, 2);
    expect((await appRow(id)).state).toBe("OFFER");
    expect((await kycTasks(id)).map((t) => t.status)).toEqual(["cancelled"]);
  });

  test("a later successful run with auto verify off still creates the kyc_review approval and closes the task", async () => {
    await policyWith({ auto_kyc_verify: false });
    let hang = true;
    const s = await setup(() => (hang ? new Promise(() => {}) : priyaFront()));
    s.ctx.kyc = { docTimeoutMs: 25 };
    const { id } = await toKyc(s);
    hang = false;
    await reopenInbound(id);
    const [ib] = await database.db.select().from(inboundEvents).where(eq(inboundEvents.entityId, id));
    await processInbound(s.ctx, ib!.id, 2);
    expect((await appRow(id)).state).toBe("SCREENING");
    const aps = await database.db.select().from(approvals).where(eq(approvals.entityId, id));
    expect(aps.map((a) => [a.gate, a.status])).toEqual([["kyc_review", "pending"]]);
    expect((await kycTasks(id)).map((t) => t.status)).toEqual(["cancelled"]);
  });

  test("two concurrent runs of the same submission apply once", async () => {
    await policyWith({ auto_kyc_verify: false });
    const s = await setup();
    const { id } = await toKyc(s);
    await database.db.delete(approvals).where(eq(approvals.entityId, id));
    await reopenInbound(id);
    const [ib] = await database.db.select().from(inboundEvents).where(eq(inboundEvents.entityId, id));
    const [a, b] = await Promise.all([processInbound(s.ctx, ib!.id, 2), processInbound(s.ctx, ib!.id, 3)]);
    expect([a, b].filter((r) => (r as { done?: boolean }).done === true)).toHaveLength(1);
    expect(await database.db.select().from(approvals).where(eq(approvals.entityId, id))).toHaveLength(1);
  });

  test("a model error that quotes an ID number is masked in the step log and the failure reason", async () => {
    const s = await setup(() => {
      throw new Error("could not read card 784-1991-4820193-4 for passport A1234567");
    });
    const { id } = await toKyc(s);
    const payloads = JSON.stringify((await steps(id)).map((e) => e.payload));
    expect(payloads).not.toMatch(/784-1991-4820193-4|4820193/);
  });

  test("stuck threshold comes from the Clock: running is quiet, past the threshold it shows retry", async () => {
    const s = await setup();
    const { id } = await createWithViewing(s, { requestedMoveInOn: "2026-12-01" });
    await attended(s, id);
    const { upload } = s.tokens(s.lastMail().text);
    const doc = (await (await s.upload(upload!, png("priya-eid-front.png"), "emirates_id", "front")).json()) as {
      id: string;
    };
    await s.portal("/api/inbound", "POST", {
      token: upload,
      type: "DOCS_UPLOADED",
      payload: { documentIds: [doc.id] },
    });
    // Queued but never processed (the worker is stuck).
    s.clock.set(new Date(new Date(START).getTime() + 9 * 60_000));
    expect((await logOf(s, s.officer, id)).some((e) => e.text.startsWith("Document check didn't"))).toBe(false);
    expect((await s.staff(s.officer, `/api/applications/${id}/kyc/retry`, "POST", {})).status).toBe(409);
    s.clock.set(new Date(new Date(START).getTime() + 11 * 60_000));
    const stuck = (await logOf(s, s.officer, id)).find((e) => e.text.startsWith("Document check didn't finish:"));
    expect(stuck).toMatchObject({ actions: ["retry_kyc"], pending: true });
    expect(stuck!.text).toContain("no result after 11 minutes");
    const r = await s.staff(s.officer, `/api/applications/${id}/kyc/retry`, "POST", {});
    expect(r.status).toBe(202);
    // The retry restarts the clock.
    expect((await logOf(s, s.officer, id)).some((e) => e.text.startsWith("Document check didn't"))).toBe(false);
  });
});
