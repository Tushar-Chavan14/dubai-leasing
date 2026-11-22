"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engineSend } from "../../../../lib/engine";
import { alertThresholds, sendSettings } from "../../../../lib/settings-forms";

/** Save the alert hours (C34, S62): `PUT /api/settings/alerts` with the hours typed and nothing else. The engine checks the role and every value. */
export async function saveAlertSettings(form: FormData): Promise<void> {
  const body = alertThresholds(form);
  if (!body) redirect("/settings/alerts?error=invalid");
  const out = await sendSettings(engineSend, { method: "PUT", path: "/api/settings/alerts", body });
  if (out === "signin") redirect("/sign-in");
  if (out !== "done") redirect(`/settings/alerts?error=${out}`);
  revalidatePath("/settings/alerts");
  redirect("/settings/alerts?saved=alerts");
}
