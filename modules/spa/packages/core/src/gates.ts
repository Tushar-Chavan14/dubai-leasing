import { defineGates, type GateDefinition } from "@platform/kernel/gates";
import { z } from "zod";
import { rolesOf, type SpaRole } from "./roles.ts";

/**
 * SPA human gates (architecture §5, S3, S13, S20, S22). The manager creates a `spa_approvals` row and pauses; only a
 * person with the gate's role decides. Nobody approves their own proposal; admin approves nothing.
 */
export const SpaGateId = z.enum([
  "seller_verification",
  "price_out_of_range",
  "kyc_review",
  "aml_flag",
  "aml_report",
  "template_approval",
  "agreement_approval",
  "noc_review",
  "settlement_approval",
  "oqood_submission",
  "transfer_submission",
  "cancellation",
  "deposit_release",
  "edd_signoff",
  "helper_review",
  "refund",
]);
export type SpaGateId = z.infer<typeof SpaGateId>;

const gate = (
  id: SpaGateId,
  label: string,
  approver: SpaRole,
  when: "always" | "conditional" = "conditional",
): GateDefinition<SpaGateId, SpaRole> => ({ id, label, when, approver });

const set = defineGates<SpaGateId, SpaRole>(
  {
    seller_verification: gate("seller_verification", "Ownership, co-owner or signatory mismatch", "sales_manager"),
    price_out_of_range: gate("price_out_of_range", "Price or discount outside policy", "sales_manager"),
    kyc_review: gate("kyc_review", "Document unreadable, expired or names don't match", "sales_manager"),
    aml_flag: gate("aml_flag", "Warning sign on a party", "compliance_officer"),
    aml_report: gate("aml_report", "Report to the FIU", "mlro"),
    template_approval: gate("template_approval", "New template version", "legal", "always"),
    agreement_approval: gate("agreement_approval", "Prepared agreement", "legal", "always"),
    noc_review: gate("noc_review", "NOC mismatch or expiring", "sales_admin"),
    settlement_approval: gate("settlement_approval", "Settlement statement", "finance", "always"),
    oqood_submission: gate("oqood_submission", "Oqood registration", "sales_admin", "always"),
    transfer_submission: gate("transfer_submission", "Resale transfer", "sales_admin", "always"),
    cancellation: gate("cancellation", "Cancel a deal", "sales_manager"),
    deposit_release: gate("deposit_release", "Deposit cheque on a cancelled resale", "sales_manager"),
    edd_signoff: gate("edd_signoff", "High risk: enhanced due diligence", "compliance_officer"),
    helper_review: gate("helper_review", "Helper result in review mode", "sales_officer"),
    refund: gate("refund", "Refund", "finance", "always"),
  },
  // helper_review: a sales manager may stand in for the sales officer (S22). No other stand-ins.
  { standIn: { sales_officer: ["sales_manager"] } },
);
/** `helper_review` is the only gate where the stand-in applies. */
const STAND_IN_GATES: ReadonlySet<SpaGateId> = new Set(["helper_review"]);

export const spaGates = set.gates;

/** Who may decide a gate: its approver (and a sales manager for `helper_review`). Admin decides none. */
export function canDecideSpaGate(g: SpaGateId, role: SpaRole): boolean {
  if (role === "admin") return false;
  return STAND_IN_GATES.has(g) ? set.canDecide(g, role) : spaGates[g].approver === role;
}

export const SpaApprovalStatus = z.enum(["pending", "approved", "rejected", "edited", "cancelled"]);
export type SpaApprovalStatus = z.infer<typeof SpaApprovalStatus>;

export const AmlOutcome = z.enum(["clear", "more_info", "stop", "stop_and_report"]);
export type AmlOutcome = z.infer<typeof AmlOutcome>;

const note = z.string().trim().min(1).max(2000);
export const SpaApprovalDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), note: note.optional() }),
  z.object({ decision: z.literal("reject"), note }),
  z.object({ decision: z.literal("edit"), note: note.optional(), proposal: z.record(z.string(), z.unknown()) }),
  z
    .object({ decision: z.literal("aml"), outcome: AmlOutcome, note: note.optional() })
    .refine((d) => d.outcome === "clear" || !!d.note, { message: "say why", path: ["note"] }),
]);
export type SpaApprovalDecision = z.infer<typeof SpaApprovalDecision>;

/** Parses a decision for a gate: `aml` only (and always) for `aml_flag`. Throws on anything else. */
export function parseDecisionFor(g: SpaGateId, input: unknown): SpaApprovalDecision {
  const d = SpaApprovalDecision.parse(input);
  if ((g === "aml_flag") !== (d.decision === "aml"))
    throw new Error(g === "aml_flag" ? "aml_flag is decided with an AML outcome" : `${g} takes no AML outcome`);
  return d;
}

/**
 * Whether this user may decide this approval: any of their roles is the gate's approver (an admin alone decides
 * nothing), and it is not their own proposal. A user may hold several roles (S83), each checked on its own.
 */
export function mayDecide(
  approval: { gate: SpaGateId; proposedBy: string },
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): { ok: true } | { ok: false; reason: string } {
  const roles = rolesOf(user);
  if (roles.every((r) => r === "admin")) return { ok: false, reason: "admin approves nothing" };
  if (!roles.some((r) => canDecideSpaGate(approval.gate, r)))
    return { ok: false, reason: `only ${spaGates[approval.gate].approver} decides ${approval.gate}` };
  if (approval.proposedBy === `user:${user.id}` || approval.proposedBy === `copilot:${user.id}`)
    return { ok: false, reason: "you can't approve your own proposal" };
  return { ok: true };
}
