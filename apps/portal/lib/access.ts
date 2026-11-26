import { signPortalToken, type PortalAudience } from "@platform/kernel/portal-token";
import { z } from "zod";
import type { Account } from "./accounts.ts";
import type { PortalEnv } from "./env.ts";

export type PostFetcher = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;
export type Access = Record<PortalAudience, boolean>;

const Answer = z.object({ active: z.boolean() }).strict();
/** How long the page waits for one engine. Wall-clock on purpose: a network timeout is not a legal date. */
const WAIT_MS = 2000;
const engineUrl = (env: PortalEnv, m: PortalAudience) =>
  (m === "leasing" ? env.PORTAL_LEASING_ENGINE_URL : env.PORTAL_SPA_ENGINE_URL).replace(/\/$/, "");

/**
 * Asks each engine whether the signed-in email has an active user there (`?check=1`: no session is issued, no token is
 * spent). Only an exact `{ active: true }` counts; a down engine, a refusal or an odd answer is "no access" (S70).
 */
export async function checkAccess(
  env: PortalEnv,
  account: Account,
  fetcher: PostFetcher,
  nowMs: number,
): Promise<Access> {
  const key = env.PORTAL_SIGNING_KEY;
  if (!key) return { leasing: false, spa: false };
  const ask = async (aud: PortalAudience): Promise<boolean> => {
    try {
      const res = await fetcher(`${engineUrl(env, aud)}/api/auth/portal-exchange?check=1`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-client-ip": "portal" },
        body: JSON.stringify({ token: signPortalToken(key, { sub: account.id, email: account.email, aud }, nowMs) }),
        signal: AbortSignal.timeout(WAIT_MS),
      });
      const parsed = res.ok ? Answer.safeParse(await res.json()) : null;
      return parsed?.success === true && parsed.data.active;
    } catch {
      return false;
    }
  };
  const [leasing, spa] = await Promise.all([ask("leasing"), ask("spa")]);
  return { leasing, spa };
}
