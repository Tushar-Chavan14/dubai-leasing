import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { companyContractTemplates, type Database, documents, helperRuns, leaseEvents } from "@leasing/db";
import { FakeLlm, type ChatMessage } from "@leasing/llm";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { extractCompanyTemplate } from "../src/manager/company-templates.ts";
import {
  CONTRACT_STRUCTURE_JOB,
  CONTRACT_TEMPLATE_JOB,
  runContractStructure,
} from "../src/manager/contract-templates.ts";
import { generatePdf, SAMPLES } from "../../../packages/helpers/src/contract-structure/evals/fixtures.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

let database: Database;

/** Answers the structure prompt for one generated sample. */
const structureLlm = (sample = SAMPLES[0]!) =>
  new FakeLlm(
    () => new Error("no decide"),
    undefined,
    (messages: ChatMessage[]) => {
      const user = messages.find((m) => m.role === "user")!.content;
      const ctxs = user
        .split("BLANK CONTEXTS (JSON lines):\n")[1]!
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as { id: string; before: string });
      return {
        sections: sample.spec.sections.map((x) => ({ heading: x.heading })),
        blanks: ctxs.map((c) => {
          const m = sample.expect.maps.find((x) => c.before.slice(-30).includes(x.near));
          return { id: c.id, label: m?.near ?? "Signature", field: m?.field ?? "none" };
        }),
      };
    },
  );

async function setup(llm: FakeLlm) {
  const t = testContext(database, "2026-10-28T04:00:00Z", { llm });
  const companyId = await testCompany(database, { slug: "tpl-co", name: "Tpl Co", rules: false });
  const app = createApi(t.ctx, {
    sessionSecret: "s",
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const token = issueToken("s", (await addStaff(database, "admin")).id, Date.now());
  const call = (path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    });
  const mk = await call("/contract-rules", "POST", {
    companyId,
    category: "residential",
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
    clauseIds: ["no_pets"],
  });
  const rule = (await mk.json()) as { id: string };
  const upload = async (bytes: Uint8Array, ruleId = rule.id) => {
    const r = await app.request(`/api/contract-rules/${ruleId}/sample`, {
      method: "POST",
      body: bytes as unknown as ArrayBuffer,
      headers: { "content-type": "application/pdf", authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(202);
    return (await r.json()) as { ruleId: string; documentId: string };
  };
  const structureJobs = () => t.scheduler.jobs.filter((j) => j.name === CONTRACT_STRUCTURE_JOB);
  return { ...t, companyId, upload, structureJobs, call };
}

const templates = () => database.db.select().from(companyContractTemplates);

describe.skipIf(noDb)("company contract templates (structure extraction)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("an upload queues the structure job beside the clause job", async () => {
    const s = await setup(structureLlm());
    const { documentId } = await s.upload(await generatePdf(SAMPLES[0]!.spec));
    expect(s.scheduler.jobs.map((j) => [j.name, j.singletonKey])).toEqual([
      [CONTRACT_TEMPLATE_JOB, `${documentId}:1`],
      [CONTRACT_STRUCTURE_JOB, `${documentId}:1`],
    ]);
  });

  test("the job stores a proposed template version with the logo in the documents store", async () => {
    const s = await setup(structureLlm());
    const { documentId } = await s.upload(await generatePdf(SAMPLES[0]!.spec));
    const res = await runContractStructure(s.ctx, documentId);
    expect(res).toMatchObject({ skipped: false, status: "ok", version: 1 });
    const [t] = await templates();
    expect(t).toMatchObject({
      companyId: s.companyId,
      sampleDocumentId: documentId,
      status: "proposed",
      version: 1,
      approvedBy: null,
      approvedAt: null,
      createdBy: "helper:contract_structure",
    });
    const sections = t!.sections as { numbering: string; items: { heading: string | null }[] };
    expect(sections.numbering).toBe("decimal_nested");
    expect(sections.items.filter((i) => i.heading)).toHaveLength(5);
    const blanks = t!.blanks as { field: string }[];
    expect(blanks).toHaveLength(12);
    expect(blanks.filter((b) => b.field === "unmapped")).toHaveLength(1); // the signature line
    expect((t!.style as { font: { regular: string }; accentColour: string }).font.regular).toBe("Times-Roman");
    expect((t!.style as { accentColour: string }).accentColour).toBe("#1a33b2");
    // The logo: a PNG in the documents store, referenced by id; the style JSON carries no image bytes.
    const [logo] = await database.db.select().from(documents).where(eq(documents.id, t!.logoDocumentId!));
    expect(logo).toMatchObject({ kind: "template_logo", mime: "image/png" });
    expect([...(await s.ctx.documents.read(logo!.path)).subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(JSON.stringify(t!.style)).not.toContain("base64");
    // Audit: a helper run and a proposal event, with no state written by the helper.
    const [run] = await database.db.select().from(helperRuns).where(eq(helperRuns.id, t!.helperRunId!));
    expect(run).toMatchObject({ helper: "contract_structure", status: "ok" });
    const events = await database.db
      .select()
      .from(leaseEvents)
      .where(eq(leaseEvents.type, "COMPANY_TEMPLATE_PROPOSED"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "helper:contract_structure", entityId: s.companyId });
  });

  test("running the job twice adds no second version", async () => {
    const s = await setup(structureLlm());
    const { documentId } = await s.upload(await generatePdf(SAMPLES[0]!.spec));
    await runContractStructure(s.ctx, documentId);
    const again = await runContractStructure(s.ctx, documentId);
    expect(again.skipped).toBe(true);
    expect(await templates()).toHaveLength(1);
    expect(s.llm.chatCalls.filter((m) => m[0]!.content.includes("describe its structure"))).toHaveLength(1);
  });

  test("after its version is retired, the same sample can be read again into a new proposed version", async () => {
    const s = await setup(structureLlm());
    const { documentId } = await s.upload(await generatePdf(SAMPLES[0]!.spec));
    await runContractStructure(s.ctx, documentId);
    const [v1] = await templates();
    // Retry is refused while the version from this sample is live.
    expect((await s.call(`/companies/${s.companyId}/contract-template/retry`, "POST")).status).toBe(409);
    // Only an approved version can be retired: stand in for an approved-then-retired v1.
    await database.db
      .update(companyContractTemplates)
      .set({ status: "retired" })
      .where(eq(companyContractTemplates.id, v1!.id));
    let panel = (await (await s.call(`/companies/${s.companyId}/contract-template`)).json()) as {
      extraction: { status: string };
    };
    expect(panel.extraction.status).toBe("retired");
    expect((await s.call(`/companies/${s.companyId}/contract-template/retry`, "POST")).status).toBe(202);
    const job = s.structureJobs().at(-1)!;
    expect(job.data).toEqual({ documentId, force: true });
    panel = (await (await s.call(`/companies/${s.companyId}/contract-template`)).json()) as typeof panel;
    expect(panel.extraction.status).toBe("reading");
    await runContractStructure(s.ctx, documentId, true);
    panel = (await (await s.call(`/companies/${s.companyId}/contract-template`)).json()) as typeof panel;
    expect(panel.extraction.status).toBe("ready");
    const rows = (await templates()).toSorted((a, b) => a.version - b.version);
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "retired"],
      [2, "proposed"],
    ]);
  });

  test("a read-again the model fails shows as failed, not reading", async () => {
    const s = await setup(
      new FakeLlm(
        () => new Error("no decide"),
        undefined,
        () => "not json",
      ),
    );
    const { documentId } = await s.upload(await generatePdf(SAMPLES[0]!.spec));
    await runContractStructure(s.ctx, documentId);
    const first = (await (await s.call(`/companies/${s.companyId}/contract-template`)).json()) as {
      extraction: { status: string; reasons: string[] };
    };
    expect(first.extraction.status).toBe("failed");
    // Try again reads the sample again and, failing again, is shown as failed with a plain reason.
    expect((await s.call(`/companies/${s.companyId}/contract-template/retry`, "POST")).status).toBe(202);
    expect(s.structureJobs().at(-1)!.data).toEqual({ documentId, force: true });
    await runContractStructure(s.ctx, documentId, true);
    const again = (await (await s.call(`/companies/${s.companyId}/contract-template`)).json()) as typeof first;
    expect(again.extraction.status).toBe("failed");
  });

  test("a new upload creates the next version and leaves the first unchanged", async () => {
    const s = await setup(structureLlm());
    const first = await s.upload(await generatePdf(SAMPLES[0]!.spec));
    await runContractStructure(s.ctx, first.documentId);
    const [before] = await templates();
    const second = await s.upload(await generatePdf({ ...SAMPLES[0]!.spec, accent: [10, 120, 40] }), first.ruleId);
    await runContractStructure(s.ctx, second.documentId);
    const rows = (await templates()).toSorted((a, b) => a.version - b.version);
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [1, "proposed"],
      [2, "proposed"],
    ]);
    expect(rows[0]).toEqual(before!);
    expect((rows[1]!.style as { accentColour: string }).accentColour).toBe("#0a7828");
  });

  test("a sample the helper can't read stores no template and records the run", async () => {
    const s = await setup(structureLlm());
    const blank = await PDFDocument.create();
    blank
      .addPage()
      .drawText("A finished contract with no blanks to fill in at all, only text.", { x: 20, y: 700, size: 10 });
    const { documentId } = await s.upload(await blank.save());
    const res = await runContractStructure(s.ctx, documentId);
    expect(res).toMatchObject({ skipped: false, status: "needs_human", templateId: null });
    expect(await templates()).toHaveLength(0);
    const runs = await database.db.select().from(helperRuns).where(eq(helperRuns.helper, "contract_structure"));
    expect(runs.map((r) => r.status)).toEqual(["needs_human"]);
  });

  test("a sample with DLD wording is stored flagged, without that header", async () => {
    const dld = SAMPLES.find((x) => x.spec.id === "dld-header")!;
    const s = await setup(structureLlm(dld));
    const { documentId } = await s.upload(await generatePdf(dld.spec));
    await extractCompanyTemplate(s.ctx, { companyId: s.companyId, sampleDocumentId: documentId });
    const [t] = await templates();
    const style = t!.style as { header: string | null; flags: { authorityMarks: boolean; areas: string[] } };
    expect(style.flags.authorityMarks).toBe(true);
    expect(style.header).toBeNull();
    expect(JSON.stringify(t!.sections)).not.toContain("Dubai Land Department");
  });

  test("only a contract sample document can be read", async () => {
    const s = await setup(structureLlm());
    await expect(
      extractCompanyTemplate(s.ctx, {
        companyId: s.companyId,
        sampleDocumentId: "00000000-0000-7000-8000-000000000000",
      }),
    ).rejects.toThrow();
  });
});
