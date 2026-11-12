import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeEjari, LocalDiskStore } from "@leasing/adapters";
import {
  type CalendarDate,
  DEFAULT_REGISTRATION_SETTINGS,
  defaultBaseRules,
  defaultCompanyPolicy,
  newId,
  type OfferTerms,
  STARTER_FORM,
} from "@leasing/core";
import sharp from "sharp";
import {
  applications,
  companyKycConfigs,
  registrationSettings,
  approvals,
  type Database,
  documents,
  ejariSubmissions,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  tasks,
  units,
} from "@leasing/db";
import { type AgentModel, extractPdf } from "@leasing/helpers";
import { FakeLlm } from "@leasing/llm";
import { and, eq } from "drizzle-orm";
import { dubai2025_01, registerRulebook, resetRulebookRegistry } from "@leasing/rulebook";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import { CONTRACT_FINISH_JOB, DEFAULT_ADDENDUM, finishContract, prepareContract } from "../src/manager/contracts.ts";
import { LEASE_MAIL_JOB, type LeaseMailJob, sendLeaseMail } from "../src/manager/lease-mail.ts";
import {
  EJARI_REVIEW_JOB,
  EJARI_SUBMIT_JOB,
  reviewEjariRejection,
  submitToEjari,
} from "../src/manager/registration.ts";
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
const SECRET = "test-secret";
let database: Database;

/**
 * A lease in CONTRACT for a passport-only tenant whose KYC-verified name is in capitals (as the
 * passport MRZ prints it), on a unit with full property data. All fictional.
 */
async function setup(
  o: {
    ejari?: FakeEjari;
    tawtheeq?: FakeEjari;
    emirate?: "sharjah";
    llm?: FakeLlm;
    dldPropertyNo?: string | null;
    contractAgent?: AgentModel;
  } = {},
) {
  const t = testContext(database, START, {
    ...(o.ejari ? { ejari: o.ejari } : {}),
    ...(o.tawtheeq ? { tawtheeq: o.tawtheeq } : {}),
    ...(o.contractAgent ? { contractAgent: o.contractAgent } : {}),
    llm: o.llm ?? new FakeLlm(agreeingDecision),
  });
  // The company is the landlord (D44): its legal party is the lease's landlord.
  const landlordId = await completeLegalDetails(database, await testCompany(database), {
    legalName: "Fictional Holdings LLC",
    email: "landlord@demo.example",
    signatoryEmail: "landlord@demo.example",
  });
  const tenantId = newId();
  await database.db.insert(parties).values({
    id: tenantId,
    kind: "individual",
    fullNameEn: "LENA TESTOVA",
    email: "lena.applicant@demo.example",
    nationality: "UTO",
    passportNo: "UT2048611",
    passportExpiresOn: "2031-06-29" as CalendarDate,
    birthDate: "1995-06-30" as CalendarDate,
  });
  const unitId = newId();
  await database.db.insert(units).values({
    companyId: await testCompany(database),
    id: unitId,
    code: "MRN-1608",
    building: "Demo Marina Tower",
    community: "Dubai Marina",
    unitNo: "1608",
    dldPropertyNo: o.dldPropertyNo === undefined ? "DEMO-DLD-001608" : o.dldPropertyNo,
    makaniNo: "1111144444",
    bedrooms: 2,
    furnished: false,
    state: "LISTED",
    askingRentFils: 13_500_000,
    ...(o.emirate ? { emirate: o.emirate } : {}),
  });
  const appId = newId();
  await database.db.insert(applications).values({
    id: appId,
    unitId,
    partyId: tenantId,
    state: "CONVERTED",
    source: "staff",
    ref: "A-TEST01",
    kycVerifiedAt: new Date("2026-10-20T08:00:00Z"),
    reservationPaidOn: "2026-10-25" as CalendarDate,
    offer: {
      revision: 1,
      annualRentFils: 13_500_000,
      askingRentFils: 13_500_000,
      cheques: 4,
      depositFils: 675_000,
      rentFreeDays: 0,
      moveInOn: "2026-12-01",
      startOn: "2026-12-01",
      endOn: "2027-11-30",
      reservationFils: 675_000,
      expiresOn: "2026-10-27",
    } as OfferTerms,
  });
  const leaseId = newId();
  await database.db.insert(leases).values({
    id: leaseId,
    ref: "MRN-1608/2026-12",
    unitId,
    applicationId: appId,
    state: "CONTRACT",
    startOn: "2026-12-01" as CalendarDate,
    endOn: "2027-11-30" as CalendarDate,
    annualRentFils: 13_500_000,
    cheques: 4,
    depositFils: 675_000,
    rulesVersion: "dubai-2025-01",
  });
  await database.db.insert(leaseParties).values([
    { leaseId, partyId: tenantId, role: "tenant" },
    { leaseId, partyId: landlordId, role: "landlord" },
  ]);
  const officer = await addStaff(database, "leasing_officer");
  const manager = await addStaff(database, "leasing_manager");
  const finance = await addStaff(database, "finance");
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
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
      headers: { "content-type": "application/json", "x-signer-ip": "203.0.113.7" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  /** Runs queued jobs (as the pg-boss workers would), in order. Ejari jobs only when asked. */
  let done = 0;
  const drain = async (opts: { ejari?: boolean } = {}) => {
    while (done < t.scheduler.jobs.length) {
      const j = t.scheduler.jobs[done]!;
      if (!opts.ejari && (j.name === EJARI_SUBMIT_JOB || j.name === EJARI_REVIEW_JOB)) return;
      done++;
      if (isTimedAgentJob(j)) continue; // a reminder pg-boss would hold until its startAfter
      if (j.name === LEASE_MAIL_JOB) await sendLeaseMail(t.ctx, j.data as unknown as LeaseMailJob);
      if (j.name === CONTRACT_FINISH_JOB) await finishContract(t.ctx, String(j.data.contractId));
      if (j.name === EJARI_SUBMIT_JOB) await submitToEjari(t.ctx, String(j.data.submissionId));
      if (j.name === EJARI_REVIEW_JOB) await reviewEjariRejection(t.ctx, String(j.data.submissionId));
    }
  };
  const signToken = (to: string) => {
    const m = t.mailer.sent.filter((x) => x.to === to && x.subject.startsWith("Tenancy contract to sign")).at(-1);
    return /\/t\/([A-Za-z0-9_-]{30,64})\/sign/.exec(m?.text ?? "")?.[1];
  };
  return {
    ...t,
    app,
    leaseId,
    tenantId,
    landlordId,
    unitId,
    appId,
    officer,
    manager,
    finance,
    staff,
    portal,
    drain,
    signToken,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const leaseRow = async (id: string) => (await database.db.select().from(leases).where(eq(leases.id, id)))[0]!;
const approvalOf = async (leaseId: string, gate: string) =>
  (
    await database.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.entityId, leaseId), eq(approvals.gate, gate as never)))
  )
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1)!;
const eventTypes = async (id: string) =>
  (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, id))).map((e) => e.type);

/** Prepare → officer approves → both parties sign → the lease is in REGISTRATION. */
async function toRegistration(s: S) {
  const p = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
  expect(p.status).toBe("prepared");
  const a = await approvalOf(s.leaseId, "final_contract");
  await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
  await s.drain();
  for (const [email, name] of [
    ["lena.applicant@demo.example", "Lena Testova"],
    ["landlord@demo.example", "Test Signatory"],
  ] as const) {
    const r = await s.portal(`/api/portal/${s.signToken(email)}/sign`, "POST", { typedName: name, consent: true });
    expect(r.status).toBe(201);
  }
  await s.drain();
  expect((await leaseRow(s.leaseId)).state).toBe("REGISTRATION");
}

const okEjari = () => new FakeEjari(() => ({ ok: true, ejariNo: "SIM-X", issuedOn: "2026-11-01" }));
const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.4 fictional certificate ${extra}`);

async function inSharjah<T>(fn: () => Promise<T>) {
  registerRulebook({ ...dubai2025_01, version: "sharjah-2025-01", emirate: "sharjah" });
  try {
    return await fn();
  } finally {
    resetRulebookRegistry();
  }
}

/** Sharjah has no adapter: approving the proposal leaves a submission awaiting manual registration. */
async function toAwaitingManual() {
  const s = await setup({ emirate: "sharjah", ejari: okEjari() });
  await toRegistration(s);
  const a = await approvalOf(s.leaseId, "ejari_submission");
  return { s, a };
}

const record = (s: S, user: { id: string }, fields: Record<string, string>, file?: Uint8Array) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file)
    form.set("certificate", new File([file as Uint8Array<ArrayBuffer>], "cert.pdf", { type: "application/pdf" }));
  return s.app.request(`/api/leases/${s.leaseId}/registration/record`, {
    method: "POST",
    headers: { authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}` },
    body: form,
  });
};
const subRows = async () => database.db.select().from(ejariSubmissions).orderBy(ejariSubmissions.createdAt);
const taskKinds = async (leaseId: string, status?: string) =>
  (await database.db.select().from(tasks).where(eq(tasks.entityId, leaseId)))
    .filter((t) => !status || t.status === status)
    .map((t) => t.kind);

describe.skipIf(noDb)("manual registration", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("approval is required first; approving makes an awaiting_manual attempt and a register_by_hand task", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      expect(a.status).toBe("pending");
      expect(a.title).toContain("by hand");
      expect(a.proposal).toMatchObject({ mode: "manual" });
      expect(await subRows()).toHaveLength(0);
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const subs = await subRows();
      expect(subs).toHaveLength(1);
      expect(subs[0]).toMatchObject({ status: "awaiting_manual", mode: "manual" });
      expect(s.scheduler.jobs.some((j) => j.name === EJARI_SUBMIT_JOB)).toBe(false);
      const t = (await database.db.select().from(tasks).where(eq(tasks.entityId, s.leaseId))).find(
        (x) => x.kind === "register_by_hand",
      );
      expect(t).toMatchObject({ status: "open", dueOn: "2026-11-04" });
      expect(t?.title).toContain("MRN-1608/2026-12");
    }));

  test("recording: a bad reference is refused (422), a good one with a certificate issues by the user", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const [sub] = await subRows();
      const bad = await record(s, s.officer, { submissionId: sub!.id, reference: "nope!", issuedOn: "2026-11-01" });
      expect(bad.status).toBe(422);
      expect(await bad.text()).toContain("Example:");
      const future = await record(s, s.officer, {
        submissionId: sub!.id,
        reference: "12345678",
        issuedOn: "2026-12-30",
      });
      expect(future.status).toBe(422);
      const notPdf = await record(
        s,
        s.officer,
        { submissionId: sub!.id, reference: "12345678", issuedOn: "2026-11-01" },
        new TextEncoder().encode("hello"),
      );
      expect(notPdf.status).toBe(422);
      const ok = await record(
        s,
        s.officer,
        { submissionId: sub!.id, reference: "12345678", issuedOn: "2026-11-01", feePaidAed: "1,000.00" },
        pdf(),
      );
      expect(ok.status).toBe(201);
      const lease = await leaseRow(s.leaseId);
      expect(lease).toMatchObject({ state: "MOVE_IN", ejariNo: "12345678", ejariIssuedOn: "2026-11-01" });
      const [issued] = await subRows();
      expect(issued).toMatchObject({ status: "issued", feePaidFils: 100_000, recordedBy: `user:${s.officer.id}` });
      expect(issued!.certificateDocumentId).toBeTruthy();
      const ev = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId))).find(
        (e) => e.type === "EJARI_ISSUED",
      );
      expect(ev?.actor).toBe(`user:${s.officer.id}`);
      expect(ev?.payload).toMatchObject({
        manual: true,
        reference: "12345678",
        feePaidFils: 100_000,
        simulated: false,
      });
      expect(typeof (ev!.payload as { feeDiffers: unknown }).feeDiffers).toBe("boolean");
      expect(await taskKinds(s.leaseId, "open")).not.toContain("register_by_hand");
      expect(await taskKinds(s.leaseId)).not.toContain("ejari_certificate_missing");
      const doc = (await database.db.select().from(documents).where(eq(documents.leaseId, s.leaseId))).find(
        (d) => d.kind === "ejari_certificate",
      );
      expect(doc).toBeTruthy();
      // The same reference again is a no-op; a different one conflicts.
      const again = await record(s, s.officer, {
        submissionId: sub!.id,
        reference: "12345678",
        issuedOn: "2026-11-01",
      });
      expect(again.status).toBe(200);
    }));

  test("recording without a certificate raises the certificate-missing task", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const [sub] = await subRows();
      const r = await record(s, s.manager, { submissionId: sub!.id, reference: "12345678", issuedOn: "2026-11-01" });
      expect(r.status).toBe(201);
      expect(await taskKinds(s.leaseId, "open")).toContain("ejari_certificate_missing");
    }));

  test("rejecting once leaves a fix task; re-propose, approve, reject again opens ejari_rejected_twice", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const [sub] = await subRows();
      const rej = (id: string) =>
        s.staff(s.officer, `/api/leases/${s.leaseId}/registration/rejected`, "POST", {
          submissionId: id,
          reasons: "Portal says the landlord licence is expired",
        });
      expect((await rej(sub!.id)).status).toBe(201);
      expect((await subRows())[0]).toMatchObject({ status: "rejected" });
      expect((await subRows())[0]!.reasons[0]).toMatchObject({ code: "MANUAL" });
      expect(await taskKinds(s.leaseId, "open")).toContain("registration_fix_and_resubmit");
      expect(await taskKinds(s.leaseId, "open")).not.toContain("register_by_hand");
      expect((await s.staff(s.officer, `/api/leases/${s.leaseId}/ejari/propose`, "POST", {})).status).toBe(201);
      const a2 = await approvalOf(s.leaseId, "ejari_submission");
      expect(a2.id).not.toBe(a.id);
      await decideApproval(s.ctx, a2.id, s.manager, { decision: "approve" });
      const second = (await subRows()).find((x) => x.status === "awaiting_manual")!;
      expect((await rej(second.id)).status).toBe(201);
      expect((await approvalOf(s.leaseId, "ejari_rejected_twice")).status).toBe("pending");
      expect(await eventTypes(s.leaseId)).toContain("EJARI_REJECTED");
    }));

  test("after the twice gate is decided, one more rejection is a fix task, not the gate again", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const rej = async (id: string) =>
        (
          await s.staff(s.officer, `/api/leases/${s.leaseId}/registration/rejected`, "POST", {
            submissionId: id,
            reasons: "Portal says no",
          })
        ).status;
      const [first] = await subRows();
      expect(await rej(first!.id)).toBe(201);
      expect((await s.staff(s.officer, `/api/leases/${s.leaseId}/ejari/propose`, "POST", {})).status).toBe(201);
      const a2 = await approvalOf(s.leaseId, "ejari_submission");
      await decideApproval(s.ctx, a2.id, s.manager, { decision: "approve" });
      const second = (await subRows()).find((x) => x.status === "awaiting_manual")!;
      expect(await rej(second.id)).toBe(201);
      const twice = await approvalOf(s.leaseId, "ejari_rejected_twice");
      // Approving the gate re-proposes the submission; approve that one too.
      await decideApproval(s.ctx, twice.id, s.manager, { decision: "approve" });
      const a3 = await approvalOf(s.leaseId, "ejari_submission");
      await decideApproval(s.ctx, a3.id, s.officer, { decision: "approve" });
      const third = (await subRows()).find((x) => x.status === "awaiting_manual")!;
      expect(await rej(third.id)).toBe(201);
      const gates = (await database.db.select().from(approvals).where(eq(approvals.entityId, s.leaseId))).filter(
        (x) => x.gate === "ejari_rejected_twice",
      );
      expect(gates).toHaveLength(1);
      expect(await taskKinds(s.leaseId, "open")).toContain("registration_fix_and_resubmit");
    }));

  test("the Workspace record of a lease registered by hand carries the pack link", () =>
    inSharjah(async () => {
      const { s } = await toAwaitingManual();
      const rows = (await (await s.staff(s.officer, "/api/records")).json()) as {
        id: string;
        stage: string;
        registrationPackUrl?: string;
      }[];
      const row = rows.find((r) => r.id === s.leaseId);
      expect(row?.stage).toBe("Ejari");
      expect(row?.registrationPackUrl).toBe(`/api/leases/${s.leaseId}/registration/pack`);
    }));

  test("the checklist takes the company's own KYC fields: a custom document (WebP), an answer, and one not asked", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const [l] = await database.db.select().from(leases).where(eq(leases.id, s.leaseId));
      const [u] = await database.db.select().from(units).where(eq(units.id, l!.unitId));
      await database.db.insert(companyKycConfigs).values({
        id: newId(),
        companyId: u!.companyId,
        version: 1,
        form: [
          ...STARTER_FORM,
          {
            key: "employer_letter",
            label: "Employer letter",
            placeholder: "",
            help: "",
            type: "document",
            required: false,
            appliesTo: "both",
            options: [],
            documentKind: "other",
            nameAsPerDocuments: false,
          },
          {
            key: "employer",
            label: "Employer",
            placeholder: "",
            help: "",
            type: "text",
            required: false,
            appliesTo: "both",
            options: [],
            nameAsPerDocuments: false,
          },
        ],
        rules: { base: defaultBaseRules(defaultCompanyPolicy), company: [] },
        createdBy: "test",
      });
      await database.db
        .update(applications)
        .set({ formAnswers: { version: 1, answers: { employer: "Acme Trading LLC" } } })
        .where(eq(applications.id, l!.applicationId!));
      await database.db.insert(registrationSettings).values({
        emirate: "sharjah",
        values: {
          ...DEFAULT_REGISTRATION_SETTINGS.sharjah,
          requiredDocuments: ["signed_contract", "kyc:other:employer_letter", "answer:employer", "answer:pet_count"],
        },
        updatedBy: "test",
        updatedAt: new Date(),
      });
      const webp = new Uint8Array(
        await sharp({ create: { width: 40, height: 30, channels: 3, background: "#336699" } })
          .webp()
          .toBuffer(),
      );
      const { sha256, path } = await s.ctx.uploads.put(webp, "webp");
      const letterId = newId();
      await database.db.insert(documents).values({
        id: letterId,
        applicationId: l!.applicationId,
        kind: "other:employer_letter",
        side: "page",
        status: "verified",
        verifiedAt: new Date("2026-10-20T00:00:00Z"),
        mime: "image/webp",
        sha256,
        path,
      });
      const view = (await (await s.staff(s.officer, `/api/leases/${s.leaseId}/registration`)).json()) as {
        pack: { checklist: { key: string; label: string; status: string; answer?: string }[] };
      };
      expect(view.pack.checklist.map((c) => [c.key, c.status])).toEqual([
        ["signed_contract", "on_file"],
        ["kyc:other:employer_letter", "on_file"],
        ["answer:employer", "on_file"],
        ["answer:pet_count", "not_asked"],
      ]);
      expect(view.pack.checklist[1]!.label).toBe("Tenant document: Employer letter");
      expect(view.pack.checklist[2]!.answer).toBe("Acme Trading LLC");
      const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/registration/pack.pdf`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      // How-to page + lease details + 3 contract pages + the converted WebP letter.
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(6);
      const text = JSON.stringify(await extractPdf(bytes));
      expect(text).toContain("How to register");
      expect(text).toContain("Signed tenancy contract: page 3");
      expect(text).toContain("Tenant document: Employer letter: page 6");
      expect(text).toContain("Acme Trading LLC");
      expect(text).toContain("not asked by this company");
      // The options list offers the company's fields to every emirate's checklist.
      const opts = (await (await s.staff(s.officer, "/api/registration-settings/document-options")).json()) as {
        key: string;
      }[];
      expect(opts.map((o) => o.key)).toEqual(
        expect.arrayContaining(["kyc:passport", "kyc:other:employer_letter", "answer:employer", "title_deed"]),
      );
    }));

  test("the pack attaches both sides of the tenant's ID from the uploads", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const [l] = await database.db.select().from(leases).where(eq(leases.id, s.leaseId));
      const png = Uint8Array.from(
        atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
        (ch) => ch.charCodeAt(0),
      );
      const ids: string[] = [];
      const at = (iso: string) => new Date(iso);
      // Not attached: a rejected file, an unverified one, and an older verified front.
      for (const [status, side, verifiedAt] of [
        ["rejected", "front", null],
        ["uploaded", "front", null],
        ["verified", "front", at("2026-10-01T00:00:00Z")],
      ] as const) {
        const { sha256, path } = await s.ctx.uploads.put(png, "png");
        await database.db.insert(documents).values({
          id: newId(),
          applicationId: l!.applicationId,
          kind: "emirates_id",
          side,
          status,
          verifiedAt,
          mime: "image/png",
          sha256,
          path,
        });
      }
      for (const side of ["front", "back"]) {
        const { sha256, path } = await s.ctx.uploads.put(png, "png");
        const id = newId();
        ids.push(id);
        await database.db.insert(documents).values({
          id,
          applicationId: l!.applicationId,
          kind: "emirates_id",
          side,
          status: "verified",
          verifiedAt: at("2026-10-20T00:00:00Z"),
          mime: "image/png",
          sha256,
          path,
        });
      }
      const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/registration/pack.pdf`);
      const doc = await PDFDocument.load(new Uint8Array(await r.arrayBuffer()));
      // How-to page + lease details + 3 contract pages + 2 ID pages.
      expect(doc.getPageCount()).toBe(7);
      const evs = await database.db
        .select()
        .from(leaseEvents)
        .where(and(eq(leaseEvents.entityId, s.leaseId), eq(leaseEvents.type, "DOCUMENT_VIEWED")));
      const attached = (evs.at(-1)!.payload as { attachedDocumentIds: string[] }).attachedDocumentIds;
      expect(attached.toSorted()).toEqual([...ids, attached.find((x) => !ids.includes(x))!].toSorted());
      expect(attached).toHaveLength(3); // signed contract + the newest verified front and back

      // A file missing from the store is listed on a last page and in the event, never silently dropped.
      await database.db.update(documents).set({ path: "zz/missing.png" }).where(eq(documents.id, ids[1]!));
      const r2 = await s.staff(s.officer, `/api/leases/${s.leaseId}/registration/pack.pdf`);
      expect(r2.status).toBe(200);
      const text2 = JSON.stringify(await extractPdf(new Uint8Array(await r2.arrayBuffer())));
      expect(text2).toContain("Could not attach");
      const last = await database.db
        .select()
        .from(leaseEvents)
        .where(and(eq(leaseEvents.entityId, s.leaseId), eq(leaseEvents.type, "DOCUMENT_VIEWED")));
      const p2 = last.map((e) => e.payload as { notAttached?: string[] }).find((p) => p.notAttached?.length);
      expect(p2?.notAttached?.[0]).toContain("(back)");
    }));

  test("the pack is one PDF (cover with a masked ID, then the signed contract); the view lists the submissions; only leasing roles", () =>
    inSharjah(async () => {
      const { s, a } = await toAwaitingManual();
      await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
      const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/registration/pack.pdf`);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toContain("no-store");
      const bytes = new Uint8Array(await r.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
      const text = (await extractPdf(bytes)) as unknown;
      // The cover masks the ID; the attached signed contract carries it in full, as the office must submit it.
      const all = JSON.stringify(text);
      expect(all.slice(0, all.indexOf("Tenancy contract"))).not.toContain("UT2048611");
      expect(all).toContain("Signature record");
      const view = (await (await s.staff(s.officer, `/api/leases/${s.leaseId}/registration`)).json()) as {
        mode: string;
        submissions: { status: string }[];
        openTaskId: string | null;
        pack: { checklist: { key: string; status: string }[] };
      };
      expect(view.mode).toBe("manual");
      expect(view.submissions[0]!.status).toBe("awaiting_manual");
      expect(view.openTaskId).toBeTruthy();
      expect(view.pack.checklist.find((c) => c.key === "signed_contract")?.status).toBe("on_file");
      expect(await eventTypes(s.leaseId)).toContain("DOCUMENT_VIEWED");
      // One file for the office: the cover, then the signed contract's pages; the download records what it attached.
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThan(1);
      const [viewed] = await database.db
        .select()
        .from(leaseEvents)
        .where(and(eq(leaseEvents.entityId, s.leaseId), eq(leaseEvents.type, "DOCUMENT_VIEWED")));
      expect((viewed!.payload as { attachedDocumentIds: string[] }).attachedDocumentIds.length).toBeGreaterThan(0);
      for (const path of ["", "/pack.pdf"]) {
        expect((await s.staff(s.finance, `/api/leases/${s.leaseId}/registration${path}`)).status).toBe(403);
      }
      const [sub] = await subRows();
      const f = await record(s, s.finance, { submissionId: sub!.id, reference: "12345678", issuedOn: "2026-11-01" });
      expect(f.status).toBe(403);
      expect(
        (
          await s.staff(s.finance, `/api/leases/${s.leaseId}/registration/rejected`, "POST", {
            submissionId: sub!.id,
            reasons: "x",
          })
        ).status,
      ).toBe(403);
    }));
});
