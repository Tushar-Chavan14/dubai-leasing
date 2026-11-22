import type { BaseMessage } from "@langchain/core/messages";

/** A tool as the chat model is told about it (Ollama / OpenAI function format). */
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ModelTurn {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}
/** The chat model behind every agent loop. `tools: null` means "answer now, no more tool calls". */
export interface AgentModel {
  name: string;
  respond(
    messages: BaseMessage[],
    tools: ToolSpec[] | null,
    onToken: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ModelTurn>;
}
