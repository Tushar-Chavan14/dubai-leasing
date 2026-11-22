"use server";

import { finishSettings } from "../../../../lib/settings-action";
import { companyRequest } from "../../../../lib/settings-forms";

/** Save the company's name and kind: `PUT /api/settings/company` with those two fields and nothing else. */
export async function saveCompany(form: FormData): Promise<void> {
  await finishSettings(companyRequest(form), "/settings/company", "company");
}
