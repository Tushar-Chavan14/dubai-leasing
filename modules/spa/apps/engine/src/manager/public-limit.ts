/**
 * A small fixed-window limiter for the public catalogue routes, by client address. In memory (one engine process), the
 * map is bounded: past the cap it is emptied, so a flood of made-up addresses can't lock real visitors out.
 */
export function createPublicLimiter(max: number, windowMs = 60_000) {
  const seen = new Map<string, { start: number; n: number }>();
  const CAP = 5000;
  return {
    allow(key: string, nowMs: number): boolean {
      if (seen.size > CAP) for (const [k, v] of seen) if (nowMs - v.start >= windowMs) seen.delete(k);
      // Still over the cap inside one window (a flood of made-up addresses): start again rather than lock real visitors out.
      if (seen.size > CAP) seen.clear();
      const cur = seen.get(key);
      if (!cur || nowMs - cur.start >= windowMs) {
        seen.set(key, { start: nowMs, n: 1 });
        return true;
      }
      cur.n += 1;
      return cur.n <= max;
    },
  };
}
