import {
  type Actor,
  type CalendarDate,
  DocumentForm,
  defaultBaseRules,
  defaultDocRules,
  effectiveCross,
  type FormField,
  KycRules,
  newId,
  PROTECTED_TRAIT,
  STARTER_FORM,
} from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import { companies, companyKycConfigs, type Tx } from "@leasing/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { notFound, unprocessable } from "../errors.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";

/**
 * Fills in what an older version derived from its switches (the checks across documents, and each read document
 * field's rules), so readers and the settings form see the settings in force.
 */
const withChecks = (form: FormField[], rules: KycRules): { form: FormField[]; rules: KycRules } => ({
  form: form.map((f) =>
    f.type === "document" && f.documentKind && f.documentKind !== "other" && !f.rules
      ? { ...f, rules: defaultDocRules(f.documentKind, rules.base) }
      : f,
  ),
  rules: { ...rules, base: { ...rules.base, checks: effectiveCross(rules.base) } },
});

export interface KycConfig {
  /** 0: the starter form and default rules (nothing saved yet). */
  version: number;
  form: FormField[];
  rules: KycRules;
}

/** The company's active document form and KYC rules; the starter set when none was saved. */
export async function companyKycConfig(tx: Pick<Tx, "db">, companyId: string, today: CalendarDate): Promise<KycConfig> {
  const [row] = await tx.db
    .select()
    .from(companyKycConfigs)
    .where(and(eq(companyKycConfigs.companyId, companyId), eq(companyKycConfigs.active, true)))
    .orderBy(desc(companyKycConfigs.version))
    .limit(1);
  if (row) return { version: row.version, ...withChecks(DocumentForm.parse(row.form), KycRules.parse(row.rules)) };
  const policy = await getCompanyPolicy(tx as Tx, today);
  return { version: 0, ...withChecks(STARTER_FORM, { base: defaultBaseRules(policy), company: [] }) };
}

/** A specific saved version (what an application answered and is checked against). */
export async function kycConfigVersion(
  tx: Pick<Tx, "db">,
  companyId: string,
  version: number,
  today: CalendarDate,
): Promise<KycConfig> {
  if (version === 0) {
    const policy = await getCompanyPolicy(tx as Tx, today);
    return { version: 0, ...withChecks(STARTER_FORM, { base: defaultBaseRules(policy), company: [] }) };
  }
  const [row] = await tx.db
    .select()
    .from(companyKycConfigs)
    .where(
      and(
        eq(companyKycConfigs.companyId, companyId),
        eq(companyKycConfigs.version, version),
        eq(companyKycConfigs.status, "published"),
      ),
    );
  if (!row) return companyKycConfig(tx, companyId, today);
  return { version: row.version, ...withChecks(DocumentForm.parse(row.form), KycRules.parse(row.rules)) };
}

/** Parses and checks a form and rules the way every save does (admin forms and the copilot alike). */
export function validateKycConfig(raw: { form: unknown; rules: unknown }): { form: FormField[]; rules: KycRules } {
  const formP = DocumentForm.safeParse(raw.form);
  const rulesP = KycRules.safeParse(raw.rules);
  const issues = [
    ...(formP.success ? [] : formP.error.issues.map((i) => `form ${i.path.join(".")}: ${i.message}`)),
    ...(rulesP.success ? [] : rulesP.error.issues.map((i) => `rules ${i.path.join(".")}: ${i.message}`)),
  ];
  if (rulesP.success) {
    for (const r of rulesP.data.company) {
      const text = [
        r.label,
        r.type === "ai_check" ? r.instruction : "",
        r.type === "document_value_pattern" ? r.describe : "",
        ...(r.type === "answer_required" ? r.allowed : []),
      ].join(" ");
      if (PROTECTED_TRAIT.test(text))
        issues.push(
          `rules ${r.label || r.id}: rules can't screen applicants on nationality, religion, race or similar traits`,
        );
    }
  }
  if (formP.success) {
    for (const f of formP.data) {
      if (f.documentKind !== "custom") continue;
      const text = `${f.label} ${f.customCategory?.name ?? ""} ${f.customCategory?.description ?? ""}`;
      if (PROTECTED_TRAIT.test(text))
        issues.push(`form ${f.key}: a document can't be about nationality, religion, race or similar traits`);
    }
  }
  if (formP.success && rulesP.success) {
    const keys = new Set(formP.data.filter((f) => f.type !== "document").map((f) => f.key));
    for (const r of rulesP.data.company) {
      if ((r.type === "answer_matches_document" || r.type === "answer_required") && !keys.has(r.fieldKey))
        issues.push(`rules ${r.label || r.id}: the form has no answer field "${r.fieldKey}"`);
    }
  }
  if (issues.length || !formP.success || !rulesP.success)
    throw unprocessable("The document form or KYC rules need attention.", issues, "bad_kyc_config");
  return { form: formP.data, rules: rulesP.data };
}

async function companyExists(tx: Tx, companyId: string) {
  const [co] = await tx.db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!co) throw notFound("company");
}

/** Serialises edits to one company's KYC config (re-entrant within a transaction). */
export async function lockKycConfig(tx: Tx, companyId: string) {
  await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`kyc-config:${companyId}`}))`);
}

async function nextVersion(tx: Tx, companyId: string): Promise<number> {
  const [last] = await tx.db
    .select({ version: companyKycConfigs.version })
    .from(companyKycConfigs)
    .where(eq(companyKycConfigs.companyId, companyId))
    .orderBy(desc(companyKycConfigs.version))
    .limit(1);
  return (last?.version ?? 0) + 1;
}

/** The company's draft, if one is open (D50). */
export async function kycDraft(tx: Pick<Tx, "db">, companyId: string) {
  const [row] = await tx.db
    .select()
    .from(companyKycConfigs)
    .where(and(eq(companyKycConfigs.companyId, companyId), eq(companyKycConfigs.status, "draft")));
  if (!row) return null;
  return {
    version: row.version,
    ...withChecks(DocumentForm.parse(row.form), KycRules.parse(row.rules)),
    updatedBy: row.createdBy,
  };
}

/** The live config and the open draft, for the settings page and the copilot. */
export async function kycConfigWithDraft(tx: Pick<Tx, "db">, companyId: string, today: CalendarDate) {
  const live = await companyKycConfig(tx, companyId, today);
  return { ...live, draft: await kycDraft(tx, companyId) };
}

const configSha = (c: { form: unknown; rules: unknown }) => sha256Hex(JSON.stringify(c));

/** Saves the company's draft (D50): validated like a publish, but nothing changes for applicants until it's published. */
export async function saveKycDraft(
  ctx: EngineContext,
  tx: Tx,
  companyId: string,
  raw: { form: unknown; rules: unknown },
  actor: Actor,
  /** The copilot's edits, recorded with the save (rule 4). */
  ops?: unknown[],
) {
  await companyExists(tx, companyId);
  const v = validateKycConfig(raw);
  await lockKycConfig(tx, companyId);
  const [draft] = await tx.db
    .select({ id: companyKycConfigs.id, version: companyKycConfigs.version })
    .from(companyKycConfigs)
    .where(and(eq(companyKycConfigs.companyId, companyId), eq(companyKycConfigs.status, "draft")));
  const version = draft?.version ?? (await nextVersion(tx, companyId));
  if (draft)
    await tx.db
      .update(companyKycConfigs)
      .set({ form: v.form, rules: v.rules, createdBy: actor, createdAt: ctx.clock.now() })
      .where(eq(companyKycConfigs.id, draft.id));
  else
    await tx.db.insert(companyKycConfigs).values({
      id: newId(),
      companyId,
      version,
      form: v.form,
      rules: v.rules,
      active: false,
      status: "draft",
      createdBy: actor,
      createdAt: ctx.clock.now(),
    });
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: companyId },
    type: "KYC_DRAFT_SAVED",
    actor,
    payload: { version, configSha256: configSha(v), ...(ops ? { ops } : {}) },
    rulesVersion: ctx.rulesVersion,
  });
  return { version, ...v };
}

/** Publishes the draft: it becomes the version new uploads use; earlier applications keep theirs. */
export async function publishKycDraft(ctx: EngineContext, tx: Tx, companyId: string, actor: Actor) {
  await companyExists(tx, companyId);
  await lockKycConfig(tx, companyId);
  const [draft] = await tx.db
    .select()
    .from(companyKycConfigs)
    .where(and(eq(companyKycConfigs.companyId, companyId), eq(companyKycConfigs.status, "draft")));
  if (!draft) throw unprocessable("There is no draft to publish.", [], "no_draft");
  // Re-checked at publish: the rules may have tightened since the draft was saved.
  const v = validateKycConfig({ form: draft.form, rules: draft.rules });
  await tx.db.update(companyKycConfigs).set({ active: false }).where(eq(companyKycConfigs.companyId, companyId));
  await tx.db
    .update(companyKycConfigs)
    .set({ active: true, status: "published", publishedAt: ctx.clock.now(), publishedBy: actor })
    .where(eq(companyKycConfigs.id, draft.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: companyId },
    type: "KYC_CONFIG_SAVED",
    actor,
    payload: {
      version: draft.version,
      fields: v.form.length,
      companyRules: v.rules.company.length,
      configSha256: configSha(v),
      fromDraft: true,
    },
    rulesVersion: ctx.rulesVersion,
  });
  return { version: draft.version, ...v };
}

/** Throws the draft away; the live version is untouched. */
export async function discardKycDraft(ctx: EngineContext, tx: Tx, companyId: string, actor: Actor) {
  await lockKycConfig(tx, companyId);
  const gone = await tx.db
    .delete(companyKycConfigs)
    .where(and(eq(companyKycConfigs.companyId, companyId), eq(companyKycConfigs.status, "draft")))
    .returning({ version: companyKycConfigs.version });
  if (gone.length)
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: companyId },
      type: "KYC_DRAFT_DISCARDED",
      actor,
      payload: { version: gone[0]!.version },
      rulesVersion: ctx.rulesVersion,
    });
  return { discarded: gone.length > 0 };
}

/** Saves and publishes in one step (a new live version); an open draft is replaced by it. */
export async function saveKycConfig(
  ctx: EngineContext,
  tx: Tx,
  companyId: string,
  raw: { form: unknown; rules: unknown },
  actor: Actor,
): Promise<KycConfig> {
  await saveKycDraft(ctx, tx, companyId, raw, actor);
  const done = await publishKycDraft(ctx, tx, companyId, actor);
  return { version: done.version, form: done.form, rules: done.rules };
}

/** A compact view of a config for the staff copilot (D50): what each field checks and how strictly. */
function copilotFields(form: FormField[], rules: KycRules) {
  return {
    fields: form.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.documentKind ? { category: f.documentKind } : {}),
      ...(f.customCategory ? { custom: f.customCategory } : {}),
      required: f.required,
      shownTo: f.appliesTo,
      ...(f.rules
        ? {
            numbers: {
              ...(f.rules.validityDays !== undefined ? { validityDays: f.rules.validityDays } : {}),
              ...(f.rules.issuedWithinDays !== undefined ? { issuedWithinDays: f.rules.issuedWithinDays } : {}),
              readConfidencePct: Math.round(f.rules.minConfidence * 100),
            },
            checks: Object.fromEntries(
              Object.entries(f.rules.checks).map(([k, v]) => [
                k,
                v.emailApplicant ? `${v.severity} + email` : v.severity,
              ]),
            ),
          }
        : {}),
    })),
    acrossDocuments: Object.fromEntries(
      Object.entries(effectiveCross(rules.base).cross).map(([k, v]) => [
        k,
        v.emailApplicant ? `${v.severity} + email` : v.severity,
      ]),
    ),
    applicantNameMatch: effectiveCross(rules.base).applicantNameMode,
    customChecks: rules.company.map((r) => ({
      id: r.id,
      label: r.label,
      type: r.type,
      severity: r.emailApplicant ? `${r.severity} + email` : r.severity,
    })),
  };
}

export async function kycCopilotView(tx: Pick<Tx, "db">, companyId: string, today: CalendarDate) {
  const c = await kycConfigWithDraft(tx, companyId, today);
  const editing = c.draft ?? c;
  return {
    liveVersion: c.version,
    draftVersion: c.draft?.version ?? null,
    showing: c.draft ? "draft" : "live",
    ...copilotFields(editing.form, editing.rules),
  };
}
