"use server";

import { safeReturnTo } from "@spa/core/demo";
import { redirect } from "next/navigation";
import { publicEngine } from "../../lib/engine";
import { webEnv } from "../../lib/env";
import { keepSession } from "../../lib/session-cookie";

/**
 * Demo mode only (S80): a fresh demo sign-in as another fictional user, then back to the same page. Nothing is bypassed:
 * the engine issues that user's own session, and if that user can't see the page the app's normal not-allowed or
 * redirect screen answers. `returnTo` must be a same-site path; anything else goes to "/".
 */
export async function switchDemoUser(email: string, returnTo: string): Promise<void> {
  if (!webEnv().SPA_DEMO_MODE) redirect("/sign-in");
  const res = await publicEngine()
    .api.auth["demo-sign-in"].$post({ json: { email: String(email) } })
    .catch(() => null);
  if (!res?.ok) redirect("/sign-in?error=down");
  await keepSession(((await res.json()) as { token: string }).token);
  redirect(safeReturnTo(String(returnTo)));
}
