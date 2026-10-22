import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";

const Input = z.object({
  approvalId: z.string().uuid().describe("The approval's id from list_approvals"),
  body: z.string().min(2).max(2000).describe("The note for the approver"),
});
const Output = z.object({ draftId: z.string(), next: z.string() });

/** Drafts a note on an approval (D26). Saved only: the user posts it from the approval page. */
export const draftApprovalNote: CopilotTool<typeof Input, typeof Output> = {
  name: "draft_approval_note",
  kind: "draft",
  description:
    "Draft a note for the approver of a pending approval (context, what was checked), when the user asks. It is only saved: the user posts it from the approval page. It never approves or rejects anything.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ approvalId, body }, { engine }) {
    const d = await engine.propose<{ id: string }>("/api/copilot/drafts", { kind: "approval_note", approvalId, body });
    return {
      draftId: d.id,
      next: "Saved as a draft note for the user to post from the approval page. Nothing was posted.",
    };
  },
};
