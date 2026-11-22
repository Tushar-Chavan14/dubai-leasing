import { bpsOfFloor, isPositiveFils } from "./money.ts";
import { isPending, pendingReason, type RuleResult, type SalesRulebook } from "./types.ts";

/** DLD registration (primary) or transfer (resale) fee and who pays it, from the rulebook only. */
export function registrationFee(
  priceFils: number,
  rb: SalesRulebook,
): RuleResult<{ totalFils: number; buyerFils: number; sellerFils: number }> {
  if (!isPositiveFils(priceFils)) return { ok: false, reasons: ["The price must be a positive whole number of fils."] };
  if (isPending(rb, "registrationFeePayer")) return { ok: false, reasons: [pendingReason("registrationFeePayer")] };
  const totalFils = bpsOfFloor(priceFils, rb.registrationFeeBps);
  const sellerFils =
    rb.registrationFeePayer === "seller"
      ? totalFils
      : rb.registrationFeePayer === "split"
        ? Math.floor(totalFils / 2)
        : 0;
  return { ok: true, totalFils, buyerFils: totalFils - sellerFils, sellerFils };
}
