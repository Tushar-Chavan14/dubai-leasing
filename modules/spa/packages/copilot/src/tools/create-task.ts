import { z } from "zod";
import { DEAL_ROLES, PROPOSED_TEXT, ProposalOutput, propose } from "./common.ts";
import type { CopilotTool } from "./types.ts";

/** Roles a copilot task may be addressed to: never a compliance role (a task for them stays a neutral matter). */
const Input = z.object({
  dealId: z.uuid().optional(),
  title: z.string().trim().min(3).max(120),
  forRole: z.enum(["sales_officer", "sales_manager", "sales_admin", "legal", "finance"]).optional(),
});

export const createTask: CopilotTool<typeof Input, typeof ProposalOutput> = {
  name: "create_task",
  description:
    "Proposes a task for a person's role, optionally on one deal, with a short plain-words title. Stores a proposal only; the task exists when the user clicks Confirm.",
  kind: "propose",
  roles: DEAL_ROLES,
  input: Input,
  output: ProposalOutput,
  run: (client, a) =>
    propose(client, "create_task", a.dealId ?? null, { title: a.title, ...(a.forRole ? { forRole: a.forRole } : {}) }),
  final: (o) => PROPOSED_TEXT(o.summary),
};
