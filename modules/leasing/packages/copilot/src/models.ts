import { ollamaChatModel, ScriptedModel } from "@platform/llm/agent";

/** The local chat model and its test double moved to `@platform/llm/agent` (C26, S61); same behaviour, old names. */
export const ollamaCopilotModel = ollamaChatModel;
export { ScriptedModel };
