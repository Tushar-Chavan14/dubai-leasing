import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { LeaseArg } from "./shared.ts";

const Input = z.object({
  lease: LeaseArg,
  signer: z
    .string()
    .min(2)
    .max(80)
    .optional()
    .describe("Which signer: tenant or landlord (or their name). Leave out when only one is left to sign"),
});
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  summary: z.object({ leaseRef: z.string(), unitCode: z.string(), signerRole: z.string() }),
  expiresAt: z.string(),
  next: z.string(),
});

interface Proposal {
  id: string;
  status: string;
  expiresAt: string;
  summary: { leaseRef: string; unitCode: string; signerRole: string };
}

/** Proposes re-emailing a signer their contract signing link (D42). Stored only; Confirm runs it. */
export const proposeResendSigningLink: CopilotTool<typeof Input, typeof Output> = {
  name: "propose_resend_signing_link",
  kind: "propose",
  description:
    "Propose emailing a contract signer a new signing link (the old link stops working), for a lease whose contract was sent and is not yet signed by that person, only when the user asks for it. Use contract_status first if unsure who has not signed. Nothing is emailed until the user clicks Confirm on the card; never say it was.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ lease, signer }, { engine }) {
    const leaseId = await resolveLeaseId(engine, lease);
    const p = await engine.propose<Proposal>("/api/copilot/proposals", {
      kind: "resend_signing_link",
      leaseId,
      ...(signer ? { signer } : {}),
    });
    return {
      proposalId: p.id,
      status: p.status,
      summary: { leaseRef: p.summary.leaseRef, unitCode: p.summary.unitCode, signerRole: p.summary.signerRole },
      expiresAt: p.expiresAt,
      next: "Waiting for the user to click Confirm on the card. No email has gone out yet; on Confirm the signer gets a new link and the old one stops working.",
    };
  },
};
