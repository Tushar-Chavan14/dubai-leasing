"use server";

import { finishSettings } from "../../../../lib/settings-action";
import { policyRequest } from "../../../../lib/settings-forms";

/** Save the Viewings page: days, hours, slot length, lead time, horizon and the per-email cap, with the version it started from. */
export async function saveViewings(form: FormData): Promise<void> {
  await finishSettings(policyRequest("viewings", form), "/settings/viewings", "policy", "stale");
}
