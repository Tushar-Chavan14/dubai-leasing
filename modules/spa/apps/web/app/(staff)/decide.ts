"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enginePost } from "../../lib/engine";
import { submitDecision } from "../../lib/inbox";

const CASE_PAGE = /^\/compliance\/cases\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A decision button on an inbox card (C31, S63): `POST /api/approvals/:id/decide` as the signed-in user, with the
 * decision, a note and an outcome and nothing else (never a role or a person). The engine decides whether this user
 * may (right role, not admin, not the proposer) and answers 403 otherwise; this is never the rule. Afterwards the
 * user returns to the screen the form came from.
 */
export async function decideApproval(formData: FormData): Promise<void> {
  // The case page asks to come back to itself: only a case address of this screen is followed, never another address.
  const asked = formData.get("back");
  const caseBack = typeof asked === "string" && CASE_PAGE.test(asked) ? asked : null;
  const back = caseBack ?? (formData.get("from") === "compliance" ? "/compliance" : "/work?tab=inbox");
  const result = await submitDecision(enginePost, formData);
  if (result === "signin") redirect("/sign-in");
  if (result !== "done") redirect(`${back}${back.includes("?") ? "&" : "?"}error=${result}#inbox`);
  for (const path of ["/", "/work", "/compliance"]) revalidatePath(path);
  if (caseBack) revalidatePath(caseBack);
  redirect(`${back}#inbox`);
}
