import { describe, expect, test } from "bun:test";
import { dubaiSales2026_01, getSalesRulebook, isPending, salesRulebookOn } from "../src/index.ts";

describe("sales rulebook registry", () => {
  test("the first version is frozen and lists every unconfirmed value", () => {
    expect(Object.isFrozen(dubaiSales2026_01)).toBe(true);
    expect([...dubaiSales2026_01.pending].toSorted() as string[]).toEqual(
      [
        "amlCashThresholdFils",
        "amlNameMatchThreshold",
        "mortgageRegistrationAdminFils",
        "mortgageRegistrationBps",
        "oqoodAdminFeeFils",
        "oqoodTransferFeeFils",
        "registrationFeePayer",
        "trusteeFeeFils",
      ].toSorted(),
    );
    expect([
      dubaiSales2026_01.registrationFeeBps,
      dubaiSales2026_01.minBookingBps,
      dubaiSales2026_01.beneficialOwnerBps,
    ]).toEqual([400, 1000, 2500]);
    expect(isPending(dubaiSales2026_01, "trusteeFeeFils")).toBe(true);
    expect(isPending(dubaiSales2026_01, "registrationFeeBps")).toBe(false);
  });
  test("lookup by version and by date; never the nearest earlier one", () => {
    expect(getSalesRulebook("dubai-sales-2026-01")).toBe(dubaiSales2026_01);
    expect(getSalesRulebook("dubai-sales-1999-01")).toBeNull();
    expect(salesRulebookOn("dubai", "2026-01-01")).toBe(dubaiSales2026_01);
    expect(salesRulebookOn("dubai", "2027-06-30")).toBe(dubaiSales2026_01);
    expect(salesRulebookOn("dubai", "2025-12-31")).toBeNull();
  });
});
