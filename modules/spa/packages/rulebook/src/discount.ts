import { bpsOfFloor, isPositiveFils } from "./money.ts";

export type DiscountResult =
  | { ok: true; discountBps: number; discountFils: number }
  | { ok: false; discountBps: number; discountFils: number; reasons: string[] };

/**
 * A primary discount against the list price. The limit (company policy, C3) is compared in fils so it is exact;
 * out of range means the caller opens `price_out_of_range`.
 */
export function discountCheck(listPriceFils: number, agreedPriceFils: number, maxDiscountBps: number): DiscountResult {
  if (!isPositiveFils(listPriceFils) || !isPositiveFils(agreedPriceFils))
    return { ok: false, discountBps: 0, discountFils: 0, reasons: ["Prices must be positive whole numbers of fils."] };
  const discountFils = listPriceFils - agreedPriceFils;
  const discountBps = Math.floor((discountFils * 10_000) / listPriceFils);
  if (discountFils < 0)
    return { ok: false, discountBps, discountFils, reasons: ["The agreed price is above the list price."] };
  if (discountFils > bpsOfFloor(listPriceFils, maxDiscountBps))
    return {
      ok: false,
      discountBps,
      discountFils,
      reasons: [`The discount is above the allowed ${maxDiscountBps / 100}%.`],
    };
  return { ok: true, discountBps, discountFils };
}
