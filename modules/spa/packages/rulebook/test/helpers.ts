import { dubaiSales2026_01, type SalesRulebook } from "../src/index.ts";

/** A rulebook copy with every value confirmed, for testing the arithmetic. Fictional values. */
export const confirmed = (over: Partial<SalesRulebook> = {}): SalesRulebook => ({
  ...dubaiSales2026_01,
  trusteeFeeFils: 400_000,
  oqoodTransferFeeFils: 100_000,
  mortgageRegistrationBps: 25,
  mortgageRegistrationAdminFils: 29_000,
  amlCashThresholdFils: 5_500_000,
  pending: [],
  ...over,
});
