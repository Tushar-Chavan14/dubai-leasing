import type { PaymentPlan } from "@spa/core";
import { bpsOfFloor, isPositiveFils } from "./money.ts";
import type { RuleResult, SalesRulebook } from "./types.ts";

const pct = (bps: number) => `${bps / 100}%`;

/**
 * Instalment amounts for a plan, in fils, adding up exactly to the price (the rounding remainder goes to the last
 * instalment). A primary deal's first instalment is the booking: at least the rulebook's minimum.
 */
export function validatePlan(
  plan: PaymentPlan,
  priceFils: number,
  rb: SalesRulebook,
  opts: { primary: boolean },
): RuleResult<{ amountsFils: number[] }> {
  const reasons: string[] = [];
  if (!isPositiveFils(priceFils)) reasons.push("The price must be a positive whole number of fils.");
  const shares = plan.instalments.map((i) => i.shareBps);
  if (!shares.length || shares.reduce((a, b) => a + b, 0) !== 10_000) reasons.push("Plan shares must add up to 100%.");
  const booking = shares[0] ?? 0;
  if (opts.primary && booking < rb.minBookingBps)
    reasons.push(`The booking (${pct(booking)}) is below the minimum (${pct(rb.minBookingBps)}).`);
  if (reasons.length) return { ok: false, reasons };
  const amountsFils = shares.map((s) => bpsOfFloor(priceFils, s));
  amountsFils[amountsFils.length - 1]! += priceFils - amountsFils.reduce((a, b) => a + b, 0);
  return { ok: true, amountsFils };
}
