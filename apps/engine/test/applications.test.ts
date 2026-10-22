import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { newId } from "@leasing/core";
import {
  actionLinks,
  applications,
  approvals,
  contracts,
  type Database,
  deadlines,
  documents,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  tasks,
  unitPhotos,
  units,
} from "@leasing/db";
import { FakeLlm } from "@leasing/llm";
import { and, eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { advance } from "../src/manager/advance.ts";
import { APPLICATION_MAIL_JOB, sendApplicationMail } from "../src/manager/applications.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import { CONTRACT_PREPARE_JOB, DEFAULT_ADDENDUM, prepareContract } from "../src/manager/contracts.ts";
import { INBOUND_JOB, processInbound } from "../src/manager/inbound.ts";
import { sweepDueDeadlines } from "../src/manager/milestones.ts";
import { UnitFields } from "../src/manager/units.ts";
import { addStaff, agreeingDecision, freshDatabase, noDb, testContext } from "./harness.ts";

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
  const landlordId = newId();
  await database.db.insert(parties).values({ id: landlordId, kind: "company", fullNameEn: "Fictional Holdings LLC" });
  const unitId = newId();
  await database.db.insert(units).values({
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
    landlordPartyId: landlordId,
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
      if (j.name === APPLICATION_MAIL_JOB) {
        await sendApplicationMail(t.ctx, String(j.data.applicationId), j.data.kind as never, Number(j.data.seq));
      }
      if (j.name === INBOUND_JOB) await processInbound(t.ctx, String(j.data.inboundEventId));
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
    const [dl] = await database.db.select().from(deadlines).where(eq(deadlines.entityId, id));
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
    await database.db
      .insert(units)
      .values({ id: otherUnit, code: "JVC-0999", building: "Other", community: "JVC", state: "LISTED" });
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
