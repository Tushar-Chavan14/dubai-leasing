import { dubaiSales2026_01 } from "./dubai-2026-01.ts";
import type { SalesRulebook, SpaEmirate } from "./types.ts";

const ALL: readonly SalesRulebook[] = Object.freeze([dubaiSales2026_01]);

export const getSalesRulebook = (version: string): SalesRulebook | null =>
  ALL.find((r) => r.version === version) ?? null;

/** The version in force on a date: the latest that started on or before it; null before the first one. */
export function salesRulebookOn(emirate: SpaEmirate, on: string): SalesRulebook | null {
  const fit = ALL.filter((r) => r.emirate === emirate && r.effectiveFrom <= on);
  return fit.toSorted((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
}
