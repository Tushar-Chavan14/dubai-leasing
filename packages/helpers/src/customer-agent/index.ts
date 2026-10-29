import { createHash } from "node:crypto";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { type Helper, maskPii, maskPiiText } from "@leasing/core";
import { enquiryCopy, isStatusStandIn } from "../leasing-assistant/copy.ts";
import { z } from "zod";
import { systemPrompt, untrusted } from "./prompt.ts";
import type { AgentContext, AgentData, AgentEffects } from "./schema.ts";
import { type AgentBackend, type ToolOutcome, toolsFor } from "./tools.ts";
import { actionClaim, verifyAnswer } from "./verify.ts";

export * from "./schema.ts";
export { AGENT_TOOLS, type AgentBackend, type ToolOutcome, toolsFor } from "./tools.ts";
export { systemPrompt, untrusted } from "./prompt.ts";
export { actionClaim, asciiDigits, verifyAnswer } from "./verify.ts";

/** At most this many tool calls per visitor message (decision D36). */
export const MAX_AGENT_TOOL_CALLS = 6;
const MAX_ANSWER_CHARS = 1200;

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface ModelTurn {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
}
/** The chat model behind the loop (same shape as the staff copilot's). `tools: null` means "answer now". */
export interface AgentModel {
  name: string;
  respond(
    messages: BaseMessage[],
    tools: ToolSpec[] | null,
    onToken: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ModelTurn>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  calls: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  retried: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  choiceNudged: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
});

/**
 * Customer Agent (decision D36). One LangGraph loop per visitor message: the chat model reads the
 * message and calls tools (search, unit facts, viewing times, book, apply, status, a choice card,
 * hand off); the tools are code. Model text is checked before it is sent: an AED amount or a date
 * that no tool returned this turn (the visitor's own words don't count), or a claim of a booking, application or email nothing confirmed,
 * sends the model back once, then ends in a fixed reply. A tool that commits something (or asks the
 * visitor for a missing detail) ends the turn with text written by code. The helper never throws:
 * a failing model becomes `needs_human` with `fallback` set, so a retry can't act twice.
 */
export function customerAgent(
  model: AgentModel,
  backend: AgentBackend,
  opts: { signal?: AbortSignal } = {},
): Helper<AgentContext, AgentData> {
  return {
    name: "customer_agent",
    async run(input) {
      const c = input.context;
      const offered = toolsFor(c);
      const specs: ToolSpec[] = offered.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: z.toJSONSchema(t.input as z.ZodTypeAny, { io: "input" }) as Record<string, unknown>,
        },
      }));
      const effects: AgentEffects = {};
      const tools: AgentData["tools"] = [];
      const outputs: unknown[] = [];
      let finalText: string | null = null;
      let answer: string | null = null;
      let failure: AgentData["fallback"] | null = null;
      /** Slot choice values from the last viewing_slots (two or more): the visitor must be offered them as a card. */
      let pendingChoices: string[] | null = null;
      const unverified: string[] = [];

      const problems = (text: string): string[] => {
        const found = verifyAnswer(text, [c.filters, { weekday: c.weekday }, ...outputs]).unverified;
        const claim = actionClaim(text);
        const out = claim ? [...found, `claims an action: ${claim}`] : found;
        // Never answer a status question with the stored stand-in line: call my_status for a fresh answer.
        return isStatusStandIn(text) ? [...out, "repeats an old placeholder instead of a fresh status"] : out;
      };

      const agent = async (s: typeof State.State) => {
        const limit = s.calls >= MAX_AGENT_TOOL_CALLS;
        const messages = limit
          ? [...s.messages, new SystemMessage("Tool limit reached for this message. Answer now with what you have.")]
          : s.messages;
        const ask = () => model.respond(messages, limit ? null : specs, () => {}, opts.signal);
        let turn: ModelTurn;
        try {
          turn = await ask();
        } catch (e) {
          // One more try after a thrown error (a dropped connection, a bad reply). Not after a timeout or an abort.
          if (opts.signal?.aborted || (e instanceof Error && /^(TimeoutError|AbortError)$/.test(e.name))) throw e;
          turn = await ask();
        }
        if (!limit && turn.toolCalls.length) {
          return {
            messages: [
              new AIMessage({
                content: "",
                tool_calls: turn.toolCalls.map((t) => ({
                  id: t.id,
                  name: t.name,
                  args: t.args,
                  type: "tool_call" as const,
                })),
              }),
            ],
          };
        }
        const text = turn.content.trim().slice(0, MAX_ANSWER_CHARS);
        if (pendingChoices && text) {
          // Times written out as text can't be tapped. Ask once for a choice card, then build it in code.
          if (!s.choiceNudged) {
            return {
              choiceNudged: true,
              messages: [
                new SystemMessage(
                  "Do not list the times in text. Call offer_choices now with 2 to 4 of the slot choice values from viewing_slots.",
                ),
              ],
            };
          }
          const options = pendingChoices.slice(0, 3).map((value) => ({ value }));
          try {
            const r = await backend.offer_choices({ question: enquiryCopy[c.language].slots, options });
            if (r.effects) Object.assign(effects, r.effects);
            tools.push({
              name: "offer_choices",
              args: { auto: true },
              ok: true,
              resultSha256: sha256(JSON.stringify(r.result)),
            });
            finalText = r.final ?? enquiryCopy[c.language].slots;
            return { messages: [new AIMessage(finalText)] };
          } catch {
            // fall through: the text goes through the normal checks
          }
        }
        const bad = text ? problems(text) : [];
        if (text && !bad.length) {
          answer = text;
          return { messages: [new AIMessage(text)] };
        }
        unverified.push(...bad);
        if (!s.retried) {
          return {
            retried: true,
            messages: [
              new SystemMessage(
                text
                  ? `Your draft was not sent: ${bad.join("; ")}. State amounts and dates only exactly as a tool returned them in this turn (call the tool if you have not). Never say you booked, applied or sent anything, and never promise that you or someone will: if the visitor asked for an action, call the tool for it: start_status_check or my_status for an application, apply_now to apply, viewing_slots to book, handoff for a tenant's repair, payment or lease question. Do not repeat amounts the visitor typed. Write a new short answer.`
                  : "You gave no answer. Answer the visitor in one or two short sentences, or call a tool.",
              ),
            ],
          };
        }
        failure = text ? "value_check" : "empty";
        return { messages: [new AIMessage(text)] };
      };

      const toolsNode = async (s: typeof State.State) => {
        const last = s.messages.at(-1) as AIMessage;
        const calls = last.tool_calls ?? [];
        const budget = Math.max(0, MAX_AGENT_TOOL_CALLS - s.calls);
        const out: ToolMessage[] = [];
        for (const [i, call] of calls.entries()) {
          const id = call.id ?? `call_${s.calls + i}`;
          const name = call.name;
          const rawArgs = (call.args ?? {}) as Record<string, unknown>;
          const fail = (error: string) => {
            const content = JSON.stringify({ error: maskPiiText(error) });
            tools.push({ name, args: maskPii(rawArgs), ok: false, resultSha256: sha256(content) });
            out.push(new ToolMessage({ content, tool_call_id: id, name }));
          };
          const def = offered.find((t) => t.name === name);
          if (!def) {
            fail(`there is no tool named ${name}; use only the tools listed`);
            continue;
          }
          if (i >= budget) {
            fail("tool call limit reached for this message");
            continue;
          }
          const args = def.input.safeParse(rawArgs);
          if (!args.success) {
            fail(`invalid arguments: ${args.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
            continue;
          }
          let r: ToolOutcome;
          try {
            r = await (backend[def.name] as (a: unknown) => Promise<ToolOutcome>).call(backend, args.data);
          } catch (e) {
            fail(e instanceof Error ? e.message : String(e));
            continue;
          }
          // A question the model wrote goes through the same value check as any model text.
          if (r.final && r.modelAuthored) {
            const bad = problems(r.final);
            if (bad.length) {
              unverified.push(...bad);
              fail(`the question was not accepted: ${bad.join("; ")}. Ask without amounts or dates.`);
              continue;
            }
          }
          const content = JSON.stringify(r.result);
          outputs.push(r.result);
          if (name !== "viewing_slots") pendingChoices = null; // the visitor moved on (a booking attempt, a search)
          if (name === "viewing_slots") {
            const slots = r.result.slots as { choice?: string }[] | undefined;
            const values = (slots ?? []).flatMap((x) => (x.choice ? [x.choice] : []));
            pendingChoices = values.length >= 2 ? values : null;
          }
          if (r.effects) Object.assign(effects, r.effects);
          tools.push({ name, args: maskPii(args.data), ok: true, resultSha256: sha256(content) });
          out.push(new ToolMessage({ content, tool_call_id: id, name }));
          if (r.final) {
            finalText = r.final;
            break; // the turn ends here; later calls in the same message are not run
          }
        }
        return { messages: out, calls: calls.length };
      };

      const graph = new StateGraph(State)
        .addNode("agent", agent)
        .addNode("tools", toolsNode)
        .addEdge(START, "agent")
        .addConditionalEdges(
          "agent",
          (s) => {
            if (answer !== null || failure || finalText !== null) return END;
            const last = s.messages.at(-1);
            if (last instanceof SystemMessage) return "agent";
            return (last as AIMessage).tool_calls?.length ? "tools" : END;
          },
          ["tools", "agent", END],
        )
        .addConditionalEdges("tools", () => (finalText !== null ? END : "agent"), ["agent", END])
        .compile();

      const initial: BaseMessage[] = [
        new SystemMessage(systemPrompt(c)),
        ...c.history.map((m) =>
          m.role === "user" ? new HumanMessage(untrusted(m.content)) : new AIMessage(m.content),
        ),
        new HumanMessage(untrusted(c.text)),
      ];
      const base = () => ({ language: c.language, tools, unverified: unverified.slice(0, 20) });
      try {
        await graph.invoke({ messages: initial }, { recursionLimit: MAX_AGENT_TOOL_CALLS * 2 + 10 });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return {
          status: "needs_human",
          data: { text: "", kind: "fallback", fallback: "model_error", effects: {}, ...base() },
          reasons: [`The model call failed: ${maskPiiText(reason).slice(0, 200)}`],
          sourceDocIds: [],
          model: { name: model.name },
        };
      }
      if (finalText === null && (failure || answer === null)) {
        return {
          status: "needs_human",
          data: { text: "", kind: "fallback", fallback: failure ?? "empty", effects: {}, ...base() },
          reasons: [`Answer not sent: ${failure ?? "empty"}.`],
          sourceDocIds: [],
          model: { name: model.name },
        };
      }
      const text = finalText ?? answer ?? "";
      return {
        status: "ok",
        data: { text, kind: finalText !== null ? "final" : "answer", effects, ...base() },
        reasons: [`${tools.length} tool call(s).`],
        sourceDocIds: [],
        model: { name: model.name },
      };
    },
  };
}

/** Test double for the chat model: one scripted turn per model call; records what it was shown. */
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
