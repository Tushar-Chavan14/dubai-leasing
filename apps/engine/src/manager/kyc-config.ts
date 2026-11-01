import {
  type Actor,
  type CalendarDate,
  DocumentForm,
  defaultBaseRules,
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
  if (row) return { version: row.version, form: DocumentForm.parse(row.form), rules: KycRules.parse(row.rules) };
  const policy = await getCompanyPolicy(tx as Tx, today);
  return { version: 0, form: STARTER_FORM, rules: { base: defaultBaseRules(policy), company: [] } };
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
    return { version: 0, form: STARTER_FORM, rules: { base: defaultBaseRules(policy), company: [] } };
  }
  const [row] = await tx.db
    .select()
    .from(companyKycConfigs)
    .where(and(eq(companyKycConfigs.companyId, companyId), eq(companyKycConfigs.version, version)));
  if (!row) return companyKycConfig(tx, companyId, today);
  return { version: row.version, form: DocumentForm.parse(row.form), rules: KycRules.parse(row.rules) };
}

/** Saves a new version of the company's form and rules (admin). Rules must name fields that exist on the form. */
export async function saveKycConfig(
  ctx: EngineContext,
  tx: Tx,
  companyId: string,
  raw: { form: unknown; rules: unknown },
  actor: Actor,
): Promise<KycConfig> {
  const [co] = await tx.db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!co) throw notFound("company");
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
        ...(r.type === "answer_required" ? r.allowed : []),
      ].join(" ");
      if (PROTECTED_TRAIT.test(text))
        issues.push(
          `rules ${r.label || r.id}: rules can't screen applicants on nationality, religion, race or similar traits`,
        );
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
  await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`kyc-config:${companyId}`}))`);
  const [last] = await tx.db
    .select({ version: companyKycConfigs.version })
    .from(companyKycConfigs)
    .where(eq(companyKycConfigs.companyId, companyId))
    .orderBy(desc(companyKycConfigs.version))
    .limit(1);
  const version = (last?.version ?? 0) + 1;
  await tx.db.update(companyKycConfigs).set({ active: false }).where(eq(companyKycConfigs.companyId, companyId));
  await tx.db.insert(companyKycConfigs).values({
    id: newId(),
    companyId,
    version,
    form: formP.data,
    rules: rulesP.data,
    createdBy: actor,
  });
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: companyId },
    type: "KYC_CONFIG_SAVED",
    actor,
    payload: {
      version,
      fields: formP.data.length,
      companyRules: rulesP.data.company.length,
      configSha256: sha256Hex(JSON.stringify({ form: formP.data, rules: rulesP.data })),
    },
    rulesVersion: ctx.rulesVersion,
  });
  return { version, form: formP.data, rules: rulesP.data };
}
