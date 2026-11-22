import { createHash } from "node:crypto";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { maskPii, maskPiiText } from "@platform/kernel/pii";
import { z } from "zod";
import type { Llm } from "../index.ts";
import { checkScope, type AgentProfile, type ScopeCheck } from "./scope.ts";
import type { AgentModel, ToolSpec } from "./types.ts";
import { untrusted } from "./untrusted.ts";
import { actionClaim, verifyAnswer } from "./verify.ts";

/** At most this many tool calls per message. */
export const MAX_LOOP_TOOL_CALLS = 6;
/** One assistant turn, scope gate included, is cut off after this long (S24). */
export const TURN_TIMEOUT_MS = 60_000;
const MAX_ANSWER_CHARS = 1200;

/** A tool the loop may call: typed input, code behind it. A tool throws to report a failure to the model. */
export interface LoopTool {
  name: string;
  description: string;
  input: z.ZodType;
  run(args: unknown): Promise<unknown>;
  /**
   * Text written by code that ends the turn when the tool did its job (a confirmation, a fixed refusal): the model does
   * not get to reword it, so nothing model-written goes out with it. Return null to let the model answer.
   */
  final?: (out: unknown) => string | null;
}

export interface TurnInput {
  model: AgentModel;
  /** The decision model for the scope gate. Without one the gate is skipped (it fails open anyway). */
  llm: Pick<Llm, "decide"> | null;
  profile: AgentProfile;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  /** What the person typed. Always fenced as untrusted before the model sees it. */
  text: string;
  tools: LoopTool[];
  /** Other things an answer may quote (today's date, the page the person is on). The person's own words never count. */
  sources?: unknown[];
  maxToolCalls?: number;
  timeoutMs?: number;
  /** Code guard (S61): true when a reply or a tool result must never reach the person or the model. */
  banned?: (text: string) => boolean;
  /** Fixed reply when `banned` trips. */
  bannedReply?: string;
  /** Fixed reply when the model fails, times out or gives nothing usable. */
  fallbackReply: string;
}

export interface ToolRun {
  name: string;
  /** Masked arguments. */
  args: Record<string, unknown>;
  ok: boolean;
  resultSha256: string;
}

export type TurnKind = "answer" | "scope_blocked" | "guarded" | "fallback" | "timeout";

export interface TurnResult {
  reply: string;
  kind: TurnKind;
  tools: ToolRun[];
  /** Amounts, dates and percentages in `reply` that no tool result of this turn contains. */
  unverified: string[];
  verified: boolean;
  model: string;
  scope: ScopeCheck | null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const spec = (t: LoopTool): ToolSpec => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: z.toJSONSchema(t.input as z.ZodType, { io: "input" }) as Record<string, unknown>,
  },
});

class TurnTimeout extends Error {}

/** Races a promise against the turn's signal. */
function within<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new TurnTimeout());
    const onAbort = () => reject(new TurnTimeout());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * The bounded tool loop every assistant shares (S24, S61). Order: scope gate (a fixed reply for an off-topic message, the
 * chat model never runs), then the model with typed tools (at most six calls, 60 s for the whole turn), then the checks on
 * what it wrote: a banned word anywhere sends the fixed reply, a claimed action no tool took is retried once and then
 * replaced, an amount, date or percentage no tool returned this turn is retried once and then marked unverified. Tool
 * results and replies are returned masked; nothing here writes to a record, so a tool that does is the module's own code.
 * Never throws.
 */
export async function runAgentTurn(input: TurnInput): Promise<TurnResult> {
  const tools: ToolRun[] = [];
  const outputs: unknown[] = [];
  const timeoutMs = input.timeoutMs ?? TURN_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  const budgetTotal = input.maxToolCalls ?? MAX_LOOP_TOOL_CALLS;
  const result = (r: Omit<TurnResult, "tools" | "model" | "scope"> & Partial<Pick<TurnResult, "scope" | "model">>) => ({
    tools,
    model: input.model.name,
    scope: null,
    ...r,
  });
  const tripped = (t: string) => !!input.banned && input.banned(t);
  const guarded = () =>
    result({ reply: input.bannedReply ?? input.fallbackReply, kind: "guarded", unverified: [], verified: true });

  try {
    let scope: ScopeCheck | null = null;
    if (input.llm) {
      const last = [...input.history].reverse().find((m) => m.role === "assistant")?.content ?? null;
      scope = await within(checkScope(input.llm, input.text, last, input.profile), signal);
      if (scope.offTopic)
        return result({
          reply: input.profile.offTopicReply,
          kind: "scope_blocked",
          unverified: [],
          verified: true,
          scope,
        });
    }

    const specs = input.tools.map(spec);
    const messages: BaseMessage[] = [
      new SystemMessage(input.system),
      ...input.history.map((m) =>
        m.role === "user" ? new HumanMessage(untrusted(m.content)) : new AIMessage(m.content),
      ),
      new HumanMessage(untrusted(input.text)),
    ];
    let calls = 0;
    let retried = false;
    // The loop ends in an answer, a fixed reply, or the turn's clock; the guard against a model that never stops is the count.
    for (let step = 0; step < budgetTotal * 2 + 4; step++) {
      const limit = calls >= budgetTotal;
      if (limit)
        messages.push(new SystemMessage("Tool limit reached for this message. Answer now with what you have."));
      const turn = await within(
        input.model.respond(messages, limit ? null : specs, () => {}, signal),
        signal,
      );
      if (!limit && turn.toolCalls.length) {
        messages.push(
          new AIMessage({
            content: "",
            tool_calls: turn.toolCalls.map((t) => ({
              id: t.id,
              name: t.name,
              args: t.args,
              type: "tool_call" as const,
            })),
          }),
        );
        for (const call of turn.toolCalls) {
          const id = call.id;
          const record = (ok: boolean, content: string) => {
            tools.push({
              name: call.name,
              args: maskPii(call.args) as Record<string, unknown>,
              ok,
              resultSha256: sha256(content),
            });
            messages.push(new ToolMessage({ content, tool_call_id: id, name: call.name }));
          };
          const fail = (error: string) => record(false, JSON.stringify({ error: maskPiiText(error) }));
          const def = input.tools.find((t) => t.name === call.name);
          if (!def) {
            fail(`there is no tool named ${call.name}; use only the tools listed`);
            continue;
          }
          if (calls >= budgetTotal) {
            fail("tool call limit reached for this message");
            continue;
          }
          calls++;
          const args = def.input.safeParse(call.args);
          if (!args.success) {
            fail(`invalid arguments: ${args.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
            continue;
          }
          let out: unknown;
          try {
            out = await within(def.run(args.data), signal);
          } catch (e) {
            if (e instanceof TurnTimeout) throw e;
            fail(e instanceof Error ? e.message : String(e));
            continue;
          }
          const content = JSON.stringify(out ?? null);
          if (tripped(content)) return guarded();
          outputs.push(out);
          record(true, content);
          const fixed = def.final?.(out) ?? null;
          if (fixed !== null) {
            if (tripped(fixed)) return guarded();
            return result({ reply: fixed, kind: "answer", unverified: [], verified: true, scope });
          }
        }
        continue;
      }
      const text = turn.content.trim().slice(0, MAX_ANSWER_CHARS);
      if (tripped(text)) return guarded();
      const unverified = text ? verifyAnswer(text, [...(input.sources ?? []), ...outputs]).unverified : [];
      const claim = text ? actionClaim(text) : null;
      if (text && !claim && !unverified.length)
        return result({ reply: text, kind: "answer", unverified: [], verified: true, scope });
      if (!retried) {
        retried = true;
        messages.push(
          new SystemMessage(
            !text
              ? "You gave no answer. Answer in one or two short sentences, or call a tool."
              : `Your draft was not sent: ${[...unverified, ...(claim ? [`claims an action: ${claim}`] : [])].join("; ")}. State amounts, dates and percentages only exactly as a tool returned them in this turn (call the tool if you have not). Never say you did something or promise that you or someone will; only a tool acts. Write a new short answer.`,
          ),
        );
        continue;
      }
      if (!text || claim)
        return result({ reply: input.fallbackReply, kind: "fallback", unverified, verified: false, scope });
      // Still carries a value no tool returned: it goes out with each value marked unverified (specs §6.4), never silently.
      return result({ reply: text, kind: "answer", unverified, verified: false, scope });
    }
    return result({ reply: input.fallbackReply, kind: "fallback", unverified: [], verified: false, scope });
  } catch (e) {
    const timedOut = e instanceof TurnTimeout || signal.aborted;
    return result({
      reply: input.fallbackReply,
      kind: timedOut ? "timeout" : "fallback",
      unverified: [],
      verified: false,
    });
  }
}
