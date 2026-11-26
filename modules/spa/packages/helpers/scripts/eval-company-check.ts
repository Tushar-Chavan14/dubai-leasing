/**
 * SPA company-check eval against the real local vision model: `bun run eval -- spa:company-check [case ids…]`
 * (S52, C20). Reads 30 fictional companies (licence, memorandum, POA or board resolution) and checks them by code:
 * signer and owners right at least 95%, and no company that should be review is passed. Models come from
 * `.env.spa.local` (SPA_VISION_MODEL).
 */
import { readFileSync } from "node:fs";
import { OllamaLlm } from "@platform/llm";
import { loadSpaEnv } from "@spa/core/env";
import { COMPANY_CHECK_LIMITS, companyCases, scoreCompanyCases } from "../src/readers/evals/index.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !(env.SPA_VISION_MODEL || env.SPA_CHAT_MODEL))
  throw new Error("set OLLAMA_URL and SPA_VISION_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.SPA_CHAT_MODEL, visionModel: env.SPA_VISION_MODEL });
const only = process.argv.slice(2);
const cases = companyCases().filter((c) => !only.length || only.includes(c.id));
const dir = new URL("../src/readers/evals/specimens/", import.meta.url);
const s = await scoreCompanyCases(
  llm,
  cases,
  async (file) => new Uint8Array(readFileSync(new URL(file, dir))),
  (c, ms) => console.log(`${c.id}: ${Math.round(ms)} ms`),
);
const pct = (a: number) => (s.cases ? Math.round((100 * a) / s.cases) : 0);
console.log(
  `\ncases ${s.cases} · signer ${s.signerRight}/${s.cases} (${pct(s.signerRight)}%, need ${COMPANY_CHECK_LIMITS.minSignerAndOwners * 100}%)` +
    ` · owners ${s.ownersRight}/${s.cases} (${pct(s.ownersRight)}%) · status ${s.statusRight}/${s.cases}` +
    ` · WRONG PASS ${s.wrongPass.length} (must be 0) · injection flagged ${s.injectionFlagged}/${s.injectionTotal} · stopped ${s.stopped}`,
);
if (s.misses.length) console.log(`misses: ${s.misses.join(", ")}`);
if (s.wrongPass.length) console.log(`wrong pass: ${s.wrongPass.join(", ")}`);
process.exit(s.ok ? 0 : 1);
