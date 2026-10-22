import type { StaffRole } from "@leasing/core";
import type { CopilotTool } from "../types.ts";
import { computeRenewalCap } from "./compute-renewal-cap.ts";
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
  proposeApplication,
] as readonly CopilotTool[];

/** Tools a role may see. The engine checks the role again on every call. */
export const toolsFor = (role: StaffRole) => copilotTools.filter((t) => t.roles.includes(role));
