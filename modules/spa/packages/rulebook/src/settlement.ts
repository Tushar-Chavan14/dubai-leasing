import { isPositiveFils } from "./money.ts";
import { transferFees } from "./transfer.ts";
import type { RuleResult, SalesRulebook } from "./types.ts";

type Side = "buyer" | "seller" | "bank_buyer" | "bank_seller";
export interface StatementLine {
  /** `price:*` lines add up to the price; then `fee:*` and `commission`. */
  code: string;
  payer: Side;
  payee: Side | "dld" | "trustee" | "broker" | "developer";
  label: string;
  amountFils: number;
  source: string;
}
export interface SettlementInput {
  dealType: "resale_ready" | "resale_offplan";
  priceFils: number;
  /** The security deposit cheque held by the brokerage, handed to the seller on transfer (S18). */
  depositHeldFils: number;
  buyerLoan: { amountFils: number; confirmed: boolean } | null;
  sellerPayoff: { amountFils: number; confirmed: boolean } | null;
  commissions: { payer: "buyer" | "seller"; payee: "broker"; label: string; amountFils: number; source: string }[];
}

/**
 * Who pays whom on transfer day (specs step 8). Price lines add up exactly to the price; the buyer's loan pays the
 * seller's bank first, then the seller; the buyer pays the rest. Never uses an unconfirmed bank amount.
 */
export function settlementStatement(
  input: SettlementInput,
  rb: SalesRulebook,
): RuleResult<{ lines: StatementLine[]; priceCheckFils: number; buyerPaysFils: number; sellerReceivesFils: number }> {
  const reasons: string[] = [];
  if (!isPositiveFils(input.priceFils)) reasons.push("The price must be a positive whole number of fils.");
  if (input.buyerLoan && !input.buyerLoan.confirmed)
    reasons.push("The buyer's loan amount isn't confirmed by a person.");
  if (input.sellerPayoff && !input.sellerPayoff.confirmed)
    reasons.push("The seller's bank payoff isn't confirmed by a person.");
  // Every amount a non-negative whole number of fils (review #6).
  const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!whole(input.depositHeldFils)) reasons.push("The deposit must be a whole number of fils.");
  if (input.buyerLoan && !whole(input.buyerLoan.amountFils)) reasons.push("The loan must be a whole number of fils.");
  if (input.sellerPayoff && !whole(input.sellerPayoff.amountFils))
    reasons.push("The payoff must be a whole number of fils.");
  if (input.commissions.some((c) => !whole(c.amountFils))) reasons.push("Commissions must be whole numbers of fils.");
  if (reasons.length) return { ok: false, reasons };
  const deposit = input.depositHeldFils;
  const loan = input.buyerLoan?.amountFils ?? 0;
  const payoff = input.sellerPayoff?.amountFils ?? 0;
  const owed = input.priceFils - deposit;
  if (deposit < 0 || deposit > input.priceFils) reasons.push("The deposit can't be more than the price.");
  else {
    if (payoff > owed)
      reasons.push("The seller's bank payoff is more than the seller receives; the seller must pay the difference.");
    if (loan > owed) reasons.push("The buyer's loan is more than the buyer still owes.");
  }
  const fees = transferFees({ dealType: input.dealType, priceFils: input.priceFils, buyerLoanFils: loan }, rb);
  if (!fees.ok) reasons.push(...fees.reasons);
  if (reasons.length || !fees.ok) return { ok: false, reasons };

  const lines: StatementLine[] = [];
  const add = (l: StatementLine) => l.amountFils > 0 && lines.push(l);
  add({
    code: "price:deposit",
    payer: "buyer",
    payee: "seller",
    label: "Security deposit",
    amountFils: deposit,
    source: "deal: deposit held",
  });
  let loanLeft = loan;
  const fund = (code: string, payee: Side, label: string, amount: number, source: string) => {
    const byBank = Math.min(loanLeft, amount);
    loanLeft -= byBank;
    add({ code, payer: "bank_buyer", payee, label, amountFils: byBank, source: "confirmed letter: buyer's loan" });
    add({ code, payer: "buyer", payee, label, amountFils: amount - byBank, source });
  };
  fund("price:seller_payoff", "bank_seller", "Seller's mortgage payoff", payoff, "confirmed letter: seller's payoff");
  fund("price:balance_to_seller", "seller", "Balance to the seller", owed - payoff, "deal: price");
  for (const f of fees.lines)
    add({
      code: `fee:${f.code}`,
      payer: f.payer,
      payee: f.code === "trustee_fee" ? "trustee" : "dld",
      label: f.label,
      amountFils: f.amountFils,
      source: f.source,
    });
  for (const c of input.commissions) add({ code: "commission", ...c });

  const priceCheckFils =
    input.priceFils - lines.filter((l) => l.code.startsWith("price:")).reduce((a, l) => a + l.amountFils, 0);
  if (priceCheckFils !== 0) return { ok: false, reasons: ["The price lines don't add up to the price."] };
  const paidBy = (who: Side) =>
    lines.filter((l) => l.payer === who && !l.code.startsWith("price:")).reduce((a, l) => a + l.amountFils, 0);
  const sellerGets = lines.filter((l) => l.payee === "seller").reduce((a, l) => a + l.amountFils, 0);
  const buyerPrice = lines
    .filter((l) => l.code.startsWith("price:") && l.payer === "buyer")
    .reduce((a, l) => a + l.amountFils, 0);
  return {
    ok: true,
    lines,
    priceCheckFils,
    buyerPaysFils: buyerPrice + paidBy("buyer"),
    sellerReceivesFils: sellerGets - paidBy("seller"),
  };
}
