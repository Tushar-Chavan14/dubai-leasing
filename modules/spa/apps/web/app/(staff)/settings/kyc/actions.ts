"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engineGet, engineSend } from "../../../../lib/engine";
import { loadKycForm } from "../../../../lib/loaders";
import { applyKycForm, kycTarget, sendSettings } from "../../../../lib/settings-forms";

const pageOf = (t: { role: string; dealType: string | null } | null) =>
  t ? `/settings/kyc/${t.role}${t.dealType ? `?dealType=${t.dealType}` : ""}` : "/settings/kyc";
const withQuery = (page: string, q: string) => `${page}${page.includes("?") ? "&" : "?"}${q}`;

/**
 * Save a KYC draft (C34, S66): the form is laid over the config the editor started from (the draft, else the form in
 * force) and sent whole to `PUT /api/settings/kyc`. The engine validates it again, including the protected-trait rule.
 */
export async function saveKycDraft(form: FormData): Promise<void> {
  const target = kycTarget(form);
  const page = pageOf(target);
  if (!target) redirect("/settings/kyc?error=invalid");
  const current = await loadKycForm(engineGet, target.role, target.dealType);
  if (!current) redirect(withQuery(page, "error=refused"));
  const config = applyKycForm(current.draft ?? current.effective.config, form);
  if (!config) redirect(withQuery(page, "error=invalid"));
  const out = await sendSettings(engineSend, {
    method: "PUT",
    path: "/api/settings/kyc",
    body: { role: target.role, ...(target.dealType ? { dealType: target.dealType } : {}), config },
  });
  if (out === "signin") redirect("/sign-in");
  if (out !== "done") redirect(withQuery(page, `error=${out}`));
  revalidatePath("/settings/kyc", "layout");
  redirect(withQuery(page, "saved=draft"));
}

export async function publishKycDraft(form: FormData): Promise<void> {
  const target = kycTarget(form);
  const page = pageOf(target);
  if (!target) redirect("/settings/kyc?error=invalid");
  const out = await sendSettings(engineSend, {
    method: "POST",
    path: "/api/settings/kyc/publish",
    body: { role: target.role, ...(target.dealType ? { dealType: target.dealType } : {}) },
  });
  if (out === "signin") redirect("/sign-in");
  if (out !== "done") redirect(withQuery(page, `error=${out}`));
  revalidatePath("/settings/kyc", "layout");
  redirect(withQuery(page, "saved=published"));
}
