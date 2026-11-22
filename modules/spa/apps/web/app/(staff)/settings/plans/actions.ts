"use server";

import { finishSettings } from "../../../../lib/settings-action";
import { policyRequest } from "../../../../lib/settings-forms";

/** Save the Plans page: the page's own fields and the version it started from; a stale version comes back as "stale". */
export async function savePlans(form: FormData): Promise<void> {
  await finishSettings(policyRequest("plans", form), "/settings/plans", "policy", "stale");
}
