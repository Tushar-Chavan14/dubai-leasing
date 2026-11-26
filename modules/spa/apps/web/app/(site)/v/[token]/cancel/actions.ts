"use server";

import { redirect } from "next/navigation";
import { clientBucket } from "../../../../../lib/client-address";
import { engineUrl, webEnv } from "../../../../../lib/env";
import { requestHeaders } from "../../../../../lib/request-headers";

/** The click on "Cancel this viewing" (S79). The engine answers cancelled, already cancelled or not found; the page shows fixed words for each. */
export async function cancelViewing(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  if (!/^[\w-]{20,64}$/.test(token)) redirect("/properties");
  let status = "error";
  try {
    const res = await fetch(`${engineUrl()}/public/viewings/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": clientBucket(await requestHeaders(), webEnv().SPA_TRUSTED_PROXY),
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    status = res.ok
      ? String(((await res.json()) as { status?: string }).status ?? "error")
      : res.status === 429
        ? "busy"
        : "error";
  } catch {
    status = "error";
  }
  redirect(`/v/${token}/cancel?result=${status}`);
}
