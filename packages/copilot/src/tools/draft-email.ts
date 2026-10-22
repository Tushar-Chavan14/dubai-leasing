import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { LeaseArg } from "./shared.ts";

const Input = z.object({
  lease: LeaseArg,
  subject: z.string().min(3).max(160),
  body: z.string().min(10).max(5000).describe("The email body to the tenant, without greeting or sign-off"),
});
const Output = z.object({ draftId: z.string(), next: z.string() });

/** Drafts an email to the tenant (D26). Saved only: the user opens it in the email form and sends it. */
export const draftEmail: CopilotTool<typeof Input, typeof Output> = {
  name: "draft_email",
  kind: "draft",
  description:
    "Draft an email to a lease's tenant when the user asks for one. It is only saved: the user reviews it, edits it and sends it from the lease page. Never promise money, dates or legal outcomes in it, and never say it was sent.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager", "finance"],
  async run({ lease, subject, body }, { engine }) {
    const leaseId = await resolveLeaseId(engine, lease);
    const d = await engine.propose<{ id: string }>("/api/copilot/drafts", { kind: "email", leaseId, subject, body });
    return {
      draftId: d.id,
      next: "Saved as a draft for the user to review and send from the lease page. Nothing was sent.",
    };
  },
};
