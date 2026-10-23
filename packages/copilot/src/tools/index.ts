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

/**
 * The copilot tool registry (architecture §8b). The engine's chat endpoint and, later, the MCP
 * server both use this list. Read tools, plus one `propose` tool whose proposal only the user's
 * Confirm click in the chat carries out (D25).
 */
export const copilotTools: readonly CopilotTool[] = [
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
  createTaskTool,
  proposeApproval,
  draftEmail,
  draftApprovalNote,
  getCasePack,
  summariseCase,
] as readonly CopilotTool[];

/** Tools a role may see. The engine checks the role again on every call. */
export const toolsFor = (role: StaffRole) => copilotTools.filter((t) => t.roles.includes(role));
