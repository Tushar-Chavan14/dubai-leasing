import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";

const Input = z.object({});
const Output = z.object({
  stages: z.array(z.object({ stage: z.string(), count: z.number().int() })),
  offer: z.object({ sent: z.number().int(), held: z.number().int() }),
  contract: z.object({ awaitingSignature: z.number().int(), other: z.number().int() }),
  viewingsToday: z.number().int(),
  waitingForYou: z.number().int(),
  openTasks: z.number().int(),
  total: z.number().int(),
  note: z.string(),
});

interface Summary {
  stages: Record<string, number>;
  offer: { sent: number; held: number };
  contract: { awaitingSignature: number; other: number };
  viewingsToday: number;
  waitingForYou: number;
  openTasks: number;
  total: number;
}

export const pipelineSummary: CopilotTool<typeof Input, typeof Output> = {
  name: "pipeline_summary",
  kind: "read",
  description:
    "How many records sit in each stage of the leasing pipeline right now (Enquiry, Viewing, Documents, Offer, Reserved, Contract, Ejari, Registered), with the offer and contract splits, viewings today, items waiting for the user and open tasks. Use it for any 'how many' question about applications, enquiries, offers or contracts. The numbers match the Home tiles.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run(_args, { engine }) {
    const s = await engine.get<Summary>("/api/copilot/pipeline");
    return {
      stages: Object.entries(s.stages).map(([stage, count]) => ({ stage, count })),
      offer: s.offer,
      contract: s.contract,
      viewingsToday: s.viewingsToday,
      waitingForYou: s.waitingForYou,
      openTasks: s.openTasks,
      total: s.total,
      note: "Counts are applications and leases on the pipeline now (rejected, withdrawn and converted applications are not counted). Offer: sent = with the applicant, held = waiting for a person to send. Contract: awaitingSignature = with the signers. Use list_records to show the records.",
    };
  },
};
