import { DealIdInput, PROPOSED_TEXT, ProposalOutput, propose, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

export const prepareAgreement: CopilotTool<typeof DealIdInput, typeof ProposalOutput> = {
  name: "prepare_agreement",
  description:
    "Proposes preparing the agreement for a deal that is in the agreement-draft step. It only prepares: legal still has to approve it before anything is signed. Stores a proposal only; it runs when the user clicks Confirm.",
  kind: "propose",
  roles: SALES,
  input: DealIdInput,
  output: ProposalOutput,
  run: (client, a) => propose(client, "prepare_agreement", a.dealId, {}),
  final: (o) => PROPOSED_TEXT(o.summary),
};
