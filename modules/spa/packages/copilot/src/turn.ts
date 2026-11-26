import { type LoopTool, runAgentTurn, type TurnResult } from "@platform/llm/agent";
import type { Llm } from "@platform/llm";
import type { AgentModel } from "@platform/llm/agent";
import { isComplianceRole, type SpaRole } from "@spa/core";
import type { EngineClient } from "./client.ts";
import { asksAboutCompliance, bannedFor } from "./guard.ts";
import { COPILOT_FIXED, COPILOT_PROFILE, copilotSystemPrompt } from "./prompt.ts";
import { toolsForRole } from "./tools/index.ts";
import type { CopilotTool } from "./tools/index.ts";
import type { DraftOutput, ProposalOutput } from "./tools/common.ts";

export interface CopilotDeps {
  model: AgentModel;
  /** The decision model for the scope gate; null skips the gate (it fails open anyway). */
  llm: Pick<Llm, "decide"> | null;
  /** The turn limit in ms (default 60 s). Tests shorten it. */
  timeoutMs?: number;
}
export interface CopilotUser {
  id: string;
  role: SpaRole;
}
export interface CopilotInput {
  text: string;
  history: { role: "user" | "assistant"; content: string }[];
}
export interface CopilotTurnResult extends TurnResult {
  /** Proposals stored this turn (status `proposed`: nothing has happened). */
  proposals: ProposalOutput[];
  drafts: DraftOutput[];
}

const loopTool = (
  t: CopilotTool,
  client: EngineClient,
  made: Pick<CopilotTurnResult, "proposals" | "drafts">,
): LoopTool => ({
  name: t.name,
  description: t.description,
  input: t.input,
  async run(args) {
    const out = await t.run(client, args);
    if (t.kind === "propose") made.proposals.push(out as ProposalOutput);
    if (t.kind === "draft") made.drafts.push(out as DraftOutput);
    return out;
  },
  ...(t.final ? { final: (o: unknown) => t.final!(o) } : {}),
});

/**
 * One copilot turn for a signed-in user (C36, S68), on the shared bounded loop: scope gate, the user's own tools (six calls,
 * 60 s), the value post-check and the unverified marks. For a role outside the two compliance roles the prompt leaves out
 * compliance, a message that asks about a review gets a neutral line without the model running, and a code guard drops any
 * reply or tool result that carries an AML word. Never throws.
 */
export async function copilotTurn(
  deps: CopilotDeps,
  client: EngineClient,
  user: CopilotUser,
  input: CopilotInput,
): Promise<CopilotTurnResult> {
  const made = { proposals: [] as ProposalOutput[], drafts: [] as DraftOutput[] };
  if (!isComplianceRole(user.role) && asksAboutCompliance(input.text))
    return {
      reply: COPILOT_FIXED.neutral,
      kind: "guarded",
      tools: [],
      unverified: [],
      verified: true,
      model: deps.model.name,
      scope: null,
      ...made,
    };
  const banned = bannedFor(user.role);
  const result = await runAgentTurn({
    model: deps.model,
    llm: deps.llm,
    ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
    profile: COPILOT_PROFILE,
    system: copilotSystemPrompt(user.role),
    history: input.history,
    text: input.text,
    tools: toolsForRole(user.role).map((t) => loopTool(t, client, made)),
    ...(banned ? { banned, bannedReply: COPILOT_FIXED.banned } : {}),
    fallbackReply: COPILOT_FIXED.fallback,
  });
  // A guarded turn shows no card that could carry a banned word.
  return result.kind === "guarded" ? { ...result, proposals: [], drafts: [] } : { ...result, ...made };
}
