/**
 * SPA staff copilot eval against the real local models: `bun run eval -- spa:copilot [ids…]` (C36, S68, specs §5c and §6.6).
 * The cases (FICTIONAL, SIMULATED) go through the copilot as the engine runs it, against a fixed stand-in for the engine
 * (no database): scope gate (decision model), chat model with the role's tools, the code checks. The hard limits decide the
 * exit code. Models come from `.env.spa.local` (SPA_DECISION_MODEL, and SPA_COPILOT_MODEL or else SPA_CHAT_MODEL). Run
 * it on its own; the real-model run is the user's.
 */
import { OllamaLlm } from "@platform/llm";
import { ollamaChatModel } from "@platform/llm/agent";
import { loadSpaEnv } from "@spa/core/env";
import { COPILOT_EVAL_CASES, COPILOT_EVAL_LIMITS, scoreCopilotCases } from "../src/evals/index.ts";

const env = loadSpaEnv();
const chat = env.SPA_COPILOT_MODEL || env.SPA_CHAT_MODEL;
if (!env.OLLAMA_URL || !chat || !env.SPA_DECISION_MODEL)
  throw new Error("set OLLAMA_URL, SPA_DECISION_MODEL and SPA_COPILOT_MODEL or SPA_CHAT_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.SPA_DECISION_MODEL });
const model = ollamaChatModel({ url: env.OLLAMA_URL, model: chat });
const only = process.argv.slice(2);
const cases = COPILOT_EVAL_CASES.filter((c) => !only.length || only.includes(c.id));
const s = await scoreCopilotCases({ model: () => model, llm }, cases, (c, reply, kind, ms) =>
  console.log(
    `${kind === "fallback" || kind === "timeout" ? "✗" : " "} ${c.id} [${c.role}] [${kind}] ${Math.round(ms)} ms: ${reply.slice(0, 90).replace(/\n/g, " ")}`,
  ),
);
console.log(
  `\ncases ${s.cases} · forbidden actions ${s.forbiddenActions.length} (must be ${COPILOT_EVAL_LIMITS.maxForbiddenActions})` +
    ` · AML words to non-compliance roles ${s.amlLeaks.length} (must be ${COPILOT_EVAL_LIMITS.maxAmlLeaks})` +
    ` · injections obeyed ${s.injectionsObeyed.length} (must be 0)` +
    ` · tool choice ${(s.toolChoiceRate * 100).toFixed(1)}% (bar ${COPILOT_EVAL_LIMITS.minToolChoice * 100}%)` +
    ` · unverified ${(s.unverifiedRate * 100).toFixed(1)}% (max ${COPILOT_EVAL_LIMITS.maxUnverifiedRate * 100}%)` +
    ` · scope gate ${(s.scopeRate * 100).toFixed(1)}% · unknown tools tried ${s.unknownTools.length}` +
    ` · proposals and drafts stored ${s.writes} · failed ${s.failed}`,
);
for (const [label, ids] of [
  ["forbidden", s.forbiddenActions],
  ["aml words", s.amlLeaks],
  ["injection obeyed", s.injectionsObeyed],
  ["tool choice missed", s.toolChoiceMissed],
  ["scope wrong", s.scopeWrong],
  ["unverified", s.unverified],
  ["unknown tools", s.unknownTools],
] as const)
  if (ids.length) console.log(`${label}: ${ids.join(", ")}`);
process.exit(s.ok ? 0 : 1);
