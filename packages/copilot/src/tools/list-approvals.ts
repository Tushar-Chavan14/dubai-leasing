import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { aed, dubaiDay, Money } from "./shared.ts";

const Input = z.object({
  status: z.enum(["pending", "decided", "all"]).default("pending"),
  lease: z.string().min(2).max(80).optional().describe("Only approvals for this lease (id, reference or unit code)"),
});
const Output = z.object({
  approvals: z.array(
    z.object({
      approvalId: z.string(),
      title: z.string(),
      gate: z.string(),
      gateLabel: z.string(),
      status: z.string(),
      decidedBy: z.string().describe("Role that decides it, in the approval inbox"),
      createdOn: z.string().nullable(),
      proposedRent: Money.nullable(),
    }),
  ),
  note: z.string(),
});

interface Row {
  id: string;
  title: string;
  gate: string;
  gateLabel: string;
  status: string;
  approverRole: string;
  entityId: string;
  createdAt: string;
  proposal: Record<string, unknown>;
  editedProposal: Record<string, unknown> | null;
}

export const listApprovals: CopilotTool<typeof Input, typeof Output> = {
  name: "list_approvals",
  kind: "read",
  description:
    "Approvals in the inbox (pending by default), optionally for one lease, with the gate and who decides it.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ status, lease }, { engine }) {
    const leaseId = lease ? await resolveLeaseId(engine, lease) : null;
    const rows = await engine.get<Row[]>(`/api/approvals?status=${status}`);
    return {
      approvals: rows
        .filter((a) => !leaseId || a.entityId === leaseId)
        .slice(0, 20)
        .map((a) => {
          const p = a.editedProposal ?? a.proposal;
          return {
            approvalId: a.id,
            title: a.title,
            gate: a.gate,
            gateLabel: a.gateLabel,
            status: a.status,
            decidedBy: a.approverRole,
            createdOn: dubaiDay(a.createdAt),
            proposedRent: typeof p.proposedRentFils === "number" ? aed(p.proposedRentFils) : null,
          };
        }),
      note: "Approvals are decided only by a person in the approval inbox (/inbox), never in chat.",
    };
  },
};
