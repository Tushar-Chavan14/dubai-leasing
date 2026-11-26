import {
  Addendum,
  MAX_ADDENDUM_CLAUSES,
  Emirate,
  PropertyCategory,
  PropertySubtype,
  type StaffUser,
} from "@leasing/core";
import { companies, contractRules, rentRules, units, withTx } from "@leasing/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import {
  approveSample,
  companyTemplatePanel,
  previewTemplate,
  resuggestTemplate,
  retireTemplate,
  retryTemplateExtraction,
  reviewTemplate,
  templateLogo,
  renameTemplate,
} from "../manager/company-templates.ts";
import {
  addCompanyClause,
  clauseView,
  companyClauseList,
  decideClause,
  editCompanyClause,
  removeCompanyClause,
  setClauseRules,
  MAX_SAMPLE_BYTES,
  retrySample,
  sampleClauseReview,
  uploadSample,
} from "../manager/contract-templates.ts";
import { notFound, unprocessable } from "../errors.ts";
import {
  discardKycDraft,
  kycConfigWithDraft,
  publishKycDraft,
  saveKycConfig,
  saveKycDraft,
} from "../manager/kyc-config.ts";
import {
  lookupCompanyLandlord,
  CompanyLegalInput,
  landlordGaps,
  legalForRole,
  updateCompanyLegal,
} from "../manager/company-legal.ts";
import {
  createCompany,
  copyContractRule,
  copyRentRule,
  createContractRule,
  createRentRule,
  defaultEmirate,
  deactivateContractRule,
  deactivateRentRule,
  replaceContractRule,
  replaceRentRule,
  updateCompany,
} from "../manager/portfolio.ts";
import { readLimited } from "./upload.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const actorOf = (u: StaffUser) => `user:${u.id}` as const;

const CompanyKind = z.enum(["developer", "realty", "owner"]);
const optText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const CompanyCreate = z.object({
  name: z.string().trim().min(1).max(120),
  kind: CompanyKind,
  tradeLicenceNo: optText(60),
  email: z.string().trim().email().max(200).nullable().optional(),
  /** Emirates the company operates in (at least one); default Dubai. */
  emirates: z.array(Emirate).min(1).optional(),
  /** Property types the company leases (at least one); default all three. */
  categories: z.array(PropertyCategory).min(1).optional(),
  /** Legal (landlord) details and authorised signatory (D44). */
  legal: CompanyLegalInput.optional(),
});
const CompanyPatch = CompanyCreate.omit({ legal: true }).partial().extend({ active: z.boolean().optional() });

/** Range checks give 400 (Zod); cross-field checks give 422 in the manager. */
/**
 * D68: `subtypes` lists the unit types a rule covers ([] = all types; omitted on replace = the rule's own). A single
 * `subtype` (clients before D68) is still read as a one-item list.
 */
const Subtypes = {
  subtypes: z.array(PropertySubtype).max(10).optional(),
  subtype: PropertySubtype.nullable().optional(),
};
function withSubtypes<
  T extends { subtypes?: PropertySubtype[] | undefined; subtype?: PropertySubtype | null | undefined },
>(body: T): Omit<T, "subtype"> {
  const { subtype, ...rest } = body;
  if (rest.subtypes !== undefined || subtype === undefined) return rest;
  return { ...rest, subtypes: subtype ? [subtype] : [] };
}

const RentRuleBody = z.object({
  category: PropertyCategory,
  ...Subtypes,
  /** Omitted: the company's only emirate (422 when it operates in several); on replace, the rule's own. */
  emirate: Emirate.optional(),
  community: z.string().trim().min(1).max(120).nullable().optional(),
  minPctBp: z.number().int().min(-5000).max(5000),
  maxPctBp: z.number().int().min(-5000).max(5000),
  minRentFils: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  maxRentFils: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  /** D63: whole percent 0–50 below the asking rent an offer may go without a manager; null = company default. */
  maxOfferDiscountPct: z.number().int().min(0).max(50).nullable().optional(),
});
const RentRuleInput = RentRuleBody.extend({ companyId: z.string().uuid() });

const ContractRuleBody = z.object({
  category: PropertyCategory,
  ...Subtypes,
  /** The emirate the rule is for; null = any emirate (D58). On replace: omitted keeps it, null clears it. */
  emirate: Emirate.nullable().optional(),
  tenures: z.array(z.enum(["annual", "short_term"])).min(1),
  minCheques: z.number().int().min(1).max(12),
  maxCheques: z.number().int().min(1).max(12),
  // Standard clause ids and `cc:<uuid>` of approved company clauses (checked against the company in the manager).
  clauseIds: Addendum.shape.clauses.default([]),
  /** An approved company template of the same company (422 otherwise). On replace: omitted keeps it, null clears it. */
  templateId: z.string().uuid().nullable().optional(),
  /** Replace only: the `clauseIds` the caller saw. A different current list is a 409 `rule_changed`. */
  expectedClauseIds: z.array(z.string()).max(MAX_ADDENDUM_CLAUSES).optional(),
});
const ContractRuleInput = ContractRuleBody.extend({ companyId: z.string().uuid() });

const TemplateReviewBody = z
  .object({
    /** Blank id to contract field name (or "unmapped"). Section wording can't be edited. */
    dropHeader: z.boolean().optional(),
    dropFooter: z.boolean().optional(),
    dropLogo: z.boolean().optional(),
    logoConfirmed: z.boolean().optional(),
    authorityChecked: z.boolean().optional(),
    /** Paragraph keys to confirm or un-confirm (values, and authority wording as a neutral reference). */
    valuesConfirmed: z.record(z.string().max(60), z.boolean()).optional(),
    authorityBodyConfirmed: z.record(z.string().max(60), z.boolean()).optional(),
    droppedParagraphs: z.record(z.string().max(60), z.boolean()).optional(),
  })
  .strict();

const AddClause = z
  .object({
    title: z.string().max(200),
    text: z.string().max(5000),
    category: z.string().max(40).optional(),
    ruleIds: z.array(z.uuid()).max(50).optional(),
    confirmValues: z.literal(true).optional(),
  })
  .strict();

const EditClause = z
  .object({
    title: z.string().max(200).optional(),
    text: z.string().max(5000).optional(),
    confirmValues: z.literal(true).optional(),
  })
  .strict();

const ClauseDecide = z
  .object({
    decision: z.enum(["approve", "reject"]),
    confirmValues: z.literal(true).optional(),
    editedText: z.string().max(5000).optional(),
  })
  .strict();

const ListQuery = z.object({
  companyId: z.string().uuid().optional(),
  category: PropertyCategory.optional(),
  history: z.enum(["0", "1"]).optional(),
});

/** Companies, rent rules and contract rules. Reads: any staff. Writes: admin only. Rule rows are immutable. */
export function registerPortfolioRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  api.get("/companies", async (c) => {
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        kind: companies.kind,
        active: companies.active,
        tradeLicenceNo: companies.tradeLicenceNo,
        email: companies.email,
        emirates: companies.emirates,
        categories: companies.categories,
        unitCount: sql<number>`count(${units.id})::int`,
      })
      .from(companies)
      .leftJoin(units, eq(units.companyId, companies.id))
      .groupBy(companies.id)
      .orderBy(asc(companies.name));
    // Whether the landlord details are complete enough to prepare a contract (no values, only the answer).
    const today = ctx.clock.today();
    const out = await withTx(ctx.database, async (tx) => {
      const list = [];
      for (const r of rows) {
        const { company, party } = await lookupCompanyLandlord(tx, r.id);
        list.push({ ...r, legalComplete: landlordGaps(company, party, today).length === 0 });
      }
      return list;
    });
    return c.json(out);
  });

  /** Legal (landlord) details and signatory. The signatory's ID number is masked for finance. */
  api.get("/companies/:id/legal", async (c) => {
    const user = c.get("user");
    const { company, party } = await withTx(ctx.database, (tx) => lookupCompanyLandlord(tx, c.req.param("id")));
    return c.json({
      companyName: company.name,
      legal: legalForRole(company, party, user.role),
      missing: landlordGaps(company, party, ctx.clock.today()),
    });
  });

  api.put("/companies/:id/legal", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = CompanyLegalInput.parse(await c.req.json());
    return c.json(
      await withTx(ctx.database, (tx) => updateCompanyLegal(ctx, tx, c.req.param("id"), body, actorOf(user))),
    );
  });

  api.post("/companies", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = CompanyCreate.parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => createCompany(ctx, tx, body, actorOf(user))), 201);
  });

  api.patch("/companies/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = CompanyPatch.parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => updateCompany(ctx, tx, c.req.param("id"), body, actorOf(user))));
  });

  api.get("/rent-rules", async (c) => {
    const q = ListQuery.parse(c.req.query());
    const where = and(
      q.companyId ? eq(rentRules.companyId, q.companyId) : undefined,
      q.category ? eq(rentRules.category, q.category) : undefined,
      q.history === "1" ? undefined : eq(rentRules.active, true),
    );
    return c.json(await db.select().from(rentRules).where(where).orderBy(desc(rentRules.createdAt)));
  });

  api.post("/rent-rules", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = withSubtypes(RentRuleInput.parse(await c.req.json()));
    return c.json(
      await withTx(ctx.database, async (tx) =>
        createRentRule(
          ctx,
          tx,
          { ...body, emirate: body.emirate ?? (await defaultEmirate(tx, body.companyId)) },
          actorOf(user),
        ),
      ),
      201,
    );
  });

  api.put("/rent-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = withSubtypes(RentRuleBody.parse(await c.req.json()));
    return c.json(await withTx(ctx.database, (tx) => replaceRentRule(ctx, tx, c.req.param("id"), body, actorOf(user))));
  });

  api.delete("/rent-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(await withTx(ctx.database, (tx) => deactivateRentRule(ctx, tx, c.req.param("id"), actorOf(user))));
  });

  /** "Copy to emirate" (D68): the same rent rule for another emirate (admin). */
  api.post("/rent-rules/:id/copy", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = z
      .object({ emirate: Emirate })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await withTx(ctx.database, (tx) => copyRentRule(ctx, tx, c.req.param("id"), body.emirate, actorOf(user))),
      201,
    );
  });

  api.get("/contract-rules", async (c) => {
    const q = ListQuery.parse(c.req.query());
    const where = and(
      q.companyId ? eq(contractRules.companyId, q.companyId) : undefined,
      q.category ? eq(contractRules.category, q.category) : undefined,
      q.history === "1" ? undefined : eq(contractRules.active, true),
    );
    return c.json(await db.select().from(contractRules).where(where).orderBy(desc(contractRules.createdAt)));
  });

  api.post("/contract-rules", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = withSubtypes(ContractRuleInput.parse(await c.req.json()));
    return c.json(await withTx(ctx.database, (tx) => createContractRule(ctx, tx, body, actorOf(user))), 201);
  });

  api.put("/contract-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = withSubtypes(ContractRuleBody.parse(await c.req.json()));
    return c.json(
      await withTx(ctx.database, (tx) => replaceContractRule(ctx, tx, c.req.param("id"), body, actorOf(user))),
    );
  });

  api.delete("/contract-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(
      await withTx(ctx.database, (tx) => deactivateContractRule(ctx, tx, c.req.param("id"), actorOf(user))),
    );
  });

  /** "Copy to emirate" (D68): the same contract rule for another emirate, or for all emirates (null). Admin. */
  api.post("/contract-rules/:id/copy", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = z
      .object({ emirate: Emirate.nullable() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await withTx(ctx.database, (tx) => copyContractRule(ctx, tx, c.req.param("id"), body.emirate, actorOf(user))),
      201,
    );
  });

  /** The reading status of the company's latest sample and the clauses proposed from it (any staff may read). */
  api.get("/companies/:id/sample", async (c) => {
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    return c.json(await sampleClauseReview(ctx, id));
  });

  /**
   * Upload a sample contract to the company's template library (PDF, 10 MB; D68): stored content-addressed and read
   * by the clause and structure helpers in jobs. A second upload of the same file for the same emirates does nothing.
   * Body: the raw PDF (query `emirates=dubai,abu_dhabi`), or multipart with a `file` part and `emirates` parts.
   * No emirates = any emirate. D69: `name` starts a new named template; `familyId` adds a version to one (exactly
   * one of the two, as query or multipart parts).
   */
  api.post("/companies/:id/sample", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    // Multipart framing adds a little to the file.
    const raw = await readLimited(c.req.raw, MAX_SAMPLE_BYTES + 64 * 1024);
    const type = c.req.header("content-type") ?? "";
    let bytes = raw;
    let list: unknown[] = (c.req.query("emirates") ?? "").split(",").filter(Boolean);
    let name = c.req.query("name");
    let familyId = c.req.query("familyId");
    if (type.startsWith("multipart/form-data")) {
      const form = await new Response(raw, { headers: { "content-type": type } }).formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) throw unprocessable("attach the contract as `file`", [], "invalid_request");
      bytes = new Uint8Array(await file.arrayBuffer());
      const parts = (form?.getAll("emirates") ?? []).flatMap((v) => String(v).split(",")).filter(Boolean);
      if (parts.length) list = parts;
      const n = form?.get("name");
      const f = form?.get("familyId");
      if (typeof n === "string" && n.trim()) name = n;
      if (typeof f === "string" && f) familyId = f;
    }
    const emirates = z.array(Emirate).max(7).safeParse(list);
    if (!emirates.success) throw unprocessable("emirates must be among the seven emirates", [], "invalid_request");
    if (name !== undefined && name.trim() !== "" && familyId !== undefined)
      throw unprocessable(
        "Give a name for a new template, or the template to add a version to.",
        [],
        "invalid_request",
      );
    // Neither: a version of the template for the same emirates, else a new one (as before D69).
    const target =
      familyId !== undefined
        ? { familyId: z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(familyId) }
        : name !== undefined && name.trim() !== ""
          ? { name }
          : undefined;
    const r = await uploadSample(ctx, id, bytes, actorOf(user), emirates.data, target);
    return c.json(r, r.duplicate ? 200 : 202);
  });

  api.post("/companies/:id/sample/retry", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    return c.json(await retrySample(ctx, id, actorOf(user)), 202);
  });

  api.post("/company-clauses/:id/decide", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const body = ClauseDecide.parse(await c.req.json());
    return c.json(await decideClause(ctx, id, body, actorOf(user)));
  });

  /** Edit or remove an approved clause at any time (admin). Clauses inside the template's wording change there. */
  api.patch("/company-clauses/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const row = await editCompanyClause(ctx, id, EditClause.parse(await c.req.json()), actorOf(user));
    return c.json(clauseView(row));
  });
  api.put("/company-clauses/:id/rules", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const body = z
      .object({ ruleIds: z.array(z.uuid()).max(100) })
      .strict()
      .parse(await c.req.json());
    return c.json(await setClauseRules(ctx, id, body.ruleIds, actorOf(user)));
  });
  api.delete("/company-clauses/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    return c.json(await removeCompanyClause(ctx, id, actorOf(user)));
  });

  // Document form and KYC rules (D46). Read: any staff (with the open draft, D50). Save, publish: admin only.
  api.get("/companies/:id/kyc-config", async (c) =>
    c.json(
      await withTx(ctx.database, (tx) =>
        kycConfigWithDraft(
          tx,
          z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id")),
          ctx.clock.today(),
        ),
      ),
    ),
  );
  api.put("/companies/:id/kyc-config", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const body = z.object({ form: z.unknown(), rules: z.unknown() }).parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => saveKycConfig(ctx, tx, id, body, actorOf(user))));
  });
  api.put("/companies/:id/kyc-config/draft", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const body = z.object({ form: z.unknown(), rules: z.unknown() }).parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => saveKycDraft(ctx, tx, id, body, actorOf(user))));
  });
  api.post("/companies/:id/kyc-config/publish", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    return c.json(await withTx(ctx.database, (tx) => publishKycDraft(ctx, tx, id, actorOf(user))));
  });
  api.delete("/companies/:id/kyc-config/draft", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    return c.json(await withTx(ctx.database, (tx) => discardKycDraft(ctx, tx, id, actorOf(user))));
  });

  api.get("/companies/:id/clauses", async (c) =>
    c.json(
      await companyClauseList(ctx, z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"))),
    ),
  );

  api.post("/companies/:id/clauses", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const body = AddClause.parse(await c.req.json());
    const row = await withTx(ctx.database, async (tx) => {
      const [co] = await tx.db.select({ id: companies.id }).from(companies).where(eq(companies.id, id));
      if (!co) throw notFound("company");
      return addCompanyClause(ctx, tx, id, body, actorOf(user));
    });
    return c.json(clauseView(row), 201);
  });

  // Company contract templates (slice 4). Reads: any staff. Review, approve, retire and preview: admin only.
  const idOf = (c: { req: { param: (k: string) => string } }) =>
    z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));

  api.get("/companies/:id/contract-template", async (c) => c.json(await companyTemplatePanel(ctx, idOf(c))));

  api.post("/companies/:id/contract-template/retry", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(await retryTemplateExtraction(ctx, idOf(c), actorOf(user)), 202);
  });

  api.patch("/contract-templates/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = TemplateReviewBody.parse(await c.req.json());
    return c.json(await reviewTemplate(ctx, idOf(c), body, actorOf(user)));
  });

  /** D47 "Approve all": the latest sample's proposed clauses (ticked ones join its rule) and its proposed template. */
  api.post("/companies/:id/sample/approve", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const raw = await c.req.text();
    const body = z
      .object({
        ruleClauseIds: z.array(z.uuid()).max(200).optional(),
        checked: z.boolean().optional(),
      })
      .strict()
      .parse(raw ? JSON.parse(raw) : {});
    return c.json(await approveSample(ctx, idOf(c), actorOf(user), body));
  });

  /** D69: rename a named template (every version of it). Admin only. */
  api.patch("/companies/:id/contract-templates/:familyId", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const familyId = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("familyId"));
    const body = z
      .object({ name: z.string().max(200) })
      .strict()
      .parse(await c.req.json());
    return c.json(await renameTemplate(ctx, idOf(c), familyId, body.name, actorOf(user)));
  });
  api.post("/contract-templates/:id/resuggest", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(await resuggestTemplate(ctx, idOf(c), actorOf(user)));
  });

  api.post("/contract-templates/:id/retire", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(await retireTemplate(ctx, idOf(c), actorOf(user)));
  });

  /** A sample contract in the template with demo values, watermarked "Preview". Nothing is stored. */
  api.get("/contract-templates/:id/preview", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const pdf = await previewTemplate(ctx, idOf(c));
    return new Response(pdf, {
      headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="template-preview.pdf"' },
    });
  });

  api.get("/contract-templates/:id/logo", async (c) => {
    const logo = await templateLogo(ctx, idOf(c));
    if (!logo) return c.json({ error: "not_found", message: "no logo" }, 404);
    return new Response(logo.bytes, { headers: { "content-type": logo.mime, "cache-control": "private, max-age=60" } });
  });
}
