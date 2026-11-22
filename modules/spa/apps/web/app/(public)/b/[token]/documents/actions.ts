"use server";

import { redirect } from "next/navigation";
import { publicEngine } from "../../../../../lib/engine";

/** "Send my documents": queues the check and uses the link up. The portal opens no approval itself. */
export async function sendDocuments(token: string) {
  const res = await publicEngine()
    .public.portal[":token"].documents.send.$post({ param: { token } })
    .catch(() => null);
  if (res?.ok) redirect(`/b/${token}/documents?sent=1`);
  const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
  redirect(`/b/${token}/documents?error=${code ?? "internal"}`);
}
