import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * The launcher's summary key (S69). True only when a key is configured and the caller sent the same one. Fixed-length
 * digests are compared in constant time, so neither the value nor its length leaks. No key configured: always false.
 */
export function portalKeyOk(given: string | undefined, configured: string | undefined): boolean {
  if (!configured || !given) return false;
  return timingSafeEqual(digest(given), digest(configured));
}
