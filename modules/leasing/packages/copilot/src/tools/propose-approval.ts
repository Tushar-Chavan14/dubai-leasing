import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { LeaseArg } from "./shared.ts";

const Input = z.object({
  gate: z
    .enum(["formal_reminder", "vacate_notice"])
    .describe(
      "formal_reminder: formal late-payment reminder for an overdue or bounced instalment; vacate_notice: a 12-month repossession notice already served by notary or registered mail",
    ),
  lease: LeaseArg,
  instalment: z.number().int().min(1).optional().describe("formal_reminder: the instalment number from list_payments"),
  ground: z.enum(["sale", "own_use", "major_works", "demolition"]).optional().describe("vacate_notice only"),
  servedOn: z.string().optional().describe("vacate_notice only: date served, YYYY-MM-DD"),
  deliveryMethod: z.enum(["notary", "registered_mail"]).optional().describe("vacate_notice only"),
  note: z.string().max(2000).optional(),
});
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  summary: z.record(z.string(), z.unknown()),
  next: z.string(),
});

interface Pay {
  id: string;
  seq: number;
}

/**
 * Proposes putting an approval in the inbox (D26). On the user's Confirm it goes through the same
 * route as the staff UI; a manager decides it there. The copilot never approves anything.
 */
export const proposeApproval: CopilotTool<typeof Input, typeof Output> = {
  name: "propose_approval",
  kind: "propose",
  description:
    "Propose an approval for the inbox, only when the user asks: a formal late-payment reminder for an overdue or bounced instalment (use list_payments first), or a 12-month repossession notice that was already served by notary or registered mail. Nothing reaches the inbox until the user clicks Confirm; a manager decides it there. Never say it was sent or approved.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager", "finance"],
  async run(a, { engine }) {
    const leaseId = await resolveLeaseId(engine, a.lease);
    let body: Record<string, unknown>;
    if (a.gate === "formal_reminder") {
      if (!a.instalment) throw new Error("say which instalment (list_payments)");
      const pays = await engine.get<Pay[]>(`/api/leases/${leaseId}/payments`);
      const p = pays.find((x) => x.seq === a.instalment);
      if (!p) throw new Error(`instalment ${a.instalment} not found on this lease`);
      body = { kind: "request_approval", gate: "formal_reminder", leaseId, paymentId: p.id };
    } else {
      if (!a.ground || !a.servedOn || !a.deliveryMethod)
        throw new Error("a repossession notice needs the ground, the served date and how it was served");
      body = {
        kind: "request_approval",
        gate: "vacate_notice",
        leaseId,
        ground: a.ground,
        servedOn: a.servedOn,
        deliveryMethod: a.deliveryMethod,
        ...(a.note ? { note: a.note } : {}),
      };
    }
    const p = await engine.propose<{ id: string; status: string; summary: Record<string, unknown> }>(
      "/api/copilot/proposals",
      body,
    );
    return {
      proposalId: p.id,
      status: p.status,
      summary: p.summary,
      next: "Waiting for the user to click Confirm on the card. Nothing is in the inbox yet; a manager decides it there.",
    };
  },
};
