import type { DealType } from "@spa/core";
import { registrationFee } from "./fees.ts";
import { bpsOfFloor } from "./money.ts";
import { isPending, pendingReason, type RulebookField, type RuleResult, type SalesRulebook } from "./types.ts";

export interface FeeLine {
  code: "dld_fee" | "trustee_fee" | "oqood_transfer_fee" | "mortgage_registration";
  label: string;
  amountFils: number;
  payer: "buyer" | "seller";
  /** Where the amount comes from: the rulebook version and field. */
  source: string;
}

/** Transfer-day fees of a resale (architecture §6), each from the rulebook with its source. Pending values refuse. */
export function transferFees(
  input: { dealType: DealType; priceFils: number; buyerLoanFils: number },
  rb: SalesRulebook,
): RuleResult<{ lines: FeeLine[]; totalFils: number }> {
  if (input.dealType === "primary_offplan") return { ok: false, reasons: ["transfer fees apply to resales"] };
  const needs: RulebookField[] = [input.dealType === "resale_ready" ? "trusteeFeeFils" : "oqoodTransferFeeFils"];
  if (input.buyerLoanFils > 0) needs.push("mortgageRegistrationBps", "mortgageRegistrationAdminFils");
  const dld = registrationFee(input.priceFils, rb);
  const reasons = [...(dld.ok ? [] : dld.reasons), ...needs.filter((f) => isPending(rb, f)).map(pendingReason)];
  if (!dld.ok || reasons.length) return { ok: false, reasons };
  const src = (field: string) => `rulebook ${rb.version}: ${field}`;
  const lines: FeeLine[] = [];
  if (dld.buyerFils > 0)
    lines.push({
      code: "dld_fee",
      label: "DLD transfer fee",
      amountFils: dld.buyerFils,
      payer: "buyer",
      source: src("registrationFeeBps"),
    });
  if (dld.sellerFils > 0)
    lines.push({
      code: "dld_fee",
      label: "DLD transfer fee",
      amountFils: dld.sellerFils,
      payer: "seller",
      source: src("registrationFeeBps"),
    });
  if (input.dealType === "resale_ready")
    lines.push({
      code: "trustee_fee",
      label: "Trustee office fee",
      amountFils: rb.trusteeFeeFils,
      payer: "buyer",
      source: src("trusteeFeeFils"),
    });
  else
    lines.push({
      code: "oqood_transfer_fee",
      label: "Oqood transfer fee",
      amountFils: rb.oqoodTransferFeeFils,
      payer: "buyer",
      source: src("oqoodTransferFeeFils"),
    });
  if (input.buyerLoanFils > 0)
    lines.push({
      code: "mortgage_registration",
      label: "Mortgage registration",
      amountFils: bpsOfFloor(input.buyerLoanFils, rb.mortgageRegistrationBps) + rb.mortgageRegistrationAdminFils,
      payer: "buyer",
      source: src("mortgageRegistrationBps + mortgageRegistrationAdminFils"),
    });
  return { ok: true, lines, totalFils: lines.reduce((a, l) => a + l.amountFils, 0) };
}
