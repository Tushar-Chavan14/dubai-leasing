import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { LeaseArg } from "./shared.ts";

const Input = z.object({
  lease: LeaseArg,
  title: z.string().min(3).max(200).describe("What needs doing, in a short sentence"),
  assigneeRole: z.enum(["leasing_officer", "leasing_manager", "finance"]).describe("Who should do it"),
  dueOn: z.string().optional().describe("Due date YYYY-MM-DD (optional)"),
  note: z.string().max(2000).optional(),
});
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  summary: z.record(z.string(), z.unknown()),
  next: z.string(),
});

/** Proposes a task on a lease (D26). Created only when the user clicks Confirm on the card. */
export const createTaskTool: CopilotTool<typeof Input, typeof Output> = {
  name: "create_task",
  kind: "propose",
  description:
    "Propose a task on a lease for a person (leasing officer, manager or finance), only when the user asks you to create or assign one. Nothing is created until the user clicks Confirm on the card; never say it was created.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ lease, title, assigneeRole, dueOn, note }, { engine }) {
    const leaseId = await resolveLeaseId(engine, lease);
    const p = await engine.propose<{ id: string; status: string; summary: Record<string, unknown> }>(
      "/api/copilot/proposals",
      {
        kind: "create_task",
        leaseId,
        title,
        assigneeRole,
        ...(dueOn ? { dueOn } : {}),
        ...(note ? { note } : {}),
      },
    );
    return {
      proposalId: p.id,
      status: p.status,
      summary: p.summary,
      next: "Waiting for the user to click Confirm on the card. Nothing has been created yet.",
    };
  },
};
