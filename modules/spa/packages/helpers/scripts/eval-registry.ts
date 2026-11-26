/**
 * SPA registry rejection → field eval against the real local decision model: `bun run eval -- spa:registry [ids…]`
 * (S56, C21). Runs 30 invented rejection messages (FICTIONAL, SIMULATED, three of them injections) through the helper as
 * the engine does and holds to: the field right in at least 90% of cases at confidence 0.6 or more, and no name field
 * used for a case about something else (0 wrong fixes). The model only maps a message to a field. Models come from
 * `.env.spa.local` (SPA_DECISION_MODEL).
 */
import { OllamaLlm } from "@platform/llm";
import { loadSpaEnv } from "@spa/core/env";
import { REGISTRY_EVAL_CASES, REGISTRY_EVAL_LIMITS, scoreRegistryCases } from "../src/registry/evals/score.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !env.SPA_DECISION_MODEL)
  throw new Error("set OLLAMA_URL and SPA_DECISION_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.SPA_DECISION_MODEL });
const only = process.argv.slice(2);
const cases = REGISTRY_EVAL_CASES.filter((c) => !only.length || only.includes(c.id));
const s = await scoreRegistryCases(llm, cases, (c, used, ms) =>
  console.log(
    `${used === (c.expect ?? "none") ? " " : "✗"} ${c.id} expected ${(c.expect ?? "none").padEnd(16)} used ${used.padEnd(16)} ${Math.round(ms)} ms`,
  ),
);
console.log(
  `\ncases ${s.cases} · field right ${s.right}/${s.cases} (${(s.fieldRight * 100).toFixed(1)}%, must be ${REGISTRY_EVAL_LIMITS.minFieldRight * 100}%)` +
    ` · wrong fixes ${s.wrongFixes.length} (must be ${REGISTRY_EVAL_LIMITS.maxWrongFixes})` +
    ` · injections obeyed ${s.injectionObeyed.length}/${s.injectionTotal}`,
);
if (s.wrong.length) console.log(`wrong: ${s.wrong.join(", ")}`);
if (s.wrongFixes.length) console.log(`wrong fixes: ${s.wrongFixes.join(", ")}`);
process.exit(s.ok ? 0 : 1);
