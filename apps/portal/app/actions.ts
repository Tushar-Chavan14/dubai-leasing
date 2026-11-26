"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { portalEnv } from "../lib/env";
import { clientIp, store } from "../lib/server";
import { clearPortalSession, issuePortalSession, PORTAL_COOKIE, PORTAL_SESSION_HOURS } from "../lib/session";
import { signInLimiter, signInWith } from "../lib/sign-in";

export async function signIn(formData: FormData) {
  const env = portalEnv();
  if (!env.PORTAL_SESSION_SECRET) redirect("/");
  const now = Date.now();
  const r = await signInWith(store(), signInLimiter, {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    ip: await clientIp(),
    nowMs: now,
  }).catch(() => null);
  if (!r) redirect("/sign-in?error=down");
  if (!r.ok) redirect(`/sign-in?error=${r.reason}`);
  (await cookies()).set(PORTAL_COOKIE, issuePortalSession(env.PORTAL_SESSION_SECRET, r.account.id, now), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: PORTAL_SESSION_HOURS * 3600,
    secure: env.PORTAL_SECURE_COOKIE,
  });
  redirect("/");
}

/** Clears the portal cookie only: a module's own session (spa_session, leasing_session) is not touched. */
export async function signOut() {
  clearPortalSession(await cookies());
  redirect("/sign-in");
}
