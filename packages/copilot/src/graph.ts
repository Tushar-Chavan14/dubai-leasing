import { createHash } from "node:crypto";
import { maskPii, maskPiiText } from "@leasing/core";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { type PageContext, systemPrompt } from "./prompt.ts";
import { verifyAnswer } from "./verify.ts";
import { toolsFor } from "./tools/index.ts";
import type { CopilotTool, ToolContext } from "./types.ts";

/** At most this many tool calls per user turn (architecture §8b, safeguard 7). */
export const MAX_TOOL_CALLS = 8;

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelTurn {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}

/** The chat model behind the loop. `tools: null` means "answer now, no more tool calls". */
export interface CopilotModel {
  name: string;
  respond(messages: BaseMessage[], tools: ToolSpec[] | null, onToken: (text: string) => void): Promise<ModelTurn>;
}

export type CopilotEvent =
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; error?: string }
  | { type: "token"; text: string }
  /** The text streamed so far was a preamble to tool calls, not the answer: clear it. */
  | { type: "discard" };

export interface ToolRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** What the model saw (masked JSON, or the error message). */
  content: string;
  /** Parsed, masked output for the post-check (null on error). */
  output: unknown;
  resultSha256: string;
}

export interface CopilotTurn {
  answer: string;
  tools: ToolRecord[];
  model: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const toolSpec = (t: CopilotTool): ToolSpec => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>,
  },
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Runs one tool call: parse arguments, call the engine as the user, parse and mask the output. */
async function callTool(
  tools: readonly CopilotTool[],
  call: ModelTurn["toolCalls"][number],
  ctx: ToolContext,
): Promise<ToolRecord> {
  const fail = (error: string): ToolRecord => {
    // Errors can echo what was asked (a name, a phone number): masked like any tool output.
    const content = JSON.stringify({ error: maskPiiText(error) });
    return {
      id: call.id,
      name: call.name,
      args: call.args,
      ok: false,
      content,
      output: null,
      resultSha256: sha256(content),
    };
  };
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return fail(`there is no tool named ${call.name}; you can only use the tools listed`);
  const args = tool.input.safeParse(call.args ?? {});
  if (!args.success) {
    return fail(`invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  let raw: unknown;
  try {
    raw = await tool.run(args.data, ctx);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  const out = tool.output.safeParse(raw);
  if (!out.success) return fail("the tool returned data in an unexpected shape; no data is available from it");
  const masked = maskPii(out.data);
  const content = JSON.stringify(masked);
  return {
    id: call.id,
    name: call.name,
    args: args.data as Record<string, unknown>,
    ok: true,
    content,
    output: masked,
    resultSha256: sha256(content),
  };
}

/**
 * One copilot turn: a LangGraph loop with an agent node (the chat model) and a tools node
 * (read tools, called as the user). Bounded at MAX_TOOL_CALLS; after that the model must answer.
 */
export async function runCopilotTurn(opts: {
  model: CopilotModel;
  ctx: ToolContext;
  message: string;
  history?: HistoryMessage[];
  page?: PageContext;
  onEvent?: (e: CopilotEvent) => void;
  /** Called as each tool call completes, so the audit keeps it even if the turn later fails. */
  onTool?: (r: ToolRecord) => void;
}): Promise<CopilotTurn> {
  const { model, ctx } = opts;
  const emit = opts.onEvent ?? (() => {});
  const tools = toolsFor(ctx.user.role);
  const specs = tools.map(toolSpec);
  const records: ToolRecord[] = [];

  const State = Annotation.Root({
    messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
    toolCalls: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
    nudged: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  });

  const agent = async (s: typeof State.State) => {
    const limit = s.toolCalls >= MAX_TOOL_CALLS;
    const messages = limit
      ? [...s.messages, new SystemMessage("Tool limit reached for this turn. Answer now with what you have.")]
      : s.messages;
    let streamed = false;
    const turn = await model.respond(messages, limit ? null : specs, (text) => {
      streamed = true;
      emit({ type: "token", text });
    });
    const calls = limit ? [] : turn.toolCalls;
    // Rule 1 in code, not just in the prompt: an answer that states amounts, dates or
    // percentages with no tool called this turn is sent back once with an instruction.
    const unbacked =
      !calls.length &&
      !s.nudged &&
      s.toolCalls === 0 &&
      verifyAnswer(turn.content, [opts.message, ctx.today]).unverified.length > 0;
    if (unbacked) {
      if (streamed) emit({ type: "discard" });
      return {
        nudged: true,
        messages: [
          new SystemMessage(
            "Your draft stated amounts, dates or percentages without calling a tool. Call the right tool now (compute_renewal_cap, explain_rule, get_lease, list_deadlines…) and answer only from its result.",
          ),
        ],
      };
    }
    if (calls.length && streamed) emit({ type: "discard" });
    return {
      messages: [
        new AIMessage({
          content: turn.content,
          tool_calls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args, type: "tool_call" as const })),
        }),
      ],
    };
  };

  const toolsNode = async (s: typeof State.State) => {
    const last = s.messages.at(-1) as AIMessage;
    const calls = last.tool_calls ?? [];
    const budget = Math.max(0, MAX_TOOL_CALLS - s.toolCalls);
    const out: ToolMessage[] = [];
    for (const [i, c] of calls.entries()) {
      const call = {
        id: c.id ?? `call_${s.toolCalls + i}`,
        name: c.name,
        args: (c.args ?? {}) as Record<string, unknown>,
      };
      emit({ type: "tool", id: call.id, name: call.name, args: call.args });
      const rec =
        i < budget
          ? await callTool(tools, call, ctx)
          : {
              id: call.id,
              name: call.name,
              args: call.args,
              ok: false,
              content: JSON.stringify({ error: "tool call limit reached for this turn" }),
              output: null,
              resultSha256: "",
            };
      records.push(rec);
      opts.onTool?.(rec);
      emit({ type: "tool_result", id: rec.id, name: rec.name, ok: rec.ok, ...(rec.ok ? {} : { error: rec.content }) });
      out.push(new ToolMessage({ content: rec.content, tool_call_id: call.id, name: call.name }));
    }
    return { messages: out, toolCalls: calls.length };
  };

  const graph = new StateGraph(State)
    .addNode("agent", agent)
    .addNode("tools", toolsNode)
    .addEdge(START, "agent")
    .addConditionalEdges(
      "agent",
      (s) => {
        const last = s.messages.at(-1);
        if (last instanceof SystemMessage) return "agent"; // nudged: try again
        return (last as AIMessage).tool_calls?.length ? "tools" : END;
      },
      ["tools", "agent", END],
    )
    .addEdge("tools", "agent")
    .compile();

  const initial: BaseMessage[] = [
    new SystemMessage(systemPrompt(ctx.user, ctx.today, opts.page)),
    ...(opts.history ?? []).map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content))),
    new HumanMessage(opts.message),
  ];
  const final = await graph.invoke({ messages: initial }, { recursionLimit: MAX_TOOL_CALLS * 2 + 6 });
  const last = final.messages.at(-1);
  const answer = typeof last?.content === "string" ? last.content : "";
  return { answer: answer.trim(), tools: records, model: model.name };
}
