import { type Actor, newId, type PropertyCategory, type PropertySubtype, SUBTYPES_BY_CATEGORY } from "@leasing/core";
import { companies, contractRules, parties, rentRules, type Tx } from "@leasing/db";
import { eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { resolveCompanyClauses } from "./clause-refs.ts";
import { requireApprovedTemplate } from "./company-templates.ts";
import { type CompanyLegalInput, ensureCompanyParty, updateCompanyLegal } from "./company-legal.ts";
import { appendEvent } from "./events.ts";

export type CompanyKind = "developer" | "realty" | "owner";

/** Lower-case, runs of non [a-z0-9] become "-", trimmed, cut to 40. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (s.length < 2) throw unprocessable("company name must give a slug of at least 2 characters", [], "bad_slug");
  return s;
}

export interface CompanyInput {
  name: string;
  kind: CompanyKind;
  tradeLicenceNo?: string | null | undefined;
  email?: string | null | undefined;
  /** Legal (landlord) details and authorised signatory, saved with the company (D44). */
  legal?: CompanyLegalInput | undefined;
}

export async function createCompany(ctx: EngineContext, tx: Tx, input: CompanyInput, actor: Actor) {
  const slug = slugify(input.name);
  const [existing] = await tx.db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug));
  if (existing) throw conflict(`slug "${slug}" is already used`, "slug_taken");
  const [row] = await tx.db
    .insert(companies)
    .values({
      id: newId(),
      name: input.name,
      slug,
      kind: input.kind,
      tradeLicenceNo: input.tradeLicenceNo ?? null,
      email: input.email ?? null,
      createdBy: actor,
    })
    .returning();
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: row!.id },
    type: "COMPANY_CREATED",
    actor,
    payload: { name: row!.name, slug, kind: row!.kind },
    rulesVersion: ctx.rulesVersion,
  });
  await ensureCompanyParty(tx, row!);
  if (input.legal) await updateCompanyLegal(ctx, tx, row!.id, input.legal, actor);
  return row!;
}

export async function updateCompany(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  patch: {
    name?: string | undefined;
    kind?: CompanyKind | undefined;
    tradeLicenceNo?: string | null | undefined;
    email?: string | null | undefined;
    active?: boolean | undefined;
  },
  actor: Actor,
) {
  const [before] = await tx.db.select().from(companies).where(eq(companies.id, id)).for("update");
  if (!before) throw notFound("company");
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  const [row] = await tx.db
    .update(companies)
    .set({ ...set, updatedAt: ctx.clock.now() })
    .where(eq(companies.id, id))
    .returning();
  // The company's party mirrors its licence number and email (D44).
  if (row && ("tradeLicenceNo" in set || "email" in set)) {
    const party = await ensureCompanyParty(tx, row);
    await tx.db
      .update(parties)
      .set({ tradeLicenceNo: row.tradeLicenceNo, email: row.email, updatedAt: ctx.clock.now() })
      .where(eq(parties.id, party.id));
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id },
    type: "COMPANY_UPDATED",
    actor,
    payload: {
      changed: Object.fromEntries(
        Object.entries(set).map(([k, v]) => [k, { from: before[k as keyof typeof before], to: v }]),
      ),
    },
    rulesVersion: ctx.rulesVersion,
  });
  return row!;
}

export interface RentRuleValues {
  companyId: string;
  category: PropertyCategory;
  subtype?: PropertySubtype | null | undefined;
  emirate: string;
  community?: string | null | undefined;
  minPctBp: number;
  maxPctBp: number;
  minRentFils?: number | null | undefined;
  maxRentFils?: number | null | undefined;
}

function checkSubtype(category: PropertyCategory, subtype: PropertySubtype | null | undefined) {
  if (subtype && !SUBTYPES_BY_CATEGORY[category].includes(subtype))
    throw unprocessable(`subtype ${subtype} does not belong to category ${category}`, [], "bad_subtype");
}

function checkRentRule(v: RentRuleValues) {
  checkSubtype(v.category, v.subtype);
  if (v.minPctBp > v.maxPctBp) throw unprocessable("minPctBp must be <= maxPctBp", [], "bad_band");
  if (typeof v.minRentFils === "number" && typeof v.maxRentFils === "number" && v.minRentFils > v.maxRentFils)
    throw unprocessable("minRentFils must be <= maxRentFils", [], "bad_bounds");
}

async function requireCompany(tx: Tx, id: string) {
  const [c] = await tx.db.select({ id: companies.id }).from(companies).where(eq(companies.id, id));
  if (!c) throw notFound("company");
}

export async function createRentRule(
  ctx: EngineContext,
  tx: Tx,
  v: RentRuleValues,
  actor: Actor,
  supersedesId: string | null = null,
) {
  const row = await insertRentRule(tx, v, actor, supersedesId);
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: v.companyId },
    type: "RENT_RULE_CREATED",
    actor,
    payload: { ruleId: row.id },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

async function insertRentRule(tx: Tx, v: RentRuleValues, actor: Actor, supersedesId: string | null) {
  checkRentRule(v);
  await requireCompany(tx, v.companyId);
  const [row] = await tx.db
    .insert(rentRules)
    .values({
      id: newId(),
      companyId: v.companyId,
      category: v.category,
      subtype: v.subtype ?? null,
      emirate: v.emirate,
      community: v.community ?? null,
      minPctBp: v.minPctBp,
      maxPctBp: v.maxPctBp,
      minRentFils: v.minRentFils ?? null,
      maxRentFils: v.maxRentFils ?? null,
      supersedesId,
      createdBy: actor,
    })
    .returning();
  return row!;
}

/** Insert a replacement and deactivate the old row. The company stays the old row's company. */
export async function replaceRentRule(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  v: Omit<RentRuleValues, "companyId">,
  actor: Actor,
) {
  const [old] = await tx.db.select().from(rentRules).where(eq(rentRules.id, id)).for("update");
  if (!old) throw notFound("rent rule");
  if (!old.active) throw conflict("rent rule is no longer active", "rule_inactive");
  const row = await insertRentRule(tx, { ...v, companyId: old.companyId }, actor, old.id);
  await tx.db.update(rentRules).set({ active: false }).where(eq(rentRules.id, old.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: old.companyId },
    type: "RENT_RULE_REPLACED",
    actor,
    payload: { ruleId: row.id, supersedesId: old.id },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

export async function deactivateRentRule(ctx: EngineContext, tx: Tx, id: string, actor: Actor) {
  const [row] = await tx.db.update(rentRules).set({ active: false }).where(eq(rentRules.id, id)).returning();
  if (!row) throw notFound("rent rule");
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: row.companyId },
    type: "RENT_RULE_DEACTIVATED",
    actor,
    payload: { ruleId: row.id },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

export interface ContractRuleValues {
  companyId: string;
  category: PropertyCategory;
  subtype?: PropertySubtype | null | undefined;
  tenures: ("annual" | "short_term")[];
  minCheques: number;
  maxCheques: number;
  clauseIds: string[];
  sampleDocumentId?: string | null | undefined;
  /** An approved company template of the same company; contracts of this rule render in it. */
  templateId?: string | null | undefined;
}

function checkContractRule(v: ContractRuleValues) {
  checkSubtype(v.category, v.subtype);
  if (v.minCheques > v.maxCheques) throw unprocessable("minCheques must be <= maxCheques", [], "bad_cheques");
}

export async function createContractRule(
  ctx: EngineContext,
  tx: Tx,
  v: ContractRuleValues,
  actor: Actor,
  supersedesId: string | null = null,
) {
  const row = await insertContractRule(tx, v, actor, supersedesId);
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: v.companyId },
    type: "CONTRACT_RULE_CREATED",
    actor,
    payload: { ruleId: row.id },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

async function insertContractRule(tx: Tx, v: ContractRuleValues, actor: Actor, supersedesId: string | null) {
  checkContractRule(v);
  await requireCompany(tx, v.companyId);
  // Company clauses must be approved clauses of this company (422 otherwise).
  await resolveCompanyClauses(tx, v.companyId, v.clauseIds);
  // The template must be approved and the company's own (422 otherwise).
  await requireApprovedTemplate(tx, v.companyId, v.templateId);
  const [row] = await tx.db
    .insert(contractRules)
    .values({
      id: newId(),
      companyId: v.companyId,
      category: v.category,
      subtype: v.subtype ?? null,
      tenures: v.tenures,
      minCheques: v.minCheques,
      maxCheques: v.maxCheques,
      clauseIds: v.clauseIds,
      sampleDocumentId: v.sampleDocumentId ?? null,
      templateId: v.templateId ?? null,
      supersedesId,
      createdBy: actor,
    })
    .returning();
  return row!;
}

export async function replaceContractRule(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  v: Omit<ContractRuleValues, "companyId"> & { expectedClauseIds?: string[] | undefined },
  actor: Actor,
) {
  const [old] = await tx.db.select().from(contractRules).where(eq(contractRules.id, id)).for("update");
  if (!old) throw notFound("contract rule");
  if (!old.active) throw conflict("contract rule is no longer active", "rule_inactive");
  if (v.expectedClauseIds && v.expectedClauseIds.join(",") !== old.clauseIds.join(",")) {
    throw conflict("The rule's clauses changed since you loaded it.", "rule_changed");
  }
  // Not sent: keep the rule's template. Sent as null: clear it.
  const templateId = v.templateId === undefined ? old.templateId : v.templateId;
  const row = await insertContractRule(tx, { ...v, templateId, companyId: old.companyId }, actor, old.id);
  await tx.db.update(contractRules).set({ active: false }).where(eq(contractRules.id, old.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: old.companyId },
    type: "CONTRACT_RULE_REPLACED",
    actor,
    payload: { ruleId: row.id, supersedesId: old.id },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

/**
 * Moves a rule to another template (or to none) as a new version, through the same versioned path as an
 * edit: the old row is deactivated, the new one supersedes it, both events carry the actor.
 */
export async function repointContractRule(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  templateId: string | null,
  actor: Actor,
) {
  const [old] = await tx.db.select().from(contractRules).where(eq(contractRules.id, id));
  if (!old) throw notFound("contract rule");
  const row = await replaceContractRule(
    ctx,
    tx,
    id,
    {
      category: old.category as PropertyCategory,
      subtype: old.subtype as PropertySubtype | null,
      tenures: old.tenures as ("annual" | "short_term")[],
      minCheques: old.minCheques,
      maxCheques: old.maxCheques,
      clauseIds: old.clauseIds,
      sampleDocumentId: old.sampleDocumentId,
      templateId,
    },
    actor,
  );
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: old.companyId },
    type: "CONTRACT_RULE_TEMPLATE_REPOINTED",
    actor,
    payload: { ruleId: row.id, supersedesId: old.id, fromTemplateId: old.templateId, toTemplateId: templateId },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

export async function deactivateContractRule(ctx: EngineContext, tx: Tx, id: string, actor: Actor) {
  const [row] = await tx.db.update(contractRules).set({ active: false }).where(eq(contractRules.id, id)).returning();
  if (!row) throw notFound("contract rule");
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: row.companyId },
    type: "CONTRACT_RULE_DEACTIVATED",
    actor,
    payload: { ruleId: row.id },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}
