import { z } from "zod";
import { DRAFT_TEXT, DraftOutput, DEAL_ROLES, saveDraft } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ dealId: z.uuid().optional(), body: z.string().trim().min(10).max(2000) });

export const draftSummary: CopilotTool<typeof Input, typeof DraftOutput> = {
  name: "draft_summary",
  description:
    "Writes a short plain summary of a deal or a list, for the user to copy into a note or a message. Saved as copy-only text on a card; nothing is sent. Use only facts a tool returned this turn.",
  kind: "draft",
  roles: DEAL_ROLES,
  input: Input,
  output: DraftOutput,
  run: (client, a) => saveDraft(client, "summary", a.dealId ?? null, a.body),
  final: (o) => DRAFT_TEXT(o.kind),
};
