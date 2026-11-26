import type { SalesRulebook } from "./types.ts";

/**
 * The first Dubai sales rulebook. 4% DLD fee, 10% minimum booking and 25% beneficial owners come from the spec;
 * every other value awaits legal or compliance confirmation (docs/spa/specs.md §11) and is pending (S36).
 */
export const dubaiSales2026_01: SalesRulebook = Object.freeze({
  version: "dubai-sales-2026-01",
  emirate: "dubai",
  effectiveFrom: "2026-01-01",
  registrationFeeBps: 400,
  registrationFeePayer: "buyer",
  oqoodAdminFeeFils: 0,
  oqoodTransferFeeFils: 0,
  trusteeFeeFils: 0,
  mortgageRegistrationBps: 0,
  mortgageRegistrationAdminFils: 0,
  minBookingBps: 1000,
  amlCashThresholdFils: 0,
  amlNameMatchThreshold: 0.85,
  beneficialOwnerBps: 2500,
  sources: Object.freeze(["docs/spa/specs.md §11 (confirm with legal and compliance)", "docs/spa/architecture.md §6"]),
  pending: Object.freeze([
    "registrationFeePayer",
    "oqoodAdminFeeFils",
    "oqoodTransferFeeFils",
    "trusteeFeeFils",
    "mortgageRegistrationBps",
    "mortgageRegistrationAdminFils",
    "amlCashThresholdFils",
    "amlNameMatchThreshold",
  ] as const),
});
