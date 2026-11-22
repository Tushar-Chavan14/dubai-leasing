import { describe, expect, test } from "bun:test";
import { settlementStatement, type SettlementInput } from "../src/index.ts";
import { confirmed } from "./helpers.ts";

const base: SettlementInput = {
  dealType: "resale_ready",
  priceFils: 200_000_000,
  depositHeldFils: 20_000_000,
  buyerLoan: null,
  sellerPayoff: null,
  commissions: [],
};
const priceLines = (r: ReturnType<typeof settlementStatement>) =>
  r.ok
    ? r.lines.filter((l) => l.code.startsWith("price:")).map((l) => [l.code, l.payer, l.payee, l.amountFils])
    : r.reasons;

describe("settlementStatement", () => {
  test("no mortgages: deposit plus the balance from the buyer make the price", () => {
    const r = settlementStatement(base, confirmed());
    expect(priceLines(r)).toEqual([
      ["price:deposit", "buyer", "seller", 20_000_000],
      ["price:balance_to_seller", "buyer", "seller", 180_000_000],
    ]);
    expect(r.ok && r.priceCheckFils).toBe(0);
    expect(r.ok && r.lines.every((l) => l.source.length > 0)).toBe(true);
  });
  test("a buyer loan pays the seller's bank first, then the seller; the buyer pays the rest", () => {
    const r = settlementStatement(
      {
        ...base,
        buyerLoan: { amountFils: 120_000_000, confirmed: true },
        sellerPayoff: { amountFils: 50_000_000, confirmed: true },
      },
      confirmed(),
    );
    expect(priceLines(r)).toEqual([
      ["price:deposit", "buyer", "seller", 20_000_000],
      ["price:seller_payoff", "bank_buyer", "bank_seller", 50_000_000],
      ["price:balance_to_seller", "bank_buyer", "seller", 70_000_000],
      ["price:balance_to_seller", "buyer", "seller", 60_000_000],
    ]);
    expect(r.ok && r.sellerReceivesFils).toBe(150_000_000);
  });
  test("fees and commissions follow, with their payers", () => {
    const r = settlementStatement(
      {
        ...base,
        commissions: [
          { payer: "seller", payee: "broker", label: "Seller's agent", amountFils: 4_000_000, source: "policy v1" },
        ],
      },
      confirmed(),
    );
    expect(
      r.ok && r.lines.filter((l) => !l.code.startsWith("price:")).map((l) => [l.code, l.payer, l.amountFils]),
    ).toEqual([
      ["fee:dld_fee", "buyer", 8_000_000],
      ["fee:trustee_fee", "buyer", 400_000],
      ["commission", "seller", 4_000_000],
    ]);
    expect(r.ok && r.sellerReceivesFils).toBe(196_000_000);
  });
  test("an unconfirmed bank amount is refused", () => {
    expect(settlementStatement({ ...base, buyerLoan: { amountFils: 1, confirmed: false } }, confirmed())).toEqual({
      ok: false,
      reasons: ["The buyer's loan amount isn't confirmed by a person."],
    });
    expect(settlementStatement({ ...base, sellerPayoff: { amountFils: 1, confirmed: false } }, confirmed()).ok).toBe(
      false,
    );
  });
  test("an underwater seller, a loan above what's owed and a deposit above the price are refused", () => {
    expect(
      settlementStatement({ ...base, sellerPayoff: { amountFils: 190_000_000, confirmed: true } }, confirmed()),
    ).toEqual({
      ok: false,
      reasons: ["The seller's bank payoff is more than the seller receives; the seller must pay the difference."],
    });
    expect(
      settlementStatement({ ...base, buyerLoan: { amountFils: 190_000_000, confirmed: true } }, confirmed()).ok,
    ).toBe(false);
    expect(settlementStatement({ ...base, depositHeldFils: 200_000_001 }, confirmed()).ok).toBe(false);
  });
  test("review #6: every amount is a non-negative whole number of fils", () => {
    const bad = [
      { ...base, depositHeldFils: 1.5 },
      { ...base, buyerLoan: { amountFils: -5, confirmed: true } },
      { ...base, sellerPayoff: { amountFils: -5, confirmed: true } },
      {
        ...base,
        commissions: [{ payer: "seller" as const, payee: "broker" as const, label: "x", amountFils: -1, source: "p" }],
      },
      {
        ...base,
        commissions: [{ payer: "seller" as const, payee: "broker" as const, label: "x", amountFils: 0.5, source: "p" }],
      },
    ];
    for (const input of bad) expect(settlementStatement(input, confirmed()).ok).toBe(false);
  });
});
