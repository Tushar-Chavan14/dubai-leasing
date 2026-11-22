/**
 * SPA KYC eval against the real local vision model: `bun run eval -- spa:kyc [case ids…]` (S49, C17).
 * Reads the 40 fictional specimens in `src/kyc/evals/specimens/` and holds the reader to the plan's limits: at least
 * 95% of fields exact and no expired document passing. Models come from `.env.spa.local` (SPA_VISION_MODEL).
 */
import { readFileSync } from "node:fs";
import { loadSpaEnv } from "@spa/core/env";
import { OllamaLlm } from "@platform/llm";
import { KYC_EVAL_LIMITS, loadKycCases, scoreKycCases } from "../src/kyc/evals/score.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !(env.SPA_VISION_MODEL || env.SPA_CHAT_MODEL))
  throw new Error("set OLLAMA_URL and SPA_VISION_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.SPA_CHAT_MODEL, visionModel: env.SPA_VISION_MODEL });
const only = process.argv.slice(2);
const cases = loadKycCases().filter((c) => !only.length || only.includes(c.id));
const dir = new URL("../src/kyc/evals/specimens/", import.meta.url);
const times: number[] = [];
const s = await scoreKycCases(
  llm,
  cases,
  async (file) => new Uint8Array(readFileSync(new URL(file, dir))),
  (c, ms) => {
    times.push(ms);
    console.log(`${c.id}: ${Math.round(ms)} ms`);
  },
);
const pct = s.fieldsTotal ? Math.round((100 * s.fieldsRight) / s.fieldsTotal) : 0;
console.log(
  `\ncases ${s.cases} · fields exact ${s.fieldsRight}/${s.fieldsTotal} (${pct}%, need ${KYC_EVAL_LIMITS.minFieldsExact * 100}%)` +
    ` · expired blocked ${s.expiredBlocked} · EXPIRED PASSED ${s.expiredPassed} (must be 0) · valid verified ${s.validVerified} · stopped ${s.stopped}`,
);
if (s.misses.length) console.log(`misses: ${s.misses.join(", ")}`);
process.exit(s.ok ? 0 : 1);
