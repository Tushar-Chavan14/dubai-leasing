"use server";

import { finishSettings } from "../../../../lib/settings-action";
import { userActiveRequest, userRoleRequest } from "../../../../lib/settings-forms";

/** Change one user's role. The engine refuses yourself and the last active admin; either comes back as "blocked". */
export async function setUserRole(form: FormData): Promise<void> {
  await finishSettings(userRoleRequest(form), "/settings/users", "user", "blocked");
}

export async function setUserActive(form: FormData): Promise<void> {
  await finishSettings(userActiveRequest(form), "/settings/users", "user", "blocked");
}
