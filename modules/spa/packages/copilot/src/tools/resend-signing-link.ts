import { z } from "zod";
import { PROPOSED_TEXT, ProposalOutput, propose, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ dealId: z.uuid(), signatureId: z.uuid() });

export const resendSigningLink: CopilotTool<typeof Input, typeof ProposalOutput> = {
  name: "resend_signing_link",
  description:
    "Proposes emailing one signer a new signing link (the old link stops working). Needs the signature id from get_signing_status. Stores a proposal only; it runs when the user clicks Confirm.",
  kind: "propose",
  roles: SALES,
  input: Input,
  output: ProposalOutput,
  run: (client, a) => propose(client, "resend_signing_link", a.dealId, { signatureId: a.signatureId }),
  final: (o) => PROPOSED_TEXT(o.summary),
};
