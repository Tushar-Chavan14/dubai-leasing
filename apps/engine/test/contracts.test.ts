import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EjariUnavailableError, FakeEjari, LocalDiskStore } from "@leasing/adapters";
import { inProcessClient } from "@leasing/copilot";
import {
  type CalendarDate,
  defaultCompanyPolicy,
  type EjariPayload,
  newId,
  type OfferTerms,
  propertyUsageFor,
} from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  applications,
  approvals,
  contracts,
  copilotProposals,
  copilotThreads,
  contractSigners,
  type Database,
  companies,
  companyClauses,
  companyPolicy,
  contractRules,
  documents,
  ejariSubmissions,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  tasks,
  units,
} from "@leasing/db";
import { extractPdf } from "@leasing/helpers";
import { FakeLlm, type SystemOneResponse } from "@leasing/llm";
import { and, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { advance } from "../src/manager/advance.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import {
  CONTRACT_FINISH_JOB,
  DEFAULT_ADDENDUM,
  defaultAddendumFor,
  finishContract,
  prepareContract,
} from "../src/manager/contracts.ts";
import { LEASE_MAIL_JOB, type LeaseMailJob, sendLeaseMail } from "../src/manager/lease-mail.ts";
import {
  applyFixes,
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

const nameMismatch = {
  ok: false as const,
  reasons: [
    {
      code: "NAME_MISMATCH",
      field: null,
      message: "The tenant name does not match the name on record for this identity document.",
    },
  ],
};
const fieldAnswer = (choice: string, confidence = 0.94): SystemOneResponse => ({
  model: "tev1:test",
  answers: { field: { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } },
});

/**
 * A lease in CONTRACT for a passport-only tenant whose KYC-verified name is in capitals (as the
 * passport MRZ prints it), on a unit with full property data. All fictional.
 */
async function setup(o: { ejari?: FakeEjari; llm?: FakeLlm; dldPropertyNo?: string | null } = {}) {
  const t = testContext(database, START, {
    ...(o.ejari ? { ejari: o.ejari } : {}),
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

const contractRows = async (leaseId: string) =>
  database.db.select().from(contracts).where(eq(contracts.leaseId, leaseId)).orderBy(contracts.version);
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

describe.skipIf(noDb)("contract (step 5)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("D44: preparing is blocked until the company's legal details and signatory are complete; the signer is the signatory", async () => {
    const s = await setup();
    await database.db.update(companies).set({ signatoryName: null, registeredAddress: null });
    let blocked: unknown;
    try {
      await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    } catch (e) {
      blocked = e;
    }
    expect(blocked).toMatchObject({ code: "landlord_details_missing" });
    expect((blocked as Error).message).toContain("Settings → Companies");
    expect((blocked as Error).message).toContain("authorised signatory name");
    expect(await contractRows(s.leaseId)).toHaveLength(0);
    await database.db.update(companies).set({
      signatoryName: "Sam Signatory",
      registeredAddress: "1 Test Street, Dubai",
      signatoryEmail: "signer@demo.example",
    });
    expect((await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" })).status).toBe(
      "prepared",
    );
  });

  test("D44: a signed contract can't be prepared again from any path; the record names the signatory and company", async () => {
    const s = await setup();
    await toRegistration(s);
    const [signed] = await contractRows(s.leaseId);
    expect(signed!.status).toBe("signed");
    const signers = await database.db.select().from(contractSigners).where(eq(contractSigners.contractId, signed!.id));
    expect(signers.find((x) => x.role === "landlord")).toMatchObject({
      nameEn: "Test Signatory",
      capacity: "Director, for and on behalf of Fictional Holdings LLC",
      email: "landlord@demo.example",
    });
    for (const opts of [{ onlyIfNone: true }, {}, { reprepare: true }]) {
      let err: unknown;
      try {
        await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system", ...opts });
      } catch (e) {
        err = e;
      }
      if (!("onlyIfNone" in opts)) expect(err).toMatchObject({ status: 409 });
    }
    expect((await contractRows(s.leaseId)).map((x) => x.status)).toEqual(["signed"]);
    const [doc] = await database.db.select().from(documents).where(eq(documents.id, signed!.signedDocumentId!));
    expect(doc?.kind).toBe("contract_signed");
  });

  test("the reservation queues the contract job; fields equal their sources exactly", async () => {
    const s = await setup();
    const p = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    expect(p.status).toBe("prepared");
    const [c] = await contractRows(s.leaseId);
    expect(c).toMatchObject({ version: 1, status: "pending_approval" });
    // Every field equals the column its source names, character for character.
    const [unitRow] = await database.db.select().from(units).where(eq(units.id, s.unitId));
    const rows: Record<string, Record<string, unknown>> = {
      party: {},
      // The contract's "kind" is the Ejari usage derived from the unit's category.
      unit: { ...unitRow!, kind: propertyUsageFor(unitRow!.category) },
      lease: (await leaseRow(s.leaseId)) as unknown as Record<string, unknown>,
    };
    for (const [field, src] of Object.entries(c!.sources)) {
      const value = (c!.fields as Record<string, unknown>)[field];
      let expected: unknown;
      if (src.entity === "party") {
        const [party] = await database.db.select().from(parties).where(eq(parties.id, src.id));
        expected = (party as Record<string, unknown>)[src.column];
      } else if (src.entity === "application") {
        const [a] = await database.db.select().from(applications).where(eq(applications.id, src.id));
        expected = (a!.offer as Record<string, unknown>)[src.column.replace("offer.", "")];
      } else {
        expected = rows[src.entity]![src.column];
      }
      expect({ field, value }).toEqual({ field, value: expected });
    }
    expect(c!.fields.tenantNameEn).toBe("LENA TESTOVA");
    // The stored PDF is the one hashed on the contract.
    const [doc] = await database.db.select().from(documents).where(eq(documents.id, c!.documentId!));
    expect(sha256Hex(new Uint8Array(await s.ctx.documents.read(doc!.path)))).toBe(c!.sha256);
    const a = await approvalOf(s.leaseId, "final_contract");
    expect(a).toMatchObject({ status: "pending", approverRole: "leasing_officer" });
    // No model call without free text.
    expect(s.llm.chatCalls).toHaveLength(0);
  });

  test("missing property data → a task, no contract", async () => {
    const s = await setup({ dldPropertyNo: null });
    const r = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    expect(r.status).toBe("needs_human");
    expect(await contractRows(s.leaseId)).toHaveLength(0);
    const ts = await database.db.select().from(tasks).where(eq(tasks.entityId, s.leaseId));
    expect(ts.map((x) => x.kind)).toEqual(["contract_needs_person"]);
  });

  test("approving sends signing links with the PDF; the approval is not consumed yet", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const a = await approvalOf(s.leaseId, "final_contract");
    await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
    await s.drain();
    const [c] = await contractRows(s.leaseId);
    expect(c!.status).toBe("sent");
    const signers = await database.db.select().from(contractSigners).where(eq(contractSigners.contractId, c!.id));
    expect(signers.map((x) => x.role).toSorted()).toEqual(["landlord", "tenant"]);
    const mails = s.mailer.sent.filter((m) => m.subject.startsWith("Tenancy contract to sign"));
    expect(mails).toHaveLength(2);
    expect(mails[0]!.attachments?.[0]?.contentType).toBe("application/pdf");
    expect(sha256Hex(mails[0]!.attachments![0]!.content)).toBe(c!.sha256);
    expect(s.signToken("lena.applicant@demo.example")).toBeTruthy();
    expect((await approvalOf(s.leaseId, "final_contract")).consumedByEventId).toBeNull();
    expect((await leaseRow(s.leaseId)).state).toBe("CONTRACT");
  });

  test("records changed after preparing → approval refused as stale", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    await database.db.update(parties).set({ passportNo: "UT2048612" }).where(eq(parties.id, s.tenantId));
    const a = await approvalOf(s.leaseId, "final_contract");
    await expect(decideApproval(s.ctx, a.id, s.officer, { decision: "approve" })).rejects.toThrow("changed");
    expect((await approvalOf(s.leaseId, "final_contract")).status).toBe("pending");
  });

  describe("company clauses (Contract AI)", () => {
    const WORDING = "The tenant keeps the balcony clear of laundry and storage.";
    const clause = async (companyId: string, over: Partial<typeof companyClauses.$inferInsert> = {}) => {
      const id = newId();
      await database.db.insert(companyClauses).values({
        id,
        companyId,
        title: "Balcony",
        textEn: WORDING,
        category: "other",
        hasValues: false,
        status: "approved",
        createdBy: "test",
        ...over,
      });
      return `cc:${id}` as const;
    };
    const unitCompany = async (s: S) =>
      (await database.db.select().from(units).where(eq(units.id, s.unitId)))[0]!.companyId;

    test("an approved company clause is printed under Additional terms (company) and the gate is still required", async () => {
      const s = await setup();
      const ref = await clause(await unitCompany(s));
      const p = await prepareContract(s.ctx, s.leaseId, {
        addendum: { clauses: ["no_pets", ref], freeText: null },
        actor: "system",
      });
      expect(p.status).toBe("prepared");
      const [c] = await contractRows(s.leaseId);
      expect(c!.addendum.clauses).toEqual(["no_pets", ref]);
      expect(c!.addendum.companyClauses).toEqual([
        { id: ref.slice(3), title: "Balcony", text: WORDING, category: "other" },
      ]);
      const [doc] = await database.db.select().from(documents).where(eq(documents.id, c!.documentId!));
      const text = await extractPdf(new Uint8Array(await s.ctx.documents.read(doc!.path)));
      const pdfText = text.ok ? text.text : "";
      expect(pdfText).toContain("Additional terms (company)");
      expect(pdfText).toContain(WORDING);
      // Nothing moved: the final_contract approval is pending and the lease is still waiting.
      expect((await approvalOf(s.leaseId, "final_contract")).status).toBe("pending");
      expect((await leaseRow(s.leaseId)).state).toBe("CONTRACT");
      expect(c!.status).toBe("pending_approval");
    });

    test("an unapproved, rejected or other-company clause id is refused with 422", async () => {
      const s = await setup();
      const mine = await unitCompany(s);
      const other = await testCompany(database, { slug: "elsewhere", rules: false });
      for (const ref of [
        await clause(mine, { status: "proposed" }),
        await clause(mine, { status: "rejected" }),
        await clause(other),
        `cc:${newId()}` as const,
      ]) {
        const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/contract/prepare`, "POST", {
          clauses: [ref],
          freeText: null,
        });
        expect(r.status).toBe(422);
        expect(((await r.json()) as { code: string }).code).toBe("bad_clause");
      }
      expect(await contractRows(s.leaseId)).toHaveLength(0);
    });

    test("a client-sent companyClauses text is ignored: the printed wording is the approved one", async () => {
      const s = await setup();
      const ref = await clause(await unitCompany(s));
      const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/contract/prepare`, "POST", {
        clauses: [ref],
        freeText: null,
        companyClauses: [{ id: ref.slice(3), title: "Forged", text: "Rent is zero." }],
      });
      expect(r.status).toBe(201);
      const [c] = await contractRows(s.leaseId);
      expect(c!.addendum.companyClauses).toEqual([
        { id: ref.slice(3), title: "Balcony", text: WORDING, category: "other" },
      ]);
    });

    test("the matching contract rule preselects its clauses (standard and approved company ones)", async () => {
      const s = await setup();
      const companyId = await unitCompany(s);
      const ref = await clause(companyId);
      const gone = await clause(companyId, { status: "rejected" });
      await database.db.insert(contractRules).values({
        id: newId(),
        companyId,
        category: "residential",
        tenures: ["annual"],
        minCheques: 1,
        maxCheques: 4,
        clauseIds: ["parking", ref, gone],
        createdBy: "test",
      });
      const a = await defaultAddendumFor(s.ctx.database, s.leaseId);
      expect(a.clauses).toEqual(["parking", ref]);
      const view = (await (await s.staff(s.officer, `/api/leases/${s.leaseId}/contract`)).json()) as {
        clauseOptions: { suggested: string[]; companyClauses: { ref: string }[] };
      };
      expect(view.clauseOptions.suggested).toEqual(["parking", ref]);
      expect(view.clauseOptions.companyClauses.map((c) => c.ref)).toEqual([ref]);
    });

    test("the renderer refuses a cc: ref that has no wording", async () => {
      const { contractDocument } = await import("@leasing/helpers");
      const fields = {} as never;
      expect(() =>
        contractDocument(
          {
            ...(fields as object),
            leaseRef: "X",
            tenantNameEn: "T",
            landlordNameEn: "L",
            startOn: "2026-12-01",
            endOn: "2027-11-30",
            annualRentFils: 1,
            depositFils: 0,
            cheques: 1,
            rentFreeDays: 0,
            moveInOn: "2026-12-01",
          } as never,
          { clauses: [`cc:${newId()}`], freeText: null },
          { version: 1, reference: "C-1", preparedOn: "2026-10-19" as CalendarDate, demo: true },
        ),
      ).toThrow("no wording");
    });

    test("without a matching rule the default clauses are used", async () => {
      const s = await setup();
      expect(await defaultAddendumFor(s.ctx.database, s.leaseId)).toEqual(DEFAULT_ADDENDUM);
    });
  });

  test("final_contract can't be edited, and its preparer can't approve it", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: `user:${s.officer.id}` });
    const a = await approvalOf(s.leaseId, "final_contract");
    await expect(decideApproval(s.ctx, a.id, s.officer, { decision: "approve" })).rejects.toThrow("own proposal");
    await expect(
      decideApproval(s.ctx, a.id, s.manager, { decision: "edit", proposal: { fields: {} } }),
    ).rejects.toMatchObject({ reasons: [expect.stringContaining("can't be edited")] });
    await decideApproval(s.ctx, a.id, s.manager, { decision: "approve" });
    expect((await contractRows(s.leaseId))[0]!.status).toBe("sent");
  });

  test("a re-issue with free text: reviewed by the chat model, old version superseded", async () => {
    const llm = new FakeLlm(agreeingDecision, undefined, () => ({
      flags: [
        { kind: "illegal_term", quote: "Rent rises 10% after six months.", reason: "rent is fixed for the term" },
      ],
    }));
    const s = await setup({ llm });
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const first = await approvalOf(s.leaseId, "final_contract");
    const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/contract/prepare`, "POST", {
      clauses: ["no_pets"],
      freeText: "Rent rises 10% after six months.",
    });
    expect(r.status).toBe(201);
    const [v1, v2] = await contractRows(s.leaseId);
    expect(v1!.status).toBe("superseded");
    expect(v2).toMatchObject({ version: 2, status: "pending_approval" });
    expect(v2!.addendum.freeText).toBe("Rent rises 10% after six months.");
    expect(v2!.flags.map((f) => f.kind)).toEqual(["illegal_term"]);
    expect((await database.db.select().from(approvals).where(eq(approvals.id, first.id)))[0]!.status).toBe("cancelled");
    const a2 = await approvalOf(s.leaseId, "final_contract");
    expect(a2.reasons[0]).toContain("illegal term");
  });

  test("signing: name must match, links work once, partial signing doesn't advance, then REGISTRATION", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    await decideApproval(s.ctx, (await approvalOf(s.leaseId, "final_contract")).id, s.officer, { decision: "approve" });
    await s.drain();
    const tenantToken = s.signToken("lena.applicant@demo.example")!;
    const view = (await (await s.portal(`/api/portal/${tenantToken}`)).json()) as Record<string, unknown>;
    expect(view).toMatchObject({ kind: "sign", role: "tenant", signerName: "LENA TESTOVA", canSign: true });
    // The passport number is masked in the portal view.
    expect(JSON.stringify(view)).not.toContain("UT2048611");
    expect((await s.portal(`/api/portal/${tenantToken}/contract.pdf`)).headers.get("content-type")).toBe(
      "application/pdf",
    );

    const wrong = await s.portal(`/api/portal/${tenantToken}/sign`, "POST", { typedName: "Lena Smith", consent: true });
    expect(wrong.status).toBe(422);
    const noConsent = await s.portal(`/api/portal/${tenantToken}/sign`, "POST", { typedName: "Lena Testova" });
    expect(noConsent.status).toBe(422);
    const ok = await s.portal(`/api/portal/${tenantToken}/sign`, "POST", { typedName: "lena  testova", consent: true });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ allSigned: false });
    const again = await s.portal(`/api/portal/${tenantToken}/sign`, "POST", {
      typedName: "Lena Testova",
      consent: true,
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(s.scheduler.jobs.some((j) => j.name === CONTRACT_FINISH_JOB)).toBe(false);
    expect((await leaseRow(s.leaseId)).state).toBe("CONTRACT");

    const landlordToken = s.signToken("landlord@demo.example")!;
    // D44: the landlord signer is the company's authorised signatory and types their own name, not the company's.
    const lview = (await (await s.portal(`/api/portal/${landlordToken}`)).json()) as Record<string, unknown>;
    expect(lview).toMatchObject({
      role: "landlord",
      signerName: "Test Signatory",
      signerCapacity: "Director, for and on behalf of Fictional Holdings LLC",
    });
    expect(
      (
        await s.portal(`/api/portal/${landlordToken}/sign`, "POST", {
          typedName: "Fictional Holdings LLC",
          consent: true,
        })
      ).status,
    ).toBe(422);
    expect(
      (await s.portal(`/api/portal/${landlordToken}/sign`, "POST", { typedName: "test  signatory", consent: true }))
        .status,
    ).toBe(201);
    await s.drain();
    const [c] = await contractRows(s.leaseId);
    expect(c!.status).toBe("signed");
    // The signed copy = approved pages + a signature record page, stored with its hash.
    const [signedDoc] = await database.db.select().from(documents).where(eq(documents.id, c!.signedDocumentId!));
    const signedBytes = new Uint8Array(await s.ctx.documents.read(signedDoc!.path));
    expect(sha256Hex(signedBytes)).toBe(c!.signedSha256!);
    const [approvedDoc] = await database.db.select().from(documents).where(eq(documents.id, c!.documentId!));
    const approvedPages = (await PDFDocument.load(await s.ctx.documents.read(approvedDoc!.path))).getPageCount();
    expect((await PDFDocument.load(signedBytes)).getPageCount()).toBe(approvedPages + 1);
    const signer = (await database.db.select().from(contractSigners).where(eq(contractSigners.role, "tenant")))[0]!;
    expect(signer).toMatchObject({ typedName: "lena  testova", ip: "203.0.113.7" });

    expect((await leaseRow(s.leaseId)).state).toBe("REGISTRATION");
    const fc = await approvalOf(s.leaseId, "final_contract");
    expect(fc.consumedByEventId).toBeTruthy();
    const types = await eventTypes(s.leaseId);
    expect(types).toContain("CONTRACT_SIGNED");
    const signedBy = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId))).filter(
      (e) => e.type === "CONTRACT_SIGNED_BY",
    );
    expect(signedBy.map((e) => e.actor).toSorted()).toEqual([`landlord:${s.landlordId}`, `tenant:${s.tenantId}`]);
    expect(types.filter((x) => x === "CONTRACT_SIGNED_BY")).toHaveLength(2);
    // Both parties get the signed copy.
    expect(s.mailer.sent.filter((m) => m.subject.startsWith("Contract signed"))).toHaveLength(2);
    // Entering REGISTRATION proposes the Ejari submission, built from the signed contract.
    const ej = await approvalOf(s.leaseId, "ejari_submission");
    expect(ej.status).toBe("pending");
    expect((ej.proposal as { payload: EjariPayload }).payload).toMatchObject({
      tenantNameEn: "LENA TESTOVA",
      tenantIdType: "passport",
      tenantIdNo: "UT2048611",
      dldPropertyNo: "DEMO-DLD-001608",
      annualRentFils: 13_500_000,
    });
    // ...and the inbox shows ID numbers masked.
    const inbox = await (await s.staff(s.officer, `/api/approvals/${ej.id}`)).text();
    expect(inbox).not.toContain("UT2048611");
  });

  test("a changed PDF on file, a superseded link and a name with digits are all refused", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    await database.db
      .update(contracts)
      .set({ sha256: "0".repeat(64) })
      .where(eq(contracts.id, c!.id));
    const a = await approvalOf(s.leaseId, "final_contract");
    await expect(decideApproval(s.ctx, a.id, s.officer, { decision: "approve" })).rejects.toThrow("not the one");
    await database.db.update(contracts).set({ sha256: c!.sha256 }).where(eq(contracts.id, c!.id));
    await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
    await s.drain();
    const oldToken = s.signToken("lena.applicant@demo.example")!;
    const digits = await s.portal(`/api/portal/${oldToken}/sign`, "POST", {
      typedName: "Lena Testova 9",
      consent: true,
    });
    expect(digits.status).toBe(422);
    // A new version: the old link no longer signs anything.
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const old = await s.portal(`/api/portal/${oldToken}/sign`, "POST", { typedName: "Lena Testova", consent: true });
    expect(old.status).toBeGreaterThanOrEqual(400);
    expect((await contractRows(s.leaseId)).map((x) => x.status)).toEqual(["superseded", "pending_approval"]);
  });

  test("the prepare job never supersedes a contract in progress", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system", onlyIfNone: true });
    const again = await prepareContract(s.ctx, s.leaseId, {
      addendum: DEFAULT_ADDENDUM,
      actor: "system",
      onlyIfNone: true,
    });
    expect(again.status).toBe("exists");
    expect(await contractRows(s.leaseId)).toHaveLength(1);
  });

  test("CONTRACT_SIGNED is refused without a fully signed contract", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const a = await approvalOf(s.leaseId, "final_contract");
    await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
    const [c] = await contractRows(s.leaseId);
    await expect(
      advance(s.ctx, { kind: "lease", id: s.leaseId }, "CONTRACT_SIGNED", {
        actor: "system",
        approvalId: a.id,
        payload: { contractId: c!.id },
      }),
    ).rejects.toThrow("not signed by everyone");
  });

  test("the contract PDF is for leasing staff only and every view is recorded", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    expect((await s.staff(s.finance, `/api/leases/${s.leaseId}/documents/${c!.documentId}`)).status).toBe(403);
    expect((await s.staff(s.officer, `/api/leases/${s.leaseId}/documents/${c!.documentId}`)).status).toBe(200);
    expect(await eventTypes(s.leaseId)).toContain("DOCUMENT_VIEWED");
    const lease = (await (await s.staff(s.finance, `/api/leases/${s.leaseId}`)).json()) as { contracts: unknown[] };
    expect(lease.contracts).toHaveLength(1);
    expect(JSON.stringify(lease.contracts)).not.toContain("UT2048611");
  });
});

describe.skipIf(noDb)("Ejari registration (step 6)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  async function approveSubmission(s: S) {
    const a = await approvalOf(s.leaseId, "ejari_submission");
    await decideApproval(s.ctx, a.id, s.officer, { decision: "approve" });
    return a;
  }

  test("the demo name-case rejection is fixed once from the verified name and issued", async () => {
    const ejari = new FakeEjari((p) =>
      p.tenantNameEn === "Lena Testova"
        ? { ok: true, ejariNo: "SIM-2026-0000042", issuedOn: "2026-11-01" }
        : nameMismatch,
    );
    const s = await setup({ ejari, llm: new FakeLlm(() => fieldAnswer("tenantNameEn")) });
    await toRegistration(s);
    const a = await approveSubmission(s);
    await s.drain({ ejari: true });
    const subs = await database.db.select().from(ejariSubmissions).orderBy(ejariSubmissions.attempt);
    expect(subs.map((x) => [x.attempt, x.status])).toEqual([
      [1, "rejected"],
      [2, "issued"],
    ]);
    expect(subs[1]!.autofix).toEqual([
      {
        field: "tenantNameEn",
        from: "LENA TESTOVA",
        to: "Lena Testova",
        source: `party:${s.tenantId}:fullNameEn (KYC-verified) (title case)`,
      },
    ]);
    // Only the name changed; everything else is the signed contract's.
    expect({ ...subs[1]!.payload, tenantNameEn: "LENA TESTOVA" }).toEqual(subs[0]!.payload);
    const lease = await leaseRow(s.leaseId);
    expect(lease).toMatchObject({ state: "MOVE_IN", ejariNo: "SIM-2026-0000042", ejariIssuedOn: "2026-11-01" });
    expect((await approvalOf(s.leaseId, "ejari_submission")).consumedByEventId).toBeTruthy();
    expect(a.id).toBe(subs[0]!.approvalId);
    expect(await eventTypes(s.leaseId)).toEqual(
      expect.arrayContaining(["EJARI_REJECTED", "EJARI_AUTOFIX", "EJARI_ISSUED"]),
    );
    // The contract keeps its signed text.
    expect((await contractRows(s.leaseId))[0]!.fields.tenantNameEn).toBe("LENA TESTOVA");
    // The certificate is stored and emailed to the tenant.
    expect(subs[1]!.certificateDocumentId).toBeTruthy();
    const mail = s.mailer.sent.find((m) => m.subject.startsWith("Ejari registration"));
    expect(mail?.attachments?.[0]?.filename).toContain("SIM-2026-0000042");
    expect(ejari.calls).toHaveLength(2);
  });

  test("a rejection that is not a name-case problem goes to a person, with no resubmission", async () => {
    const ejari = new FakeEjari(() => ({
      ok: false,
      reasons: [
        {
          code: "ACTIVE_REGISTRATION_EXISTS",
          field: null,
          message: "The property already has an active registration.",
        },
      ],
    }));
    const s = await setup({ ejari, llm: new FakeLlm(() => fieldAnswer("none")) });
    await toRegistration(s);
    await approveSubmission(s);
    await s.drain({ ejari: true });
    expect(await database.db.select().from(ejariSubmissions)).toHaveLength(1);
    const p = await approvalOf(s.leaseId, "ejari_rejected_twice");
    expect(p.status).toBe("pending");
    expect((await leaseRow(s.leaseId)).state).toBe("REGISTRATION");
    // Rejecting it leaves a task for a manager; approving it proposes a fresh submission.
    await decideApproval(s.ctx, p.id, s.officer, { decision: "approve" });
    const subsApprovals = (
      await database.db
        .select()
        .from(approvals)
        .where(and(eq(approvals.entityId, s.leaseId), eq(approvals.gate, "ejari_submission")))
    ).map((x) => x.status);
    expect(subsApprovals.toSorted()).toEqual(["approved", "pending"]);
  });

  test("the corrected resubmission rejected again → a person (no second fix)", async () => {
    const ejari = new FakeEjari(() => nameMismatch);
    const s = await setup({ ejari, llm: new FakeLlm(() => fieldAnswer("tenantNameEn")) });
    await toRegistration(s);
    await approveSubmission(s);
    await s.drain({ ejari: true });
    const subs = await database.db.select().from(ejariSubmissions);
    expect(subs.map((x) => x.status)).toEqual(["rejected", "rejected"]);
    const p = await approvalOf(s.leaseId, "ejari_rejected_twice");
    expect(p.title).toContain("twice");
    expect((p.proposal as { attempts: unknown[] }).attempts).toHaveLength(2);
    expect(ejari.calls).toHaveLength(2);
  });

  test("an unreadable decision → a person, never a guess", async () => {
    const ejari = new FakeEjari(() => nameMismatch);
    const s = await setup({ ejari, llm: new FakeLlm(() => new Error("model down")) });
    await toRegistration(s);
    await approveSubmission(s);
    await s.drain({ ejari: true });
    expect(await database.db.select().from(ejariSubmissions)).toHaveLength(1);
    expect((await approvalOf(s.leaseId, "ejari_rejected_twice")).status).toBe("pending");
  });

  test("a rejected submission leaves a task; EJARI_ISSUED needs an issued submission of the approval", async () => {
    const s = await setup();
    await toRegistration(s);
    const a = await approvalOf(s.leaseId, "ejari_submission");
    await expect(
      advance(s.ctx, { kind: "lease", id: s.leaseId }, "EJARI_ISSUED", {
        actor: "system",
        approvalId: a.id,
        payload: { ejariNo: "SIM-FAKE", issuedOn: "2026-11-01" },
      }),
    ).rejects.toThrow();
    await decideApproval(s.ctx, a.id, s.officer, { decision: "reject", note: "wrong unit" });
    const ts = await database.db.select().from(tasks).where(eq(tasks.entityId, s.leaseId));
    expect(ts.map((x) => x.kind)).toContain("ejari_submission_rejected");
    const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/ejari/propose`, "POST", {});
    expect(r.status).toBe(201);
  });

  test("rejecting ejari_rejected_twice leaves a task for a manager", async () => {
    const ejari = new FakeEjari(() => nameMismatch);
    const s = await setup({ ejari, llm: new FakeLlm(() => fieldAnswer("none")) });
    await toRegistration(s);
    await approveSubmission(s);
    await s.drain({ ejari: true });
    const p = await approvalOf(s.leaseId, "ejari_rejected_twice");
    await decideApproval(s.ctx, p.id, s.officer, { decision: "reject", note: "amend the contract" });
    const ts = await database.db.select().from(tasks).where(eq(tasks.entityId, s.leaseId));
    expect(ts.find((x) => x.kind === "ejari_blocked")?.assigneeRole).toBe("leasing_manager");
  });

  test("applyFixes refuses anything but a typo-class name change from the sent value", () => {
    const p = {
      tenantNameEn: "LENA TESTOVA",
      landlordNameEn: "Fictional Holdings LLC",
      annualRentFils: 1,
    } as unknown as EjariPayload;
    expect(() => applyFixes(p, [{ field: "annualRentFils", from: "1", to: "2", source: "x" } as never])).toThrow();
    expect(() =>
      applyFixes(p, [{ field: "tenantNameEn", from: "LENA TESTOVA", to: "Lena Smith", source: "x" }]),
    ).toThrow();
    expect(() => applyFixes(p, [{ field: "tenantNameEn", from: "OTHER", to: "Other", source: "x" }])).toThrow();
    expect(
      applyFixes(p, [{ field: "tenantNameEn", from: "LENA TESTOVA", to: "Lena Testova", source: "x" }]).tenantNameEn,
    ).toBe("Lena Testova");
  });

  test("the submit job is idempotent and an outage is retried, then handed to a person", async () => {
    let down = true;
    const ejari = new FakeEjari(() =>
      down ? new EjariUnavailableError("503") : { ok: true, ejariNo: "SIM-1", issuedOn: "2026-11-01" },
    );
    const s = await setup({ ejari });
    await toRegistration(s);
    await approveSubmission(s);
    const [sub] = await database.db.select().from(ejariSubmissions);
    await expect(submitToEjari(s.ctx, sub!.id)).rejects.toThrow("will retry");
    expect((await database.db.select().from(ejariSubmissions))[0]).toMatchObject({ status: "queued", tries: 1 });
    down = false;
    await submitToEjari(s.ctx, sub!.id);
    await submitToEjari(s.ctx, sub!.id); // a duplicate run does nothing
    expect(ejari.calls.filter((c) => c.requestId === sub!.id)).toHaveLength(2);
    expect((await leaseRow(s.leaseId)).ejariNo).toBe("SIM-1");

    // A registry that stays down: after the policy's attempts, a task, no endless retries.
    const s2db = await freshDatabase();
    database = s2db;
    const ejari2 = new FakeEjari(() => new EjariUnavailableError("503"));
    const s2 = await setup({ ejari: ejari2 });
    await toRegistration(s2);
    await approveSubmission(s2);
    const [sub2] = await database.db.select().from(ejariSubmissions);
    await expect(submitToEjari(s2.ctx, sub2!.id)).rejects.toThrow();
    await expect(submitToEjari(s2.ctx, sub2!.id)).rejects.toThrow();
    await submitToEjari(s2.ctx, sub2!.id);
    expect((await database.db.select().from(ejariSubmissions))[0]).toMatchObject({ status: "error", tries: 3 });
    const ts = await database.db.select().from(tasks).where(eq(tasks.entityId, s2.leaseId));
    expect(ts.map((x) => x.kind)).toContain("ejari_unreachable");
  });
});

describe.skipIf(noDb)("end to end: contract → Ejari → move-in → rent → complaint (phase 3 exit)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  /** tev1: a leak report is a routine plumbing issue; everything else agrees, as in the tests above. */
  const decide = (state: string): SystemOneResponse =>
    /"""[^"]*leak/i.test(state)
      ? {
          model: "tev1:test",
          answers: {
            category: { type: "choice", choice: "plumbing", confidence: 0.92, probabilities: {} },
            urgency: { type: "score", score: 1, confidence: 0.8, probabilities: {} },
            safety: { type: "noul", noul: 0.04 },
            legal_threat: { type: "noul", noul: 0.02 },
            system_instruction: { type: "noul", noul: 0.02 },
            language: { type: "choice", choice: "en", confidence: 0.99, probabilities: {} },
          },
        }
      : agreeingDecision();

  test("signed, registered, moved in, a cheque bounces, the formal reminder starts the rulebook clock, a leak becomes a ticket", async () => {
    const ejari = new FakeEjari(() => ({ ok: true, ejariNo: "SIM-2026-0000777", issuedOn: "2026-11-01" }));
    const llm = new FakeLlm(
      decide,
      undefined,
      () => "Thank you for your report. Our leasing team has received it and will contact you.",
    );
    const s = await setup({ ejari, llm });
    const { completeMoveInChecklist } = await import("./harness.ts");
    const { sweepDueDeadlines } = await import("../src/manager/milestones.ts");
    const { createLink } = await import("../src/manager/links.ts");
    const { withTx, payments, complaints, maintenanceTickets } = await import("@leasing/db");

    // Steps 5–6: contract signed, Ejari issued.
    await toRegistration(s);
    await decideApproval(s.ctx, (await approvalOf(s.leaseId, "ejari_submission")).id, s.officer, {
      decision: "approve",
    });
    await s.drain({ ejari: true });
    expect((await leaseRow(s.leaseId)).state).toBe("MOVE_IN");

    // Step 7: the checklist gates the move-in; then ACTIVE with the instalments and the move-in email.
    expect((await s.staff(s.officer, `/api/leases/${s.leaseId}/move-in/complete`, "POST")).status).toBe(422);
    await completeMoveInChecklist(s.ctx, s.leaseId);
    expect((await s.staff(s.officer, `/api/leases/${s.leaseId}/move-in/complete`, "POST")).status).toBe(200);
    await s.drain();
    expect((await leaseRow(s.leaseId)).state).toBe("ACTIVE");
    const pays = await database.db.select().from(payments).where(eq(payments.leaseId, s.leaseId)).orderBy(payments.seq);
    expect(pays.map((p) => [p.dueOn as string, p.amountFils, p.status as string])).toEqual([
      ["2026-12-01", 3_375_000, "scheduled"],
      ["2027-03-01", 3_375_000, "scheduled"],
      ["2027-06-01", 3_375_000, "scheduled"],
      ["2027-09-01", 3_375_000, "scheduled"],
    ]);
    expect(s.mailer.sent.some((m) => m.to === "lena.applicant@demo.example" && /move-in/i.test(m.subject))).toBe(true);

    // Step 8: the reminder goes out a week before; the first cheque bounces.
    s.clock.advanceDays(23); // 2026-11-24
    await sweepDueDeadlines(s.ctx);
    await s.drain();
    expect(s.mailer.sent.at(-1)!.subject).toMatch(/^Rent reminder: payment 1 of 4/);
    s.clock.advanceDays(7); // 2026-12-01
    expect(
      (await s.staff(s.finance, `/api/payments/${pays[0]!.id}/record`, "POST", { outcome: "bounced" })).status,
    ).toBe(200);
    await s.drain();
    s.clock.advanceDays(7);
    await sweepDueDeadlines(s.ctx);
    await s.drain();
    s.clock.advanceDays(7); // 2026-12-15: two friendly reminders → formal reminder drafted, not sent
    await sweepDueDeadlines(s.ctx);
    await s.drain();
    const formal = await approvalOf(s.leaseId, "formal_reminder");
    expect(formal.status).toBe("pending");
    expect(s.mailer.sent.some((m) => /formal/i.test(m.subject))).toBe(false);
    await decideApproval(s.ctx, formal.id, s.manager, { decision: "approve" });
    await s.drain();
    const p1 = (await database.db.select().from(payments).where(eq(payments.id, pays[0]!.id)))[0]!;
    expect(p1.formalReminderSentOn as string).toBe("2026-12-15");
    expect(p1.evictionEligibleOn as string).toBe("2027-01-14"); // + 30 days, dubai-2025-01

    // A leak reported in the portal becomes a ticket; the tenant gets the checked acknowledgement.
    const link = await withTx(database, (tx) =>
      createLink(s.ctx, tx, {
        purpose: "tenancy",
        entity: { kind: "lease", id: s.leaseId },
        partyId: s.tenantId,
        ttlDays: 30,
      }),
    );
    const r = await s.portal("/api/inbound", "POST", {
      token: link.token,
      type: "COMPLAINT_SUBMITTED",
      payload: { description: "Water leak under the kitchen sink", room: "Kitchen", atRisk: false },
    });
    expect(r.status).toBe(202);
    const { processInbound, INBOUND_JOB } = await import("../src/manager/inbound.ts");
    for (const j of s.scheduler.jobs.filter((x) => x.name === INBOUND_JOB))
      await processInbound(s.ctx, String(j.data.inboundEventId));
    await s.drain();
    const [c] = await database.db.select().from(complaints).where(eq(complaints.leaseId, s.leaseId));
    expect(c).toMatchObject({ status: "ticketed", category: "plumbing" });
    const [ticket] = await database.db.select().from(maintenanceTickets);
    expect(ticket).toMatchObject({ status: "open", urgency: 1 });
    expect(s.mailer.sent.at(-1)!.subject).toContain(`We received your report ${c!.ref}`);
    // Nothing on the lease moved on its own: it is still ACTIVE and a person decides what's next.
    expect((await leaseRow(s.leaseId)).state).toBe("ACTIVE");
  });
});

describe.skipIf(noDb)("agent switches (D37): signing reminders and the Ejari draft (Postgres)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });
  const setAutopilot = async (patch: Record<string, unknown>) => {
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: { ...defaultCompanyPolicy, autopilot: { ...defaultCompanyPolicy.autopilot, ...patch } },
      createdBy: "test",
    });
  };
  const reminders = (s: S) =>
    s.scheduler.jobs.filter((j) => j.name === LEASE_MAIL_JOB && j.data.kind === "sign_reminder");
  const approveContract = async (s: S) => {
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    await decideApproval(s.ctx, (await approvalOf(s.leaseId, "final_contract")).id, s.officer, { decision: "approve" });
    await s.drain();
  };

  test("sign_reminder on: one per signer after N days (singletonKey), a fresh link, nothing once signed", async () => {
    await setAutopilot({ sign_reminder: true, sign_reminder_days: 2 });
    const s = await setup();
    s.ctx.demoMode = false; // real mode: a pg-boss job with startAfter
    await approveContract(s);
    const jobs = reminders(s);
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.startAfter?.toISOString()).toBe("2026-11-03T04:00:00.000Z");
      expect(j.singletonKey).toBe(`${s.leaseId}:sign_reminder:${j.data.key}#1`);
    }
    const oldToken = s.signToken("lena.applicant@demo.example")!;
    const signers = await database.db.select().from(contractSigners);
    const tenant = signers.find((x) => x.role === "tenant")!;
    const job = jobs.find((j) => j.data.key === tenant.id)!;
    const before = s.mailer.sent.length;
    expect((await sendLeaseMail(s.ctx, job.data as unknown as LeaseMailJob)).sent).toBe(true);
    const mail = s.mailer.sent.at(-1)!;
    expect(mail.subject.startsWith("Reminder: tenancy contract to sign")).toBe(true);
    expect(s.mailer.sent.length).toBe(before + 1);
    expect(mail.attachments?.length).toBe(1);
    // The reminder carries a fresh link; the old one stopped working.
    const fresh = /\/t\/([A-Za-z0-9_-]{30,64})\/sign/.exec(mail.text)![1]!;
    expect(fresh).not.toBe(oldToken);
    expect((await s.portal(`/api/portal/${oldToken}`)).status).toBeGreaterThanOrEqual(400);
    // Signed: the next reminder for that signer sends nothing.
    expect(
      (await s.portal(`/api/portal/${fresh}/sign`, "POST", { typedName: "Lena Testova", consent: true })).status,
    ).toBe(201);
    const other = jobs.find((j) => j !== job)!;
    const n = s.mailer.sent.length;
    expect((await sendLeaseMail(s.ctx, { ...(job.data as unknown as LeaseMailJob), seq: 5 })).sent).toBe(false);
    expect(s.mailer.sent.length).toBe(n);
    // The landlord has not signed: still reminded.
    expect((await sendLeaseMail(s.ctx, other.data as unknown as LeaseMailJob)).sent).toBe(true);
  });

  test("sign_reminder off: nothing is queued, and a run after the switch was turned off sends nothing", async () => {
    await setAutopilot({ sign_reminder: false });
    const s = await setup();
    await approveContract(s);
    expect(reminders(s)).toHaveLength(0);
    const signers = await database.db.select().from(contractSigners);
    const n = s.mailer.sent.length;
    const r = await sendLeaseMail(s.ctx, { leaseId: s.leaseId, kind: "sign_reminder", key: signers[0]!.id, seq: 1 });
    expect(r.sent).toBe(false);
    expect(s.mailer.sent.length).toBe(n);
  });

  test("ejari_draft_auto on: entering REGISTRATION drafts the submission, which still waits for a person", async () => {
    await setAutopilot({ ejari_draft_auto: true });
    const s = await setup();
    await toRegistration(s);
    const ej = await approvalOf(s.leaseId, "ejari_submission");
    expect(ej).toMatchObject({ status: "pending", proposedBy: "system" });
    expect(s.scheduler.jobs.some((j) => j.name === EJARI_SUBMIT_JOB)).toBe(false);
    expect(await database.db.select().from(ejariSubmissions)).toHaveLength(0);
  });

  test("ejari_draft_auto off: an officer is asked to draft it; drafting still needs the same human approval", async () => {
    await setAutopilot({ ejari_draft_auto: false });
    const s = await setup();
    await toRegistration(s);
    expect(
      await database.db
        .select()
        .from(approvals)
        .where(and(eq(approvals.entityId, s.leaseId), eq(approvals.gate, "ejari_submission"))),
    ).toHaveLength(0);
    const [task] = await database.db
      .select()
      .from(tasks)
      .where(eq(tasks.dedupeKey, `${s.leaseId}:draft_ejari_submission`));
    expect(task).toMatchObject({ kind: "draft_ejari_submission", status: "open", assigneeRole: "leasing_officer" });
    expect(s.scheduler.jobs.some((j) => j.name === EJARI_SUBMIT_JOB)).toBe(false);
    // The officer drafts it (the existing route); the task is done and the gate is pending, not decided.
    const r = await s.staff(s.officer, `/api/leases/${s.leaseId}/ejari/propose`, "POST");
    expect([200, 201]).toContain(r.status);
    const ej = await approvalOf(s.leaseId, "ejari_submission");
    expect(ej.status).toBe("pending");
    expect((await database.db.select().from(tasks).where(eq(tasks.id, task!.id)))[0]!.status).toBe("done");
    expect(s.scheduler.jobs.some((j) => j.name === EJARI_SUBMIT_JOB)).toBe(false);
  });

  test("with every switch on, the human gates still stand: nothing is signed, approved or submitted by a switch", async () => {
    const all = Object.fromEntries(
      Object.keys(defaultCompanyPolicy.autopilot)
        .filter((k) => typeof (defaultCompanyPolicy.autopilot as Record<string, unknown>)[k] === "boolean")
        .map((k) => [k, true]),
    );
    await setAutopilot(all);
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const fc = await approvalOf(s.leaseId, "final_contract");
    expect(fc.status).toBe("pending");
    await s.drain();
    expect(s.mailer.sent.filter((m) => /contract to sign/i.test(m.subject))).toHaveLength(0);
    await decideApproval(s.ctx, fc.id, s.officer, { decision: "approve" });
    await s.drain();
    for (const [email, name] of [
      ["lena.applicant@demo.example", "Lena Testova"],
      ["landlord@demo.example", "Test Signatory"],
    ] as const) {
      await s.portal(`/api/portal/${s.signToken(email)}/sign`, "POST", { typedName: name, consent: true });
    }
    await s.drain();
    const ej = await approvalOf(s.leaseId, "ejari_submission");
    expect(ej.status).toBe("pending");
    expect(ej.decidedBy).toBeNull();
    expect(await database.db.select().from(ejariSubmissions)).toHaveLength(0);
  });
});

describe.skipIf(noDb)("copilot proposals on the contract (D42)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  const propose = async (s: S, user: { id: string }, body: Record<string, unknown>) => {
    const threadId = newId();
    await database.db
      .insert(copilotThreads)
      .values({ id: threadId, userId: user.id, title: "t", createdAt: s.clock.now() });
    const res = await s.app.request("/api/copilot/proposals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
        "x-copilot-thread": threadId,
      },
      body: JSON.stringify(body),
    });
    return res;
  };

  test("prepare_contract: nothing is prepared until Confirm; Confirm prepares once and leaves final_contract pending", async () => {
    const s = await setup();
    const res = await propose(s, s.officer, { kind: "prepare_contract", leaseId: s.leaseId });
    expect(res.status).toBe(201);
    const p = (await res.json()) as { id: string; status: string; summary: { gate: string; emails: boolean } };
    expect(p.status).toBe("pending");
    expect(p.summary).toMatchObject({ gate: "final_contract", emails: false });
    expect(await contractRows(s.leaseId)).toHaveLength(0);
    const ok = await s.staff(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST");
    expect(ok.status).toBe(200);
    const done = (await ok.json()) as { status: string; result: { approvalId: string } };
    expect(done.status).toBe("confirmed");
    expect(await contractRows(s.leaseId)).toHaveLength(1);
    const fc = await approvalOf(s.leaseId, "final_contract");
    expect(fc.status).toBe("pending");
    expect(fc.id).toBe(done.result.approvalId);
    expect(fc.proposedBy).toBe(`copilot:${s.officer.id}`);
    // The contract is not sent: no signing mail until a person approves.
    await s.drain();
    expect(s.mailer.sent.filter((m) => /contract to sign/i.test(m.subject))).toHaveLength(0);
    // Single use.
    expect((await s.staff(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(409);
    expect(await contractRows(s.leaseId)).toHaveLength(1);
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId));
    expect(events.some((e) => e.type === "CONTRACT_PREPARED" && e.actor === `copilot:${s.officer.id}`)).toBe(true);
    expect(events.some((e) => e.type === "COPILOT_PROPOSAL_CONFIRMED" && e.actor === `user:${s.officer.id}`)).toBe(
      true,
    );
  });

  test("prepare_contract: roles, cancel, expiry and the client can't confirm", async () => {
    const s = await setup();
    expect((await propose(s, s.finance, { kind: "prepare_contract", leaseId: s.leaseId })).status).toBe(403);
    const p = (await (await propose(s, s.officer, { kind: "prepare_contract", leaseId: s.leaseId })).json()) as {
      id: string;
    };
    // Another user can't confirm it; the copilot's own client can't reach confirm at all.
    expect((await s.staff(s.manager, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(404);
    const client = inProcessClient(s.app, issueToken(SECRET, s.officer.id, Date.now()));
    await expect(client.propose(`/api/copilot/proposals/${p.id}/confirm`, {})).rejects.toThrow("invalid engine path");
    expect((await s.staff(s.officer, `/api/copilot/proposals/${p.id}/cancel`, "POST")).status).toBe(200);
    expect((await s.staff(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(409);
    const q = (await (await propose(s, s.officer, { kind: "prepare_contract", leaseId: s.leaseId })).json()) as {
      id: string;
    };
    s.clock.set(new Date(s.clock.now().getTime() + 31 * 60_000));
    expect((await s.staff(s.officer, `/api/copilot/proposals/${q.id}/confirm`, "POST")).status).toBe(409);
    expect(await contractRows(s.leaseId)).toHaveLength(0);
    // A lease that isn't waiting for a contract can't be proposed.
    await database.db.update(leases).set({ state: "ACTIVE" }).where(eq(leases.id, s.leaseId));
    expect((await propose(s, s.officer, { kind: "prepare_contract", leaseId: s.leaseId })).status).toBe(409);
  });

  test("resend_signing_link: Confirm re-sends the link as the user; finance is refused; the lease with nothing sent has no signer", async () => {
    const s = await setup();
    expect((await propose(s, s.officer, { kind: "resend_signing_link", leaseId: s.leaseId })).status).toBe(409);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const fc = await approvalOf(s.leaseId, "final_contract");
    await decideApproval(s.ctx, fc.id, s.officer, { decision: "approve" });
    await s.drain();
    expect((await propose(s, s.finance, { kind: "resend_signing_link", leaseId: s.leaseId })).status).toBe(403);
    const unclear = await propose(s, s.officer, { kind: "resend_signing_link", leaseId: s.leaseId });
    expect(unclear.status).toBe(422);
    const res = await propose(s, s.officer, { kind: "resend_signing_link", leaseId: s.leaseId, signer: "tenant" });
    expect(res.status).toBe(201);
    const p = (await res.json()) as { id: string; summary: { signerRole: string; emails: boolean } };
    expect(p.summary).toMatchObject({ signerRole: "tenant", emails: true });
    const before = s.mailer.sent.length;
    expect((await s.staff(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(200);
    await s.drain();
    expect(s.mailer.sent.length).toBe(before + 1);
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId));
    expect(events.some((e) => e.type === "SIGN_LINK_RESENT" && e.actor === `copilot:${s.officer.id}`)).toBe(true);
    // Double confirm: refused, no second mail.
    expect((await s.staff(s.officer, `/api/copilot/proposals/${p.id}/confirm`, "POST")).status).toBe(409);
    const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.id));
    expect(row!.status).toBe("confirmed");
  });
});
