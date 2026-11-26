"use server";

import { finishSettings } from "../../../../lib/settings-action";
import { policyRequest } from "../../../../lib/settings-forms";

/** Save the Signing page: link days and signing order, with the version the page started from. */
export async function saveSigning(form: FormData): Promise<void> {
  await finishSettings(policyRequest("signing", form), "/settings/signing", "policy", "stale");
}
