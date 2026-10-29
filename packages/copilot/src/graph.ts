import { createHash } from "node:crypto";
import { maskPii, maskPiiText } from "@leasing/core";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { type PageContext, systemPrompt } from "./prompt.ts";
import type { Choices, CopilotCard, ToolUi } from "./ui.ts";
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
  respond(
    messages: BaseMessage[],
    tools: ToolSpec[] | null,
    onToken: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ModelTurn>;
}

export type CopilotEvent =
  | { type: "tool"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; error?: string }
  | { type: "token"; text: string }
  /** The text streamed so far was a preamble to tool calls, not the answer: clear it. */
  | { type: "discard" }
  /** Record or unit cards a tool produced; the client shows them under the answer. */
  | { type: "cards"; cards: CopilotCard[] }
  /** A tap-to-choose card; a tap only sends text or opens a page. */
  | { type: "choices"; choices: Choices };

export interface ToolRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** What the model saw (masked JSON, or the error message). */
  content: string;
  /** Parsed, masked output for the post-check, without `ui` (null on error). */
  output: unknown;
  /** Cards and choices the tool produced for the client; the model never sees them. */
  ui?: ToolUi;
  resultSha256: string;
}

export interface CopilotTurn {
  answer: string;
  tools: ToolRecord[];
  model: string;
  cards: CopilotCard[];
  choices?: Choices;
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
  const { ui, ...forModel } = maskPii(out.data) as Record<string, unknown> & { ui?: ToolUi };
  const content = JSON.stringify(forModel);
  return {
    id: call.id,
    name: call.name,
    args: args.data as Record<string, unknown>,
    ok: true,
    content,
    output: forModel,
    ...(ui ? { ui } : {}),
    resultSha256: sha256(content),
  };
}

/**
 * Values a tool returned this turn, with the page each opens: `offer_choices` accepts only these.
 * Text wrapped as untrusted (written by tenants or applicants) is never issued.
 */
export function collectIssued(into: Map<string, string | null>, output: unknown, ui?: ToolUi) {
  // Only identifier-like fields can become a choice (ids, refs, codes, areas, company names, stages).
  // Person names and other free text never do, wrapped or not.
  const KEYS = new Set(["ref", "unitId", "id", "code", "unitCode", "community", "company", "stage", "category", "at"]);
  const walk = (v: unknown, key = "", parent = "") => {
    if (typeof v === "string") {
      const ok = KEYS.has(key) || (key === "name" && parent === "companies");
      if (ok && v.length <= 80 && !v.includes("<untrusted>") && !into.has(v)) into.set(v, null);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key, parent));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k, key || parent);
  };
  walk(output);
  for (const c of ui?.cards ?? []) {
    if (c.kind === "record") {
      into.set(c.ref, c.href);
      into.set(c.id, c.href);
    } else {
      into.set(c.card.unitId, c.href);
      into.set(c.card.code, c.href);
    }
  }
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
  /** TENANCY_OPS from the engine. */
  tenancyOps: boolean;
}): Promise<CopilotTurn> {
  const { model, ctx } = opts;
  const emit = opts.onEvent ?? (() => {});
  const tools = toolsFor(ctx.user.role, { tenancyOps: opts.tenancyOps });
  const specs = tools.map(toolSpec);
  const records: ToolRecord[] = [];
  const issued = new Map<string, string | null>();
  const toolCtx: ToolContext = { ...ctx, issued, tenancyOps: opts.tenancyOps };
  const cards: CopilotCard[] = [];
  let choices: Choices | undefined;

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
            "Your draft stated amounts, dates or percentages without calling a tool. Call the right tool now (pipeline_summary, list_records, get_record, explain_rule…) and answer only from its result.",
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
          ? await callTool(tools, call, toolCtx)
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
      if (rec.ok) {
        collectIssued(issued, rec.output, rec.ui);
        if (rec.ui?.cards?.length) {
          cards.push(...rec.ui.cards);
          emit({ type: "cards", cards: rec.ui.cards });
        }
        if (rec.ui?.choices) {
          choices = rec.ui.choices;
          emit({ type: "choices", choices });
        }
      }
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
    new SystemMessage(systemPrompt(ctx.user, ctx.today, opts.page, { tenancyOps: opts.tenancyOps })),
    ...(opts.history ?? []).map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content))),
    new HumanMessage(opts.message),
  ];
  const final = await graph.invoke({ messages: initial }, { recursionLimit: MAX_TOOL_CALLS * 2 + 6 });
  const last = final.messages.at(-1);
  const answer = typeof last?.content === "string" ? last.content : "";
  return { answer: answer.trim(), tools: records, model: model.name, cards, ...(choices ? { choices } : {}) };
}
