import { DealIdInput, ProposalOutput, PROPOSED_TEXT, propose, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

export const requestDocuments: CopilotTool<typeof DealIdInput, typeof ProposalOutput> = {
  name: "request_documents",
  description:
    "Proposes asking every buyer and seller of a deal for their documents (each gets an emailed link). Stores a proposal only; it runs when the user clicks Confirm.",
  kind: "propose",
  roles: SALES,
  input: DealIdInput,
  output: ProposalOutput,
  run: (client, a) => propose(client, "request_documents", a.dealId, {}),
  final: (o) => PROPOSED_TEXT(o.summary),
};
