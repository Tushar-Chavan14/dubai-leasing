import { HttpOqoodAdapter } from "@spa/helpers";

/**
 * The registry adapter the engine registers (S53). Only demo mode talks to the simulated registry (`oqood-mock`,
 * labelled "simulated"): outside it nothing is registered, so the submission jobs wait, no number is ever issued and
 * `oqoodIssued` / `transferIssued` stay false until a real registry's adapter is wired (a later chunk).
 */
export function registryAdapterFor(
  env: { SPA_DEMO_MODE: boolean; REGISTRY_MOCK_URL: string },
  warn: (message: string) => void = console.warn,
): HttpOqoodAdapter | null {
  if (env.SPA_DEMO_MODE) return new HttpOqoodAdapter({ baseUrl: env.REGISTRY_MOCK_URL });
  warn(
    "No registry adapter is configured: outside demo mode the Oqood and trustee submission jobs don't run, so no registration number is issued.",
  );
  return null;
}
