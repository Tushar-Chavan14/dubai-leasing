import { describe, expect, test } from "bun:test";
import { dubaiSales2026_01, transferFees } from "../src/index.ts";
import { confirmed } from "./helpers.ts";

const amounts = (r: ReturnType<typeof transferFees>) =>
  r.ok ? r.lines.map((l) => [l.code, l.amountFils, l.payer]) : r.reasons;

describe("transferFees", () => {
  test("ready resale: DLD fee and trustee fee", () => {
    const r = transferFees({ dealType: "resale_ready", priceFils: 200_000_000, buyerLoanFils: 0 }, confirmed());
    expect(amounts(r)).toEqual([
      ["dld_fee", 8_000_000, "buyer"],
      ["trustee_fee", 400_000, "buyer"],
    ]);
    expect(r.ok && r.totalFils).toBe(8_400_000);
    expect(r.ok && r.lines.every((l) => l.source.startsWith("rulebook dubai-sales-2026-01:"))).toBe(true);
  });
  test("off-plan resale: Oqood transfer fee instead of the trustee fee", () => {
    expect(
      amounts(transferFees({ dealType: "resale_offplan", priceFils: 200_000_000, buyerLoanFils: 0 }, confirmed())),
    ).toEqual([
      ["dld_fee", 8_000_000, "buyer"],
      ["oqood_transfer_fee", 100_000, "buyer"],
    ]);
  });
  test("a buyer's loan adds the mortgage registration fee", () => {
    const r = transferFees(
      { dealType: "resale_ready", priceFils: 200_000_000, buyerLoanFils: 100_000_000 },
      confirmed(),
    );
    expect(amounts(r)).toContainEqual(["mortgage_registration", 279_000, "buyer"]);
  });
  test("a split DLD fee gives one line per payer", () => {
    const r = transferFees(
      { dealType: "resale_ready", priceFils: 200_000_000, buyerLoanFils: 0 },
      confirmed({ registrationFeePayer: "split" }),
    );
    expect(amounts(r)).toEqual([
      ["dld_fee", 4_000_000, "buyer"],
      ["dld_fee", 4_000_000, "seller"],
      ["trustee_fee", 400_000, "buyer"],
    ]);
  });
  test("primary deals have no transfer; pending values are named", () => {
    expect(transferFees({ dealType: "primary_offplan", priceFils: 1, buyerLoanFils: 0 }, confirmed())).toEqual({
      ok: false,
      reasons: ["transfer fees apply to resales"],
    });
    const r = transferFees({ dealType: "resale_ready", priceFils: 200_000_000, buyerLoanFils: 0 }, dubaiSales2026_01);
    expect(r).toEqual({
      ok: false,
      reasons: ["registrationFeePayer awaits legal confirmation", "trusteeFeeFils awaits legal confirmation"],
    });
  });
});
