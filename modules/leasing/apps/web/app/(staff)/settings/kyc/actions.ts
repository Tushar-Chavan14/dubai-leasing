"use server";

import { revalidatePath } from "next/cache";
import { engine } from "../../../../lib/engine";
import { type RuleResult, ruleError } from "../../../../lib/portfolio";

/** Saves a new version of the company's document form and KYC rules (admin; the engine validates everything). */
export async function saveKycConfig(companyId: string, form: unknown, rules: unknown): Promise<RuleResult> {
  const r = await engine(`/api/companies/${companyId}/kyc-config`, {
    method: "PUT",
    body: JSON.stringify({ form, rules }),
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/kyc");
  return { ok: true };
}

/** Saves the company's draft (D50); applicants keep getting the live version until it's published. */
export async function saveKycDraft(companyId: string, form: unknown, rules: unknown): Promise<RuleResult> {
  const r = await engine(`/api/companies/${companyId}/kyc-config/draft`, {
    method: "PUT",
    body: JSON.stringify({ form, rules }),
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/kyc");
  return { ok: true };
}

/** Publishes the draft: the version new uploads use. */
export async function publishKycDraft(companyId: string): Promise<RuleResult> {
  const r = await engine(`/api/companies/${companyId}/kyc-config/publish`, { method: "POST" });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/kyc");
  return { ok: true };
}

/** Throws the draft away; the live version is untouched. */
export async function discardKycDraft(companyId: string): Promise<RuleResult> {
  const r = await engine(`/api/companies/${companyId}/kyc-config/draft`, { method: "DELETE" });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/kyc");
  return { ok: true };
}
