import { createHash, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time compare of fixed-length digests, so the secret's length doesn't leak either. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * The gate for routes called by the web server only (channel relays, public listings): no secret
 * configured → 503 (routes off); wrong or missing bearer → 401; otherwise null.
 */
export function secretGate(secret: string | undefined): (c: Context) => Response | null {
  return (c) => {
    if (!secret) return c.json({ error: "channel disabled", code: "channel_disabled" }, 503);
    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ") || !sameSecret(header.slice(7), secret))
      return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    return null;
  };
}

/** The client address the web server forwards (the only `x-forwarded-for` value our web server sends); "" on a direct call. */
export const clientIp = (c: Context) => (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim();

const WINDOW_MS = 3_600_000;

/** Per-IP hourly counter (wall-clock, in memory, like the portal's limiter). True when over the limit. */
export function ipLimiter(max: number): (ip: string) => boolean {
  const hits = new Map<string, { n: number; until: number }>();
  let calls = 0;
  return (ip) => {
    ip ||= "unknown"; // no forwarded address (misconfigured proxy): all such calls share one bucket
    const now = Date.now(); // wall-clock on purpose: in-memory rate limiter, not domain time (D31)
    // Sweep expired entries now and then, so spoofed keys can't grow the map without bound.
    if (hits.size > 1000 || ++calls % 500 === 0) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    const h = hits.get(ip);
    if (!h || h.until < now) {
      hits.set(ip, { n: 1, until: now + WINDOW_MS });
      return false;
    }
    h.n++;
    return h.n > max;
  };
}
