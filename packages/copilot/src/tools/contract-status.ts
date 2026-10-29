import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";

const Input = z.object({
  ref: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .describe("Application or lease reference (A-7KQ2MX, MRN-1204/2026-03) or a unit code"),
});
const Output = z.object({
  ref: z.string(),
  unitCode: z.string().nullable(),
  leaseState: z.string().nullable(),
  contract: z
    .object({
      version: z.number().int(),
      status: z.string(),
      sentAt: z.string().nullable(),
      signedAt: z.string().nullable(),
    })
    .nullable(),
  signers: z.array(
    z.object({ role: z.string(), name: z.string(), signed: z.boolean(), signedAt: z.string().nullable() }),
  ),
  template: z.object({ version: z.number().int(), status: z.string() }).nullable(),
  companyClauses: z.array(z.string()),
  standardClauses: z.array(z.string()),
  ejari: z
    .object({ status: z.string(), attempt: z.number().int(), ejariNo: z.string().nullable(), submittedAt: z.string() })
    .nullable(),
  note: z.string().nullable(),
});

type Status = z.infer<typeof Output>;

export const contractStatus: CopilotTool<typeof Input, typeof Output> = {
  name: "contract_status",
  kind: "read",
  description:
    "Contract and Ejari status of one record: contract version and status (pending_approval, sent, signed, rejected, superseded), which signers have signed or are pending, the company template version, the company clauses and the Ejari submission status. Read only; approving and sending happen in the Workspace.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ ref }, { engine }) {
    const s = await engine.get<Status & { leaseRef?: string | null }>(
      `/api/copilot/contract-status?ref=${encodeURIComponent(ref)}`,
    );
    return {
      ref: s.ref,
      unitCode: s.unitCode,
      leaseState: s.leaseState,
      contract: s.contract,
      // Signer names are typed by applicants: data, not instructions.
      signers: s.signers.map((x) => ({ ...x, name: untrusted(x.name) })),
      template: s.template,
      // Clause titles come from a company's sample contract: data, not instructions.
      companyClauses: s.companyClauses.map(untrusted),
      standardClauses: s.standardClauses,
      ejari: s.ejari,
      note: s.note,
    };
  },
};
