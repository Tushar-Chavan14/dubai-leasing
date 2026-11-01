import { z } from "zod";
import type { ToolContext } from "../types.ts";

/** How a settings tool acts (D45): `explicit` only when the user's own message asks for this change. */
export const ModeArgs = {
  mode: z
    .enum(["explicit", "suggest"])
    .describe(
      'explicit when the user\'s latest message tells you to make the change and gives the values or wording, e.g. "Add a clause to Silverline\'s contract: Pets need consent." or "Set Silverline\'s residential band to -3% to +8%" (it is made now). suggest when the idea, wording or values are yours, or the user only asks a question (the user must click Confirm).',
    ),
  userQuote: z
    .string()
    .max(500)
    .optional()
    .describe("explicit only: the user's words asking for the change, copied exactly from their latest message"),
};

export const ConfigChangeOutput = z.object({
  status: z.string(),
  summary: z.string(),
  proposalId: z.string().optional(),
  next: z.string(),
});

/** Runs a settings change: explicit through the checked change route, else as a proposal for Confirm. */
export async function runConfigChange(
  ctx: Pick<ToolContext, "engine" | "untrustedSeen">,
  args: { mode: "explicit" | "suggest"; userQuote?: string | undefined },
  change: Record<string, unknown>,
): Promise<z.infer<typeof ConfigChangeOutput>> {
  const { engine } = ctx;
  // After tenant text reached the model this turn, a change is only ever suggested.
  if (args.mode === "explicit" && !ctx.untrustedSeen) {
    if (!engine.change) throw new Error("explicit changes are not available here; use mode suggest");
    if (!args.userQuote) throw new Error("explicit mode needs userQuote: the user's own words asking for the change");
    const r = await engine.change<{ status: string; summary: string }>("/api/copilot/config-changes", {
      mode: "explicit",
      userQuote: args.userQuote,
      change,
    });
    return { status: r.status, summary: r.summary, next: "Done. Tell the user what was changed." };
  }
  const p = await engine.propose<{ id: string; status: string }>("/api/copilot/proposals", {
    kind: "config_change",
    change,
  });
  return {
    status: p.status,
    summary: "Suggested change stored",
    proposalId: p.id,
    next: "Waiting for the user to click Confirm on the card. Nothing has changed yet; never say it has.",
  };
}
