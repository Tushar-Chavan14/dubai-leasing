import { z } from "zod";
import type { CompanyPolicy } from "./policy.ts";

export const PropertyCategory = z.enum(["residential", "commercial", "retail"]);
export type PropertyCategory = z.infer<typeof PropertyCategory>;

export const PropertySubtype = z.enum([
  "apartment",
  "villa",
  "townhouse",
  "penthouse",
  "office",
  "shop",
  "showroom",
  "warehouse",
]);
export type PropertySubtype = z.infer<typeof PropertySubtype>;

export const SUBTYPES_BY_CATEGORY: Record<PropertyCategory, PropertySubtype[]> = {
  residential: ["apartment", "villa", "townhouse", "penthouse"],
  commercial: ["office", "warehouse"],
  retail: ["shop", "showroom"],
};

/** Retail is commercial for Ejari, the contract and the rulebook own-use lock. */
export function propertyUsageFor(category: PropertyCategory): "residential" | "commercial" {
  return category === "residential" ? "residential" : "commercial";
}

/** Asking-rent limits from the rulebook: a band around the SRI average, optional AED bounds. */
export interface RentRuleBounds {
  /** Basis points relative to the SRI average (-500 = 5% below). */
  minPctBp: number;
  maxPctBp: number;
  minRentFils: number | null;
  maxRentFils: number | null;
}

/** Smart Rental Index average for the unit's area and type. */
export interface SriBasis {
  avgAnnualRentFils: number | null;
  avgAnnualRentPerSqftFils: number | null;
  label: string;
}

export interface PriceRange {
  min: number;
  max: number;
  basis: {
    sriFils: number | null;
    bandMin: number | null;
    bandMax: number | null;
    aedMin: number | null;
    aedMax: number | null;
  };
}

/**
 * Allowed annual asking rent (fils). Band = SRI × (1 + bp), rounded toward the narrower range,
 * intersected with the rule's AED bounds. Null when no rule, no limit applies, or the limits don't overlap.
 */
export function allowedAskingRange(
  unit: { category: PropertyCategory; areaSqft: number | null },
  sri: SriBasis | null,
  rule: RentRuleBounds | null,
): PriceRange | null {
  if (!rule) return null;
  let sriFils: number | null = null;
  if (sri) {
    if (unit.category === "residential") sriFils = sri.avgAnnualRentFils;
    else if (sri.avgAnnualRentPerSqftFils !== null && unit.areaSqft !== null && unit.areaSqft > 0) {
      sriFils = Math.round(sri.avgAnnualRentPerSqftFils * unit.areaSqft);
    }
  }
  const bandMin = sriFils === null ? null : Math.ceil((sriFils * (10_000 + rule.minPctBp)) / 10_000);
  const bandMax = sriFils === null ? null : Math.floor((sriFils * (10_000 + rule.maxPctBp)) / 10_000);
  const { minRentFils: aedMin, maxRentFils: aedMax } = rule;
  if (bandMin === null && aedMin === null && aedMax === null) return null;
  const min = Math.max(bandMin ?? 0, aedMin ?? 0);
  const max = Math.min(bandMax ?? Number.MAX_SAFE_INTEGER, aedMax ?? Number.MAX_SAFE_INTEGER);
  if (min > max) return null;
  return { min, max, basis: { sriFils, bandMin, bandMax, aedMin, aedMax } };
}

export function askingRentWithinRange(unit: { askingRentFils: number | null }, range: PriceRange | null): boolean {
  if (unit.askingRentFils === null || !range) return false;
  return unit.askingRentFils >= range.min && unit.askingRentFils <= range.max;
}

/** Cheque-count limits from the contract rule for the property usage. */
export interface ContractRuleLimits {
  minCheques: number;
  maxCheques: number;
}

export function applyContractRule(policy: CompanyPolicy, rule: ContractRuleLimits | null): CompanyPolicy {
  if (!rule) return policy;
  return {
    ...policy,
    minCheques: rule.minCheques,
    maxCheques: rule.maxCheques,
    offerDefaultCheques: Math.min(rule.maxCheques, Math.max(rule.minCheques, policy.offerDefaultCheques)),
  };
}
