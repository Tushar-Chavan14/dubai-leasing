import { ollamaCopilotModel } from "@leasing/copilot";
import type { AgentModel } from "@leasing/helpers";
import { assertLocalModel } from "@platform/llm";

/** Room for the contract agent's whole JSON answer (rewordings of several template paragraphs). */
export const CONTRACT_AGENT_MAX_TOKENS = 2000;

/**
 * The chat model behind the contract agent (D45): `CONTRACT_AI_MODEL`, else `CHAT_MODEL`; it must support tool
 * calling. Contract records carry tenant ID numbers, so the model must be a local Ollama model on a loopback address
 * (AGENTS rule 8): a remote host or a cloud tag throws here, at start-up.
 */
export function contractAgentModel(cfg: { url: string; model: string }): AgentModel {
  assertLocalModel(cfg.url, cfg.model, "Contract records");
  // The answer is JSON with clause reasons, flags and template rewordings: the copilot's 400-token cap cut it off
  // mid-rewording, so it never parsed and every such contract went to a person.
  return ollamaCopilotModel({ ...cfg, numPredict: CONTRACT_AGENT_MAX_TOKENS });
}
