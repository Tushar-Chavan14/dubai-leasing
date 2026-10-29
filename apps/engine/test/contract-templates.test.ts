import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { defaultCompanyPolicy, newId } from "@leasing/core";
import { companyClauses, companyPolicy, contractRules, type Database, documents, leaseEvents } from "@leasing/db";
import { FakeLlm, ModelTimeoutError } from "@leasing/llm";
import { and, eq } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import {
  CONTRACT_STRUCTURE_JOB,
  CONTRACT_TEMPLATE_JOB,
  contractJobBudgetSeconds,
  contractJobExpireSeconds,
  failSample,
  runContractTemplate,
  sampleProgress,
} from "../src/manager/contract-templates.ts";
import { addStaff, agreeingDecision, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";
const PETS = "No pets may be kept in the unit without the landlord's written consent.";
const EARLY = "The tenant may end the tenancy early by giving 60 days written notice.";

async function samplePdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 780 - i * 20, size: 9, font }));
  return pdf.save();
}

const answer = {
  clauses: [
    { title: "Pets", text: PETS, category: "pets", quote: PETS },
    { title: "Early termination", text: EARLY, category: "termination", quote: EARLY },
  ],
};

let database: Database;

async function setup(llm = new FakeLlm(agreeingDecision, undefined, () => answer)) {
  const t = testContext(database, "2026-10-19T04:00:00Z", { llm });
  const companyId = await testCompany(database, { slug: "tpl-co", name: "Tpl Co", rules: false });
  const otherId = await testCompany(database, { slug: "other-co", name: "Other Co", rules: false });
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const tokens: Record<string, string> = {};
  for (const role of ["leasing_officer", "admin"] as const) {
    tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
  }
  const send = (role: string, path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
    });
  const upload = (role: string, ruleId: string, bytes: Uint8Array, headers: Record<string, string> = {}) =>
    app.request(`/api/contract-rules/${ruleId}/sample`, {
      method: "POST",
      body: bytes as unknown as ArrayBuffer,
      headers: { "content-type": "application/pdf", authorization: `Bearer ${tokens[role]}`, ...headers },
    });
  const mk = await send("admin", "/contract-rules", "POST", {
    companyId,
    category: "residential",
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
    clauseIds: ["no_pets"],
  });
  const rule = (await mk.json()) as { id: string };
  const drain = async () => {
    for (const j of t.scheduler.jobs.splice(0)) {
      if (j.name === CONTRACT_TEMPLATE_JOB) await runContractTemplate(t.ctx, String(j.data.documentId));
    }
  };
  return { ...t, app, send, upload, companyId, otherId, rule, drain };
}
type S = Awaited<ReturnType<typeof setup>>;

const clausesOf = async (s: S, ruleId: string) => {
  const r = await s.send("admin", `/contract-rules/${ruleId}/clauses`);
  expect(r.status).toBe(200);
  return (await r.json()) as {
    sample: { status: string; reasons: string[]; clauseCount: number } | null;
    clauses: { id: string; ref: string; text: string; status: string; hasValues: boolean }[];
  };
};

/** Uploads the sample and runs the job; returns the rule row that replaced the original. */
async function uploaded(s: S) {
  const res = await s.upload("admin", s.rule.id, await samplePdf([PETS, EARLY]));
  expect(res.status).toBe(202);
  const body = (await res.json()) as { ruleId: string; documentId: string };
  await s.drain();
  return body;
}

describe.skipIf(noDb)("contract templates (Contract AI)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("upload: admin only, PDF only, 10 MB cap before reading, content-addressed", async () => {
    const s = await setup();
    const pdf = await samplePdf([PETS]);
    expect((await s.upload("leasing_officer", s.rule.id, pdf)).status).toBe(403);
    const notPdf = await s.upload("admin", s.rule.id, new TextEncoder().encode("hello, not a pdf"));
    expect(notPdf.status).toBe(422);
    expect(((await notPdf.json()) as { code: string }).code).toBe("not_pdf");
    // Declared too large: refused from the header alone.
    const declared = await s.upload("admin", s.rule.id, pdf, { "content-length": String(11 * 1024 * 1024) });
    expect(declared.status).toBe(422);
    expect(((await declared.json()) as { code: string }).code).toBe("too_big");
    // Streamed too large without a usable header.
    const big = new Uint8Array(10 * 1024 * 1024 + 70 * 1024);
    big.set(new TextEncoder().encode("%PDF-1.7"));
    expect(((await (await s.upload("admin", s.rule.id, big)).json()) as { code: string }).code).toBe("too_big");
    expect(s.scheduler.jobs).toHaveLength(0);

    const ok = await s.upload("admin", s.rule.id, pdf);
    expect(ok.status).toBe(202);
    const { documentId, ruleId } = (await ok.json()) as { documentId: string; ruleId: string };
    const [doc] = await database.db.select().from(documents).where(eq(documents.id, documentId));
    expect(doc?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc?.path).toContain(doc!.sha256);
    // The rule was replaced by a row that carries the sample; the old row is inactive.
    const [next] = await database.db.select().from(contractRules).where(eq(contractRules.id, ruleId));
    expect(next).toMatchObject({ sampleDocumentId: documentId, supersedesId: s.rule.id, active: true });
    expect(s.scheduler.jobs.map((j) => [j.name, j.singletonKey])).toEqual([
      [CONTRACT_TEMPLATE_JOB, `${documentId}:1`],
      [CONTRACT_STRUCTURE_JOB, `${documentId}:1`],
    ]);
  });

  test("the helper's clauses become proposed company clauses; hasValues is set by code", async () => {
    const s = await setup();
    const { ruleId } = await uploaded(s);
    const r = await clausesOf(s, ruleId);
    expect(r.sample).toMatchObject({ status: "done", clauseCount: 2 });
    expect(r.clauses.map((c) => [c.text, c.status, c.hasValues])).toEqual([
      [PETS, "proposed", false],
      [EARLY, "proposed", true],
    ]);
    const events = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, s.companyId), eq(leaseEvents.type, "COMPANY_CLAUSES_PROPOSED")));
    expect(events).toHaveLength(1);
    expect(events[0]?.actor).toBe("helper:contract_template");
  });

  test("duplicate upload of the same file makes no duplicate proposals; the job is safe to run twice", async () => {
    const s = await setup();
    const pdf = await samplePdf([PETS, EARLY]);
    const first = await s.upload("admin", s.rule.id, pdf);
    const { ruleId, documentId } = (await first.json()) as { ruleId: string; documentId: string };
    await runContractTemplate(s.ctx, documentId);
    expect(await runContractTemplate(s.ctx, documentId)).toEqual({ skipped: true });
    const again = await s.upload("admin", ruleId, pdf);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { duplicate: boolean }).duplicate).toBe(true);
    await s.drain();
    expect((await clausesOf(s, ruleId)).clauses).toHaveLength(2);
    expect(await database.db.select().from(companyClauses)).toHaveLength(2);
  });

  test("needs_human and failed readings are reported plainly, with no proposals", async () => {
    const s = await setup();
    const scan = await s.upload("admin", s.rule.id, await samplePdf([]));
    const { ruleId } = (await scan.json()) as { ruleId: string };
    await s.drain();
    const r = await clausesOf(s, ruleId);
    expect(r.sample?.status).toBe("needs_human");
    expect(r.sample?.reasons.length).toBeGreaterThan(0);
    expect(r.clauses).toHaveLength(0);
  });

  test("decide: admin only; hasValues needs confirmValues; edits recompute hasValues; audit per decision", async () => {
    const s = await setup();
    const { ruleId } = await uploaded(s);
    const [pets, early] = (await clausesOf(s, ruleId)).clauses;
    const decide = (role: string, id: string, body: unknown) =>
      s.send(role, `/company-clauses/${id}/decide`, "POST", body);

    expect((await decide("leasing_officer", pets!.id, { decision: "approve" })).status).toBe(403);
    const refused = await decide("admin", early!.id, { decision: "approve" });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { code: string }).code).toBe("confirm_values");

    // An edit that adds a value is re-checked by code even if the client says nothing about it.
    const sneaky = await decide("admin", pets!.id, {
      decision: "approve",
      editedText: "No pets, except one cat, and a fine of AED 500 applies.",
    });
    expect(((await sneaky.json()) as { code: string }).code).toBe("confirm_values");
    const edited = await decide("admin", pets!.id, {
      decision: "approve",
      editedText: "No pets without written consent.",
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      status: "approved",
      textEn: "No pets without written consent.",
      hasValues: false,
    });
    // Editing away the value drops the flag; a value that stays still needs the box.
    const ok = await decide("admin", early!.id, { decision: "approve", confirmValues: true });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "approved", hasValues: true });
    expect((await decide("admin", early!.id, { decision: "reject" })).status).toBe(409);

    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.companyId));
    const types = events.map((e) => [e.type, e.actor.startsWith("user:")]);
    expect(types).toContainEqual(["COMPANY_CLAUSE_APPROVED", true]);
    expect(events.filter((e) => e.type === "COMPANY_CLAUSE_APPROVED")).toHaveLength(2);
    expect(events.find((e) => e.type === "COMPANY_CLAUSE_APPROVED")?.payload).toMatchObject({ edited: true });
  });

  test("an edit that removes the amounts clears the flag and needs no confirmation", async () => {
    const s = await setup();
    const { ruleId } = await uploaded(s);
    const early = (await clausesOf(s, ruleId)).clauses[1]!;
    const r = await s.send("admin", `/company-clauses/${early.id}/decide`, "POST", {
      decision: "approve",
      editedText: "The tenant may end the tenancy early with the landlord's written agreement.",
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ hasValues: false });
  });

  test("reject keeps the clause out of rules; contract rule clauseIds accept only approved clauses of the same company", async () => {
    const s = await setup();
    const { ruleId } = await uploaded(s);
    const [pets, early] = (await clausesOf(s, ruleId)).clauses;
    const decide = (id: string, body: unknown) => s.send("admin", `/company-clauses/${id}/decide`, "POST", body);
    await decide(early!.id, { decision: "reject" });
    await decide(pets!.id, { decision: "approve" });
    const put = (id: string, clauseIds: string[]) =>
      s.send("admin", `/contract-rules/${id}`, "PUT", {
        category: "residential",
        tenures: ["annual"],
        minCheques: 1,
        maxCheques: 4,
        clauseIds,
      });
    const bad = await put(ruleId, ["no_pets", early!.ref]);
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("bad_clause");
    expect((await put(ruleId, [`cc:${newId()}`])).status).toBe(422);
    expect((await put(ruleId, ["cc:not-a-uuid"])).status).toBe(400);

    // An approved clause of another company is refused too.
    const [other] = await database.db
      .insert(companyClauses)
      .values({
        id: newId(),
        companyId: s.otherId,
        title: "Other",
        textEn: "Other company wording.",
        category: "other",
        hasValues: false,
        status: "approved",
        createdBy: "test",
      })
      .returning();
    expect((await put(ruleId, [`cc:${other!.id}`])).status).toBe(422);

    const good = await put(ruleId, ["no_pets", pets!.ref]);
    expect(good.status).toBe(200);
    const next = (await good.json()) as { id: string; clauseIds: string[] };
    expect(next.clauseIds).toEqual(["no_pets", pets!.ref]);
    // The review list follows the rule through its replacement.
    expect((await clausesOf(s, next.id)).clauses.map((c) => c.status)).toEqual(["approved", "rejected"]);
  });

  test("a failed reading is queued again on re-upload of the same file, with a fresh job key", async () => {
    const s = await setup();
    const scan = await samplePdf([]);
    const first = (await (await s.upload("admin", s.rule.id, scan)).json()) as { ruleId: string; documentId: string };
    await s.drain();
    expect((await clausesOf(s, first.ruleId)).sample?.status).toBe("needs_human");
    const again = await s.upload("admin", first.ruleId, scan);
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ duplicate: false, retry: true, documentId: first.documentId });
    expect(s.scheduler.jobs.map((j) => j.singletonKey)).toEqual([`${first.documentId}:2`, `${first.documentId}:2`]);
    expect((await clausesOf(s, first.ruleId)).sample?.status).toBe("queued");
    await s.drain();
    expect((await clausesOf(s, first.ruleId)).sample?.status).toBe("needs_human");
    // While a reading is queued or done, the same file is still a duplicate.
    const [doc] = await database.db.select().from(documents).where(eq(documents.id, first.documentId));
    expect(doc?.sha256).toBeTruthy();
  });

  test("the Try again route re-queues only a failed or needs_human reading", async () => {
    const s = await setup();
    const { ruleId } = (await (await s.upload("admin", s.rule.id, await samplePdf([]))).json()) as { ruleId: string };
    expect((await s.send("admin", `/contract-rules/${ruleId}/sample/retry`, "POST", {})).status).toBe(409);
    await s.drain();
    expect((await s.send("leasing_officer", `/contract-rules/${ruleId}/sample/retry`, "POST", {})).status).toBe(403);
    expect((await s.send("admin", `/contract-rules/${ruleId}/sample/retry`, "POST", {})).status).toBe(202);
    expect(s.scheduler.jobs).toHaveLength(2);
    expect((await clausesOf(s, ruleId)).sample?.status).toBe("queued");
  });

  test("a reading stuck in queued for 15 minutes is marked failed on read, and the late job skips it", async () => {
    const s = await setup();
    const { ruleId, documentId } = (await (await s.upload("admin", s.rule.id, await samplePdf([PETS]))).json()) as {
      ruleId: string;
      documentId: string;
    };
    s.clock.set(new Date(s.clock.now().getTime() + 14 * 60_000));
    expect((await clausesOf(s, ruleId)).sample?.status).toBe("queued");
    s.clock.set(new Date(s.clock.now().getTime() + 2 * 60_000));
    const r = await clausesOf(s, ruleId);
    expect(r.sample).toMatchObject({ status: "failed", reasons: ["The reading job stopped; try again."] });
    expect(await runContractTemplate(s.ctx, documentId)).toEqual({ skipped: true });
    expect(await database.db.select().from(companyClauses)).toHaveLength(0);
    // Try again works from the stuck state.
    expect((await s.send("admin", `/contract-rules/${ruleId}/sample/retry`, "POST", {})).status).toBe(202);
  });

  test("a model timeout is stored as a failed reading with the real reason, not left queued", async () => {
    const s = await setup(new FakeLlm(agreeingDecision, undefined, () => new ModelTimeoutError(300_000)));
    const { ruleId } = (await (await s.upload("admin", s.rule.id, await samplePdf([PETS]))).json()) as {
      ruleId: string;
    };
    await s.drain();
    const r = await clausesOf(s, ruleId);
    expect(r.sample?.status).toBe("failed");
    expect(r.sample?.reasons).toEqual(["Timed out after 5 minutes waiting for the model; try again."]);
    expect((await s.send("admin", `/contract-rules/${ruleId}/sample/retry`, "POST", {})).status).toBe(202);
  });

  test("failSample stores the reason on a queued sample only", async () => {
    const s = await setup();
    const { ruleId, documentId } = (await (await s.upload("admin", s.rule.id, await samplePdf([PETS]))).json()) as {
      ruleId: string;
      documentId: string;
    };
    expect(await failSample(s.ctx, documentId, "Timed out after 15 minutes waiting for the model")).toBe(true);
    expect((await clausesOf(s, ruleId)).sample).toMatchObject({
      status: "failed",
      reasons: ["Timed out after 15 minutes waiting for the model"],
    });
    expect(await failSample(s.ctx, documentId, "again")).toBe(false);
    expect(await runContractTemplate(s.ctx, documentId)).toEqual({ skipped: true });
  });

  test("waiting vs running: startedAt is stored when the job starts; the status says which, and whether the template is ready", async () => {
    const s = await setup();
    const { ruleId, documentId } = (await (await s.upload("admin", s.rule.id, await samplePdf([PETS]))).json()) as {
      ruleId: string;
      documentId: string;
    };
    s.clock.set(new Date(s.clock.now().getTime() + 4 * 60_000));
    expect((await clausesOf(s, ruleId)).sample).toMatchObject({
      status: "queued",
      phase: "waiting",
      minutes: 4,
      templateReady: false,
    });
    const [doc] = await database.db.select().from(documents).where(eq(documents.id, documentId));
    expect((doc!.extracted as { startedAt?: string }).startedAt).toBeUndefined();
    // The job starts (the model call then hangs in real life; here it finishes and clears the status).
    const llm = new FakeLlm(agreeingDecision, undefined, () => {
      return answer;
    });
    s.ctx.contractAiLlm = llm;
    await runContractTemplate(s.ctx, documentId);
    const [after] = await database.db.select().from(documents).where(eq(documents.id, documentId));
    const meta = after!.extracted as { startedAt?: string; status: string };
    expect(meta.startedAt).toBe(s.clock.now().toISOString());
    expect(meta.status).toBe("done");
  });

  test("sampleProgress derives phase and whole minutes from the Clock", () => {
    const now = new Date("2026-10-19T04:20:00Z");
    const queuedAt = "2026-10-19T04:00:00Z";
    expect(sampleProgress({ status: "queued", queuedAt }, now)).toEqual({ phase: "waiting", minutes: 20 });
    expect(sampleProgress({ status: "queued", queuedAt, startedAt: "2026-10-19T04:12:30Z" }, now)).toEqual({
      phase: "running",
      minutes: 7,
    });
    expect(sampleProgress({ status: "failed", queuedAt }, now)).toBeNull();
  });

  test("the clauses job expires in pg-boss only after the code's own deadline, which is after the model timeout", () => {
    for (const t of [30, 300, 900]) {
      expect(contractJobBudgetSeconds(t)).toBeGreaterThan(t);
      expect(contractJobExpireSeconds(t)).toBeGreaterThan(contractJobBudgetSeconds(t));
    }
    expect(contractJobExpireSeconds(300)).toBeGreaterThanOrEqual(900);
  });

  test("toggling a clause with a stale clause list or a replaced rule is a 409", async () => {
    const s = await setup();
    const { ruleId } = await uploaded(s);
    const body = (over: Record<string, unknown>) => ({
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 4,
      clauseIds: ["no_pets", "parking"],
      ...over,
    });
    const stale = await s.send("admin", `/contract-rules/${ruleId}`, "PUT", body({ expectedClauseIds: ["parking"] }));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("rule_changed");
    const ok = await s.send("admin", `/contract-rules/${ruleId}`, "PUT", body({ expectedClauseIds: ["no_pets"] }));
    expect(ok.status).toBe(200);
    const replaced = await s.send(
      "admin",
      `/contract-rules/${ruleId}`,
      "PUT",
      body({ expectedClauseIds: ["no_pets"] }),
    );
    expect(replaced.status).toBe(409);
    expect(((await replaced.json()) as { code: string }).code).toBe("rule_inactive");
  });
});

describe.skipIf(noDb)("contract_ai_auto_approve_valueless (D37)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });
  const LINES = {
    pets: "Pets must be kept clean and under control at all times.",
    tidy: "The tenant keeps the unit tidy and reports defects promptly.",
    petDeposit: "A pet deposit of AED 500 applies to each pet.",
    exit: "Either party may end the tenancy only as the law allows.",
    pay: "Payment is made by cheque to the landlord.",
    sublet: "The tenant may not sublet any part of the unit.",
    receipts: "The tenant keeps the rent receipts safe.",
  };
  const mixed = {
    clauses: [
      { title: "Pets", text: LINES.pets, category: "pets", quote: LINES.pets },
      { title: "Tidy", text: LINES.tidy, category: "maintenance", quote: LINES.tidy },
      { title: "Pet deposit", text: LINES.petDeposit, category: "pets", quote: LINES.petDeposit },
      { title: "Exit", text: LINES.exit, category: "termination", quote: LINES.exit },
      { title: "Payment", text: LINES.pay, category: "payment", quote: LINES.pay },
      { title: "Sub-letting", text: LINES.sublet, category: "subletting", quote: LINES.sublet },
      { title: "Receipts", text: LINES.receipts, category: "maintenance", quote: LINES.receipts },
    ],
  };
  const run = async (on: boolean) => {
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: {
        ...defaultCompanyPolicy,
        autopilot: { ...defaultCompanyPolicy.autopilot, contract_ai_auto_approve_valueless: on },
      },
      createdBy: "test",
    });
    const s = await setup(new FakeLlm(agreeingDecision, undefined, () => mixed));
    const res = await s.upload("admin", s.rule.id, await samplePdf(Object.values(LINES)));
    expect(res.status).toBe(202);
    const { ruleId } = (await res.json()) as { ruleId: string };
    await s.drain();
    return { s, ruleId, review: await clausesOf(s, ruleId) };
  };

  test("on: only valueless clauses outside termination, payment and subletting are approved, by system:auto-approve", async () => {
    const { review } = await run(true);
    const byText = (t: string) => review.clauses.find((c) => c.text === t)!;
    expect(byText(LINES.pets).status).toBe("approved");
    expect(byText(LINES.tidy).status).toBe("approved");
    expect(byText(LINES.petDeposit)).toMatchObject({ status: "proposed", hasValues: true });
    expect(byText(LINES.exit).status).toBe("proposed");
    expect(byText(LINES.pay).status).toBe("proposed");
    expect(byText(LINES.sublet).status).toBe("proposed");
    // A money word in the wording keeps it for an admin even in a "safe" category.
    expect(byText(LINES.receipts).status).toBe("proposed");
    const rows = await database.db.select().from(companyClauses).where(eq(companyClauses.status, "approved"));
    expect(rows.map((r) => r.approvedBy)).toEqual(["system:auto-approve", "system:auto-approve"]);
    expect(rows.every((r) => r.approvedAt !== null && r.hasValues === false)).toBe(true);
    const audit = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.type, "COMPANY_CLAUSE_APPROVED"), eq(leaseEvents.actor, "system:auto-approve")));
    expect(audit).toHaveLength(2);
    expect(audit[0]!.payload).toMatchObject({ autoApproved: true, hasValues: false });
    const proposed = await database.db
      .select()
      .from(leaseEvents)
      .where(eq(leaseEvents.type, "COMPANY_CLAUSES_PROPOSED"));
    expect(proposed[0]!.payload).toMatchObject({ proposed: 7, autoApproved: 2 });
  });

  test("off: every clause waits for an admin", async () => {
    const { review } = await run(false);
    expect(review.clauses).toHaveLength(7);
    expect(review.clauses.every((c) => c.status === "proposed")).toBe(true);
    expect(
      await database.db.select().from(leaseEvents).where(eq(leaseEvents.actor, "system:auto-approve")),
    ).toHaveLength(0);
  });
});
