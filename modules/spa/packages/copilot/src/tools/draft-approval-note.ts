import { z } from "zod";
import { COMPLIANCE, DRAFT_TEXT, DraftOutput, saveDraft, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ dealId: z.uuid(), body: z.string().trim().min(10).max(2000) });

export const draftApprovalNote: CopilotTool<typeof Input, typeof DraftOutput> = {
  name: "draft_approval_note",
  description:
    "Writes the wording of a note for an approval's decision box (for example why something is returned). It is saved as a draft and pre-fills the note box on the approvals page; the person reads it, edits it and decides themselves. It never decides.",
  kind: "draft",
  roles: [...SALES.filter((r) => r !== "sales_officer"), "legal", "finance", ...COMPLIANCE],
  input: Input,
  output: DraftOutput,
  run: (client, a) => saveDraft(client, "approval_note", a.dealId, a.body),
  final: (o) => DRAFT_TEXT(o.kind),
};
