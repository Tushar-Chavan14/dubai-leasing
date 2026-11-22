import { signPortalToken, type PortalAudience } from "@platform/kernel/portal-token";
import type { Account } from "./accounts.ts";
import type { PortalEnv } from "./env.ts";

/**
 * Where "Open <module>" sends the browser: the module web app's `/auth/portal`, with a token minted now for that module
 * only (60 seconds, one use, no role). The module's engine decides whether this person has a user there.
 */
export function handoffUrl(env: PortalEnv, module: PortalAudience, account: Account, nowMs: number): string {
  const key = env.PORTAL_SIGNING_KEY;
  if (!key) throw new Error("portal sign-in is not configured");
  const base = (module === "leasing" ? env.PORTAL_LEASING_URL : env.PORTAL_SPA_URL).replace(/\/$/, "");
  const token = signPortalToken(key, { sub: account.id, email: account.email, aud: module }, nowMs);
  return `${base}/auth/portal?token=${encodeURIComponent(token)}`;
}
