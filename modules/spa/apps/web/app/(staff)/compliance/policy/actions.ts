"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engineGet, engineSend } from "../../../../lib/engine";
import { loadAmlPolicy } from "../../../../lib/loaders";
import { applyPolicyForm, sendSettings } from "../../../../lib/settings-forms";

/**
 * Publish the compliance rules (C34, S66): the form is laid over the policy in force and sent whole to
 * `PUT /api/compliance/policy`. The engine accepts only the compliance officer and validates every value again.
 */
export async function publishAmlPolicy(form: FormData): Promise<void> {
  const current = await loadAmlPolicy(engineGet);
  if (!current) redirect("/compliance/policy?error=refused");
  const body = applyPolicyForm(current.values, form);
  if (!body) redirect("/compliance/policy?error=invalid");
  const out = await sendSettings(engineSend, { method: "PUT", path: "/api/compliance/policy", body });
  if (out === "signin") redirect("/sign-in");
  if (out !== "done") redirect(`/compliance/policy?error=${out}`);
  revalidatePath("/compliance/policy");
  redirect("/compliance/policy?saved=policy");
}
