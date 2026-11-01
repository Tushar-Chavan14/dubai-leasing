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
