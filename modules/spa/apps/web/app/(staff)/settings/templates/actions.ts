"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engineSend } from "../../../../lib/engine";
import { isId, remapRequest, sendSettings, templateRequest, uploadBody } from "../../../../lib/settings-forms";

/**
 * The Templates forms (C34, S66): each posts to its own engine route as the signed-in user and nothing else. The engine
 * checks the role (an admin writes) and every value again and answers 403, 409 or 422 otherwise; this is a convenience,
 * never the rule. The user comes back with one fixed word, never the engine's text.
 */
export async function createTemplate(form: FormData): Promise<void> {
  const req = templateRequest(form);
  if (!req) redirect("/settings/templates?error=invalid");
  const out = await sendSettings(engineSend, req);
  if (out === "signin") redirect("/sign-in");
  if (out !== "done") redirect(`/settings/templates?error=${out}`);
  revalidatePath("/settings/templates");
  redirect("/settings/templates?saved=template");
}

export async function uploadSample(form: FormData): Promise<void> {
  const raw = form.get("templateId");
  const back = isId(raw) ? `/settings/templates/${raw}` : "/settings/templates";
  const up = uploadBody(form);
  if (!up) redirect(`${back}?error=upload`);
  const res = await engineSend(`/api/templates/${up.id}/versions`, { method: "POST", body: up.body }).catch(() => null);
  if (res?.status === 401) redirect("/sign-in");
  if (!res || res.status !== 202) redirect(`${back}?error=${res && res.status === 422 ? "upload" : "refused"}`);
  const answer = (await res.json().catch(() => null)) as { existing?: unknown } | null;
  revalidatePath(back);
  redirect(`${back}?saved=${answer?.existing === true ? "existing" : "upload"}`);
}

export async function remapBlank(form: FormData): Promise<void> {
  const raw = form.get("versionId");
  const back = isId(raw) ? `/settings/templates/versions/${raw}` : "/settings/templates";
  const req = remapRequest(form);
  if (!req) redirect(`${back}?error=invalid`);
  const out = await sendSettings(engineSend, req);
  if (out === "signin") redirect("/sign-in");
  if (out !== "done") redirect(`${back}?error=${out}`);
  revalidatePath(back);
  redirect(`${back}?saved=remap#blanks`);
}
