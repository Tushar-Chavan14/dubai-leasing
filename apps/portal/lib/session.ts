import { issueToken, verifyToken } from "@platform/kernel/session-token";

/** The portal's own cookie. The modules keep `spa_session` and `leasing_session`; signing out here clears only this one. */
export const PORTAL_COOKIE = "portal_session";
export const PORTAL_SESSION_HOURS = 12;

export interface CookieJar {
  delete(name: string): unknown;
}

export const issuePortalSession = (secret: string, accountId: string, nowMs: number): string =>
  issueToken(secret, accountId, nowMs, PORTAL_SESSION_HOURS);
/** The account id, or null: wrong secret (a module's session never works here), malformed or expired. */
export const readPortalSession = (secret: string, token: string | undefined, nowMs: number): string | null =>
  token ? verifyToken(secret, token, nowMs) : null;

/** Signing out of the portal clears the portal cookie and nothing else. */
export function clearPortalSession(jar: CookieJar): void {
  jar.delete(PORTAL_COOKIE);
}
