import type { CalendarDate } from "@platform/kernel/dates";
import type { DealType } from "./state/deal.ts";

/**
 * Checks of a developer NOC entered by a person against its deal (specs step 6, S13, S15, S47). Pure: no clock, no
 * database. Any code here is a blocker: the NOC goes to `noc_review` (sales admin). Money is integer fils.
 */
export type NocCode =
  | "unit_mismatch"
  | "seller_names_mismatch"
  | "expired_before_transfer"
  | "no_target_date"
  | "service_charges_not_cleared"
  | "below_minimum_paid"
  | "paid_unconfirmed";

export interface NocRecordInput {
  unitNo: string;
  sellerNames: readonly string[];
  /** The last day the NOC is valid (calendar date). */
  expiresOn: string;
  serviceChargesCleared: boolean;
  /** The amount paid to the developer, only once a person confirmed it. */
  paidFils: number | null;
  /** What the reader saw (C20): never used for a decision. */
  paidReadFils?: number | null;
}
export interface NocDealInput {
  type: DealType;
  unitNo: string | null;
  sellerNames: readonly string[];
  targetTransferOn: string | null;
  priceFils: number;
}
export interface NocRule {
  minPaidBps: number;
}

/** The project's own NOC rule, else the default (`projectCode` null). The policy schema guarantees one default. */
export function selectNocRule<R extends { projectCode: string | null }>(
  rules: readonly R[],
  projectCode: string | null,
): R {
  const own = projectCode ? rules.find((r) => r.projectCode === projectCode) : undefined;
  const found = own ?? rules.find((r) => r.projectCode === null);
  if (!found) throw new Error("the policy has no default NOC rule");
  return found;
}

/** Names compared one to one after normalising; a name with no letters or digits, or an empty list, never matches. */
function sameSellers(a: readonly string[], b: readonly string[], normalise: (s: string) => string): boolean {
  if (!a.length || a.length !== b.length) return false;
  const x = a.map(normalise).toSorted();
  const y = b.map(normalise).toSorted();
  return x.every((n, i) => n !== "" && n === y[i]);
}

export function nocChecks(
  record: NocRecordInput,
  deal: NocDealInput,
  rule: NocRule,
  today: CalendarDate,
  normalise: (s: string) => string,
): NocCode[] {
  const codes: NocCode[] = [];
  const unit = normalise(record.unitNo);
  if (!deal.unitNo || unit === "" || unit !== normalise(deal.unitNo)) codes.push("unit_mismatch");
  if (!sameSellers(record.sellerNames, deal.sellerNames, normalise)) codes.push("seller_names_mismatch");
  // An expired NOC is before any transfer that can still happen; without a target date the NOC can't be compared.
  if (record.expiresOn < today || (deal.targetTransferOn && record.expiresOn < deal.targetTransferOn))
    codes.push("expired_before_transfer");
  if (!deal.targetTransferOn) codes.push("no_target_date");
  if (!record.serviceChargesCleared) codes.push("service_charges_not_cleared");
  if (deal.type === "resale_offplan") {
    if (record.paidFils === null) codes.push("paid_unconfirmed");
    // paid / price >= minPaidBps / 10000, cross-multiplied: no rounding.
    else if (record.paidFils * 10_000 < deal.priceFils * rule.minPaidBps) codes.push("below_minimum_paid");
  }
  return codes;
}
