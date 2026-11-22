import { FakeScreening, type ScreeningAdapter } from "@spa/helpers";

/**
 * The screening adapter the engine registers (S50, review 3). Only demo mode gets `FakeScreening` (invented lists, labelled
 * "FICTIONAL, SIMULATED"): outside it nothing is registered, so no screening job runs, every party stays "not
 * screened" and `openAmlFlag` fails closed until C27 wraps a real provider.
 */
export function screeningAdapterFor(
  env: { SPA_DEMO_MODE: boolean },
  warn: (message: string) => void = console.warn,
): ScreeningAdapter | null {
  if (env.SPA_DEMO_MODE) return new FakeScreening();
  warn(
    "AML screening is not configured: outside demo mode no screening adapter is registered, so every party stays not screened and deals can't pass their checks.",
  );
  return null;
}
