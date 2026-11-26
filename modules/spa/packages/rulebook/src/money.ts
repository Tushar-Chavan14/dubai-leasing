/** A positive whole number of fils, safe to multiply by basis points. */
export const isPositiveFils = (n: number): boolean =>
  Number.isSafeInteger(n) && n > 0 && Number.isSafeInteger(n * 10_000);
/**
 * `amount × bps / 10000`, rounded down to a whole fil. Done in BigInt (C16) so the product never loses a fil to
 * floating point, however large the amount. Refuses anything that isn't a non-negative whole number.
 */
export function bpsOfFloor(amountFils: number, bps: number): number {
  if (!Number.isSafeInteger(amountFils) || amountFils < 0 || !Number.isSafeInteger(bps) || bps < 0)
    throw new RangeError("bpsOfFloor takes a non-negative whole number of fils and of basis points");
  const out = (BigInt(amountFils) * BigInt(bps)) / 10_000n;
  if (out > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("the result is too large for a whole number of fils");
  return Number(out);
}
