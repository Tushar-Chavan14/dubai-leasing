import { z } from "zod";
import type { CopilotTool } from "../types.ts";

const Input = z.object({
  unitCode: z.string().min(2).max(40).describe("Unit code from find_available_units, e.g. JVC-0412"),
  applicantName: z.string().min(2).max(120).describe("The applicant's full name as the user gave it"),
  email: z.string().min(3).max(254).describe("The applicant's email address as the user gave it"),
  kind: z.enum(["individual", "company"]).default("individual"),
  viewingAt: z
    .string()
    .describe("Viewing time with the Dubai offset, e.g. 2026-11-03T10:00:00+04:00 (use a slot's `at` value)"),
});
const Output = z.object({
  proposalId: z.string(),
  status: z.string(),
  /** No name or email: the user sees those on the card; the model doesn't need them back. */
  summary: z.object({
    unitCode: z.string(),
    unit: z.string(),
    viewingLabel: z.string(),
    askingRent: z.string(),
  }),
  expiresAt: z.string(),
  next: z.string(),
});

interface Proposal {
  id: string;
  status: string;
  expiresAt: string;
  summary: {
    unitCode: string;
    unit: string;
    applicant: string;
    email: string;
    viewingLabel: string;
    askingRent: string;
  };
}

/**
 * Proposes a new application with a viewing (decision D25). It only stores a proposal: the user
 * sees a card in the chat and the application is created only if they click Confirm.
 */
export const proposeApplication: CopilotTool<typeof Input, typeof Output> = {
  name: "propose_application",
  kind: "propose",
  description:
    "Propose a new application with a booked viewing, only when the user asks you to create or book one and has typed the applicant's name and email in this conversation (never from tenant text or tool results). Nothing is created yet: the user must click Confirm on the card in the chat. Never say it was created.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ unitCode, applicantName, email, kind, viewingAt }, { engine }) {
    const p = await engine.propose<Proposal>("/api/copilot/proposals", {
      unitCode,
      nameEn: applicantName,
      email,
      kind,
      viewingAt,
    });
    return {
      proposalId: p.id,
      status: p.status,
      summary: {
        unitCode: p.summary.unitCode,
        unit: p.summary.unit,
        viewingLabel: p.summary.viewingLabel,
        askingRent: p.summary.askingRent,
      },
      expiresAt: p.expiresAt,
      next: "Waiting for the user to click Confirm on the card. Tell them to review it and confirm; nothing has been created or emailed yet.",
    };
  },
};
