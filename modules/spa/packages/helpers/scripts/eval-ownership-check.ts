/**
 * SPA ownership-check eval against the real local vision model: `bun run eval -- spa:ownership-check [case ids…]`
 * (S52, C20). Reads 30 fictional title deeds and checks them against labelled sellers with the C5 matching: the bar is
 * no wrong "matched" (a missed match is safe and only reported). Models come from `.env.spa.local` (SPA_VISION_MODEL).
 */
import { readFileSync } from "node:fs";
import { OllamaLlm } from "@platform/llm";
import { loadSpaEnv } from "@spa/core/env";
import { matchOwners, ownershipCases, scoreOwnershipCases } from "../src/readers/evals/index.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !(env.SPA_VISION_MODEL || env.SPA_CHAT_MODEL))
  throw new Error("set OLLAMA_URL and SPA_VISION_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.SPA_CHAT_MODEL, visionModel: env.SPA_VISION_MODEL });
const only = process.argv.slice(2);
const cases = ownershipCases().filter((c) => !only.length || only.includes(c.id));
const dir = new URL("../src/readers/evals/specimens/", import.meta.url);
const s = await scoreOwnershipCases(
  llm,
  cases,
  async (file) => new Uint8Array(readFileSync(new URL(file, dir))),
  matchOwners,
  (c, ms) => console.log(`${c.id}: ${Math.round(ms)} ms`),
);
console.log(
  `\ncases ${s.cases} · right ${s.right} · WRONG MATCHED ${s.wrongMatched.length} (must be 0) · missed matches ${s.missedMatch.length}` +
    ` · injection flagged ${s.injectionFlagged}/${s.injectionTotal} · stopped ${s.stopped}`,
);
if (s.wrongMatched.length) console.log(`wrong matched: ${s.wrongMatched.join(", ")}`);
if (s.missedMatch.length) console.log(`missed matches: ${s.missedMatch.join(", ")}`);
process.exit(s.ok ? 0 : 1);
