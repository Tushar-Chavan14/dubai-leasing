import { type Emirate, registrationStageName } from "@leasing/core";

/**
 * Display name of a Workspace stage. The registration stage's key is "Ejari" everywhere (stored data, filters); it
 * shows as the unit's own system (Tawtheeq, Attestation, …), or "Registration" where records of several emirates mix.
 */
export function stageLabel(stage: string, emirate?: Emirate): string {
  if (stage !== "Ejari") return stage;
  return emirate ? registrationStageName(emirate) : "Registration";
}
