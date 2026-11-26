import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import type { AgentModel, ModelTurn, ToolSpec } from "./types.ts";

const textOf = (content: AIMessageChunk["content"]) =>
  typeof content === "string"
    ? content
    : content.map((p) => (typeof p === "string" ? p : "text" in p ? String(p.text) : "")).join("");

/**
 * Local chat model through Ollama (decision D5): temperature 0, thinking off (latency), kept
 * loaded between turns. The model must support tool calling.
 */
export function ollamaChatModel(cfg: { url: string; model: string; numPredict?: number }): AgentModel {
  const chat = new ChatOllama({
    baseUrl: cfg.url,
    model: cfg.model,
    temperature: 0,
    think: false,
    keepAlive: "10m",
    // The system prompt and tool schemas alone are ~4.2k tokens; Ollama's 4096 default silently
    // truncates the question. Leave room for history and tool results.
    numCtx: 16384,
    // Answers are short by design; a hard stop keeps a runaway answer from holding the model. Callers with longer
    // structured answers (the contract agent's JSON) pass their own.
    numPredict: cfg.numPredict ?? 400,
  });
  return {
    name: cfg.model,
    async respond(messages: BaseMessage[], tools: ToolSpec[] | null, onToken, signal, opts): Promise<ModelTurn> {
      const runnable = tools?.length ? chat.bindTools(tools) : chat;
      let acc: AIMessageChunk | undefined;
      const call = {
        ...(signal ? { signal } : {}),
        // Structured output only on a turn with no tools (a schema would stop tool calls).
        ...(opts?.format && !tools?.length ? { format: opts.format } : {}),
      };
      for await (const chunk of await runnable.stream(messages, call)) {
        const t = textOf(chunk.content);
        if (t) onToken(t);
        acc = acc ? acc.concat(chunk) : chunk;
      }
      return {
        content: acc ? textOf(acc.content) : "",
        toolCalls: (acc?.tool_calls ?? []).map((c, i) => ({
          id: c.id ?? `call_${i}`,
          name: c.name,
          args: (c.args ?? {}) as Record<string, unknown>,
        })),
      };
    },
  };
}

/** Test double: replies from a script, one entry per model call; records what it was shown. */
export class ScriptedModel implements AgentModel {
  name = "scripted";
  calls: { messages: BaseMessage[]; tools: ToolSpec[] | null }[] = [];
  constructor(private readonly script: ((call: number, messages: BaseMessage[]) => ModelTurn)[]) {}
  async respond(messages: BaseMessage[], tools: ToolSpec[] | null, onToken: (t: string) => void) {
    this.calls.push({ messages, tools });
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)];
    if (!step) throw new Error("script is empty");
    const turn = step(this.calls.length - 1, messages);
    if (turn.content) onToken(turn.content);
    return turn;
  }
}

/** Test double for the customer agent's chat model: like `ScriptedModel`, but streams nothing. */
export class ScriptedAgentModel implements AgentModel {
  name = "scripted-agent";
  calls: { messages: BaseMessage[]; tools: ToolSpec[] | null }[] = [];
  constructor(private readonly script: ((call: number, messages: BaseMessage[]) => ModelTurn)[]) {}
  async respond(messages: BaseMessage[], tools: ToolSpec[] | null): Promise<ModelTurn> {
    this.calls.push({ messages, tools });
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)];
    if (!step) throw new Error("script is empty");
    return step(this.calls.length - 1, messages);
  }
}

/** A scripted tool call, for tests. */
export const callTool = (name: string, args: Record<string, unknown> = {}, id = `c-${name}`): ModelTurn => ({
  content: "",
  toolCalls: [{ id, name, args }],
});
export const say = (content: string): ModelTurn => ({ content, toolCalls: [] });
