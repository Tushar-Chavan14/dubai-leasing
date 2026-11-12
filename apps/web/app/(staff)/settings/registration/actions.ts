"use server";

import { revalidatePath } from "next/cache";
import { engine } from "../../../../lib/engine";
import { type RuleResult, ruleError } from "../../../../lib/portfolio";

/** Save one emirate's registration settings (admin only; the engine checks the role). */
export async function saveRegistration(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const emirate = String(formData.get("emirate") ?? "");
  const url = String(formData.get("portalUrl") ?? "").trim();
  const sources = String(formData.get("sources") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const body = {
    mode: String(formData.get("mode") ?? "manual"),
    portalName: String(formData.get("portalName") ?? ""),
    portalUrl: url || null,
    instructions: String(formData.get("instructions") ?? ""),
    requiredDocuments: formData.getAll("requiredDocuments").map(String),
    referenceExample: String(formData.get("referenceExample") ?? ""),
    referencePattern: String(formData.get("referencePattern") ?? ""),
    sources,
  };
  const r = await engine(`/api/registration-settings/${encodeURIComponent(emirate)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/registration");
  return { ok: true };
}

/** Save who pays the registration fee (admin only; the engine checks the role). */
export async function saveFeePayer(_prev: RuleResult, formData: FormData): Promise<RuleResult> {
  const r = await engine("/api/policy/registration", {
    method: "PUT",
    body: JSON.stringify({ registrationFeePaidBy: String(formData.get("registrationFeePaidBy") ?? "") }),
  });
  if (!r.ok) return ruleError(r);
  revalidatePath("/settings/registration");
  return { ok: true };
}
