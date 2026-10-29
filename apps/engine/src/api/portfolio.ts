import { Addendum, PropertyCategory, PropertySubtype, type StaffUser } from "@leasing/core";
import { companies, contractRules, rentRules, units, withTx } from "@leasing/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import {
  approveTemplate,
  companyTemplatePanel,
  previewTemplate,
  resuggestTemplate,
  retireTemplate,
  retryTemplateExtraction,
  reviewTemplate,
  templateLogo,
} from "../manager/company-templates.ts";
import {
  decideClause,
  MAX_SAMPLE_BYTES,
  retrySample,
  ruleClauseReview,
  uploadSample,
} from "../manager/contract-templates.ts";
import { unprocessable } from "../errors.ts";
import {
  lookupCompanyLandlord,
  CompanyLegalInput,
  landlordGaps,
  legalForRole,
  updateCompanyLegal,
} from "../manager/company-legal.ts";
import {
  createCompany,
  createContractRule,
  createRentRule,
  deactivateContractRule,
  deactivateRentRule,
  replaceContractRule,
  replaceRentRule,
  updateCompany,
} from "../manager/portfolio.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const actorOf = (u: StaffUser) => `user:${u.id}` as const;

const CompanyKind = z.enum(["developer", "realty", "owner"]);
const optText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const CompanyCreate = z.object({
  name: z.string().trim().min(1).max(120),
  kind: CompanyKind,
  tradeLicenceNo: optText(60),
  email: z.string().trim().email().max(200).nullable().optional(),
  /** Legal (landlord) details and authorised signatory (D44). */
  legal: CompanyLegalInput.optional(),
});
const CompanyPatch = CompanyCreate.omit({ legal: true }).partial().extend({ active: z.boolean().optional() });

/** Range checks give 400 (Zod); cross-field checks give 422 in the manager. */
const RentRuleBody = z.object({
  category: PropertyCategory,
  subtype: PropertySubtype.nullable().optional(),
  emirate: z.literal("dubai").default("dubai"),
  community: z.string().trim().min(1).max(120).nullable().optional(),
  minPctBp: z.number().int().min(-5000).max(5000),
  maxPctBp: z.number().int().min(-5000).max(5000),
  minRentFils: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  maxRentFils: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
});
const RentRuleInput = RentRuleBody.extend({ companyId: z.string().uuid() });

const ContractRuleBody = z.object({
  category: PropertyCategory,
  subtype: PropertySubtype.nullable().optional(),
  tenures: z.array(z.enum(["annual", "short_term"])).min(1),
  minCheques: z.number().int().min(1).max(12),
  maxCheques: z.number().int().min(1).max(12),
  // Standard clause ids and `cc:<uuid>` of approved company clauses (checked against the company in the manager).
  clauseIds: Addendum.shape.clauses.default([]),
  sampleDocumentId: z.string().uuid().nullable().optional(),
  /** An approved company template of the same company (422 otherwise). On replace: omitted keeps it, null clears it. */
  templateId: z.string().uuid().nullable().optional(),
  /** Replace only: the `clauseIds` the caller saw. A different current list is a 409 `rule_changed`. */
  expectedClauseIds: z.array(z.string()).max(20).optional(),
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

const ClauseDecide = z
  .object({
    decision: z.enum(["approve", "reject"]),
    confirmValues: z.literal(true).optional(),
    editedText: z.string().max(5000).optional(),
  })
  .strict();

/** Reads a request body, refusing more than `max` bytes without buffering the rest (Content-Length first, then the stream). */
async function readLimited(req: Request, max: number): Promise<Uint8Array> {
  const tooBig = () => unprocessable("The file is larger than 10 MB.", [], "too_big");
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  if (!req.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

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
    const body = RentRuleInput.parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => createRentRule(ctx, tx, body, actorOf(user))), 201);
  });

  api.put("/rent-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = RentRuleBody.parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => replaceRentRule(ctx, tx, c.req.param("id"), body, actorOf(user))));
  });

  api.delete("/rent-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(await withTx(ctx.database, (tx) => deactivateRentRule(ctx, tx, c.req.param("id"), actorOf(user))));
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
    const body = ContractRuleInput.parse(await c.req.json());
    return c.json(await withTx(ctx.database, (tx) => createContractRule(ctx, tx, body, actorOf(user))), 201);
  });

  api.put("/contract-rules/:id", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = ContractRuleBody.parse(await c.req.json());
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

  /** The sample's reading status and the clauses proposed from it (any staff may read). */
  api.get("/contract-rules/:id/clauses", async (c) => {
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    return c.json(await ruleClauseReview(ctx, id));
  });

  /**
   * Upload a sample contract (PDF, 10 MB): stored content-addressed, pinned on a new row of the rule,
   * read by the contract-template helper in a job. A second upload of the same file does nothing.
   * Body: the raw PDF, or multipart with a `file` part.
   */
  api.post("/contract-rules/:id/sample", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const id = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    // Multipart framing adds a little to the file.
    const raw = await readLimited(c.req.raw, MAX_SAMPLE_BYTES + 64 * 1024);
    const type = c.req.header("content-type") ?? "";
    let bytes = raw;
    if (type.startsWith("multipart/form-data")) {
      const form = await new Response(raw, { headers: { "content-type": type } }).formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) throw unprocessable("attach the contract as `file`", [], "invalid_request");
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    const r = await uploadSample(ctx, id, bytes, actorOf(user));
    return c.json(r, r.duplicate ? 200 : 202);
  });

  api.post("/contract-rules/:id/sample/retry", async (c) => {
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

  api.post("/contract-templates/:id/approve", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    return c.json(await approveTemplate(ctx, idOf(c), actorOf(user)));
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
