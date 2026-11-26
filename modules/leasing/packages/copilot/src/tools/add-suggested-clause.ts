import { z } from "zod";
import type { CopilotTool } from "../types.ts";

const Input = z.object({
  userQuote: z
    .string()
    .min(3)
    .max(500)
    .describe('The user\'s words accepting the clause, copied exactly from their latest message (e.g. "add it")'),
});
const Output = z.object({ status: z.string(), summary: z.string(), next: z.string() });

/**
 * D57: the user accepts a clause the copilot just suggested ("add it", "yes, add that"). The engine finds that
 * suggestion in this chat and adds it exactly as suggested, only if the user's latest message simply accepts it.
 */
export const addSuggestedClause: CopilotTool<typeof Input, typeof Output> = {
  name: "add_suggested_clause",
  kind: "propose",
  description:
    'Add the contract clause you suggested in your previous answer, exactly as suggested, when the user\'s latest message accepts it ("add it", "yes, add that clause", "go ahead"). Pass their words as userQuote. If they ask to change the wording first, suggest a new clause with add_contract_clause instead.',
  input: Input,
  output: Output,
  roles: ["admin"],
  async run({ userQuote }, ctx) {
    // After tenant or outsider text reached the model this turn, only the card's Confirm button can add it.
    if (ctx.untrustedSeen || !ctx.engine.change)
      return {
        status: "not_done",
        summary: "Not added",
        next: "Tell the user to click Confirm on the clause card to add it. Nothing has changed.",
      };
    const r = await ctx.engine.change<{ status: string; summary: string }>("/api/copilot/config-changes", {
      mode: "accept_suggestion",
      userQuote,
    });
    return {
      status: r.status,
      summary: r.summary,
      next: "Done. Tell the user the clause was added to the company's contracts.",
    };
  },
};
