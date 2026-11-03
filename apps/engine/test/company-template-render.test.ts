import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { type CalendarDate, newId, type OfferTerms } from "@leasing/core";
import {
  applications,
  actionLinks,
  approvals,
  companyClauses,
  companyContractTemplates,
  contractRules,
  contractSigners,
  contracts,
  type Database,
  documents,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  units,
  withTx,
} from "@leasing/db";
import {
  buildEjariPayload,
  DEFAULT_STYLE,
  EMPTY_REVIEW,
  encodePng,
  extractPdf,
  type TemplateBlank,
  type TemplateSections,
  type TemplateStyle,
  templateParagraphs,
} from "@leasing/helpers";
import { FakeLlm } from "@leasing/llm";
import { and, eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { backfillTemplateClauseLinks } from "../src/manager/company-templates.ts";
import { contractAgentContext } from "../src/manager/contract-agent-backend.ts";
import { contractInputs } from "../src/manager/contracts.ts";
import { issueToken } from "../src/api/auth.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import { DEFAULT_ADDENDUM, prepareContract } from "../src/manager/contracts.ts";
import {
  addStaff,
  agreeingDecision,
  completeLegalDetails,
  freshDatabase,
  noDb,
  testCompany,
  testContext,
} from "./harness.ts";

const SECRET = "tpl-secret";
let database: Database;

const blank = (
  id: string,
  label: string,
  field: TemplateBlank["field"],
  before: string,
  over: Partial<TemplateBlank> = {},
): TemplateBlank => ({
  id,
  kind: "underscore",
  marker: "____",
  label,
  field,
  fieldType: null,
  role: "field",
  sectionIndex: 0,
  before,
  after: "",
  ...over,
});

const SECTIONS: TemplateSections = {
  numbering: "article",
  title: "RESIDENTIAL TENANCY AGREEMENT",
  items: [
    { id: "s0", number: null, heading: null, paragraphs: ["Made between {{b1}} (Landlord) and {{b2}} (Tenant)."] },
    {
      id: "s1",
      number: "Article I",
      heading: "Premises",
      paragraphs: ["The premises are unit {{b3}} in {{b4}}."],
    },
    {
      id: "s2",
      number: "Article II",
      heading: "Term and Rent",
      paragraphs: [
        "The term starts on {{b5}} and ends on {{b6}}.",
        "The annual rent is {{b7}}, paid in {{b8}} cheques.",
        "A security deposit of {{b9}} is held.",
      ],
    },
    { id: "s3", number: "Article III", heading: "Signatures", paragraphs: ["Landlord: {{b10}}", "Tenant: {{b11}}"] },
  ],
};
/** All mapped; `b1` and `b2` are names printed exactly. */
const goodBlanks = (): TemplateBlank[] => [
  blank("b1", "Landlord name", "landlordNameEn", "Made between "),
  blank("b2", "Tenant name", "tenantNameEn", "(Landlord) and "),
  blank("b3", "Unit number", "unitNo", "The premises are unit "),
  blank("b4", "Building", "building", "in "),
  blank("b5", "Start date", "startOn", "The term starts on "),
  blank("b6", "End date", "endOn", "and ends on "),
  blank("b7", "Annual rent", "annualRentFils", "The annual rent is "),
  blank("b8", "Number of cheques", "cheques", "paid in ", { after: " cheques." }),
  blank("b9", "Security deposit", "depositFils", "A security deposit of "),
  blank("b10", "Landlord signature", "unmapped", "Landlord: ", { role: "signature" }),
  blank("b11", "Tenant signature", "unmapped", "Tenant: ", { role: "signature" }),
];
const STYLE: TemplateStyle = {
  ...DEFAULT_STYLE,
  fromSample: true,
  font: { family: "serif", regular: "Times-Roman", bold: "Times-Bold", observed: ["Times-Roman"] },
  accentColour: "#1f4e79",
  header: "Fictional Realty Co. Tenancy",
  footer: "Fictional Realty Co. Page {page} of {pages}",
};

async function setup() {
  const t = testContext(database, "2026-10-28T04:00:00Z", { llm: new FakeLlm(agreeingDecision) });
  const companyId = await testCompany(database);
  const otherCompanyId = await testCompany(database, { slug: "other-co", name: "Other Co" });
  const landlordId = await completeLegalDetails(database, companyId, {
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
    companyId,
    id: unitId,
    code: "MRN-1608",
    building: "Demo Marina Tower",
    community: "Dubai Marina",
    unitNo: "1608",
    dldPropertyNo: "DEMO-DLD-001608",
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
  const admin = await addStaff(database, "admin");
  const officer = await addStaff(database, "leasing_officer");
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const as =
    (user: { id: string }) =>
    (path: string, method = "GET", body?: unknown) =>
      app.request(`/api${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
  const api = as(admin);

  let versions = 0;
  /** A proposed template for a company, as extraction would store it (sample document included). */
  const propose = async (
    over: {
      unconfirmed?: boolean;
      companyId?: string;
      blanks?: TemplateBlank[];
      style?: TemplateStyle;
      logo?: boolean;
      sections?: TemplateSections;
    } = {},
  ) => {
    const cid = over.companyId ?? companyId;
    const sampleId = newId();
    await database.db.insert(documents).values({
      id: sampleId,
      kind: "contract_sample",
      sha256: sampleId,
      path: `x/${sampleId}`,
      mime: "application/pdf",
      extracted: { companyId: cid, status: "done" },
    });
    let logoDocumentId: string | null = null;
    if (over.logo) {
      const px = new Uint8Array(8 * 8 * 4).fill(200);
      const stored = await t.ctx.documents.put(encodePng(8, 8, 4, px), "png");
      logoDocumentId = newId();
      await database.db.insert(documents).values({
        id: logoDocumentId,
        kind: "template_logo",
        sha256: stored.sha256,
        path: stored.path,
        mime: "image/png",
        bytes: stored.bytes,
        extracted: { widthPx: 8, heightPx: 8 },
      });
    }
    const id = newId();
    versions++;
    await database.db.insert(companyContractTemplates).values({
      id,
      companyId: cid,
      sampleDocumentId: sampleId,
      status: "proposed",
      sections: over.sections ?? SECTIONS,
      blanks: over.blanks ?? goodBlanks(),
      style: over.style ?? STYLE,
      // The wording carries numbers and periods: confirmed up front unless a test wants the block.
      review: {
        ...EMPTY_REVIEW,
        valuesConfirmed: over.unconfirmed
          ? []
          : templateParagraphs(over.sections ?? SECTIONS)
              .filter((p) => p.values)
              .map((p) => p.key),
      },
      logoDocumentId,
      version:
        (await database.db.select().from(companyContractTemplates).where(eq(companyContractTemplates.companyId, cid)))
          .length + 1,
      createdBy: "helper:contract_structure",
      createdAt: new Date(),
    });
    return id;
  };
  /** D47 "Approve all" for the company of the template (its sample is the latest one), with the one tick. */
  const approveSample = async (id: string, body: Record<string, unknown> = { checked: true }, user = admin) => {
    const [row] = await database.db.select().from(companyContractTemplates).where(eq(companyContractTemplates.id, id));
    return as(user)(`/companies/${row!.companyId}/sample/approve`, "POST", body);
  };
  const approve = async (id: string) => {
    const r = await approveSample(id);
    expect(r.status).toBe(200);
  };
  const rule = async (templateId: string | null, cid = companyId) => {
    const r = await api("/contract-rules", "POST", {
      companyId: cid,
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 12,
      clauseIds: [],
      ...(templateId ? { templateId } : {}),
    });
    return { status: r.status, body: (await r.json()) as { id: string; templateId?: string | null } };
  };
  return {
    ...t,
    app,
    api,
    as,
    admin,
    officer,
    companyId,
    otherCompanyId,
    leaseId,
    tenantId,
    unitId,
    propose,
    approve,
    approveSample,
    rule,
    versions,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const templateRow = async (id: string) =>
  (await database.db.select().from(companyContractTemplates).where(eq(companyContractTemplates.id, id)))[0]!;
const contractRows = async (leaseId: string) =>
  database.db.select().from(contracts).where(eq(contracts.leaseId, leaseId)).orderBy(contracts.version);
const pdfText = async (s: S, documentId: string) => {
  const [doc] = await database.db.select().from(documents).where(eq(documents.id, documentId));
  const x = await extractPdf(new Uint8Array(await s.ctx.documents.read(doc!.path)));
  return x.ok ? x.text : "";
};

describe.skipIf(noDb)("company template review and approval", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  describe("one-step approval with the template's clauses", () => {
    const proposedClause = async (s: S, templateId: string, quote: string, companyId = s.companyId) => {
      const row = await templateRow(templateId);
      const id = newId();
      await database.db.insert(companyClauses).values({
        id,
        companyId,
        title: "Clause",
        textEn: quote,
        quote,
        category: "other",
        hasValues: false,
        status: "proposed",
        sourceDocumentId: row.sampleDocumentId,
        createdBy: "helper:contract_template",
      });
      return id;
    };
    const clauseRow = async (id: string) =>
      (await database.db.select().from(companyClauses).where(eq(companyClauses.id, id)))[0]!;

    test("Approve all approves every clause, linked to the paragraph it was read from (D47)", async () => {
      const s = await setup();
      const id = await s.propose();
      const c = await proposedClause(s, id, "The term starts on 1 December 2026 and ends on 30 November 2027.");
      await s.approve(id);
      const row = await clauseRow(c);
      expect(row).toMatchObject({ status: "approved", inTemplateId: id });
      expect(row.templateParagraphKey).not.toBeNull();
      // The clause wording is now the paragraph's, with its blanks as [labels].
      expect(row.textEn).toContain("[Start date]");
    });

    test("an unticked clause is approved but stays out of the sample's rule", async () => {
      const s = await setup();
      const id = await s.propose();
      const ruleId = (await s.rule(null)).body.id;
      const sampleId = (await templateRow(id)).sampleDocumentId;
      await database.db
        .update(documents)
        .set({ extracted: { companyId: s.companyId, status: "done", ruleId } })
        .where(eq(documents.id, sampleId));
      const kept = await proposedClause(s, id, "The term starts on 1 December 2026 and ends on 30 November 2027.");
      const out = await proposedClause(s, id, "A security deposit of AED 6,750 is held.");
      const r = await s.approveSample(id, { ruleClauseIds: [kept], checked: true });
      expect(r.status).toBe(200);
      expect((await clauseRow(kept)).status).toBe("approved");
      expect((await clauseRow(out)).status).toBe("approved");
      const [active] = await database.db
        .select()
        .from(contractRules)
        .where(and(eq(contractRules.companyId, s.companyId), eq(contractRules.active, true)));
      expect(active!.clauseIds).toEqual([`cc:${kept}`]);
    });

    test("a clause with amounts needs the one 'I checked' tick", async () => {
      const s = await setup();
      const id = await s.propose();
      const priced = await proposedClause(s, id, "A security deposit of AED 6,750 is held.");
      await database.db.update(companyClauses).set({ hasValues: true }).where(eq(companyClauses.id, priced));
      const r = await s.approveSample(id, {});
      expect(r.status).toBe(422);
      expect(((await r.json()) as { code: string }).code).toBe("confirm_checked");
      expect((await s.approveSample(id, { checked: true })).status).toBe(200);
      expect((await clauseRow(priced)).status).toBe("approved");
    });

    test("a clause id from another sample is refused and nothing changes", async () => {
      const s = await setup();
      const id = await s.propose();
      const other = await s.propose();
      const foreign = await proposedClause(s, other, "The premises are unit 1204 in Demo Tower.");
      // The latest sample is `other`; a clause from `id`'s sample can't be ticked into its rule.
      const mine = await proposedClause(s, id, "The term starts on 1 December 2026 and ends on 30 November 2027.");
      const r = await s.approveSample(other, { ruleClauseIds: [mine], checked: true });
      expect(r.status).toBe(422);
      expect((await templateRow(other)).status).toBe("proposed");
      expect((await clauseRow(foreign)).status).toBe("proposed");
    });
  });

  test("a blank left empty (or unmapped) does not block approval; mappings can't be edited by hand", async () => {
    const s = await setup();
    const blanks = goodBlanks();
    blanks[6] = blank("b7", "Annual rent", "leave_empty", "The annual rent is ");
    blanks[3] = blank("b4", "Building", "unmapped", "in ");
    const id = await s.propose({ blanks });
    await s.approve(id);
    expect((await templateRow(id)).status).toBe("approved");
    // No field selection any more: the review patch refuses a `mappings` key.
    const id2 = await s.propose();
    expect((await s.api(`/contract-templates/${id2}`, "PATCH", { mappings: { b7: "startOn" } })).status).toBe(400);
    expect((await templateRow(id2)).blanks).toEqual(goodBlanks());
  });

  test("Re-suggest mappings fixes a proposed template by label and party; an approved one is immutable", async () => {
    const s = await setup();
    const blanks = goodBlanks();
    blanks[0] = blank("b1", "Landlord Nationality", "leaseRef", "Made between ");
    blanks[1] = blank("b2", "Date of contract", "startOn", "(Landlord) and ");
    const id = await s.propose({ blanks });
    const r = await s.api(`/contract-templates/${id}/resuggest`, "POST");
    expect(r.status).toBe(200);
    const row = await templateRow(id);
    const by = (b: string) => (row.blanks as TemplateBlank[]).find((x) => x.id === b)!;
    expect(by("b1")).toMatchObject({ field: "landlordNationality", source: "matched" });
    expect(by("b2")).toMatchObject({ field: "contractOn", source: "matched" });
    await s.approve(id);
    const again = await s.api(`/contract-templates/${id}/resuggest`, "POST");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe("template_immutable");
  });

  test("wording with values or DLD/RERA words needs only the one tick, not a confirmation per line (D47)", async () => {
    const s = await setup();
    const sections: TemplateSections = {
      ...SECTIONS,
      items: [
        ...SECTIONS.items,
        { id: "s9", number: null, heading: "Registration", paragraphs: ["The tenancy is registered with Ejari."] },
      ],
    };
    const id = await s.propose({ sections, unconfirmed: true });
    const r = await s.approveSample(id, {});
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe("confirm_checked");
    await s.approve(id);
    expect((await templateRow(id)).review).toMatchObject({ checked: true });
  });

  test("wording with a person's ID, phone or amount from the sample is left out automatically", async () => {
    const s = await setup();
    const sections: TemplateSections = {
      ...SECTIONS,
      items: SECTIONS.items.map((it) =>
        it.id === "s1"
          ? {
              ...it,
              paragraphs: [
                ...it.paragraphs,
                "Owner Ahmed Khalid Al Mansoori, Emirates ID 784-1980-1234567-1, phone +971 50 123 4567.",
              ],
            }
          : it,
      ),
    };
    const id = await s.propose({ sections });
    // D47: code leaves the line out on its own and says so; nothing to tick per line.
    const panel = (await (await s.api(`/companies/${s.companyId}/contract-template`)).json()) as {
      templates: { id: string; changes: string[] }[];
    };
    expect(panel.templates.find((t) => t.id === id)!.changes.join(" ")).toContain("Emirates ID");
    await s.approve(id);
    expect((await s.rule(id)).status).toBe(201);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    const text = await pdfText(s, c!.documentId!);
    expect(text).toContain("The premises are unit 1608");
    expect(text).not.toMatch(/Ahmed|784-1980|\+971/);
  });

  test("a wrong-type mapping already stored (tampered row) doesn't block: the blank prints empty", async () => {
    const s = await setup();
    const blanks = goodBlanks();
    blanks[4] = { ...blank("b5", "Start date", "annualRentFils", "The term starts on "), fieldType: "money_fils" };
    const id = await s.propose({ blanks });
    await s.approve(id);
    expect((await templateRow(id)).status).toBe("approved");
  });

  test("a header, footer or logo with authority marks is removed automatically", async () => {
    const s = await setup();
    const style: TemplateStyle = {
      ...STYLE,
      header: null,
      footer: null,
      accentColour: null,
      flags: { authorityMarks: true, areas: ["header", "footer", "logo_area"] },
    };
    const id = await s.propose({ style, logo: true });
    // D47: the marked header, footer and logo are removed by code, never kept.
    await s.approve(id);
    // The look in use has no header, footer or logo and the neutral accent colour.
    const view = (await (await s.api(`/companies/${s.companyId}/contract-template`)).json()) as {
      templates: {
        effective: { header: string | null; footer: string | null; accentColour: string | null; hasLogo: boolean };
      }[];
    };
    expect(view.templates[0]!.effective).toEqual({ header: null, footer: null, accentColour: null, hasLogo: false });
  });

  test("a kept logo needs the one tick (it covers 'our company's logo')", async () => {
    const s = await setup();
    const id = await s.propose({ logo: true });
    const r = await s.approveSample(id, {});
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe("confirm_checked");
    await s.approve(id);
    const logo = await s.api(`/contract-templates/${id}/logo`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
  });

  test("approval is admin only; an approved template is immutable; a new version retires the old one", async () => {
    const s = await setup();
    const v1 = await s.propose();
    expect((await s.approveSample(v1, { checked: true }, s.officer)).status).toBe(403);
    expect((await s.as(s.officer)(`/contract-templates/${v1}`, "PATCH", { dropHeader: true })).status).toBe(403);
    await s.approve(v1);
    // Immutable.
    const edit = await s.api(`/contract-templates/${v1}`, "PATCH", { dropHeader: true });
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { code: string }).code).toBe("template_immutable");
    expect((await s.approveSample(v1)).status).toBe(409);
    const v2 = await s.propose();
    await s.approve(v2);
    expect((await templateRow(v1)).status).toBe("retired");
    expect((await templateRow(v2)).status).toBe("approved");
    expect((await templateRow(v2)).version).toBe(2);
    // Retire.
    expect((await s.api(`/contract-templates/${v2}/retire`, "POST")).status).toBe(200);
    expect((await s.api(`/contract-templates/${v2}/retire`, "POST")).status).toBe(409);
    // Every decision is in the audit trail with the actor.
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.companyId));
    const decisions = events.filter(
      (e) => e.type.startsWith("COMPANY_TEMPLATE_") && e.type !== "COMPANY_TEMPLATE_PROPOSED",
    );
    expect(decisions.map((e) => e.type).toSorted()).toEqual(
      [
        "COMPANY_TEMPLATE_APPROVED",
        "COMPANY_TEMPLATE_APPROVED",
        "COMPANY_TEMPLATE_RETIRED",
        "COMPANY_TEMPLATE_RETIRED",
      ].toSorted(),
    );
    for (const e of decisions) expect(e.actor).toBe(`user:${s.admin.id}`);
  });

  test("a contract rule may reference only an approved template of its own company", async () => {
    const s = await setup();
    const proposed = await s.propose();
    expect((await s.rule(proposed)).status).toBe(422);
    const approved = await s.propose();
    await s.approve(approved);
    const theirs = await s.propose({ companyId: s.otherCompanyId });
    await s.approve(theirs);
    const cross = await s.rule(theirs);
    expect(cross.status).toBe(422);
    expect((cross.body as unknown as { code: string }).code).toBe("template_unavailable");
    const ok = await s.rule(approved);
    expect(ok.status).toBe(201);
    expect(ok.body.templateId).toBe(approved);
    // A replace without `templateId` keeps it; null clears it.
    const kept = await s.api(`/contract-rules/${ok.body.id}`, "PUT", {
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 12,
      clauseIds: [],
    });
    const keptRule = (await kept.json()) as { id: string; templateId: string | null };
    expect(keptRule.templateId).toBe(approved);
    const cleared = await s.api(`/contract-rules/${keptRule.id}`, "PUT", {
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 12,
      clauseIds: [],
      templateId: null,
    });
    expect(((await cleared.json()) as { templateId: string | null }).templateId).toBeNull();
  });

  test("the preview renders sample values, marked Preview; admin only", async () => {
    const s = await setup();
    const id = await s.propose({ logo: true });
    const r = await s.api(`/contract-templates/${id}/preview`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await r.arrayBuffer());
    const x = await extractPdf(bytes);
    const text = x.ok ? x.text : "";
    expect(text).toContain("Preview");
    // Placeholders show where each field lands; no realistic value, signature lines empty.
    expect(text).toContain("«Tenant name»");
    expect(text).toContain("«Annual rent (AED)»");
    expect(text).toContain("placeholders, not a contract");
    expect(text).not.toContain("Sample Tenant");
    expect(text).not.toContain("85,000");
    expect((await s.as(s.officer)(`/contract-templates/${id}/preview`)).status).toBe(403);
    // A blank left empty previews as an empty line (it is hand-filled), not an error.
    const blanks = goodBlanks();
    blanks[0] = blank("b1", "Landlord name", "leave_empty", "Made between ");
    const empty = await s.propose({ blanks });
    expect((await s.api(`/contract-templates/${empty}/preview`)).status).toBe(200);
  });
});

describe.skipIf(noDb)("contract rendered in the company template", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  /** An approved template pinned by the unit's contract rule. */
  async function pinned(s: S, over: Parameters<S["propose"]>[0] = {}, confirm = true) {
    const id = await s.propose(over);
    if (over.logo && confirm) await s.api(`/contract-templates/${id}`, "PATCH", { logoConfirmed: true });
    await s.approve(id);
    const r = await s.rule(id);
    expect(r.status).toBe(201);
    return id;
  }

  test("every blank is filled from contract fields, formatted by code; the PDF text layer is stable", async () => {
    const s = await setup();
    const id = await pinned(s, { logo: true });
    const p = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    expect(p.status).toBe("prepared");
    const [c] = await contractRows(s.leaseId);
    const text = await pdfText(s, c!.documentId!);
    expect(text).toContain("RESIDENTIAL TENANCY AGREEMENT");
    expect(text).toContain("Made between Fictional Holdings LLC (Landlord) and LENA TESTOVA (Tenant).");
    expect(text).toContain("The premises are unit 1608 in Demo Marina Tower.");
    expect(text).toContain("The term starts on 1 December 2026 and ends on 30 November 2027.");
    expect(text).toContain("The annual rent is AED 135,000, paid in 4 cheques.");
    expect(text).toContain("A security deposit of AED 6,750 is held.");
    expect(text).toContain("Article I Premises");
    expect(text).toContain("Fictional Realty Co. Tenancy"); // header
    expect(text).toContain("Fictional Realty Co. Page 1 of 1"); // footer with page numbers
    expect(text).not.toMatch(/\{\{|_{3}/);
    // What the template lacks is appended; company clauses (standard here) follow the template.
    expect(text).toContain("Additional terms required by law");
    expect(text).toContain("registered in Ejari");
    expect(text).toContain("Minor maintenance");
    expect(text).toContain("Company template v1");
    expect(text.indexOf("Article II Term and Rent")).toBeLessThan(text.indexOf("Minor maintenance"));
    expect(text.indexOf("Minor maintenance")).toBeLessThan(text.indexOf("Additional terms required by law"));
    expect(text.replace(/C-[A-Z0-9]{6}/, "C-REF")).toMatchSnapshot();
    // The approval shows the PDF and the template line; the template is in the stored proposal.
    const [a] = await database.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.entityId, s.leaseId), eq(approvals.gate, "final_contract")));
    expect(a!.reasons).toContain("Company template v1");
    expect((a!.proposal as { template?: { id: string; version: number } }).template).toMatchObject({ id, version: 1 });
    expect(a!.status).toBe("pending");
    const events = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, s.leaseId), eq(leaseEvents.type, "CONTRACT_PREPARED")));
    expect((events[0]!.payload as { templateVersion: number }).templateVersion).toBe(1);
  });

  test("a field with no data prepares with an empty line, and the approval lists what was left empty and the sources", async () => {
    const s = await setup();
    // The tenant has no Emirates ID on record; the representative blank is left empty by choice.
    const blanks = goodBlanks();
    blanks[1] = blank("b2", "Tenant Emirates ID number", "tenantEmiratesIdNo", "(Landlord) and ID no. ");
    blanks[3] = blank("b4", "Landlord representative", "leave_empty", "in ", { marker: "________" });
    blanks[4] = blank("b5", "Date of contract", "contractOn", "The term starts on ");
    await pinned(s, { blanks });
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    const printed = await pdfText(s, c!.documentId!);
    expect(printed).toContain("________");
    expect(printed).toContain("The term starts on 28 October 2026"); // the date of the contract is today, from the Clock
    const [a] = await database.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.entityId, s.leaseId), eq(approvals.gate, "final_contract")));
    const reasons = (a!.reasons as string[]).join("\n");
    expect(reasons).toContain("Left empty for hand-filling:");
    expect(reasons).toContain("Landlord representative");
    expect(reasons).toContain("Tenant Emirates ID number");
    expect(reasons).toContain("Annual rent <- annualRentFils");
    expect(a!.status).toBe("pending");
  });

  test("retiring the template drops the rule to the standard contract and makes a pending approval stale", async () => {
    const s = await setup();
    const id = await pinned(s);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [a] = await database.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.entityId, s.leaseId), eq(approvals.gate, "final_contract")));
    expect((await s.api(`/contract-templates/${id}/retire`, "POST")).status).toBe(200);
    await expect(decideApproval(s.ctx, a!.id, s.officer, { decision: "approve" })).rejects.toThrow(
      /changed|stale|template/i,
    );
    expect((await contractRows(s.leaseId))[0]!.status).toBe("pending_approval");
    // The rule fell back to no template: a new prepare gives the standard contract.
    const again = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    expect(again.status).toBe("prepared");
  });

  test("the template id, version and content hash are part of the inputHash", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const plain = (await contractRows(s.leaseId))[0]!;
    await pinned(s);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [, withTemplate] = await contractRows(s.leaseId);
    expect(withTemplate!.inputHash).not.toBe(plain.inputHash);
    // The first contract was superseded; its approval is cancelled.
    expect((await contractRows(s.leaseId))[0]!.status).toBe("superseded");
  });

  test("the Ejari payload is identical with and without a template", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    await pinned(s);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [plain, withTemplate] = await contractRows(s.leaseId);
    expect(withTemplate!.fields).toEqual(plain!.fields);
    const a = buildEjariPayload(plain!.fields);
    const b = buildEjariPayload(withTemplate!.fields);
    expect(a.ok && b.ok).toBe(true);
    expect(b).toEqual(a);
  });

  test("D47: the contract agent checks the wording as printed, not the sample's original", async () => {
    const s = await setup();
    const id = await s.propose();
    const sampleId = (await templateRow(id)).sampleDocumentId;
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Deposit",
      textEn: "A security deposit of AED 6,750 is held.",
      quote: "A security deposit of AED 6,750 is held.",
      category: "payment",
      hasValues: true,
      status: "proposed",
      sourceDocumentId: sampleId,
      createdBy: "helper:contract_template",
    });
    await s.approve(id);
    const r = await s.api("/contract-rules", "POST", {
      companyId: s.companyId,
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 12,
      clauseIds: [`cc:${clauseId}`],
      templateId: id,
    });
    expect(r.status).toBe(201);
    await s.api(`/company-clauses/${clauseId}`, "PATCH", {
      text: "The landlord holds [Security deposit] for [Building].",
    });
    const agentView = await withTx(s.ctx.database, async (tx) => {
      const i = await contractInputs(tx, s.leaseId);
      return contractAgentContext(s.ctx, tx, i, DEFAULT_ADDENDUM);
    });
    const texts = agentView.template!.paragraphs.map((p) => p.text).join(" | ");
    expect(texts).toContain("The landlord holds {{b9}} for {{b4}}.");
    expect(texts).not.toContain("A security deposit of");
  });

  test("D47: a linked paragraph prints the clause's current wording, only when the clause is in the rule", async () => {
    const s = await setup();
    const id = await s.propose();
    const sampleId = (await templateRow(id)).sampleDocumentId;
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Deposit",
      textEn: "A security deposit of AED 6,750 is held.",
      quote: "A security deposit of AED 6,750 is held.",
      category: "payment",
      hasValues: true,
      status: "proposed",
      sourceDocumentId: sampleId,
      createdBy: "helper:contract_template",
    });
    await s.approve(id);
    const preview = async () => {
      const x = await extractPdf(
        new Uint8Array(await (await s.api(`/contract-templates/${id}/preview`)).arrayBuffer()),
      );
      return x.ok ? x.text.replace(/\s+/g, " ") : "";
    };
    expect(await preview()).toContain("A security deposit of «Security deposit (AED)» is held.");
    // Edited: the paragraph prints the new wording, the [label] still filled from the records.
    const edit = await s.api(`/company-clauses/${clauseId}`, "PATCH", {
      text: "The landlord holds a refundable deposit of [Security deposit].",
    });
    expect(edit.status).toBe(200);
    const edited = await preview();
    expect(edited).toContain("The landlord holds a refundable deposit of «Security deposit (AED)».");
    expect(edited).not.toContain("A security deposit of");
    // A rule without the clause: the contract leaves the paragraph out; with it, it prints.
    expect((await s.rule(id)).status).toBe(201);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c1] = await contractRows(s.leaseId);
    expect(await pdfText(s, c1!.documentId!)).not.toContain("refundable deposit");
    // Removed: the paragraph is gone from previews too.
    expect((await s.api(`/company-clauses/${clauseId}`, "DELETE")).status).toBe(200);
    expect(await preview()).not.toContain("refundable deposit");
  });

  test("D47: a contract prints a linked clause in the rule in its template place, never again as an extra term", async () => {
    const s = await setup();
    const id = await s.propose();
    const sampleId = (await templateRow(id)).sampleDocumentId;
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Deposit",
      textEn: "A security deposit of AED 6,750 is held.",
      quote: "A security deposit of AED 6,750 is held.",
      category: "payment",
      hasValues: true,
      status: "proposed",
      sourceDocumentId: sampleId,
      createdBy: "helper:contract_template",
    });
    await s.approve(id);
    const r = await s.api("/contract-rules", "POST", {
      companyId: s.companyId,
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 12,
      clauseIds: [`cc:${clauseId}`],
      templateId: id,
    });
    expect(r.status).toBe(201);
    await prepareContract(s.ctx, s.leaseId, {
      addendum: { clauses: [`cc:${clauseId}`], freeText: null },
      actor: "system",
    });
    const [c] = await contractRows(s.leaseId);
    const text = (await pdfText(s, c!.documentId!)).replace(/\s+/g, " ");
    expect(text).toContain("A security deposit of");
    expect(text).not.toContain("Deposit: A security deposit");
  });

  test("D47 backfill: a clause approved into an older template is linked and joins the template's rules", async () => {
    const s = await setup();
    const id = await pinned(s);
    const sampleId = (await templateRow(id)).sampleDocumentId;
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Deposit",
      textEn: "A deposit is held.",
      quote: "A security deposit of AED 6,750 is held.",
      category: "payment",
      hasValues: true,
      status: "approved",
      inTemplateId: id,
      sourceDocumentId: sampleId,
      createdBy: "helper:contract_template",
    });
    expect(await backfillTemplateClauseLinks(s.ctx)).toBe(1);
    expect(await backfillTemplateClauseLinks(s.ctx)).toBe(0);
    const [active] = await database.db
      .select()
      .from(contractRules)
      .where(and(eq(contractRules.companyId, s.companyId), eq(contractRules.active, true)));
    expect(active!.clauseIds).toContain(`cc:${clauseId}`);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    expect((await pdfText(s, c!.documentId!)).replace(/\s+/g, " ")).toContain("A security deposit of");
  });

  test("D47: on an older template, a clause from a sample-values line is rejected at Approve all, not approved", async () => {
    const s = await setup();
    const sections: TemplateSections = {
      ...SECTIONS,
      items: SECTIONS.items.map((it) =>
        it.id === "s1"
          ? { ...it, paragraphs: [...it.paragraphs, "Owner phone +971 50 123 4567 for all notices."] }
          : it,
      ),
    };
    // Stored without code's review, as templates read before D47 were.
    const id = await s.propose({ sections });
    const sampleId = (await templateRow(id)).sampleDocumentId;
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Notices",
      textEn: "Owner phone +971 50 123 4567 for all notices.",
      quote: "Owner phone +971 50 123 4567 for all notices.",
      category: "other",
      hasValues: true,
      status: "proposed",
      sourceDocumentId: sampleId,
      createdBy: "helper:contract_template",
    });
    await s.approve(id);
    const [row] = await database.db.select().from(companyClauses).where(eq(companyClauses.id, clauseId));
    expect(row!.status).toBe("rejected");
  });

  test("D47: a linked clause may use any template field in [brackets]; an unknown name is refused", async () => {
    const s = await setup();
    const id = await s.propose();
    const sampleId = (await templateRow(id)).sampleDocumentId;
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Deposit",
      textEn: "A security deposit of AED 6,750 is held.",
      quote: "A security deposit of AED 6,750 is held.",
      category: "payment",
      hasValues: true,
      status: "proposed",
      sourceDocumentId: sampleId,
      createdBy: "helper:contract_template",
    });
    await s.approve(id);
    const bad = await s.api(`/company-clauses/${clauseId}`, "PATCH", { text: "A deposit of [Anual rent] is held." });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("unknown_field");
    // A field from another part of the template (as listed under Fields) is fine.
    const ok = await s.api(`/company-clauses/${clauseId}`, "PATCH", {
      text: "A deposit of [Security deposit] for [building] is held.",
    });
    expect(ok.status).toBe(200);
  });

  test("company clauses are appended after the template sections", async () => {
    const s = await setup();
    await pinned(s);
    const clauseId = newId();
    await database.db.insert(companyClauses).values({
      id: clauseId,
      companyId: s.companyId,
      title: "Balcony",
      textEn: "The tenant keeps the balcony clear.",
      category: "other",
      status: "approved",
      quote: "q",
      hasValues: false,
      createdBy: "test",
    });
    const p = await prepareContract(s.ctx, s.leaseId, {
      addendum: { clauses: [`cc:${clauseId}`], freeText: null },
      actor: "system",
    });
    expect(p.status).toBe("prepared");
    const [c] = await contractRows(s.leaseId);
    const text = await pdfText(s, c!.documentId!);
    expect(text).toContain("Balcony: The tenant keeps the balcony clear.");
    expect(text.indexOf("Article III Signatures")).toBeLessThan(text.indexOf("Balcony:"));
  });

  test("approving a new version moves the company's active rules as a new rule version; retire falls back to none", async () => {
    const s = await setup();
    const v1 = await pinned(s);
    const all = async () => database.db.select().from(contractRules).where(eq(contractRules.companyId, s.companyId));
    const active = async () => (await all()).filter((r) => r.active);
    const v1Rule = (await active())[0]!;
    const v2 = await s.propose();
    const before = (await (await s.api(`/companies/${s.companyId}/contract-template`)).json()) as {
      rulesToMove: number;
      rulesOnRetired: number;
    };
    expect(before).toMatchObject({ rulesToMove: 1, rulesOnRetired: 0 });
    await s.approve(v2);
    const [now] = await active();
    expect(now!.templateId).toBe(v2);
    expect(now!.id).not.toBe(v1Rule.id);
    expect(now!.supersedesId).toBe(v1Rule.id);
    expect((await all()).find((r) => r.id === v1Rule.id)!.active).toBe(false);
    const events = async () =>
      await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.companyId));
    const ev = (await events()).filter((e) => e.type === "CONTRACT_RULE_TEMPLATE_REPOINTED");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ fromTemplateId: v1, toTemplateId: v2 });
    expect(ev[0]!.actor).toBe(`user:${s.admin.id}`);
    expect((await events()).filter((e) => e.type === "CONTRACT_RULE_REPLACED")).toHaveLength(1);
    // Retire: the rule falls back to no template, as a new version, audited.
    expect((await s.api(`/contract-templates/${v2}/retire`, "POST")).status).toBe(200);
    const [fallback] = await active();
    expect(fallback!.templateId).toBeNull();
    expect(fallback!.supersedesId).toBe(now!.id);
    const ev2 = (await events()).filter((e) => e.type === "CONTRACT_RULE_TEMPLATE_REPOINTED");
    expect(ev2).toHaveLength(2);
    expect(ev2.some((e) => (e.payload as { toTemplateId: string | null }).toTemplateId === null)).toBe(true);
    const after = (await (await s.api(`/companies/${s.companyId}/contract-template`)).json()) as {
      rulesOnRetired: number;
    };
    expect(after.rulesOnRetired).toBe(0);
  });

  test("approving a template links a rule that has no template, so the contract uses it", async () => {
    const s = await setup();
    const r = await s.rule(null);
    expect(r.status).toBe(201);
    const id = await s.propose();
    await s.approve(id);
    const [active] = (
      await database.db.select().from(contractRules).where(eq(contractRules.companyId, s.companyId))
    ).filter((x) => x.active);
    expect(active!.templateId).toBe(id);
    expect(active!.supersedesId).toBe(r.body.id);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    expect(await pdfText(s, c!.documentId!)).toContain("Article I Premises");
  });

  test("the final contract keeps the order of the preview's sections and headings", async () => {
    const s = await setup();
    const id = await pinned(s);
    const pr = await s.api(`/contract-templates/${id}/preview`);
    const x = await extractPdf(new Uint8Array(await pr.arrayBuffer()));
    const preview = x.ok ? x.text : "";
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    const final = await pdfText(s, c!.documentId!);
    const marks = [
      "RESIDENTIAL TENANCY AGREEMENT",
      "Article I Premises",
      "Article II Term and Rent",
      "Article III Signatures",
      "Fictional Realty Co. Tenancy",
    ];
    for (const m of marks) {
      expect(preview).toContain(m);
      expect(final).toContain(m);
    }
    const order = (t: string) => marks.slice(0, 4).sort((a, b) => t.indexOf(a) - t.indexOf(b));
    expect(order(final)).toEqual(order(preview));
    expect(order(final)).toEqual(marks.slice(0, 4));
  });

  test("prepare again supersedes the pending approval or an unsigned sent contract; refused once anyone signed", async () => {
    const s = await setup();
    await pinned(s);
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const r = await s.as(s.officer)(`/leases/${s.leaseId}/contract/reprepare`, "POST");
    expect(r.status).toBe(201);
    const rows = await contractRows(s.leaseId);
    expect(rows.map((c) => c.status)).toEqual(["superseded", "pending_approval"]);
    const approvalsNow = await database.db.select().from(approvals).where(eq(approvals.entityId, s.leaseId));
    expect(approvalsNow.find((a) => a.id === rows[0]!.approvalId)!.status).toBe("cancelled");
    expect(approvalsNow.find((a) => a.id === rows[1]!.approvalId)!.status).toBe("pending");
    const ev = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId));
    const rep = ev.filter((e) => e.type === "CONTRACT_REPREPARED");
    expect(rep).toHaveLength(1);
    expect(rep[0]!.payload).toMatchObject({ supersededVersion: 1, newVersion: 2 });
    // Approved and sent, nobody signed yet: prepare again replaces it and its signing links stop working.
    const approver = await addStaff(database, "leasing_officer");
    await decideApproval(s.ctx, rows[1]!.approvalId!, approver, { decision: "approve" });
    expect((await contractRows(s.leaseId))[1]!.status).toBe("sent");
    const fromSent = await s.as(s.officer)(`/leases/${s.leaseId}/contract/reprepare`, "POST");
    expect(fromSent.status).toBe(201);
    const after = await contractRows(s.leaseId);
    expect(after.map((c) => c.status)).toEqual(["superseded", "superseded", "pending_approval"]);
    const v2Signers = await database.db
      .select()
      .from(contractSigners)
      .where(eq(contractSigners.contractId, after[1]!.id));
    const links = await database.db.select().from(actionLinks);
    for (const sg of v2Signers) {
      const link = links.find((l) => l.id === sg.linkId);
      if (link) expect(link.expiresAt.getTime()).toBeLessThanOrEqual(s.ctx.clock.now().getTime());
    }
    // Once someone has signed: refused, nothing changes.
    await decideApproval(s.ctx, after[2]!.approvalId!, approver, { decision: "approve" });
    const [v3] = (await contractRows(s.leaseId)).slice(-1);
    expect(v3!.status).toBe("sent");
    await database.db
      .update(contractSigners)
      .set({ signedAt: s.ctx.clock.now() })
      .where(and(eq(contractSigners.contractId, v3!.id), eq(contractSigners.role, "tenant")));
    const linksBefore = await database.db.select().from(actionLinks);
    const again = await s.as(s.officer)(`/leases/${s.leaseId}/contract/reprepare`, "POST");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code?: string }).code).toBe("contract_already_approved");
    expect((await contractRows(s.leaseId)).map((c) => c.status)).toEqual(["superseded", "superseded", "sent"]);
    expect(await database.db.select().from(actionLinks)).toEqual(linksBefore);
    const ev2 = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId));
    expect(ev2.filter((e) => e.type === "CONTRACT_REPREPARED")).toHaveLength(2);
  });

  describe("prepare again re-maps blanks against the data held now", () => {
    const VISA = "VISA-778899";
    const sections: TemplateSections = {
      ...SECTIONS,
      items: SECTIONS.items.map((it, n) =>
        n === 1 ? { ...it, paragraphs: [...it.paragraphs, "Entry permit no: {{b12}}"] } : it,
      ),
    };
    const withPermit = () => [
      ...goodBlanks(),
      blank("b12", "Entry permit no", "leave_empty", "Entry permit no: ", { source: "empty", sectionIndex: 1 }),
    ];
    const setupPermit = async (chat?: (m: unknown[]) => unknown) => {
      const s = await setup();
      if (chat) s.ctx.contractAiLlm = new FakeLlm(agreeingDecision, undefined, chat as never);
      else s.ctx.contractAiLlm = new FakeLlm(agreeingDecision);
      await pinned(s, { sections, blanks: withPermit() });
      await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
      return s;
    };
    const lastApproval = async (s: S) => {
      const rows = await contractRows(s.leaseId);
      const [a] = await database.db
        .select()
        .from(approvals)
        .where(eq(approvals.id, rows.at(-1)!.approvalId!));
      return { rows, reasons: ((a!.reasons ?? []) as string[]).join(" | ") };
    };

    test("a leave_empty blank is filled once its data exists; the model sees keys, never values", async () => {
      const seen: unknown[][] = [];
      const s = await setupPermit((m) => {
        seen.push(m);
        return { blanks: [{ id: "b12", key: "tenantVisaNo" }] };
      });
      expect((await lastApproval(s)).reasons).toContain("Left empty for hand-filling: Entry permit no");
      await database.db.update(parties).set({ visaNo: VISA }).where(eq(parties.id, s.tenantId));
      const r = await s.as(s.officer)(`/leases/${s.leaseId}/contract/reprepare`, "POST");
      expect(r.status).toBe(201);
      const { rows, reasons } = await lastApproval(s);
      expect(rows.map((c) => c.status)).toEqual(["superseded", "pending_approval"]);
      expect(await pdfText(s, rows[1]!.documentId!)).toContain(VISA);
      expect(reasons).toContain("Entry permit no <- tenantVisaNo");
      expect(reasons).toContain("Blank mapping refreshed");
      const prompt = JSON.stringify(seen);
      expect(prompt).not.toContain(VISA);
      expect(prompt).not.toContain("LENA TESTOVA");
      expect(prompt).not.toContain("UT2048611");
      // The approved template is untouched; the mapping used is in the event payload.
      const tpl = (await database.db.select().from(companyContractTemplates)).find((t) => t.status === "approved")!;
      expect((tpl.blanks as TemplateBlank[]).find((b) => b.id === "b12")!.field).toBe("leave_empty");
      const ev = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, s.leaseId));
      const prep = ev.filter((e) => e.type === "CONTRACT_PREPARED").at(-1)!.payload as {
        mappingRefresh: { changes: { to: string }[]; mappingUsed: Record<string, string> };
      };
      expect(prep.mappingRefresh.changes.map((c) => c.to)).toEqual(["tenantVisaNo"]);
      expect(prep.mappingRefresh.mappingUsed.b12).toBe("tenantVisaNo");
    });

    test("the automatic first preparation re-maps too (same shared step)", async () => {
      const s = await setup();
      s.ctx.contractAiLlm = new FakeLlm(agreeingDecision, undefined, () => ({
        blanks: [{ id: "b12", key: "tenantVisaNo" }],
      }));
      await pinned(s, { sections, blanks: withPermit() });
      await database.db.update(parties).set({ visaNo: VISA }).where(eq(parties.id, s.tenantId));
      const p = await prepareContract(s.ctx, s.leaseId, {
        addendum: DEFAULT_ADDENDUM,
        actor: "system",
        onlyIfNone: true,
      });
      expect(p.status).toBe("prepared");
      const { rows, reasons } = await lastApproval(s);
      expect(await pdfText(s, rows[0]!.documentId!)).toContain(VISA);
      expect(reasons).toContain("Entry permit no <- tenantVisaNo");
    });

    test("model down: the stored mapping is used and the approval says so", async () => {
      const s = await setupPermit(() => new Error("model offline"));
      await database.db.update(parties).set({ visaNo: VISA }).where(eq(parties.id, s.tenantId));
      const r = await s.as(s.officer)(`/leases/${s.leaseId}/contract/reprepare`, "POST");
      expect(r.status).toBe(201);
      const { rows, reasons } = await lastApproval(s);
      expect(await pdfText(s, rows[1]!.documentId!)).not.toContain(VISA);
      expect(reasons).toContain("mapping model was unavailable");
      expect(reasons).toContain("Left empty for hand-filling: Entry permit no");
    });
  });

  test("text the fonts can't print blocks approval; an unprintable field value fails the prepare", async () => {
    const s = await setup();
    const arabic = "\u0627\u0644\u0625\u064a\u062c\u0627\u0631";
    const bad = await s.propose({
      sections: {
        ...SECTIONS,
        items: [{ ...SECTIONS.items[0]!, paragraphs: [`${arabic} {{b1}} {{b2}}`] }, ...SECTIONS.items.slice(1)],
      },
    });
    const r = await s.approveSample(bad);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { reasons: string[] }).reasons.join(" ")).toContain("can't print");
    await pinned(s);
    await database.db.update(parties).set({ fullNameEn: arabic }).where(eq(parties.id, s.tenantId));
    const err = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" }).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ status: 422, code: "template_blank_unfilled" });
    expect((err as { reasons: string[] }).reasons.join(" ")).toContain("can't be printed");
  });

  test("a missing or corrupt logo file is a 422 template_unavailable, not a 500", async () => {
    const s = await setup();
    const id = await pinned(s, { logo: true });
    const row = await templateRow(id);
    const garbage = await s.ctx.documents.put(new TextEncoder().encode("not an image"), "png");
    await database.db
      .update(documents)
      .set({ path: garbage.path, sha256: garbage.sha256 })
      .where(eq(documents.id, row.logoDocumentId!));
    const corrupt = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" }).catch(
      (e: unknown) => e,
    );
    expect(corrupt).toMatchObject({ status: 422, code: "template_unavailable" });
    await database.db
      .update(documents)
      .set({ path: "nowhere/missing.png" })
      .where(eq(documents.id, row.logoDocumentId!));
    const missing = await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" }).catch(
      (e: unknown) => e,
    );
    expect(missing).toMatchObject({ status: 422, code: "template_unavailable" });
    expect((await contractRows(s.leaseId)).length).toBe(0);
  });

  test("without a rule template the standard contract is unchanged", async () => {
    const s = await setup();
    await prepareContract(s.ctx, s.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    const [c] = await contractRows(s.leaseId);
    const text = await pdfText(s, c!.documentId!);
    expect(text).toContain("Tenancy contract (demo template)");
    expect(text).not.toContain("Company template");
    const rules = await database.db.select().from(contractRules).where(eq(contractRules.companyId, s.companyId));
    expect(rules).toHaveLength(0);
  });
});
