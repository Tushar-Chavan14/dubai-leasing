import { z } from "zod";
import { resolveApplication } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";

const Input = z.object({
  application: z.string().min(2).max(80).describe("Application reference (A-7KQ2MX) or unit code"),
  viewingAt: z.string().describe("Viewing time with the Dubai offset: copy a slot's `at` from viewing_slots exactly"),
});
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  summary: z.object({ applicationRef: z.string().nullable(), unitCode: z.string(), viewingLabel: z.string() }),
  expiresAt: z.string(),
  next: z.string(),
});

interface Proposal {
  id: string;
  status: string;
  expiresAt: string;
  summary: { applicationRef: string | null; unitCode: string; viewingLabel: string };
}

/**
 * Proposes booking the viewing for an enquiry, which emails the applicant their invitation (D42).
 * Only stores a proposal: the booking and the email happen only when the user clicks Confirm.
 */
export const proposeViewingInvite: CopilotTool<typeof Input, typeof Output> = {
  name: "propose_viewing_invite",
  kind: "propose",
  description:
    "Propose booking a viewing for an existing enquiry application and emailing the applicant the invitation, only when the user asks for it. Call viewing_slots first and pass a slot's `at`. Nothing is booked or emailed until the user clicks Confirm on the card; never say it was. Only enquiries without a viewing can be booked; for a viewing that is already booked, draft_email can write a reminder instead.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ application, viewingAt }, { engine }) {
    const app = await resolveApplication(engine, application);
    const p = await engine.propose<Proposal>("/api/copilot/proposals", {
      kind: "viewing_invite",
      applicationId: app.id,
      viewingAt,
    });
    return {
      proposalId: p.id,
      status: p.status,
      summary: {
        applicationRef: p.summary.applicationRef,
        unitCode: p.summary.unitCode,
        viewingLabel: p.summary.viewingLabel,
      },
      expiresAt: p.expiresAt,
      next: "Waiting for the user to click Confirm on the card. Nothing is booked and no email has gone out yet; on Confirm the applicant is emailed the invitation.",
    };
  },
};
