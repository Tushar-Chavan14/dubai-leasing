import {
  type Actor,
  type Emirate,
  EMIRATE_LABELS,
  newId,
  type PropertyCategory,
  type PropertySubtype,
  SUBTYPES_BY_CATEGORY,
  MAX_ADDENDUM_CLAUSES,
} from "@leasing/core";
import {
  companies,
  companyClauses,
  companyContractTemplates,
  contractRules,
  parties,
  rentRules,
  type Tx,
  units,
} from "@leasing/db";
import { and, count, eq, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { resolveCompanyClauses } from "./clause-refs.ts";
import { requireApprovedTemplate, templateFitsRule } from "./company-templates.ts";
import { type CompanyLegalInput, ensureCompanyParty, updateCompanyLegal } from "./company-legal.ts";
import { appendEvent } from "./events.ts";
import { normaliseSubtypes, overlaps, type RuleScope, sharedSubtypes } from "./rule-scope.ts";

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
  /** Emirates the company operates in; omitted = Dubai only. */
  emirates?: Emirate[] | undefined;
  /** Property types the company leases; omitted = all three. */
  categories?: PropertyCategory[] | undefined;
  /** Legal (landlord) details and authorised signatory, saved with the company (D44). */
  legal?: CompanyLegalInput | undefined;
}

const dedupe = <T>(list: T[]) => [...new Set(list)];
const ALL_CATEGORIES: PropertyCategory[] = ["residential", "commercial", "retail"];
const inCategoryOrder = (list: PropertyCategory[]) => ALL_CATEGORIES.filter((c) => list.includes(c));

/** 422 `category_not_offered` unless the company leases the property type. */
export async function assertOffers(tx: Tx, companyId: string, category: PropertyCategory) {
  const [c] = await tx.db
    .select({ name: companies.name, categories: companies.categories })
    .from(companies)
    .where(eq(companies.id, companyId))
    // Shares the company row with `updateCompany` (FOR UPDATE): a type or emirate being removed can't race this insert.
    .for("share");
  if (!c) throw notFound("company");
  if (!c.categories.includes(category))
    throw unprocessable(
      `${c.name} doesn't offer ${category} properties. Add it to the company's "Offers for lease" list first.`,
      [],
      "category_not_offered",
    );
}

/** 422 `category_in_use` when a company still has units or active rules of a type it would stop offering. */
async function assertCategoriesFree(tx: Tx, companyId: string, removed: PropertyCategory[]) {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  for (const cat of removed) {
    const unitCount = await n(
      tx.db
        .select({ n: count() })
        .from(units)
        .where(and(eq(units.companyId, companyId), eq(units.category, cat))),
    );
    const rentCount = await n(
      tx.db
        .select({ n: count() })
        .from(rentRules)
        .where(and(eq(rentRules.companyId, companyId), eq(rentRules.category, cat), eq(rentRules.active, true))),
    );
    const contractCount = await n(
      tx.db
        .select({ n: count() })
        .from(contractRules)
        .where(
          and(eq(contractRules.companyId, companyId), eq(contractRules.category, cat), eq(contractRules.active, true)),
        ),
    );
    if (unitCount || rentCount || contractCount)
      throw unprocessable(
        `Can't remove ${cat}: ${unitCount} unit(s), ${rentCount} active rent rule(s) and ${contractCount} active contract rule(s) still use it.`,
        [],
        "category_in_use",
      );
  }
}

/** 422 `emirate_not_operated` unless the company operates in the emirate. */
export async function assertOperates(tx: Tx, companyId: string, emirate: Emirate) {
  const [c] = await tx.db
    .select({ name: companies.name, emirates: companies.emirates })
    .from(companies)
    .where(eq(companies.id, companyId))
    // Shares the company row with `updateCompany` (FOR UPDATE): a type or emirate being removed can't race this insert.
    .for("share");
  if (!c) throw notFound("company");
  if (!c.emirates.includes(emirate))
    throw unprocessable(
      `${c.name} doesn't operate in ${EMIRATE_LABELS[emirate]}. Add it to the company's "Operates in" list first.`,
      [],
      "emirate_not_operated",
    );
}

/** The emirate a rule defaults to when none is given: only allowed when the company operates in exactly one. */
export async function defaultEmirate(tx: Tx, companyId: string): Promise<Emirate> {
  const [c] = await tx.db
    .select({ emirates: companies.emirates })
    .from(companies)
    .where(eq(companies.id, companyId))
    .for("share");
  if (!c) throw notFound("company");
  if (c.emirates.length === 1) return c.emirates[0]!;
  throw unprocessable(
    `Say which emirate: ${c.emirates.map((e) => EMIRATE_LABELS[e]).join(", ")}`,
    [],
    "emirate_required",
  );
}

/** 422 `emirate_in_use` when a company still has units or active rules in an emirate it would stop operating in. */
async function assertEmiratesFree(tx: Tx, companyId: string, removed: Emirate[]) {
  if (!removed.length) return;
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  for (const e of removed) {
    const unitCount = await n(
      tx.db
        .select({ n: count() })
        .from(units)
        .where(and(eq(units.companyId, companyId), eq(units.emirate, e))),
    );
    const rentCount = await n(
      tx.db
        .select({ n: count() })
        .from(rentRules)
        .where(and(eq(rentRules.companyId, companyId), eq(rentRules.emirate, e), eq(rentRules.active, true))),
    );
    const contractCount = await n(
      tx.db
        .select({ n: count() })
        .from(contractRules)
        .where(
          and(eq(contractRules.companyId, companyId), eq(contractRules.emirate, e), eq(contractRules.active, true)),
        ),
    );
    if (unitCount || rentCount || contractCount)
      throw unprocessable(
        `Can't remove ${EMIRATE_LABELS[e]}: ${unitCount} unit(s), ${rentCount} active rent rule(s) and ${contractCount} active contract rule(s) still use it.`,
        [],
        "emirate_in_use",
      );
  }
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
      emirates: dedupe(input.emirates?.length ? input.emirates : ["dubai"]),
      categories: inCategoryOrder(input.categories?.length ? input.categories : ALL_CATEGORIES),
      createdBy: actor,
    })
    .returning();
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: row!.id },
    type: "COMPANY_CREATED",
    actor,
    payload: { name: row!.name, slug, kind: row!.kind, emirates: row!.emirates, categories: row!.categories },
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
    emirates?: Emirate[] | undefined;
    categories?: PropertyCategory[] | undefined;
    active?: boolean | undefined;
  },
  actor: Actor,
) {
  const [before] = await tx.db.select().from(companies).where(eq(companies.id, id)).for("update");
  if (!before) throw notFound("company");
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) set[k] = v;
  if (patch.emirates) {
    const next = dedupe(patch.emirates);
    if (!next.length) throw unprocessable("a company must operate in at least one emirate", [], "bad_emirates");
    set.emirates = next;
    await assertEmiratesFree(
      tx,
      id,
      before.emirates.filter((e) => !next.includes(e)),
    );
  }
  if (patch.categories) {
    const next = inCategoryOrder(patch.categories);
    if (!next.length) throw unprocessable("a company must offer at least one property type", [], "bad_categories");
    set.categories = next;
    await assertCategoriesFree(
      tx,
      id,
      before.categories.filter((c) => !next.includes(c)),
    );
  }
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
  /** Unit types the rule covers (D68); empty or omitted = every type of the category. */
  subtypes?: readonly PropertySubtype[] | null | undefined;
  emirate: Emirate;
  community?: string | null | undefined;
  minPctBp: number;
  maxPctBp: number;
  minRentFils?: number | null | undefined;
  maxRentFils?: number | null | undefined;
  /** D63: offer discount below the asking rent without a manager, whole percent 0–50; null = company default. */
  maxOfferDiscountPct?: number | null | undefined;
}

function checkSubtypes(category: PropertyCategory, subtypes: readonly PropertySubtype[] | null | undefined) {
  const bad = (subtypes ?? []).filter((s) => !SUBTYPES_BY_CATEGORY[category].includes(s));
  if (bad.length)
    throw unprocessable(`type ${bad.join(", ")} does not belong to category ${category}`, bad, "bad_subtype");
}

const typesLabel = (list: readonly string[]) =>
  list.length ? list.map((s) => s.replaceAll("_", " ")).join(", ") : "all types";

/**
 * Refuses a rule that would compete with another active rule of the company for the same units at the same
 * specificity (D68): one rule per unit, never a silent "newest wins". The company and category are locked first,
 * so two saves can't both pass. `replacing` is the row being replaced (still active until the insert).
 */
export async function assertNoOverlap(
  tx: Tx,
  kind: "rent" | "contract",
  v: { companyId: string; category: PropertyCategory } & RuleScope,
  replacing: string | null,
  /** The copilot gets the other rule's id, so it can replace that rule instead (the settings page shows the row). */
  forCopilot = false,
) {
  await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`rules:${kind}:${v.companyId}:${v.category}`}))`);
  const rows: (RuleScope & { id: string })[] =
    kind === "rent"
      ? await tx.db
          .select()
          .from(rentRules)
          .where(
            and(eq(rentRules.companyId, v.companyId), eq(rentRules.category, v.category), eq(rentRules.active, true)),
          )
      : await tx.db
          .select()
          .from(contractRules)
          .where(
            and(
              eq(contractRules.companyId, v.companyId),
              eq(contractRules.category, v.category),
              eq(contractRules.active, true),
            ),
          );
  const other = rows.find((r) => r.id !== replacing && overlaps(r, v));
  if (!other) return;
  const where = v.emirate ? EMIRATE_LABELS[v.emirate] : "all emirates";
  const shared = sharedSubtypes(other, v);
  throw unprocessable(
    `Another active ${kind} rule already covers ${typesLabel(shared)} in ${where}${v.community ? ` (${v.community})` : ""}. Change that rule, or pick other types.${forCopilot ? ` To change it, replace it: replaceRuleId ${other.id}.` : ""}`,
    [],
    "rule_overlap",
  );
}

function checkRentRule(v: RentRuleValues) {
  checkSubtypes(v.category, v.subtypes);
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
    payload: { ruleId: row.id, emirate: row.emirate, maxOfferDiscountPct: row.maxOfferDiscountPct },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}

async function insertRentRule(tx: Tx, v: RentRuleValues, actor: Actor, supersedesId: string | null) {
  checkRentRule(v);
  await requireCompany(tx, v.companyId);
  await assertOperates(tx, v.companyId, v.emirate);
  await assertOffers(tx, v.companyId, v.category);
  const subtypes = normaliseSubtypes(v.subtypes);
  await assertNoOverlap(
    tx,
    "rent",
    { companyId: v.companyId, category: v.category, emirate: v.emirate, community: v.community ?? null, subtypes },
    supersedesId,
  );
  const [row] = await tx.db
    .insert(rentRules)
    .values({
      id: newId(),
      companyId: v.companyId,
      category: v.category,
      subtypes,
      emirate: v.emirate,
      community: v.community ?? null,
      minPctBp: v.minPctBp,
      maxPctBp: v.maxPctBp,
      minRentFils: v.minRentFils ?? null,
      maxRentFils: v.maxRentFils ?? null,
      maxOfferDiscountPct: v.maxOfferDiscountPct ?? null,
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
  v: Omit<RentRuleValues, "companyId" | "emirate"> & { emirate?: Emirate | undefined },
  actor: Actor,
) {
  const [old] = await tx.db.select().from(rentRules).where(eq(rentRules.id, id)).for("update");
  if (!old) throw notFound("rent rule");
  if (!old.active) throw conflict("rent rule is no longer active", "rule_inactive");
  // Omitted (undefined) keeps the rule's offer discount; null clears it to the company default (D63).
  const maxOfferDiscountPct = v.maxOfferDiscountPct === undefined ? old.maxOfferDiscountPct : v.maxOfferDiscountPct;
  const row = await insertRentRule(
    tx,
    {
      ...v,
      emirate: v.emirate ?? old.emirate,
      // Omitted types keep the rule's own (D68); [] = all types.
      subtypes: v.subtypes === undefined ? old.subtypes : v.subtypes,
      maxOfferDiscountPct,
      companyId: old.companyId,
    },
    actor,
    old.id,
  );
  await tx.db.update(rentRules).set({ active: false }).where(eq(rentRules.id, old.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: old.companyId },
    type: "RENT_RULE_REPLACED",
    actor,
    payload: {
      ruleId: row.id,
      supersedesId: old.id,
      maxOfferDiscountPct: { from: old.maxOfferDiscountPct, to: row.maxOfferDiscountPct },
      subtypes: { from: old.subtypes, to: row.subtypes },
    },
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
  /** Unit types the rule covers (D68); empty or omitted = every type of the category. */
  subtypes?: readonly PropertySubtype[] | null | undefined;
  /** The emirate the rule is for; null = any emirate (D58). On replace: omitted keeps it, null clears it. */
  emirate?: Emirate | null | undefined;
  tenures: ("annual" | "short_term")[];
  minCheques: number;
  maxCheques: number;
  clauseIds: string[];
  /** An approved company template of the same company; contracts of this rule render in it. */
  templateId?: string | null | undefined;
}

function checkContractRule(v: ContractRuleValues) {
  checkSubtypes(v.category, v.subtypes);
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

/**
 * A rule pointed at a template (new, or a different one than before) gets the template's approved linked clauses
 * (D47 wording prints only for clauses in the rule; D68: templates are picked from the library, not uploaded on the
 * rule). Unchanged template: the rule's list is kept as the admin left it.
 */
async function withTemplateClauses(
  tx: Tx,
  companyId: string,
  templateId: string | null | undefined,
  previousTemplateId: string | null,
  clauseIds: string[],
): Promise<string[]> {
  if (!templateId || templateId === previousTemplateId) return clauseIds;
  const linked = await tx.db
    .select({ id: companyClauses.id })
    .from(companyClauses)
    .where(
      and(
        eq(companyClauses.companyId, companyId),
        eq(companyClauses.inTemplateId, templateId),
        eq(companyClauses.status, "approved"),
      ),
    );
  const add = linked.map((c) => `cc:${c.id}`).filter((x) => !clauseIds.includes(x));
  return add.length ? [...clauseIds, ...add] : clauseIds;
}

async function insertContractRule(
  tx: Tx,
  v: ContractRuleValues,
  actor: Actor,
  supersedesId: string | null,
  /** A copy keeps the source rule's clause list exactly. */
  exactClauses = false,
) {
  checkContractRule(v);
  await requireCompany(tx, v.companyId);
  if (v.emirate) await assertOperates(tx, v.companyId, v.emirate);
  await assertOffers(tx, v.companyId, v.category);
  // Company clauses must be approved clauses of this company (422 otherwise).
  await resolveCompanyClauses(tx, v.companyId, v.clauseIds);
  let previousTemplateId: string | null = null;
  if (supersedesId) {
    const [old] = await tx.db
      .select({ templateId: contractRules.templateId })
      .from(contractRules)
      .where(eq(contractRules.id, supersedesId));
    previousTemplateId = old?.templateId ?? null;
  }
  const clauseIds = (
    exactClauses
      ? v.clauseIds
      : await withTemplateClauses(tx, v.companyId, v.templateId, previousTemplateId, v.clauseIds)
  ) as ContractRuleValues["clauseIds"];
  if (clauseIds.length > MAX_ADDENDUM_CLAUSES) {
    throw unprocessable(
      `A contract rule can list at most ${MAX_ADDENDUM_CLAUSES} clauses (this one would have ${clauseIds.length}).`,
      [],
      "rule_too_many_clauses",
    );
  }
  // The template must be approved and the company's own (422 otherwise).
  const template = await requireApprovedTemplate(tx, v.companyId, v.templateId);
  // A rule for one emirate needs a template listing it, or an any-emirate one (D58, D68). A rule for all emirates may
  // use any template: units of an emirate the template doesn't list fall back to that emirate's own (templateForUnit).
  if (template && v.emirate && !templateFitsRule(template, v.emirate))
    throw unprocessable(
      `That company template is for ${template.emirates.map((e) => EMIRATE_LABELS[e]).join(", ")}; this rule is for ${v.emirate ? EMIRATE_LABELS[v.emirate] : "all emirates"}.`,
      [],
      "template_emirate",
    );
  const subtypes = normaliseSubtypes(v.subtypes);
  await assertNoOverlap(
    tx,
    "contract",
    { companyId: v.companyId, category: v.category, emirate: v.emirate ?? null, subtypes },
    supersedesId,
  );
  const [row] = await tx.db
    .insert(contractRules)
    .values({
      id: newId(),
      companyId: v.companyId,
      category: v.category,
      subtypes,
      emirate: v.emirate ?? null,
      tenures: v.tenures,
      minCheques: v.minCheques,
      maxCheques: v.maxCheques,
      clauseIds,
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
  /** Keep `clauseIds` exactly (template approval decides which linked clauses join, by the admin's ticks). */
  exactClauses = false,
) {
  const [old] = await tx.db.select().from(contractRules).where(eq(contractRules.id, id)).for("update");
  if (!old) throw notFound("contract rule");
  if (!old.active) throw conflict("contract rule is no longer active", "rule_inactive");
  if (v.expectedClauseIds && v.expectedClauseIds.join(",") !== old.clauseIds.join(",")) {
    throw conflict("The rule's clauses changed since you loaded it.", "rule_changed");
  }
  // Not sent: keep the rule's template. Sent as null: clear it.
  const templateId = v.templateId === undefined ? old.templateId : v.templateId;
  // The same for the emirate (D58), so callers that copy a rule's fields keep it.
  const emirate = v.emirate === undefined ? old.emirate : v.emirate;
  // Omitted types keep the rule's own (D68); [] = all types.
  const subtypes = v.subtypes === undefined ? old.subtypes : v.subtypes;
  const row = await insertContractRule(
    tx,
    { ...v, templateId, emirate, subtypes, companyId: old.companyId },
    actor,
    old.id,
    exactClauses,
  );
  await tx.db.update(contractRules).set({ active: false }).where(eq(contractRules.id, old.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: old.companyId },
    type: "CONTRACT_RULE_REPLACED",
    actor,
    payload: {
      ruleId: row.id,
      supersedesId: old.id,
      // What changed, so the audit reads without joining the two rows (D58).
      before: {
        emirate: old.emirate,
        subtypes: old.subtypes,
        minCheques: old.minCheques,
        maxCheques: old.maxCheques,
        tenures: old.tenures,
      },
      after: {
        emirate: row.emirate,
        subtypes: row.subtypes,
        minCheques: row.minCheques,
        maxCheques: row.maxCheques,
        tenures: row.tenures,
      },
    },
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
      subtypes: old.subtypes,
      tenures: old.tenures as ("annual" | "short_term")[],
      minCheques: old.minCheques,
      maxCheques: old.maxCheques,
      clauseIds: old.clauseIds,
      templateId,
    },
    actor,
    true,
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

/**
 * "Copy to emirate" (D68): a new active contract rule with the same types, tenures, cheques and clauses for another
 * emirate (or for all emirates). The template comes along only when it may be used there; otherwise the copy has none
 * and the unit's emirate picks an approved template as usual. Same checks as a new rule (emirate, overlap).
 */
export async function copyContractRule(
  ctx: EngineContext,
  tx: Tx,
  id: string,
  toEmirate: Emirate | null,
  actor: Actor,
) {
  const [src] = await tx.db.select().from(contractRules).where(eq(contractRules.id, id));
  if (!src) throw notFound("contract rule");
  if (!src.active) throw conflict("contract rule is no longer active", "rule_inactive");
  if (src.emirate === toEmirate) throw unprocessable("The rule is already for that emirate.", [], "same_emirate");
  let templateId = src.templateId;
  if (templateId) {
    const [tpl] = await tx.db
      .select({ emirates: companyContractTemplates.emirates })
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, templateId));
    if (!tpl || !templateFitsRule(tpl, toEmirate)) templateId = null;
  }
  const row = await insertContractRule(
    tx,
    {
      companyId: src.companyId,
      category: src.category as PropertyCategory,
      subtypes: src.subtypes,
      emirate: toEmirate,
      tenures: src.tenures as ("annual" | "short_term")[],
      minCheques: src.minCheques,
      maxCheques: src.maxCheques,
      clauseIds: src.clauseIds,
      templateId,
    },
    actor,
    null,
    true,
  );
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: src.companyId },
    type: "CONTRACT_RULE_COPIED",
    actor,
    payload: { ruleId: row.id, fromRuleId: src.id, emirate: toEmirate, templateKept: templateId !== null },
    rulesVersion: ctx.rulesVersion,
  });
  return { rule: row, templateKept: templateId !== null || src.templateId === null };
}

/** "Copy to emirate" for a rent rule (D68). A community rule is not copied: communities belong to one emirate. */
export async function copyRentRule(ctx: EngineContext, tx: Tx, id: string, toEmirate: Emirate, actor: Actor) {
  const [src] = await tx.db.select().from(rentRules).where(eq(rentRules.id, id));
  if (!src) throw notFound("rent rule");
  if (!src.active) throw conflict("rent rule is no longer active", "rule_inactive");
  if (src.emirate === toEmirate) throw unprocessable("The rule is already for that emirate.", [], "same_emirate");
  if (src.community)
    throw unprocessable(
      "A rule for one community can't be copied to another emirate; add a new rule there.",
      [],
      "community_rule",
    );
  const row = await insertRentRule(
    tx,
    {
      companyId: src.companyId,
      category: src.category as PropertyCategory,
      subtypes: src.subtypes,
      emirate: toEmirate,
      community: null,
      minPctBp: src.minPctBp,
      maxPctBp: src.maxPctBp,
      minRentFils: src.minRentFils,
      maxRentFils: src.maxRentFils,
      maxOfferDiscountPct: src.maxOfferDiscountPct,
    },
    actor,
    null,
  );
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: src.companyId },
    type: "RENT_RULE_COPIED",
    actor,
    payload: { ruleId: row.id, fromRuleId: src.id, emirate: toEmirate },
    rulesVersion: ctx.rulesVersion,
  });
  return row;
}
