/** Server-side only. TENANCY_OPS: move-in through move-out is on (default off). */
export const TENANCY_OPS = process.env.TENANCY_OPS === "true" || process.env.TENANCY_OPS === "1";

const PORTAL_DEFAULT = "http://localhost:3100";
/**
 * Server-side only. `LEASING_PORTAL_URL` (in `.env`, next to the other leasing settings): where "Portal" in the avatar
 * menu goes (the module chooser, S69). Not set or not an http(s) URL: the local default.
 */
export function portalUrl(): string {
  const v = process.env.LEASING_PORTAL_URL?.trim();
  return v && /^https?:\/\/[^\s]+$/.test(v) ? v.replace(/\/$/, "") : PORTAL_DEFAULT;
}
