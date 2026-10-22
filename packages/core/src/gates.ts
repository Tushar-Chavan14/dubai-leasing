import { z } from "zod";
import type { StaffRole } from "./roles.ts";

/**
 * Human gates (docs/specs.md §6). The Manager creates an `approvals` row and pauses; only a
 * person in the inbox UI decides. Nothing — helper, job or copilot — can approve.
 */
export const GateId = z.enum([
  "price_out_of_range",
  "offer_out_of_limits",
  "final_contract",
  "ejari_submission",
  "formal_reminder",
  "renewal_notice",
  "vacate_notice",
  "refund",
  "kyc_review",
  "ejari_rejected_twice",
  "safety_complaint",
]);
export type GateId = z.infer<typeof GateId>;

export interface GateDefinition {
  id: GateId;
  label: string;
  when: "always" | "conditional";
  approver: StaffRole;
}

export const approvalGates: Readonly<Record<GateId, GateDefinition>> = Object.freeze({
  price_out_of_range: {
    id: "price_out_of_range",
    label: "Asking rent outside company range",
    when: "conditional",
    approver: "leasing_manager",
  },
  offer_out_of_limits: {
    id: "offer_out_of_limits",
    label: "Offer term outside limits",
    when: "conditional",
    approver: "leasing_manager",
  },
  final_contract: { id: "final_contract", label: "Final contract", when: "always", approver: "leasing_officer" },
  ejari_submission: { id: "ejari_submission", label: "Ejari submission", when: "always", approver: "leasing_officer" },
  formal_reminder: {
    id: "formal_reminder",
    label: "Formal late-payment reminder",
    when: "always",
    approver: "leasing_manager",
  },
  renewal_notice: {
    id: "renewal_notice",
    label: "Rent-increase / renewal notice",
    when: "always",
    approver: "leasing_manager",
  },
  vacate_notice: { id: "vacate_notice", label: "Vacate notice", when: "always", approver: "leasing_manager" },
  refund: { id: "refund", label: "Refund above threshold or disputed", when: "conditional", approver: "finance" },
  kyc_review: {
    id: "kyc_review",
    label: "KYC unclear, expired or mismatched",
    when: "conditional",
    approver: "leasing_officer",
  },
  ejari_rejected_twice: {
    id: "ejari_rejected_twice",
    label: "Ejari rejected twice",
    when: "conditional",
    approver: "leasing_officer",
  },
  safety_complaint: {
    id: "safety_complaint",
    label: "Safety or legal-threat complaint",
    when: "conditional",
    approver: "leasing_officer",
  },
});

/**
 * Who may decide a gate. The named approver, or a leasing manager for leasing-officer gates.
 * Admin configures the system but does not approve gates.
 */
export function canDecideGate(gate: GateId, role: StaffRole): boolean {
  const approver = approvalGates[gate].approver;
  return role === approver || (approver === "leasing_officer" && role === "leasing_manager");
}

/** `cancelled`: the lease left the path the proposal was for (e.g. tenant moved out); nobody decided it. */
export const ApprovalStatus = z.enum(["pending", "approved", "rejected", "edited", "cancelled"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), note: z.string().max(2000).optional() }),
  z.object({ decision: z.literal("reject"), note: z.string().min(1).max(2000) }),
  z.object({
    decision: z.literal("edit"),
    note: z.string().max(2000).optional(),
    proposal: z.record(z.string(), z.unknown()),
  }),
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
