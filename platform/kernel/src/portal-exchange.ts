import { type PortalAudience, verifyPortalToken } from "./portal-token.ts";

/** Fixed-window counters kept in memory (one engine process). `nowMs` comes from the engine Clock. */
export interface ExchangeLimits {
  exchange: { ip: number; email: number };
  check: { ip: number; email: number };
  windowMs: number;
}
export const DEFAULT_EXCHANGE_LIMITS: ExchangeLimits = {
  exchange: { ip: 20, email: 10 },
  check: { ip: 120, email: 60 },
  windowMs: 60_000,
};

export interface ExchangeLimiter {
  allow(mode: "exchange" | "check", scope: "ip" | "email", key: string, nowMs: number): boolean;
}

const MAX_KEYS = 5000;

export function createExchangeLimiter(limits: ExchangeLimits = DEFAULT_EXCHANGE_LIMITS): ExchangeLimiter {
  const seen = new Map<string, { start: number; n: number }>();
  return {
    allow(mode, scope, key, nowMs) {
      if (seen.size > MAX_KEYS) for (const [k, v] of seen) if (nowMs - v.start >= limits.windowMs) seen.delete(k);
      const id = `${mode}:${scope}:${key}`;
      // A flood of distinct keys inside one window cannot grow the map without bound: past the cap, new keys are refused.
      if (!seen.has(id) && seen.size > MAX_KEYS) return false;
      const cur = seen.get(id);
      if (!cur || nowMs - cur.start >= limits.windowMs) {
        seen.set(id, { start: nowMs, n: 1 });
        return 1 <= limits[mode][scope];
      }
      cur.n += 1;
      return cur.n <= limits[mode][scope];
    },
  };
}

export interface ExchangeDeps<U> {
  /** The module's public key; unset turns portal sign-in off. */
  publicKey: string | undefined;
  audience: PortalAudience;
  /** Wall-clock milliseconds (token expiry and the limiter's windows). */
  nowMs: number;
  limiter: ExchangeLimiter;
  /** True the first time a `jti` is seen, false after. */
  takeJti(jti: string): Promise<boolean>;
  /** The module's own active user for this lower-case email, or null. Never creates one. */
  findUser(email: string): Promise<U | null>;
}

export type ExchangeResult<U> =
  | { status: 200; kind: "session"; user: U }
  | { status: 200; kind: "check"; active: boolean }
  | { status: 401 | 403 | 404 | 429; body: { error: string; code: string } };

const BODY = {
  off: { error: "not found", code: "not_found" },
  invalid: { error: "this sign-in link isn't valid", code: "unauthorised" },
  noAccount: { error: "you don't have access to this module", code: "forbidden" },
  slow: { error: "too many attempts, try again in a minute", code: "rate_limited" },
} as const;

/**
 * One decision for both engines (S70). Order: feature on, IP limit, token, email limit, then (for a real exchange) the
 * one-use `jti`, then the module's own user. The token's other claims are never read: the role comes from the user row.
 */
export async function portalExchange<U>(
  deps: ExchangeDeps<U>,
  input: { token: string; check: boolean; ip: string },
): Promise<ExchangeResult<U>> {
  if (!deps.publicKey) return { status: 404, body: BODY.off };
  const mode = input.check ? "check" : "exchange";
  if (!deps.limiter.allow(mode, "ip", input.ip, deps.nowMs)) return { status: 429, body: BODY.slow };
  const v = verifyPortalToken(deps.publicKey, input.token, deps.audience, deps.nowMs);
  if (!v.ok) return { status: 401, body: BODY.invalid };
  if (!deps.limiter.allow(mode, "email", v.claims.email, deps.nowMs)) return { status: 429, body: BODY.slow };
  if (input.check) return { status: 200, kind: "check", active: (await deps.findUser(v.claims.email)) !== null };
  // The token is spent before the user is looked up, so a refused person cannot retry the same token either.
  if (!(await deps.takeJti(v.claims.jti))) return { status: 401, body: BODY.invalid };
  const user = await deps.findUser(v.claims.email);
  return user ? { status: 200, kind: "session", user } : { status: 403, body: BODY.noAccount };
}
