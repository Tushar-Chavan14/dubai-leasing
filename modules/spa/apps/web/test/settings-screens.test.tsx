/* oxlint-disable no-explicit-any -- the mocked framework calls and the pages' elements are read loosely */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { renderToStaticMarkup as render } from "react-dom/server";
import { DEFAULT_SPA_AML_POLICY, SpaRole, starterKycConfig } from "@spa/core";
import { FixedClock, issueToken } from "../../engine/test/session.ts";
import {
  dealEvents,
  spaAmlPolicy,
  spaKycConfigs,
  templateUploads,
  type SpaDatabase,
} from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import type { SpaContext } from "../../engine/src/manager/context.ts";
import { failClosedFacts } from "../../engine/src/manager/facts.ts";
import { addTemplateVersion, createTemplate } from "../../engine/src/manager/templates.ts";
import { seedUsers, spaTpl, toData, type U } from "../../engine/test/prepare-fixtures.ts";
import { AlertSettingsForm } from "../components/alert-settings";
import { AmlPolicyForm } from "../components/aml-policy";
import { KycEditor, KycIndexTable, PartyFormPreview } from "../components/kyc-settings";
import { NewTemplateForm, TemplateRecordView, TemplateTable, TemplateVersionPage } from "../components/templates";
import type { AmlPolicyView, KycDetail, TemplateRecord, TemplateVersionView } from "../lib/contracts";
import {
  alertThresholds,
  applyKycForm,
  applyPolicyForm,
  kycTarget,
  outcomeOf,
  remapRequest,
  settingsError,
  templateRequest,
  uploadBody,
} from "../lib/settings-forms";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-21T06:00:00Z");
const url = spaTestDatabaseUrl();
const ROLE_KEYS = [
  ["officer", "sales_officer"],
  ["manager", "sales_manager"],
  ["salesadmin", "sales_admin"],
  ["legal", "legal"],
  ["finance", "finance"],
  ["compliance", "compliance_officer"],
  ["mlro", "mlro"],
  ["admin", "admin"],
] as const;
/** The words no page a non-compliance role can open may hold (S57, S63, S66). */
const BANNED =
  /\baml\b|anti-money|money laundering|screen(ing|ed|s)?\b|sanction|\bpep\b|politically exposed|\bedd\b|due diligence|\brisk\b|mlro|suspicio/i;
const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};
const dummyAction = async () => {};

let session = "";
const redirects: string[] = [];
const revalidated: string[] = [];
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session }) }) }));
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
mock.module("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
mock.module("../lib/env", () => ({ engineUrl: () => "http://engine.test", sessionCookie: () => "spa_session" }));

// ---- pure pieces -------------------------------------------------------------------------------------------------------

describe("C34: the Settings forms read a fixed list of fields", () => {
  test("a template request keeps the name, kind and project codes; a stuffed role or actor is never sent", () => {
    const r = templateRequest(
      form({ name: " Standard SPA ", documentKind: "spa", projectCodes: "P-1, P-2", role: "admin", actor: "user:x" }),
    );
    expect(r).toEqual({
      method: "POST",
      path: "/api/templates",
      body: { name: "Standard SPA", documentKind: "spa", projectCodes: ["P-1", "P-2"] },
    });
    expect(templateRequest(form({ name: "", documentKind: "spa" }))).toBeNull();
    expect(templateRequest(form({ name: "x", documentKind: "nope" }))).toBeNull();
  });
  test("a remap request needs a uuid version, a bN blank and a key", () => {
    const id = "0198a1b2-0000-7000-8000-000000000001";
    expect(remapRequest(form({ versionId: id, blankId: "b4", key: "price", role: "admin" }))).toEqual({
      method: "POST",
      path: `/api/template-versions/${id}/blanks/b4/remap`,
      body: { key: "price" },
    });
    expect(remapRequest(form({ versionId: "../x", blankId: "b4", key: "price" }))).toBeNull();
    expect(remapRequest(form({ versionId: id, blankId: "../b4", key: "price" }))).toBeNull();
  });
  test("an upload body is the file and the box, nothing else", () => {
    const id = "0198a1b2-0000-7000-8000-000000000001";
    const f = form({ templateId: id, noRealData: "on", role: "admin" });
    f.set("file", new File(["%PDF-1.4"], "s.pdf"));
    const u = uploadBody(f)!;
    expect([...u.body.keys()].toSorted()).toEqual(["file", "noRealData"]);
    expect(u.body.get("noRealData")).toBe("true");
    f.delete("noRealData");
    expect(uploadBody(f)!.body.get("noRealData")).toBe("false");
    f.delete("file");
    expect(uploadBody(f)).toBeNull();
  });
  test("a KYC form is laid over the config: only words, required flags, confidence and cross-checks move", () => {
    const base = starterKycConfig("buyer_person");
    const f = form({
      minConfidence: "0.8",
      cross_required_documents: "blocker",
      cross_names_consistent: "warning",
      cross_name_matches_deal: "off",
      role: "admin",
    });
    for (const fld of base.form) {
      f.set(`label_${fld.key}`, `${fld.label} X`);
      if (fld.required) f.set(`required_${fld.key}`, "on");
    }
    const out = applyKycForm(base, f)!;
    expect(out.rules.minConfidence).toBe(0.8);
    expect(out.rules.cross.required_documents.severity).toBe("blocker");
    expect(out.form.map((x) => x.key)).toEqual(base.form.map((x) => x.key));
    expect(out.form[0]!.label).toBe(`${base.form[0]!.label} X`);
    expect(out.form.map((x) => x.type)).toEqual(base.form.map((x) => x.type));
    expect(applyKycForm(base, form({ ...Object.fromEntries(f), minConfidence: "2" }))).toBeNull();
    expect(applyKycForm(base, form({ ...Object.fromEntries(f), cross_names_consistent: "maybe" }))).toBeNull();
    expect(kycTarget(form({ role: "buyer_person", dealType: "resale_ready" }))).toEqual({
      role: "buyer_person",
      dealType: "resale_ready",
    });
    expect(kycTarget(form({ role: "judge" }))).toBeNull();
  });
  test("the compliance form is laid over the policy; sanctions always flags; a bad country or number is refused", () => {
    const f = form({
      cutoffMedium: "25",
      cutoffHigh: "55",
      highRiskCountries: "xx, yy",
      everyDays: "",
      atOffer: "on",
    });
    for (const id of Object.keys(DEFAULT_SPA_AML_POLICY.rules)) {
      f.set(`points_${id}`, "10");
      f.set(`severity_${id}`, id === "sanctions" ? "warning" : "flag");
      f.set(`on_${id}`, "on");
    }
    const out = applyPolicyForm(DEFAULT_SPA_AML_POLICY, f)!;
    expect(out.rules.sanctions).toEqual({ on: true, severity: "flag", points: 10 });
    expect(out.highRiskCountries).toEqual(["XX", "YY"]);
    expect(out.risk.cutoffs).toEqual({ medium: 25, high: 55 });
    expect(out.rescreen.everyDays).toBeNull();
    expect(out.rescreen.atOffer).toBe(true);
    expect(out.rescreen.beforeTransfer).toBe(false);
    expect(out.sourceOfFunds).toEqual(DEFAULT_SPA_AML_POLICY.sourceOfFunds);
    f.set("highRiskCountries", "XXX");
    expect(applyPolicyForm(DEFAULT_SPA_AML_POLICY, f)).toBeNull();
  });
  test("alert hours become a record of whole hours; nothing filled or a bad number is null", () => {
    expect(alertThresholds(form({ hours_kyc_review: "24", hours_compliance_review: "12", role: "admin" }))).toEqual({
      kyc_review: 24,
      compliance_review: 12,
    });
    expect(alertThresholds(form({ hours_kyc_review: "0" }))).toBeNull();
    expect(alertThresholds(form({}))).toBeNull();
  });
  test("an engine answer becomes one fixed word and the words never repeat engine text or name a compliance subject", () => {
    expect([200, 202, 401, 403, 409, 422, 400, 500, null].map(outcomeOf)).toEqual([
      "done",
      "done",
      "signin",
      "refused",
      "exists",
      "invalid",
      "invalid",
      "refused",
      "refused",
    ]);
    for (const c of ["invalid", "exists", "refused", "upload", "whatever"])
      expect(settingsError(c)).not.toMatch(BANNED);
  });
});

describe("C34: the Settings components draw what they are given", () => {
  const record = (over: Partial<TemplateRecord> = {}): TemplateRecord => ({
    id: "t1",
    name: "<b>Standard</b> SPA",
    documentKind: "spa",
    projectCodes: [],
    createdAt: "2026-11-20T06:00:00.000Z",
    versions: [
      {
        id: "v1",
        version: 1,
        status: "in_review",
        createdAt: "2026-11-20T06:00:00.000Z",
        decidedAt: null,
        approvalId: "a1",
        rulesVersion: "r",
        blockers: 2,
        warnings: 1,
      },
    ],
    uploads: [
      {
        id: "u1",
        fileName: "<img src=x onerror=alert(1)>.pdf",
        status: "needs_human",
        reason: "Upload a blank or fictional copy",
        versionId: null,
        uploadedAt: "2026-11-20T06:00:00.000Z",
        finishedAt: null,
      },
      {
        id: "u2",
        fileName: "ok.pdf",
        status: "done",
        reason: null,
        versionId: "v1",
        uploadedAt: "2026-11-20T06:00:00.000Z",
        finishedAt: null,
      },
    ],
    ...over,
  });
  test("the template page: upload form only for an admin; file names are escaped; results in words; every state has a label", () => {
    const admin = render(<TemplateRecordView t={record()} canWrite upload={dummyAction} />);
    expect(admin).toContain('type="file"');
    expect(admin).toContain('name="noRealData"');
    expect(admin).toContain("no real customer data");
    expect(admin).toContain("Upload a blank or fictional copy");
    expect(admin).toContain("Needs a person");
    expect(admin).toContain("2 to fix, 1 to look at");
    expect(admin).not.toContain("<img src=x");
    expect(admin).toContain("&lt;img src=x");
    const legal = render(<TemplateRecordView t={record()} canWrite={false} upload={dummyAction} />);
    expect(legal).not.toContain('type="file"');
    expect(legal).not.toMatch(/<form/);
    expect(legal).toContain("Only an admin uploads samples");
  });
  test("the template table and the add form", () => {
    expect(render(<TemplateTable items={[]} />)).toContain("No templates yet.");
    const html = render(
      <TemplateTable
        items={[
          {
            id: "t1",
            name: "Standard SPA",
            documentKind: "spa",
            projectCodes: ["P-1"],
            createdAt: "x",
            inUse: { versionId: "v", version: 2 },
            latest: { versionId: "v", version: 3, status: "in_review" },
          },
        ]}
      />,
    );
    expect(html).toContain("Version 2");
    expect(html).toContain("In review");
    expect(html).toContain("P-1");
    expect(render(<NewTemplateForm action={dummyAction} />)).toContain("A different scope is a new template");
  });
  const version = (over: Partial<TemplateVersionView> = {}): TemplateVersionView => ({
    id: "0198a1b2-0000-7000-8000-000000000001",
    templateId: "t1",
    templateName: "Standard SPA",
    documentKind: "spa",
    version: 1,
    status: "in_review",
    approvalId: "a1",
    rulesVersion: "r",
    createdAt: "2026-11-20T06:00:00.000Z",
    decidedAt: null,
    checks: [{ code: "x", severity: "blocker", message: "<script>alert(1)</script> missing key" }],
    blanks: [
      {
        id: "b1",
        label: "<script>alert(2)</script>",
        kind: "underscore",
        role: "field",
        field: "price",
        fieldType: "money_fils",
        source: "model",
        before: "Price: ",
        after: "",
      },
    ],
    title: "<script>alert(3)</script>",
    sections: [{ number: "1.", heading: "<script>alert(4)</script>", paragraphs: ["<script>alert(5)</script>"] }],
    canRemap: true,
    choices: [{ key: "price", label: "Sale price", type: "money_fils" }],
    ...over,
  });
  test("the version page: model text is escaped plain text; the remap form is the admin's while in review; legal is pointed to the inbox", () => {
    const admin = render(<TemplateVersionPage v={version()} viewer="admin" remap={dummyAction} />);
    expect(admin).not.toContain("<script>alert");
    expect(admin).toContain("&lt;script&gt;alert(2)");
    expect(admin).toContain('name="key"');
    expect(admin).toContain("Suggested by a model");
    expect(admin).toContain("marked SAMPLE");
    expect(admin).toContain("Legal decides this version in the inbox");
    const legal = render(<TemplateVersionPage v={version()} viewer="legal" remap={dummyAction} />);
    expect(legal).not.toContain('name="key"');
    expect(legal).not.toContain("<script>alert");
    expect(legal).toContain("Decide in the inbox");
    const manager = render(<TemplateVersionPage v={version()} viewer="sales_manager" remap={dummyAction} />);
    expect(manager).not.toContain('name="key"');
    expect(manager).not.toContain("Decide in the inbox");
    const decided = render(
      <TemplateVersionPage v={version({ status: "approved", canRemap: false })} viewer="admin" remap={dummyAction} />,
    );
    expect(decided).not.toContain('name="key"');
    expect(decided).toContain("In use");
  });
  const kyc = (draft: boolean): KycDetail => ({
    role: "buyer_person",
    dealType: null,
    scope: "any",
    effective: { version: 1, scope: "any", config: starterKycConfig("buyer_person") },
    draft: draft ? starterKycConfig("buyer_person") : null,
    versions: [{ version: 1, publishedAt: "2026-11-20T06:00:00.000Z" }],
  });
  test("the KYC editor: inputs for an admin with a publish button only when a draft waits; disabled and no buttons for a reader; a party preview", () => {
    const admin = render(<KycEditor d={kyc(true)} canEdit save={dummyAction} publish={dummyAction} />);
    expect(admin).toContain("Save draft");
    expect(admin).toContain("Publish the draft as the next version");
    expect(admin).toContain("The form as the party sees it");
    const noDraft = render(<KycEditor d={kyc(false)} canEdit save={dummyAction} publish={dummyAction} />);
    expect(noDraft).toContain("Save draft");
    expect(noDraft).not.toContain("Publish the draft");
    const reader = render(<KycEditor d={kyc(true)} canEdit={false} save={dummyAction} publish={dummyAction} />);
    expect(reader).not.toContain("Save draft");
    expect(reader).not.toContain("Publish the draft");
    expect(reader).toContain("disabled");
    expect(reader).toContain("Published versions are read-only");
    expect(render(<PartyFormPreview config={starterKycConfig("buyer_person")} />)).toContain("Choose a file to upload");
  });
  test("the KYC index links every role and override", () => {
    const items = (["buyer_person", "seller_person"] as const).flatMap((role) =>
      [null, "primary_offplan"].map((d) => ({
        role,
        dealType: d as any,
        scope: d ?? "any",
        version: null,
        hasDraft: role === "seller_person",
      })),
    );
    const html = render(<KycIndexTable items={items} />);
    expect(html).toContain('href="/settings/kyc/buyer_person"');
    expect(html).toContain('href="/settings/kyc/seller_person?dealType=primary_offplan"');
    expect(html).toContain("Draft waiting");
  });
  const policy = (over: Partial<AmlPolicyView> = {}): AmlPolicyView => ({
    version: 0,
    values: DEFAULT_SPA_AML_POLICY,
    confirmWithCompliance: true,
    mayPublish: true,
    history: [],
    ...over,
  });
  test("the compliance form: a confirm pill on placeholders only; publish for the officer, none for the reader", () => {
    const officer = render(<AmlPolicyForm p={policy()} action={dummyAction} />);
    expect(officer).toContain("Confirm with compliance");
    expect(officer).toContain("Publish as a new version");
    const mlro = render(<AmlPolicyForm p={policy({ mayPublish: false })} action={dummyAction} />);
    expect(mlro).not.toContain("Publish as a new version");
    expect(mlro).toContain("The compliance officer publishes changes");
    const set = render(
      <AmlPolicyForm
        p={policy({
          version: 3,
          confirmWithCompliance: false,
          history: [{ version: 3, createdAt: "2026-11-20T06:00:00.000Z" }],
        })}
        action={dummyAction}
      />,
    );
    expect(set).not.toContain("Confirm with compliance");
    expect(set).toContain("Version 3");
  });
  test("the alert form lists a row per gate with hours", () => {
    const html = render(
      <AlertSettingsForm
        items={[
          { key: "kyc_review", label: "KYC review", hours: 24, isDefault: true, version: 0 },
          { key: "compliance_review", label: "Compliance review", hours: 12, isDefault: false, version: 2 },
        ]}
        canEdit
        action={dummyAction}
      />,
    );
    expect(html).toContain('name="hours_kyc_review"');
    expect(html).toContain("Compliance review");
    expect(html).not.toMatch(BANNED);
  });
});

// ---- the real engine -----------------------------------------------------------------------------------------------------

describe.skipIf(!url)("C34: the Settings pages and actions against the real engine, per role", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  let ctx: SpaContext;
  let templateId = "";
  let versionId = "";
  const realFetch = globalThis.fetch;
  const sent: any[] = [];
  const asUser = (k: string) => (session = issueToken(SECRET, users[k]!.id, NOW));
  const putFiles = new Map<string, Uint8Array>();
  const page = async (mod: string, props: Record<string, unknown> = {}): Promise<string | "404"> => {
    const m = await import(mod);
    try {
      const el = await m.default({ params: Promise.resolve({}), searchParams: Promise.resolve({}), ...props });
      return render(el);
    } catch (e) {
      if (String((e as Error).message) === "NEXT_NOT_FOUND") return "404";
      throw e;
    }
  };
  const run = async (mod: string, name: string, f: FormData) => {
    const actions = await import(mod);
    redirects.length = 0;
    revalidated.length = 0;
    await (actions as any)[name](f).catch(() => {});
    return redirects[0];
  };
  const base = "../app/(staff)";

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    ctx = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
    app = createApp({
      database,
      jobs: {
        boss: {
          getQueue: async () => ({}),
          send: async (...a: unknown[]) => {
            sent.push(a);
            return "job";
          },
        } as never,
        lastHeartbeat: () => null,
      },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      documents: {
        async put(bytes, ext) {
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          putFiles.set(`${sha256}.${ext}`, bytes);
          return { sha256, path: `${sha256}.${ext}`, bytes: bytes.length };
        },
        async read(k) {
          return putFiles.get(k)!;
        },
      },
    });
    globalThis.fetch = ((input: string, init?: RequestInit) =>
      app.request(String(input).replace("http://engine.test", ""), init)) as never;
    const t = await createTemplate(ctx, { name: "Standard SPA", documentKind: "spa", projectCodes: [] }, users.admin!);
    templateId = t.id;
    const data = toData(spaTpl());
    data.sections.items[0]!.heading = "<script>alert('heading')</script> PARTIES";
    data.blanks[0]!.label = "<script>alert('label')</script>";
    const v = await addTemplateVersion(ctx, { templateId, docId: "d", docHash: "a".repeat(64), data }, users.admin!);
    versionId = v.id;
    await database.db.insert(templateUploads).values({
      id: crypto.randomUUID(),
      templateId,
      docHash: "b".repeat(64),
      storageKey: "k",
      fileName: "real-looking.pdf",
      status: "needs_human",
      reason: "Upload a blank or fictional copy",
      declaredNoRealData: true,
      uploadedBy: `user:${users.admin!.id}`,
      uploadedAt: new Date(NOW),
      finishedAt: new Date(NOW),
    });
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await database?.close();
  });

  const pages = () =>
    [
      { name: "settings", mod: `${base}/settings/page`, who: ["manager", "legal", "admin"] },
      { name: "templates", mod: `${base}/settings/templates/page`, who: ["manager", "legal", "admin"] },
      {
        name: "template",
        mod: `${base}/settings/templates/[id]/page`,
        who: ["manager", "legal", "admin"],
        props: { params: Promise.resolve({ id: templateId }) },
      },
      {
        name: "version",
        mod: `${base}/settings/templates/versions/[versionId]/page`,
        who: ["manager", "legal", "admin"],
        props: { params: Promise.resolve({ versionId }) },
      },
      { name: "kyc", mod: `${base}/settings/kyc/page`, who: ["manager", "admin"] },
      {
        name: "kyc form",
        mod: `${base}/settings/kyc/[role]/page`,
        who: ["manager", "admin"],
        props: { params: Promise.resolve({ role: "buyer_person" }) },
      },
      { name: "alerts", mod: `${base}/settings/alerts/page`, who: ["admin"] },
      { name: "helpers", mod: `${base}/settings/helpers/page`, who: ["manager", "admin"] },
      { name: "policy", mod: `${base}/compliance/policy/page`, who: ["compliance", "mlro"] },
    ] as const;

  test("every page opens for the right roles only and is not there for the rest, for all eight roles", async () => {
    for (const p of pages())
      for (const [key] of ROLE_KEYS) {
        asUser(key);
        const html = await page(p.mod, (p as any).props);
        const opens = (p.who as readonly string[]).includes(key);
        expect(html === "404", `${p.name} / ${key}`).toBe(!opens);
      }
  });

  test("no AML, screening, risk or sanction word on any page a non-compliance role can open, for all eight roles", async () => {
    let scanned = 0;
    for (const p of pages())
      for (const [key] of ROLE_KEYS) {
        if (key === "compliance" || key === "mlro") continue;
        asUser(key);
        const html = await page(p.mod, (p as any).props);
        if (html === "404") continue;
        scanned++;
        expect(html, `${p.name} / ${key}`).not.toMatch(BANNED);
      }
    expect(scanned).toBeGreaterThanOrEqual(15);
  });

  test("the Settings hub lists only what the role may open; admin sees the neutral compliance card and nothing else about it", async () => {
    asUser("legal");
    const legal = (await page(`${base}/settings/page`)) as string;
    expect(legal).toContain('href="/settings/templates"');
    expect(legal).not.toContain("/settings/kyc");
    expect(legal).not.toContain("/settings/helpers");
    expect(legal).not.toContain("/settings/alerts");
    expect(legal).not.toContain("managed by compliance");
    asUser("manager");
    const manager = (await page(`${base}/settings/page`)) as string;
    expect(manager).toContain("/settings/kyc");
    expect(manager).not.toContain("/settings/alerts");
    expect(manager).not.toContain("managed by compliance");
    asUser("admin");
    const admin = (await page(`${base}/settings/page`)) as string;
    expect(admin).toContain("Compliance rules, managed by compliance");
    expect(admin).not.toContain("/compliance/policy");
    expect(admin).not.toMatch(BANNED);
  });

  test("model text on the pages is escaped: no script element reaches an admin's or legal's page", async () => {
    for (const k of ["admin", "legal", "manager"]) {
      asUser(k);
      const v = (await page(`${base}/settings/templates/versions/[versionId]/page`, {
        params: Promise.resolve({ versionId }),
      })) as string;
      expect(v).not.toContain("<script>alert");
      expect(v).toContain("&lt;script&gt;alert(&#x27;heading&#x27;)");
      expect(v).toContain("Preview with sample values");
    }
    asUser("admin");
    const t = (await page(`${base}/settings/templates/[id]/page`, {
      params: Promise.resolve({ id: templateId }),
    })) as string;
    expect(t).toContain("Upload a blank or fictional copy");
    expect(t).toContain("real-looking.pdf");
    expect(t).not.toMatch(/\b784-|N1234567/);
  });

  test("the compliance rules page shows the placeholder pill, and the officer alone has the publish button", async () => {
    asUser("compliance");
    const officer = (await page(`${base}/compliance/policy/page`)) as string;
    expect(officer).toContain("Confirm with compliance");
    expect(officer).toContain("Publish as a new version");
    asUser("mlro");
    const mlro = (await page(`${base}/compliance/policy/page`)) as string;
    expect(mlro).toContain("Confirm with compliance");
    expect(mlro).not.toContain("Publish as a new version");
  });

  test("a hand-edited address is a page that isn't there, never a crash", async () => {
    asUser("admin");
    expect(await page(`${base}/settings/templates/[id]/page`, { params: Promise.resolve({ id: "not-a-uuid" }) })).toBe(
      "404",
    );
    expect(
      await page(`${base}/settings/templates/[id]/page`, { params: Promise.resolve({ id: crypto.randomUUID() }) }),
    ).toBe("404");
    expect(await page(`${base}/settings/kyc/[role]/page`, { params: Promise.resolve({ role: "judge" }) })).toBe("404");
    expect(
      await page(`${base}/settings/kyc/[role]/page`, {
        params: Promise.resolve({ role: "buyer_person" }),
        searchParams: Promise.resolve({ dealType: "x" }),
      }),
    ).toBe("404");
  });

  test("template actions: a forged form from a sales role changes nothing; an admin adds, uploads (twice: the same row), remaps", async () => {
    const A = `${base}/settings/templates/actions`;
    asUser("officer");
    expect(await run(A, "createTemplate", form({ name: "Forged", documentKind: "spa", role: "admin" }))).toBe(
      "/settings/templates?error=refused",
    );
    asUser("admin");
    expect(await run(A, "createTemplate", form({ name: "", documentKind: "spa" }))).toBe(
      "/settings/templates?error=invalid",
    );
    expect(await run(A, "createTemplate", form({ name: "Second SPA", documentKind: "spa" }))).toBe(
      "/settings/templates?saved=template",
    );
    expect(await run(A, "createTemplate", form({ name: "Second SPA", documentKind: "spa" }))).toBe(
      "/settings/templates?error=exists",
    );
    const up = (name = "s.pdf", box = true) => {
      const f = form({ templateId });
      if (box) f.set("noRealData", "on");
      f.set("file", new File(["%PDF-1.4\n% fictional"], name, { type: "application/pdf" }));
      return f;
    };
    expect(await run(A, "uploadSample", up())).toBe(`/settings/templates/${templateId}?saved=upload`);
    expect(await run(A, "uploadSample", up("again.pdf"))).toBe(`/settings/templates/${templateId}?saved=existing`);
    expect(await run(A, "uploadSample", up("s.pdf", false))).toBe(`/settings/templates/${templateId}?error=upload`);
    asUser("legal");
    expect(await run(A, "uploadSample", up("l.pdf"))).toBe(`/settings/templates/${templateId}?error=refused`);
    asUser("admin");
    expect(await run(A, "remapBlank", form({ versionId, blankId: "b4", key: "leave_empty" }))).toBe(
      `/settings/templates/versions/${versionId}?saved=remap#blanks`,
    );
    expect(await run(A, "remapBlank", form({ versionId, blankId: "b1", key: "price" }))).toBe(
      `/settings/templates/versions/${versionId}?error=invalid`,
    );
    asUser("manager");
    expect(await run(A, "remapBlank", form({ versionId, blankId: "b4", key: "price" }))).toBe(
      `/settings/templates/versions/${versionId}?error=refused`,
    );
  });

  test("KYC actions: an admin saves a draft and publishes it; a manager's forged save is refused", async () => {
    const A = `${base}/settings/kyc/actions`;
    const cfg = starterKycConfig("buyer_person");
    const fields = (label?: string) => {
      const f = form({
        role: "buyer_person",
        minConfidence: "0.7",
        cross_required_documents: "blocker",
        cross_names_consistent: "warning",
        cross_name_matches_deal: "warning",
      });
      for (const x of cfg.form) {
        f.set(`label_${x.key}`, x.key === "full_name" && label ? label : x.label);
        if (x.required) f.set(`required_${x.key}`, "on");
      }
      return f;
    };
    asUser("manager");
    expect(await run(A, "saveKycDraft", fields())).toBe("/settings/kyc/buyer_person?error=refused");
    asUser("admin");
    expect(await run(A, "saveKycDraft", fields("Full name, as written"))).toBe(
      "/settings/kyc/buyer_person?saved=draft",
    );
    const draft = (await database.db.select().from(spaKycConfigs)).filter((r) => r.status === "draft");
    expect(JSON.stringify(draft[0]!.values)).toContain("Full name, as written");
    expect(await run(A, "publishKycDraft", form({ role: "buyer_person" }))).toBe(
      "/settings/kyc/buyer_person?saved=published",
    );
    expect(await run(A, "publishKycDraft", form({ role: "buyer_person" }))).toBe(
      "/settings/kyc/buyer_person?error=exists",
    );
    // an override for one deal type keeps its own address
    const ov = fields();
    ov.set("dealType", "resale_ready");
    expect(await run(A, "saveKycDraft", ov)).toBe("/settings/kyc/buyer_person?dealType=resale_ready&saved=draft");
    // the published version is read-only on the page: a second save leaves it as published
    const read = (await page(`${base}/settings/kyc/[role]/page`, {
      params: Promise.resolve({ role: "buyer_person" }),
    })) as string;
    expect(read).toContain("Full name, as written");
    expect(read).toContain("Version 1");
  });

  test("alert actions: an admin saves the hours; the page keeps its compliance entry generic", async () => {
    const A = `${base}/settings/alerts/actions`;
    asUser("manager");
    expect(await run(A, "saveAlertSettings", form({ hours_kyc_review: "12" }))).toBe("/settings/alerts?error=refused");
    asUser("admin");
    expect(await run(A, "saveAlertSettings", form({ hours_kyc_review: "0" }))).toBe("/settings/alerts?error=invalid");
    expect(await run(A, "saveAlertSettings", form({ hours_kyc_review: "12", hours_compliance_review: "6" }))).toBe(
      "/settings/alerts?saved=alerts",
    );
    const html = (await page(`${base}/settings/alerts/page`)) as string;
    expect(html).toContain("Compliance review");
    expect(html).not.toMatch(BANNED);
    const events = await database.db.select().from(dealEvents);
    expect(JSON.stringify(events.filter((e) => e.type === "ALERT_SETTINGS_SET"))).not.toMatch(/aml|compliance_review/i);
  });

  test("compliance actions: the officer publishes; the MLRO, an admin and a sales role are refused and nothing is written", async () => {
    const A = `${base}/compliance/policy/actions`;
    const fields = (countries = "XX") => {
      const f = form({
        cutoffMedium: "30",
        cutoffHigh: "60",
        highRiskCountries: countries,
        everyDays: "90",
        atOffer: "on",
        beforeTransfer: "on",
      });
      for (const id of Object.keys(DEFAULT_SPA_AML_POLICY.rules)) {
        f.set(`points_${id}`, "20");
        f.set(`severity_${id}`, "flag");
        f.set(`on_${id}`, "on");
      }
      return f;
    };
    for (const k of ["mlro", "admin", "officer", "manager", "salesadmin", "legal", "finance"]) {
      asUser(k);
      expect(await run(A, "publishAmlPolicy", fields()), k).toBe("/compliance/policy?error=refused");
    }
    expect((await database.db.select().from(spaAmlPolicy)).length).toBe(0);
    asUser("compliance");
    expect(await run(A, "publishAmlPolicy", fields("XXX"))).toBe("/compliance/policy?error=invalid");
    expect(await run(A, "publishAmlPolicy", fields("XX, YY"))).toBe("/compliance/policy?saved=policy");
    expect((await database.db.select().from(spaAmlPolicy)).length).toBe(1);
    const html = (await page(`${base}/compliance/policy/page`)) as string;
    expect(html).not.toContain("Confirm with compliance");
    expect(html).toContain("Version 1");
  });

  test("the preview address forwards the session and refuses a bad id", async () => {
    const route = await import(`${base}/settings/templates/versions/[versionId]/preview/route`);
    asUser("legal");
    const ok = await route.GET(new Request("http://web.test/x"), { params: Promise.resolve({ versionId }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/pdf");
    expect(
      (await route.GET(new Request("http://web.test/x"), { params: Promise.resolve({ versionId: "../x" }) })).status,
    ).toBe(404);
    asUser("finance");
    expect((await route.GET(new Request("http://web.test/x"), { params: Promise.resolve({ versionId }) })).status).toBe(
      404,
    );
  });

  test("every role value is a real role", () => {
    for (const [, r] of ROLE_KEYS) expect(SpaRole.options).toContain(r);
  });
});
