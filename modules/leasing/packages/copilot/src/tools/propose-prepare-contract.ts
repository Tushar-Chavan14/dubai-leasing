import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { LeaseArg } from "./shared.ts";

const Input = z.object({ lease: LeaseArg });
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  summary: z.object({ leaseRef: z.string(), unitCode: z.string() }),
  expiresAt: z.string(),
  next: z.string(),
});

interface Proposal {
  id: string;
  status: string;
  expiresAt: string;
  summary: { leaseRef: string; unitCode: string };
}

/**
 * Proposes preparing the contract for a lease waiting at the contract step (D42). It only prepares:
 * the contract then waits at the `final_contract` approval, which a person decides in the inbox.
 */
export const proposePrepareContract: CopilotTool<typeof Input, typeof Output> = {
  name: "propose_prepare_contract",
  kind: "propose",
  description:
    "Propose preparing the contract for a lease that is waiting for one, only when the user asks for it. Preparing does not approve or send anything: the contract then waits for a person to approve it in the approvals inbox (final contract gate). Nothing is prepared until the user clicks Confirm on the card; never say it was.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ lease }, { engine }) {
    const leaseId = await resolveLeaseId(engine, lease);
    const p = await engine.propose<Proposal>("/api/copilot/proposals", { kind: "prepare_contract", leaseId });
    return {
      proposalId: p.id,
      status: p.status,
      summary: { leaseRef: p.summary.leaseRef, unitCode: p.summary.unitCode },
      expiresAt: p.expiresAt,
      next: "Waiting for the user to click Confirm on the card. Nothing is prepared yet. After Confirm the contract still needs a person's approval in the inbox before anything is sent.",
    };
  },
};
