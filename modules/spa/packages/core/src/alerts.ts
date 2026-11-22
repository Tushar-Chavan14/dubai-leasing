import { z } from "zod";
import { SpaGateId } from "./gates.ts";
import { isComplianceGate } from "./visibility.ts";
import { spaGates } from "./gates.ts";

/**
 * Staff alerts for a gate that waits too long (S30, S62). The threshold is in whole hours per gate and comes from the
 * admin's settings; these are the placeholders used until a company sets its own (confirm with the business). Past the
 * threshold the approver role is alerted, past twice the threshold the manager too.
 */
export const ALERT_DEFAULT_HOURS: Readonly<Record<SpaGateId, number>> = Object.freeze({
  seller_verification: 24,
  price_out_of_range: 24,
  kyc_review: 24,
  aml_flag: 12,
  aml_report: 12,
  template_approval: 48,
  agreement_approval: 24,
  noc_review: 24,
  settlement_approval: 24,
  oqood_submission: 24,
  transfer_submission: 24,
  cancellation: 24,
  deposit_release: 24,
  edd_signoff: 12,
  helper_review: 8,
  refund: 24,
});

/** The one key an admin sees for the three compliance gates (S42): the admin never reads which gate it is. */
export const COMPLIANCE_REVIEW_KEY = "compliance_review";
export const ALERT_THRESHOLD_KEYS = [
  ...SpaGateId.options.filter((g) => !isComplianceGate(g)),
  COMPLIANCE_REVIEW_KEY,
] as const;
/**
 * What the admin saves: `{ gate: hours }` for a non-compliance gate, or `compliance_review` for the three compliance gates
 * at once (an admin never reads which of them it is, S42). A compliance gate's own name is refused here.
 */
export const AlertThresholds = z
  .record(z.string(), z.number().int().min(1).max(720))
  .refine((r) => Object.keys(r).length > 0, "set at least one gate")
  .refine((r) => Object.keys(r).every((k) => (ALERT_THRESHOLD_KEYS as readonly string[]).includes(k)), "unknown gate");
export type AlertThresholds = z.infer<typeof AlertThresholds>;

export const ALERT_LEVELS = ["approver", "manager"] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

const hoursWord = (n: number) => `${n} ${n === 1 ? "hour" : "hours"}`;

/**
 * The words of an alert, written by code (S62): the gate label, the deal ref and the hours waited, nothing else. A
 * compliance gate is always the one generic sentence; no detail goes to any other role.
 */
export function alertText(a: { gate: string; dealRef: string | null; hours: number }): string {
  if (isComplianceGate(a.gate)) return `A compliance review has been waiting ${hoursWord(a.hours)}.`;
  const label = (spaGates as Record<string, { label: string }>)[a.gate]?.label ?? "An approval";
  return `${label}${a.dealRef ? ` for ${a.dealRef}` : ""} has been waiting ${hoursWord(a.hours)}.`;
}
