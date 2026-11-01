import { ollamaCopilotModel } from "@leasing/copilot";
import type { AgentModel } from "@leasing/helpers";
import { assertLocalModel } from "@leasing/llm";

/**
 * The chat model behind the contract agent (D45): `CONTRACT_AI_MODEL`, else `CHAT_MODEL`; it must support tool
 * calling. Contract records carry tenant ID numbers, so the model must be a local Ollama model on a loopback address
 * (AGENTS rule 8): a remote host or a cloud tag throws here, at start-up.
 */
export function contractAgentModel(cfg: { url: string; model: string }): AgentModel {
  assertLocalModel(cfg.url, cfg.model, "Contract records");
  return ollamaCopilotModel(cfg);
}
