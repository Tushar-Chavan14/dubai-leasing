import { SpaRole } from "@spa/core";
import { createTask } from "./create-task.ts";
import { draftApprovalNote } from "./draft-approval-note.ts";
import { draftEmail } from "./draft-email.ts";
import { draftSummary } from "./draft-summary.ts";
import { getComplianceCase } from "./get-compliance-case.ts";
import { getDealTimeline } from "./get-deal-timeline.ts";
import { getDeal } from "./get-deal.ts";
import { getListing } from "./get-listing.ts";
import { getNocBankStatus } from "./get-noc-bank-status.ts";
import { getPaymentPlan } from "./get-payment-plan.ts";
import { getRulebookValue } from "./get-rulebook-value.ts";
import { getSettlement } from "./get-settlement.ts";
import { getSigningStatus } from "./get-signing-status.ts";
import { getTemplateStatus } from "./get-template-status.ts";
import { listApprovals } from "./list-approvals.ts";
import { listListings } from "./list-listings.ts";
import { listTasks } from "./list-tasks.ts";
import { prepareAgreement } from "./prepare-agreement.ts";
import { requestDocuments } from "./request-documents.ts";
import { resendSigningLink } from "./resend-signing-link.ts";
import { searchDeals } from "./search-deals.ts";
import type { CopilotTool } from "./types.ts";

export type { CopilotTool, ToolKind } from "./types.ts";
export { RULEBOOK_KEYS } from "./get-rulebook-value.ts";

/** The registry (C36, S68). One tool per file; a role is offered only the tools listing it. */
export const COPILOT_TOOLS: readonly CopilotTool[] = Object.freeze([
  searchDeals,
  getDeal,
  getDealTimeline,
  listApprovals,
  listTasks,
  getPaymentPlan,
  getNocBankStatus,
  getSettlement,
  getSigningStatus,
  listListings,
  getListing,
  getTemplateStatus,
  getRulebookValue,
  getComplianceCase,
  requestDocuments,
  createTask,
  resendSigningLink,
  prepareAgreement,
  draftEmail,
  draftSummary,
  draftApprovalNote,
]);

export const toolsForRole = (role: SpaRole): CopilotTool[] => COPILOT_TOOLS.filter((t) => t.roles.includes(role));

export const TOOL_NAMES_BY_ROLE: Readonly<Record<SpaRole, readonly string[]>> = Object.freeze(
  Object.fromEntries(SpaRole.options.map((r) => [r, toolsForRole(r).map((t) => t.name)])) as unknown as Record<
    SpaRole,
    readonly string[]
  >,
);
