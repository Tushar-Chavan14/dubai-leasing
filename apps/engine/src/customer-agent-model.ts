import { ollamaCopilotModel } from "@leasing/copilot";
import type { AgentModel } from "@leasing/helpers";
import { assertLocalModel } from "@leasing/llm";

/**
 * The chat model behind the public web chat agent (decision D36): `CUSTOMER_AGENT_MODEL`, else
 * `CHAT_MODEL`; it must support tool calling. What visitors type is personal data, so the model
 * has to be a local Ollama model on a loopback address (AGENTS rule 8): a remote host or a cloud
 * tag throws here, at start-up.
 */
export function customerAgentModel(cfg: { url: string; model: string }): AgentModel {
  assertLocalModel(cfg.url, cfg.model, "Visitor messages");
  return ollamaCopilotModel(cfg);
}
