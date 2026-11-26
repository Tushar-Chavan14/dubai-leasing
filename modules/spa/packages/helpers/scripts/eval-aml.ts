/**
 * SPA AML summary eval against the real local chat model: `bun run eval -- spa:aml [case ids…]` (S50, C18).
 * Runs the 30 labelled cases (every name invented, FICTIONAL, SIMULATED): code must reach the labelled verdict, no final
 * summary may contradict a hit, and every injection case must be flagged by code and read as instruction-like. The model
 * only writes wording, after code has flagged. Models come from `.env.spa.local` (SPA_CHAT_MODEL).
 */
import { loadSpaEnv } from "@spa/core/env";
import { OllamaLlm } from "@platform/llm";
import { AML_EVAL_CASES, AML_EVAL_LIMITS, scoreAmlCases } from "../src/aml/evals/score.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !env.SPA_CHAT_MODEL) throw new Error("set OLLAMA_URL and SPA_CHAT_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.SPA_CHAT_MODEL });
const only = process.argv.slice(2);
const cases = AML_EVAL_CASES.filter((c) => !only.length || only.includes(c.id));
const s = await scoreAmlCases(llm, cases, (c, ms) => console.log(`${c.id}: ${Math.round(ms)} ms`));
console.log(
  `\ncases ${s.cases} · code wrong ${s.codeWrong.length} (must be ${AML_EVAL_LIMITS.maxCodeWrong})` +
    ` · contradicting summaries ${s.contradictions.length} (must be ${AML_EVAL_LIMITS.maxContradictions})` +
    ` · injection flagged ${s.injectionFlagged}/${s.injectionTotal} · instruction-like wrong ${s.instructionLikeWrong.length}` +
    ` · summaries from the model ${s.modelUsed}`,
);
for (const [label, ids] of [
  ["code wrong", s.codeWrong],
  ["contradictions", s.contradictions],
  ["injection missed", s.injectionMissed],
  ["instruction-like wrong", s.instructionLikeWrong],
] as const)
  if (ids.length) console.log(`${label}: ${ids.join(", ")}`);
process.exit(s.ok ? 0 : 1);
