import { z } from "zod";
import { resolveApplication } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";

const Input = z.object({
  application: z.string().min(2).max(80).describe("Application reference (A-7KQ2MX) or unit code"),
});
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  summary: z.object({ applicationRef: z.string().nullable(), unitCode: z.string() }),
  expiresAt: z.string(),
  next: z.string(),
});

interface Proposal {
  id: string;
  status: string;
  expiresAt: string;
  summary: { applicationRef: string | null; unitCode: string };
}

/** Proposes (re)sending the document upload request to an applicant (D42). Stored only; Confirm runs it. */
export const proposeRequestDocuments: CopilotTool<typeof Input, typeof Output> = {
  name: "propose_request_documents",
  kind: "propose",
  description:
    "Propose emailing an applicant a fresh document upload link (for an application waiting for documents), only when the user asks for it. Earlier upload links stop working when it is confirmed. Nothing is emailed until the user clicks Confirm on the card; never say it was.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ application }, { engine }) {
    const app = await resolveApplication(engine, application);
    const p = await engine.propose<Proposal>("/api/copilot/proposals", {
      kind: "request_documents",
      applicationId: app.id,
    });
    return {
      proposalId: p.id,
      status: p.status,
      summary: { applicationRef: p.summary.applicationRef, unitCode: p.summary.unitCode },
      expiresAt: p.expiresAt,
      next: "Waiting for the user to click Confirm on the card. No email has gone out yet; on Confirm the applicant gets a new upload link and the old one stops working.",
    };
  },
};
