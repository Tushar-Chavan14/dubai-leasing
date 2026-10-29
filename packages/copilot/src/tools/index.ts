import type { StaffRole } from "@leasing/core";
import { getCasePack } from "./get-case-pack.ts";
import { summariseCase } from "./summarise-case.ts";
import type { CopilotTool } from "../types.ts";
import { computeRenewalCap } from "./compute-renewal-cap.ts";
import { createTaskTool } from "./create-task.ts";
import { draftApprovalNote } from "./draft-approval-note.ts";
import { draftEmail } from "./draft-email.ts";
import { listPayments } from "./list-payments.ts";
import { listTickets } from "./list-tickets.ts";
import { proposeApproval } from "./propose-approval.ts";
import { explainRule } from "./explain-rule.ts";
import { findAvailableUnits } from "./find-available-units.ts";
import { getHelperRun } from "./get-helper-run.ts";
import { getLease } from "./get-lease.ts";
import { getLeaseTimeline } from "./get-lease-timeline.ts";
import { listApprovals } from "./list-approvals.ts";
import { listDeadlines } from "./list-deadlines.ts";
import { listOutboundMessages } from "./list-outbound-messages.ts";
import { proposeApplication } from "./propose-application.ts";
import { searchEntities } from "./search-entities.ts";
import { contractStatus } from "./contract-status.ts";
import { getRecord } from "./get-record.ts";
import { listCompanies } from "./list-companies.ts";
import { listRecords } from "./list-records.ts";
import { offerChoices } from "./offer-choices.ts";
import { pipelineSummary } from "./pipeline-summary.ts";
import { getEnquiry } from "./get-enquiry.ts";
import { getUnit } from "./get-unit.ts";
import { listEnquiries } from "./list-enquiries.ts";
import { listTasks } from "./list-tasks.ts";
import { proposePrepareContract } from "./propose-prepare-contract.ts";
import { proposeRequestDocuments } from "./propose-request-documents.ts";
import { proposeResendSigningLink } from "./propose-resend-signing-link.ts";
import { proposeViewingInvite } from "./propose-viewing-invite.ts";
import { viewingSlots } from "./viewing-slots.ts";

/**
 * The copilot tool registry (architecture §8b). The engine's chat endpoint and, later, the MCP
 * server both use this list. Read tools, plus one `propose` tool whose proposal only the user's
 * Confirm click in the chat carries out (D25).
 */
export const copilotTools: readonly CopilotTool[] = [
  pipelineSummary,
  listRecords,
  getRecord,
  contractStatus,
  listCompanies,
  listTasks,
  listEnquiries,
  getEnquiry,
  getUnit,
  viewingSlots,
  offerChoices,
  searchEntities,
  getLease,
  getLeaseTimeline,
  listDeadlines,
  listApprovals,
  getHelperRun,
  listOutboundMessages,
  explainRule,
  computeRenewalCap,
  findAvailableUnits,
  listPayments,
  listTickets,
  proposeApplication,
  proposeViewingInvite,
  proposeRequestDocuments,
  proposeResendSigningLink,
  proposePrepareContract,
  createTaskTool,
  proposeApproval,
  draftEmail,
  draftApprovalNote,
  getCasePack,
  summariseCase,
] as readonly CopilotTool[];

/** Tools of move-in through move-out; hidden while TENANCY_OPS is off. */
const TENANCY_TOOLS = new Set([
  "compute_renewal_cap",
  "list_deadlines",
  "get_lease_timeline",
  "list_payments",
  "list_tickets",
  "get_case_pack",
  "summarise_case",
  // Its two gates (formal_reminder, vacate_notice) are both tenancy gates.
  "propose_approval",
]);

/**
 * Tools a role may see. The engine checks the role again on every call. `tenancyOps` is the
 * engine's TENANCY_OPS and is required (no fail-open default).
 */
export const toolsFor = (role: StaffRole, opts: { tenancyOps: boolean }) =>
  copilotTools.filter((t) => t.roles.includes(role) && (opts.tenancyOps || !TENANCY_TOOLS.has(t.name)));
