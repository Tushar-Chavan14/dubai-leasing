import { dealMachine, type DealState, listingMachine, unitMachine } from "./state/index.ts";
import type { SpaGateId } from "./gates.ts";
import type { SpaRole } from "./roles.ts";

/** One role, or every role a user holds (M5c, S83): read-side rules take either and apply to any of them. */
export type RoleSet = SpaRole | readonly SpaRole[];
const listOf = (r: RoleSet): readonly SpaRole[] => (typeof r === "string" ? [r] : r);
import { type StepKey, stepsFor } from "./steps.ts";

/**
 * Who may see compliance matters (S6, S42, S50, S57). Two roles, and admin is not one: admin configures the product but
 * never reads a case, a screening or a risk detail. Everyone else sees only a neutral "Compliance review".
 */
export const COMPLIANCE_ROLES: readonly SpaRole[] = Object.freeze(["compliance_officer", "mlro"] as SpaRole[]);
export const isComplianceRole = (role: RoleSet): boolean => listOf(role).some((r) => COMPLIANCE_ROLES.includes(r));

/** Gates whose existence stays off every other role's screens (S42, tipping-off). */
export const COMPLIANCE_GATES: ReadonlySet<SpaGateId> = new Set<SpaGateId>(["edd_signoff", "aml_flag", "aml_report"]);
export const isComplianceGate = (gate: string): boolean => COMPLIANCE_GATES.has(gate as SpaGateId);
/** The gate name any role may see: the three compliance gates all read "compliance_review". */
export const neutralGate = (gate: string): string => (isComplianceGate(gate) ? "compliance_review" : gate);

/** The deal machine's AML moves are written to the timeline as `COMPLIANCE_REVIEW_RECORDED`, never under these names. */
const AML_MOVE_NAMES = new Set<string>(["AML_FLAGGED", "AML_CLEARED", "AML_STOPPED"]);
const machineEvents = [...dealMachine.events, ...unitMachine.events, ...listingMachine.events] as string[];

/**
 * Every event type the engine appends, split in two (S57). A test scans the engine source for each appended `type` and
 * fails on one that is in neither set, so a new event is classified on purpose. Not in `STAFF_EVENTS` means hidden from
 * every non-compliance role (fail closed).
 */
export const STAFF_EVENTS: ReadonlySet<string> = new Set([
  // Unit, project and listing records (M2, M3) and leads and viewings (M5, S79): none carries a compliance fact.
  "APPROVAL_WITHDRAWN",
  "LEAD_CREATED",
  "LEAD_MESSAGE",
  "LEAD_STATUS",
  "LISTING_DOCUMENT_UPLOADED",
  "LISTING_UPDATED",
  "MEDIA_ADDED",
  "MEDIA_CAPTIONED",
  "MEDIA_REMOVED",
  "MEDIA_REORDERED",
  "PROJECT_UPDATED",
  "UNIT_UPDATED",
  "VIEWING_ATTENDED",
  "VIEWING_BOOKED",
  "VIEWING_CANCELLED",
  "VIEWING_NO_SHOW",
  "AGREEMENT_PREPARED",
  "ALERT_SETTINGS_SET",
  "AGREEMENT_REVIEWED",
  "AGREEMENT_SIGNED",
  "AGREEMENT_SUPERSEDED",
  "APPROVAL_DECIDED",
  "APPROVAL_PROPOSED",
  "BANK_AMOUNT_CONFIRMED",
  "BANK_LETTER_RECORDED",
  "BENEFICIAL_OWNER_ADDED",
  "BROKER_SET",
  "BUILDING_ADDED",
  "CHASE_PAUSED",
  "CHASE_RESUMED",
  "CHASE_SENT",
  "CHASE_TEMPLATE_APPROVED",
  "CHASE_TEMPLATE_CREATED",
  "COMPANY_CHECK_RUN",
  "COMPANY_SET",
  "COMPLIANCE_REVIEW_RECORDED",
  "COPILOT_PROPOSAL_CONFIRMED",
  "DEAL_CREATED",
  "DEMO_CLOCK_SET",
  "DEAL_PROJECT_SET",
  "DEAL_UNIT_SET",
  "DEFAULT_CLEARED",
  "DEFAULT_FLAGGED",
  "DEPOSIT_HANDED_TO_SELLER",
  "DEPOSIT_RECORDED",
  "DEPOSIT_RELEASED",
  "DOCUMENT_READ",
  "DOCUMENT_UPLOADED",
  "DOCUMENTS_REQUESTED",
  "HELPER_MODE_SET",
  "HELPER_REVIEW_HELD",
  "HELPER_REVIEW_RELEASED",
  "HELPER_REVIEW_REJECTED",
  "ESCROW_ACCOUNT_SET",
  "KYC_DRAFT_SAVED",
  "KYC_PUBLISHED",
  "KYC_RUN",
  "LISTING_AGREEMENT_SIGNED",
  "LISTING_CREATED",
  "MILESTONE_REACHED",
  "NOC_CONFIRMED",
  "NOC_RECORDED",
  "OFFER_ACCEPTED",
  "OFFER_ANSWERED",
  "OFFER_EXPIRED",
  "OFFER_REJECTED",
  "OFFER_SENT",
  "OFFER_WITHDRAWN",
  "OWNERSHIP_CHECKED",
  "OWNERSHIP_RECORDED",
  "PARTY_CREATED",
  "PARTY_DOCUMENT_UPLOADED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_PLAN_SET",
  "PAYMENT_REGISTERED",
  "POLICY_PUBLISHED",
  "PORTAL_DOCUMENTS_SENT",
  "PORTAL_LINK_ISSUED",
  "PREPARE_STOPPED",
  "PRICE_LIST_CREATED",
  "PRICE_LIST_PUBLISHED",
  "PROJECT_CREATED",
  "REGISTRATION_ATTEMPTED",
  "REGISTRATION_REJECTION_HANDLED",
  "SETTLEMENT_PROPOSED",
  "SETTLEMENT_STALE",
  "SETTLEMENT_SUPERSEDED",
  "SIGNATORY_ADDED",
  "SIGNING_ADVANCE_BLOCKED",
  "SIGNING_COMPLETE",
  "SIGNING_LINK_ISSUED",
  "SIGNING_LINK_RESENT",
  "SIGNING_OPENED",
  "SIGNING_STOPPED",
  "SIGNING_SUPERSEDED",
  "TARGET_TRANSFER_DATE_SET",
  "TASK_DONE",
  "TEMPLATE_BLANK_RELABELED",
  "TEMPLATE_BLANK_REMAPPED",
  "TEMPLATE_CREATED",
  "TEMPLATE_UPLOAD_READ",
  "TEMPLATE_UPLOADED",
  "UNIT_ADDED",
  "UNIT_PLACED",
  "USER_ACTIVE_SET",
  "USER_ROLE_CHANGED",
  ...machineEvents.filter((e) => !AML_MOVE_NAMES.has(e)),
]);
/** Compliance roles only: the AML policy and the AML moves under their own names (which the engine never writes to a deal). */
export const COMPLIANCE_EVENTS: ReadonlySet<string> = new Set([
  "AML_POLICY_PUBLISHED",
  // C23 (S62): exports, the retention list and the monthly report are compliance records.
  "CASE_EXPORTED",
  "COMPLIANCE_REPORT_EXPORTED",
  "COMPLIANCE_REPORT_GENERATED",
  "RETENTION_REVIEW_APPROVED",
  "RETENTION_REVIEW_LISTED",
  ...AML_MOVE_NAMES,
]);

/** Whether a role may see an event of this type. A compliance role sees everything, including a type nobody classified. */
export function eventVisibleTo(type: string, role: RoleSet): boolean {
  if (isComplianceRole(role)) return true;
  return STAFF_EVENTS.has(type);
}

/**
 * Whose tasks a role sees (S55): its own and, for a sales manager, everyone's (who may finish any). A task for a
 * compliance role is seen by the compliance roles only, so a task list never hints at a review.
 */
export function taskVisibleTo(taskRole: SpaRole, viewer: RoleSet): boolean {
  if (isComplianceRole(taskRole)) return isComplianceRole(viewer);
  return listOf(viewer).some((r) => r === taskRole || r === "sales_manager");
}

// ---------------------------------------------------------------------------------------------
// Stages and steps, in the words staff see (design §4.3, §6.2). The hold is "On hold", never by its internal name.

export type StageKey = DealState | "ON_HOLD";

/** The stage a role is told: a hold reads `ON_HOLD` for everyone but the compliance roles. */
export const stageKey = (state: DealState, role: RoleSet): StageKey =>
  state === "AML_HOLD" && !isComplianceRole(role) ? "ON_HOLD" : state;

const STAGE_LABELS: Readonly<Record<StageKey, string>> = Object.freeze({
  OFFER_AGREED: "Offer accepted",
  PARTY_CHECK: "Checking parties",
  AML_HOLD: "On hold · review open",
  ON_HOLD: "On hold · review open",
  AGREEMENT_DRAFT: "Preparing the agreement",
  LEGAL_REVIEW: "Legal approval",
  SIGNING: "Signing",
  REGISTRATION: "Oqood registration",
  NOC: "Developer NOC",
  FINANCE: "Banks",
  SETTLEMENT: "Settlement",
  TRANSFER: "Transfer",
  INSTALMENTS: "Instalments",
  HANDED_OVER: "Handed over",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
});
export const stageLabel = (k: StageKey): string => STAGE_LABELS[k];

export interface DealStep {
  key: StepKey;
  label: string;
  status: "done" | "current" | "upcoming";
}

/**
 * The steps of this deal in order (`stepsFor`): `visited` is every state the deal has been in (from its events); a
 * cancelled deal keeps the steps it reached and has no current one.
 */
export function dealSteps(
  deal: {
    dealType: "primary_offplan" | "resale_ready" | "resale_offplan";
    state: DealState;
    sellerMortgage: boolean;
    buyerMortgage: boolean;
    planTakenOver: boolean;
  },
  visited: readonly string[],
): DealStep[] {
  const defs = stepsFor(deal.dealType, deal);
  const finished = deal.state === "COMPLETED" || deal.state === "HANDED_OVER";
  const cancelled = deal.state === "CANCELLED";
  const currentIdx = defs.findIndex((d) => d.states.includes(deal.state));
  return defs.map(({ key, label, states }, i) => {
    const status: DealStep["status"] = finished
      ? "done"
      : cancelled
        ? states.some((x) => visited.includes(x))
          ? "done"
          : "upcoming"
        : i < currentIdx
          ? "done"
          : i === currentIdx
            ? "current"
            : "upcoming";
    return { key, label, status };
  });
}
