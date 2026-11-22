import { z } from "zod";
import { DRAFT_TEXT, DraftOutput, saveDraft, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({
  dealId: z.uuid().optional(),
  to: z.enum(["buyer", "seller", "broker", "colleague"]),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(2000),
});

export const draftEmail: CopilotTool<typeof Input, typeof DraftOutput> = {
  name: "draft_email",
  description:
    "Writes an email draft to a buyer, seller, broker or colleague. The draft is saved as copy-only text on a card: nothing is sent, and the user sends it from their own mail. Write no amounts, dates or fees unless a tool returned them this turn.",
  kind: "draft",
  roles: SALES,
  input: Input,
  output: DraftOutput,
  run: (client, a) => saveDraft(client, "email", a.dealId ?? null, a.body, { to: a.to, subject: a.subject }),
  final: (o) => DRAFT_TEXT(o.kind),
};
