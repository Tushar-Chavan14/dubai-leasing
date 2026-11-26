"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HELPER_MODES } from "@spa/core";
import { engine } from "../../../../lib/engine";

const Form = z.object({ helper: z.string().min(1), scope: z.string().min(1), mode: z.enum(HELPER_MODES) });

/**
 * A mode button (C24, S59): `PUT /api/settings/helpers` as the signed-in user, with a helper, a scope and a mode and
 * nothing else. The engine checks the role (admin), the helper and the mode again; this is a convenience, never the rule.
 */
export async function setHelperMode(formData: FormData): Promise<void> {
  const f = Form.safeParse({
    helper: formData.get("helper"),
    scope: formData.get("scope"),
    mode: formData.get("mode"),
  });
  if (!f.success) redirect("/settings/helpers?error=1");
  const res = await (await engine()).api.settings.helpers.$put({ json: f.data }).catch(() => null);
  if ((res?.status as number | undefined) === 401) redirect("/sign-in");
  if (!res?.ok) redirect("/settings/helpers?error=1");
  revalidatePath("/settings/helpers");
}
