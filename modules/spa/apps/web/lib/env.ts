import { loadSpaEnv, type SpaEnv } from "@spa/core/env";

/** `.env.spa.local`, read once per server process (S25). Server code only: it never reaches the browser. */
let cached: SpaEnv | null = null;
export function webEnv(): SpaEnv {
  cached ??= loadSpaEnv();
  return cached;
}

export const engineUrl = (): string => `http://127.0.0.1:${webEnv().SPA_ENGINE_PORT}`;
export const sessionCookie = (): string => webEnv().SPA_SESSION_COOKIE;
