"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engine, formError } from "../../../lib/engine";
import type { ReferenceRule, RuleValues } from "./labels";

export interface RuleActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
  code?: string | undefined;
}

const fail = (r: Awaited<ReturnType<typeof engine>>): RuleActionState => ({
  ...formError(r),
  ...(r.status === 400 ? { error: "Some values need attention." } : {}),
  code: r.error?.code,
});

/** New draft copied from a published version; opens the editor. */
export async function createDraftAction(formData: FormData): Promise<void> {
  const r = await engine<{ version: string }>("/api/rulebooks", {
    method: "POST",
    body: JSON.stringify({ basedOn: String(formData.get("basedOn") ?? "") }),
  });
  if (!r.ok) throw new Error(r.error?.error ?? `engine returned ${r.status}`);
  revalidatePath("/rules");
  redirect(`/rules/${encodeURIComponent(r.data.version)}`);
}

export async function saveDraftAction(
  version: string,
  draft: { values: RuleValues; referenceRules: ReferenceRule[]; effectiveFrom: string },
): Promise<RuleActionState> {
  const r = await engine(`/api/rulebooks/${encodeURIComponent(version)}`, {
    method: "PATCH",
    body: JSON.stringify(draft),
  });
  revalidatePath(`/rules/${version}`);
  revalidatePath("/rules");
  return r.ok ? { ok: "Draft saved." } : fail(r);
}

export async function deleteDraftAction(version: string): Promise<RuleActionState> {
  const r = await engine(`/api/rulebooks/${encodeURIComponent(version)}`, { method: "DELETE" });
  if (!r.ok) return fail(r);
  revalidatePath("/rules");
  redirect("/rules");
}

export async function publishAction(version: string, confirmLegalReview: boolean): Promise<RuleActionState> {
  const r = await engine(`/api/rulebooks/${encodeURIComponent(version)}/publish`, {
    method: "POST",
    body: JSON.stringify({ confirmLegalReview }),
  });
  revalidatePath(`/rules/${version}`);
  revalidatePath("/rules");
  return r.ok ? { ok: "Published. New leases get this version from its effective date." } : fail(r);
}
