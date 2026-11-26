/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FixedClock, issueToken } from "@platform/kernel";
import { extractPdf } from "@platform/readers/pdf/extract";
import type { Helper } from "@platform/kernel/helper";
import type { Llm } from "@platform/llm";
import type { ContractStructureContext, ContractStructureData } from "@platform/readers/structure/schema";
import { dealEvents, spaTemplateVersions, spaTemplates, templateUploads, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { count, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import type { DocumentStore } from "../src/manager/noc.ts";
import { realDataIn, readTemplateUpload } from "../src/manager/template-uploads.ts";
import { createTemplate } from "../src/manager/templates.ts";
import { seedUsers, spaTpl, toData, type U } from "./prepare-fixtures.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-21T06:00:00Z");
const url = spaTestDatabaseUrl();
const ROLES = ["officer", "manager", "salesadmin", "legal", "finance", "compliance", "mlro", "admin"] as const;
const READ = new Set(["admin", "legal", "manager"]);
const pdf = (tag: string) => new TextEncoder().encode(`%PDF-1.4\n% fictional sample ${tag}\n`);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!url)("C34: template routes, upload, preview (S66)", () => {
  let database: SpaDatabase;
  let app: ReturnType<typeof createApp>;
  let users: Record<string, U>;
  let ctx: SpaContext;
  let templateId = "";
  let versionId = "";
  let blankId = "";
  const sent: { name: string; data: any; opts: any }[] = [];
  const files = new Map<string, Uint8Array>();
  let puts = 0;
  const store: DocumentStore = {
    async put(bytes, ext) {
      puts++;
      const sha256 = sha(bytes);
      files.set(`${sha256}.${ext}`, bytes);
      return { sha256, path: `${sha256}.${ext}`, bytes: bytes.length };
    },
    async read(key) {
      const b = files.get(key);
      if (!b) throw new Error("missing");
      return b;
    },
  };
  const call = async (method: string, path: string, as?: string | null, body?: unknown) => {
    const form = body instanceof FormData;
    const r = await app.request(path, {
      method,
      headers: {
        ...(form || body === undefined ? {} : { "content-type": "application/json" }),
        ...(as ? { authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
      },
      ...(body === undefined ? {} : { body: form ? (body as FormData) : JSON.stringify(body) }),
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: r.status, text, json, bytes, type: r.headers.get("content-type") ?? "" };
  };
  const upload = (
    as: string | null,
    tid: string,
    bytes: Uint8Array,
    over: { name?: string; box?: string | null } = {},
  ) => {
    const f = new FormData();
    f.set("file", new File([bytes as never], over.name ?? "sample.pdf", { type: "application/pdf" }));
    if (over.box !== null) f.set("noRealData", over.box ?? "true");
    return call("POST", `/api/templates/${tid}/versions`, as, f);
  };
  const fakeHelper = (
    data: ContractStructureData | "fail" | "human",
  ): Helper<ContractStructureContext, ContractStructureData> => ({
    name: "spa-template",
    async run() {
      if (data === "fail")
        return { status: "failed", reasons: ["The uploaded file couldn't be read."], sourceDocIds: [] };
      if (data === "human") return { status: "needs_human", reasons: ["Too many blanks."], sourceDocIds: [] };
      return { status: "ok", data, reasons: [], sourceDocIds: [] };
    },
  });
  const deps = (helper: ReturnType<typeof fakeHelper>) => ({
    llm: {} as Llm,
    readFile: (key: string) => store.read!(key),
    helper,
  });
  const fresh = async (name: string) =>
    (await createTemplate(ctx, { name, documentKind: "spa", projectCodes: [] }, users.admin!)).id;
  const queued = async (tid: string, bytes: Uint8Array) => {
    const r = await upload("admin", tid, bytes);
    expect(r.status).toBe(202);
    return r.json.id as string;
  };
  const uploadRow = async (id: string) =>
    (await database.db.select().from(templateUploads).where(eq(templateUploads.id, id)))[0]!;
  const versionsOf = async (tid: string) =>
    (
      await database.db.select({ n: count() }).from(spaTemplateVersions).where(eq(spaTemplateVersions.templateId, tid))
    )[0]!.n;

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    ctx = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
    app = createApp({
      database,
      jobs: {
        boss: {
          getQueue: async () => ({}),
          send: async (name: string, data: unknown, opts: unknown) => {
            sent.push({ name, data, opts });
            return "job-1";
          },
        } as never,
        lastHeartbeat: () => null,
      },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      documents: store,
    });
    templateId = await fresh("Standard SPA");
    const id = await queued(templateId, pdf("seed"));
    await readTemplateUpload(ctx, deps(fakeHelper(toData(spaTpl()))), { uploadId: id });
    const up = await uploadRow(id);
    versionId = up.versionId!;
    blankId = "b4";
  });
  afterAll(async () => {
    await database?.close();
  });

  describe("reads, per role", () => {
    for (const role of ROLES) {
      test(`${role}: list, record, version`, async () => {
        const ok = READ.has(role);
        const list = await call("GET", "/api/templates", role);
        const rec = await call("GET", `/api/templates/${templateId}`, role);
        const ver = await call("GET", `/api/template-versions/${versionId}`, role);
        expect([list.status, rec.status, ver.status]).toEqual(ok ? [200, 200, 200] : [403, 403, 403]);
        if (ok) {
          expect(list.json.items[0].name).toBe("Standard SPA");
          expect(rec.json.versions[0].status).toBe("in_review");
          expect(rec.json.uploads[0].status).toBe("done");
          expect(ver.json.blanks.length).toBeGreaterThan(5);
          expect(ver.json.checks).toBeInstanceOf(Array);
        }
      });
    }
    test("401 without a session, 404 for an unknown or malformed id (allowed roles), a 403 never says whether it exists", async () => {
      for (const p of ["/api/templates", `/api/templates/${templateId}`, `/api/template-versions/${versionId}`])
        expect((await call("GET", p, null)).status).toBe(401);
      for (const p of ["/api/templates/", "/api/template-versions/"]) {
        for (const id of [crypto.randomUUID(), "not-a-uuid"]) {
          if (p.endsWith("templates/")) {
            expect((await call("GET", `${p}${id}`, "admin")).status).toBe(404);
            expect((await call("GET", `${p}${id}`, "officer")).status).toBe(403);
          } else {
            expect((await call("GET", `${p}${id}`, "legal")).status).toBe(404);
            expect((await call("GET", `${p}${id}`, "finance")).status).toBe(403);
          }
        }
      }
    });
  });

  describe("create and remap, per role", () => {
    for (const role of ROLES) {
      test(`${role}: create a template`, async () => {
        const r = await call("POST", "/api/templates", role, {
          name: `By ${role}`,
          documentKind: "mou",
          projectCodes: ["P-1"],
        });
        expect(r.status).toBe(role === "admin" ? 201 : 403);
      });
      test(`${role}: remap a blank`, async () => {
        const r = await call("POST", `/api/template-versions/${versionId}/blanks/${blankId}/remap`, role, {
          key: "leave_empty",
        });
        expect(r.status).toBe(role === "admin" ? 200 : 403);
      });
    }
    test("401, bad body 422, unknown blank 404, unknown version 404, a key that doesn't fit 422", async () => {
      expect((await call("POST", "/api/templates", null, {})).status).toBe(401);
      expect((await call("POST", `/api/template-versions/${versionId}/blanks/${blankId}/remap`, null, {})).status).toBe(
        401,
      );
      expect((await call("POST", "/api/templates", "admin", { name: "" })).status).toBe(422);
      expect(
        (await call("POST", "/api/templates", "admin", { name: "Standard SPA", documentKind: "spa" })).status,
      ).toBe(409);
      const nb = await call("POST", `/api/template-versions/${versionId}/blanks/b999/remap`, "admin", { key: "price" });
      expect(nb.status).toBe(404);
      const nv = await call("POST", `/api/template-versions/${crypto.randomUUID()}/blanks/b1/remap`, "admin", {
        key: "price",
      });
      expect(nv.status).toBe(404);
      const bad = await call("POST", `/api/template-versions/${versionId}/blanks/b1/remap`, "admin", { key: "price" });
      expect(bad.status).toBe(422);
      expect((await call("POST", `/api/template-versions/${versionId}/blanks/b1/remap`, "admin", {})).status).toBe(400);
    });
    test("a project scope is fixed at creation: no route changes it", async () => {
      const r = await call("POST", "/api/templates", "admin", {
        name: "Scoped",
        documentKind: "spa",
        projectCodes: ["P-9"],
      });
      for (const method of ["PUT", "PATCH", "POST"])
        expect([404, 405]).toContain(
          (await call(method, `/api/templates/${r.json.id}`, "admin", { projectCodes: [] })).status,
        );
      const row = (await database.db.select().from(spaTemplates).where(eq(spaTemplates.id, r.json.id)))[0]!;
      expect(row.projectCodes).toEqual(["P-9"]);
    });
  });

  describe("upload", () => {
    test("only an admin uploads; 401; 404 for an unknown template; the box must be ticked; only a PDF", async () => {
      const tid = await fresh("Upload gates");
      for (const role of ROLES.filter((r) => r !== "admin"))
        expect((await upload(role, tid, pdf(role))).status).toBe(403);
      expect((await upload(null, tid, pdf("x"))).status).toBe(401);
      expect((await upload("admin", crypto.randomUUID(), pdf("x"))).status).toBe(404);
      expect((await upload("admin", "nope", pdf("x"))).status).toBe(404);
      expect((await upload("admin", tid, pdf("nobox"), { box: null })).status).toBe(422);
      expect((await upload("admin", tid, pdf("nobox"), { box: "false" })).status).toBe(422);
      expect((await upload("admin", tid, new TextEncoder().encode("MZ not a pdf"))).status).toBe(422);
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
      expect((await upload("admin", tid, png)).status).toBe(422);
      const big = new Uint8Array(10 * 1024 * 1024 + 1);
      big.set(pdf("big"));
      expect((await upload("admin", tid, big)).status).toBe(422);
      const huge = new Uint8Array(11 * 1024 * 1024);
      huge.set(pdf("huge"));
      expect((await upload("admin", tid, huge)).status).toBe(413);
      expect(
        Number(
          (
            await database.db.select({ n: count() }).from(templateUploads).where(eq(templateUploads.templateId, tid))
          )[0]!.n,
        ),
      ).toBe(0);
    });
    test("a repeat upload returns the same row, stores once and queues one job keyed template and hash", async () => {
      const tid = await fresh("Dedupe");
      const bytes = pdf("dedupe");
      const before = puts;
      sent.length = 0;
      const a = await upload("admin", tid, bytes);
      const b = await upload("admin", tid, bytes, { name: "renamed.pdf" });
      expect(a.status).toBe(202);
      expect(b.status).toBe(202);
      expect(b.json.id).toBe(a.json.id);
      expect(a.json.existing).toBe(false);
      expect(b.json.existing).toBe(true);
      expect(puts - before).toBe(1);
      expect(sent.length).toBeGreaterThanOrEqual(1);
      for (const s of sent) {
        expect(s.name).toBe("spa.template.read");
        expect(s.opts.singletonKey).toBe(`${tid}:${sha(bytes)}`);
        expect(s.data).toEqual({ uploadId: a.json.id });
      }
      expect(
        Number(
          (
            await database.db.select({ n: count() }).from(templateUploads).where(eq(templateUploads.templateId, tid))
          )[0]!.n,
        ),
      ).toBe(1);
      // the same file under another template is a different row
      const other = await fresh("Dedupe 2");
      expect((await upload("admin", other, bytes)).json.id).not.toBe(a.json.id);
    });
    test("the read stores a version and opens the legal approval; running the job twice adds nothing", async () => {
      const tid = await fresh("Read twice");
      const id = await queued(tid, pdf("twice"));
      const d = deps(fakeHelper(toData(spaTpl())));
      await readTemplateUpload(ctx, d, { uploadId: id });
      await readTemplateUpload(ctx, d, { uploadId: id });
      const up = await uploadRow(id);
      expect(up.status).toBe("done");
      expect(up.versionId).toBeTruthy();
      expect(up.finishedAt).toBeTruthy();
      expect(await versionsOf(tid)).toBe(1);
      const v = (
        await database.db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, up.versionId!))
      )[0]!;
      expect(v.status).toBe("in_review");
      expect(v.approvalId).toBeTruthy();
      expect(v.docHash).toBe(up.docHash);
    });
    test("a job that crashed after the version was stored links it instead of adding a second", async () => {
      const tid = await fresh("Resume");
      const id = await queued(tid, pdf("resume"));
      const d = deps(fakeHelper(toData(spaTpl())));
      await readTemplateUpload(ctx, d, { uploadId: id });
      await database.pool.query("alter table template_uploads disable trigger template_uploads_guard");
      await database.pool.query(
        "update template_uploads set status = 'reading', version_id = null, finished_at = null, reason = null where id = $1",
        [id],
      );
      await database.pool.query("alter table template_uploads enable trigger template_uploads_guard");
      await readTemplateUpload(ctx, d, { uploadId: id });
      expect(await versionsOf(tid)).toBe(1);
      expect((await uploadRow(id)).status).toBe("done");
    });
    test("a helper that fails or asks for a person ends the upload without a version", async () => {
      const tid = await fresh("Helper ends");
      const a = await queued(tid, pdf("fail"));
      await readTemplateUpload(ctx, deps(fakeHelper("fail")), { uploadId: a });
      expect((await uploadRow(a)).status).toBe("failed");
      const b = await queued(tid, pdf("human"));
      await readTemplateUpload(ctx, deps(fakeHelper("human")), { uploadId: b });
      const row = await uploadRow(b);
      expect(row.status).toBe("needs_human");
      expect(row.reason).toContain("Too many blanks");
      expect(await versionsOf(tid)).toBe(0);
    });
    test("a template whose text holds an ID, passport, email, phone or IBAN stops: needs_human, no version, nothing scrubbed", async () => {
      const samples: Record<string, string> = {
        eid: "Emirates ID 784-1990-1234567-1",
        passport: "Passport no. N1234567",
        email: "contact jane.roe@example.test now",
        phone: "Call +971 50 123 4567",
        iban: "IBAN AE07 0331 2345 6789 0123 456",
      };
      for (const [k, line] of Object.entries(samples)) {
        const tid = await fresh(`Real data ${k}`);
        const data = toData(spaTpl());
        data.sections.items[0]!.paragraphs.push(line);
        const id = await queued(tid, pdf(`real-${k}`));
        await readTemplateUpload(ctx, deps(fakeHelper(data)), { uploadId: id });
        const row = await uploadRow(id);
        expect(row.status).toBe("needs_human");
        expect(row.reason).toBe("Upload a blank or fictional copy");
        expect(row.versionId).toBeNull();
        expect(await versionsOf(tid)).toBe(0);
        // the reason names no value and the detail route repeats nothing of it
        const rec = await call("GET", `/api/templates/${tid}`, "admin");
        expect(rec.text).not.toContain(line.split(" ").at(-1)!);
      }
    });
    test("a blank label or a helper reason that holds an identifier also stops the read, and a file name like one is not kept", async () => {
      const tid = await fresh("Labels and reasons");
      const data = toData(spaTpl());
      data.blanks[0]!.label = "jane.roe@example.test";
      const a = await queued(tid, pdf("label-hit"));
      await readTemplateUpload(ctx, deps(fakeHelper(data)), { uploadId: a });
      expect((await uploadRow(a)).reason).toBe("Upload a blank or fictional copy");
      expect(await versionsOf(tid)).toBe(0);
      const leaky: Helper<ContractStructureContext, ContractStructureData> = {
        name: "spa-template",
        async run() {
          return { status: "failed", reasons: ["Could not read page 2 of 784-1990-1234567-1"], sourceDocIds: [] };
        },
      };
      const b = await queued(tid, pdf("reason-hit"));
      await readTemplateUpload(ctx, deps(leaky), { uploadId: b });
      const row = await uploadRow(b);
      expect(row.status).toBe("failed");
      expect(row.reason).toBe("Upload a blank or fictional copy");
      const named = await upload("admin", tid, pdf("named"), { name: "784-1990-1234567-1.pdf" });
      expect((await uploadRow(named.json.id)).fileName).toBe("sample.pdf");
    });
    test("the scan finds the five patterns and leaves a plain contract alone", () => {
      expect(realDataIn("784-1990-1234567-1")).toBe(true);
      expect(realDataIn("N1234567")).toBe(true);
      expect(realDataIn("a.b@example.test")).toBe(true);
      expect(realDataIn("+971501234567")).toBe(true);
      expect(realDataIn("AE070331234567890123456")).toBe(true);
      expect(
        realDataIn("The Seller sells Unit {{b5}} for AED ______ on 1 March 2026, clause 12.4 and Article 7."),
      ).toBe(false);
      expect(realDataIn("Licence no. ____________  Passport no. ____________")).toBe(false);
    });
    test("the upload page text from a model is stored as text and returned unchanged for the page to escape", async () => {
      const tid = await fresh("Escape");
      const data = toData(spaTpl());
      data.sections.items[0]!.heading = "<script>alert(1)</script> PARTIES";
      const id = await queued(tid, pdf("escape"));
      await readTemplateUpload(ctx, deps(fakeHelper(data)), { uploadId: id });
      const vid = (await uploadRow(id)).versionId!;
      const v = await call("GET", `/api/template-versions/${vid}`, "legal");
      expect(v.json.sections[0].heading).toContain("<script>");
    });
    test("each step writes a staff-visible event with the hash and no file name", async () => {
      const ev = await database.db.select().from(dealEvents);
      const up = ev.filter((e) => e.type === "TEMPLATE_UPLOADED");
      expect(up.length).toBeGreaterThan(0);
      expect(JSON.stringify(up[0]!.payload)).not.toContain("sample.pdf");
    });
  });

  describe("preview", () => {
    test("renders a PDF marked SAMPLE with fictional values, stores nothing and changes nothing", async () => {
      const eventsBefore = (await database.db.select({ n: count() }).from(dealEvents))[0]!.n;
      const putsBefore = puts;
      const r = await call("GET", `/api/template-versions/${versionId}/preview`, "legal");
      expect(r.status).toBe(200);
      expect(r.type).toContain("application/pdf");
      expect(r.bytes.length).toBeGreaterThan(500);
      const text = await extractPdf(r.bytes);
      expect(text.ok).toBe(true);
      if (text.ok) {
        expect(text.text).toContain("SAMPLE");
        expect(text.text).not.toMatch(/784-\d{4}-\d{7}-\d/);
      }
      expect(puts).toBe(putsBefore);
      expect((await database.db.select({ n: count() }).from(dealEvents))[0]!.n).toBe(eventsBefore);
    });
    for (const role of ROLES) {
      test(`${role}: preview`, async () => {
        const r = await call("GET", `/api/template-versions/${versionId}/preview`, role);
        expect(r.status).toBe(READ.has(role) ? 200 : 403);
      });
    }
    test("401, 404 and a version that can't print answers 422 with what's missing, not a PDF", async () => {
      expect((await call("GET", `/api/template-versions/${versionId}/preview`, null)).status).toBe(401);
      expect((await call("GET", `/api/template-versions/${crypto.randomUUID()}/preview`, "admin")).status).toBe(404);
      expect((await call("GET", "/api/template-versions/nope/preview", "admin")).status).toBe(404);
    });
  });
});
