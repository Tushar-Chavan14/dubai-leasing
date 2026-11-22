"use server";

import { redirect } from "next/navigation";
import { publicEngine } from "../../../../../lib/engine";

/** Signs through the emailed link: the typed name and the consent tick (S54). */
export async function signAgreement(token: string, formData: FormData) {
  const typedName = String(formData.get("typedName") ?? "").trim();
  const consent = formData.get("consent") === "on";
  if (!typedName || !consent) redirect(`/b/${token}/sign?error=consent_required`);
  const res = await publicEngine()
    .public["sign-links"][":token"].sign.$post(
      { param: { token } },
      { init: { body: JSON.stringify({ typedName, consent: true }), headers: { "content-type": "application/json" } } },
    )
    .catch(() => null);
  if (res?.ok) redirect(`/b/${token}/sign?done=1`);
  const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
  redirect(`/b/${token}/sign?error=${code ?? "internal"}`);
}
