import type { CalendarDate } from "@leasing/core";
import { dubai2025_01 } from "./dubai/2025-01.ts";
import { deepEqual } from "./schema.ts";
import type { Rulebook } from "./types.ts";

export * from "./rules.ts";
export * from "./schema.ts";
export type * from "./types.ts";
export { dubai2025_01 };

/** Versions defined in code: the base every stored version starts from (decision D23). */
export const baseRulebooks: readonly Rulebook[] = Object.freeze([dubai2025_01]);

/**
 * Published versions known to this process, in registration order. The engine loads published
 * rows from `rulebooks` at startup and after each publish. A published version never changes,
 * so every lookup stays synchronous.
 */
const registry = new Map<string, Rulebook>();

/** Back to the code versions only (engine startup and test setup, before loading the database). */
export function resetRulebookRegistry(): void {
  registry.clear();
  for (const r of baseRulebooks) registry.set(r.version, r);
}
resetRulebookRegistry();

/**
 * Adds a published version. Registering the same content again is a no-op; a different content
 * under an existing version is refused, because leases pinned to it must never see it change.
 */
export function registerRulebook(r: Rulebook): void {
  const existing = registry.get(r.version);
  if (existing) {
    if (!deepEqual(existing, r)) throw new Error(`rulebook ${r.version} is already registered with different content`);
    return;
  }
  registry.set(r.version, r);
}

/** Every registered (published) version, in registration order. */
export function rulebookVersions(): string[] {
  return [...registry.keys()];
}

/** Every lease stores its `rulesVersion`; always look rules up by that version. */
export function getRulebook(version: string): Rulebook {
  const r = registry.get(version);
  if (!r) throw new Error(`unknown rulebook version: ${version}`);
  return r;
}

/**
 * The version new leases get on `today`: the registered version with the latest
 * `effectiveFrom` on or before today (a tie goes to the one registered last). Null if none.
 */
export function activeRulesVersion(today: CalendarDate, emirate: Rulebook["emirate"] = "dubai"): string | null {
  let best: Rulebook | null = null;
  for (const r of registry.values()) {
    if (r.emirate !== emirate || r.effectiveFrom > today) continue;
    if (!best || r.effectiveFrom >= best.effectiveFrom) best = r;
  }
  return best?.version ?? null;
}

/**
 * The version a lease term is pinned to: the version in force on the day the term starts (new,
 * imported and renewed terms alike). A term starting before every registered version (an old
 * imported lease) gets the earliest code base version.
 */
export function rulesVersionForTerm(startOn: CalendarDate, emirate: Rulebook["emirate"] = "dubai"): string {
  const active = activeRulesVersion(startOn, emirate);
  if (active) return active;
  const base = baseRulebooks
    .filter((r) => r.emirate === emirate)
    .toSorted((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  if (!base) throw new Error(`no base rulebook for ${emirate}`);
  return base.version;
}
