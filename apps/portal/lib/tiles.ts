import { z } from "zod";
import type { Access } from "./access.ts";
import type { PortalEnv } from "./env.ts";

/** What an engine's `GET /summary` may say (S69): two integers. Anything else is treated as "not available". */
const Summary = z.object({ openWork: z.number().int().min(0), waitingApprovals: z.number().int().min(0) }).strict();
export type Counts = z.infer<typeof Summary>;

/** `hidden`: counts are off. `unavailable`: the engine is down, the key is wrong or the answer is odd. */
export type TileCounts = { state: "hidden" } | { state: "unavailable" } | { state: "shown"; counts: Counts };
export interface Tile {
  key: "leasing" | "spa";
  name: string;
  href: string;
  counts: TileCounts;
}
export type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

/** How long the page waits for one engine. Wall-clock on purpose: a network timeout is not a legal date. */
const WAIT_MS = 2000;

export async function readCounts(engineUrl: string, key: string | undefined, fetcher: Fetcher): Promise<TileCounts> {
  if (!key) return { state: "unavailable" };
  try {
    const res = await fetcher(`${engineUrl.replace(/\/$/, "")}/summary`, {
      headers: { "x-portal-key": key },
      signal: AbortSignal.timeout(WAIT_MS),
    });
    if (!res.ok) return { state: "unavailable" };
    const parsed = Summary.safeParse(await res.json());
    return parsed.success ? { state: "shown", counts: parsed.data } : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

/** The two tiles. Without PORTAL_SHOW_COUNTS no engine is called at all. A failing engine never throws. */
export async function loadTiles(env: PortalEnv, fetcher: Fetcher = fetch): Promise<Tile[]> {
  const counts = (engineUrl: string): Promise<TileCounts> =>
    env.PORTAL_SHOW_COUNTS
      ? readCounts(engineUrl, env.PORTAL_SUMMARY_KEY, fetcher)
      : Promise.resolve({ state: "hidden" });
  const [leasing, spa] = await Promise.all([counts(env.PORTAL_LEASING_ENGINE_URL), counts(env.PORTAL_SPA_ENGINE_URL)]);
  return [
    { key: "leasing", name: "Leasing", href: env.PORTAL_LEASING_URL, counts: leasing },
    { key: "spa", name: "Sales (SPA)", href: env.PORTAL_SPA_URL, counts: spa },
  ];
}

/**
 * The signed-in page (S70, amends S69): a tile only for a module whose engine said this email has an active user,
 * and counts only on those tiles (read with the summary key; none without one). Tiles link through `/go/<module>`.
 */
export async function loadSignedInTiles(env: PortalEnv, access: Access, fetcher: Fetcher = fetch): Promise<Tile[]> {
  const one = async (key: Tile["key"], name: string, engineUrl: string): Promise<Tile | null> =>
    access[key]
      ? {
          key,
          name,
          href: `/go/${key}`,
          counts: env.PORTAL_SUMMARY_KEY
            ? await readCounts(engineUrl, env.PORTAL_SUMMARY_KEY, fetcher)
            : { state: "hidden" },
        }
      : null;
  const tiles = await Promise.all([
    one("leasing", "Leasing", env.PORTAL_LEASING_ENGINE_URL),
    one("spa", "Sales (SPA)", env.PORTAL_SPA_ENGINE_URL),
  ]);
  return tiles.filter((t): t is Tile => t !== null);
}
