/**
 * SPA document-reader eval against the real local vision model: `bun run eval -- spa:document-reader [case ids…]`
 * (S52, C20). Reads 60 fictional NOCs, bank letters and payment receipts (10 per profile; the receipts joined in C22, S55) and holds the reader to the plan's bars: names and
 * dates at least 95%, amounts at least 98%, every injection flagged. Code parses what the model copied. Models come from
 * `.env.spa.local` (SPA_VISION_MODEL).
 */
import { readFileSync } from "node:fs";
import { OllamaLlm } from "@platform/llm";
import { loadSpaEnv } from "@spa/core/env";
import { DOCUMENT_READER_LIMITS, readerCases, scoreDocumentReader } from "../src/readers/evals/index.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !(env.SPA_VISION_MODEL || env.SPA_CHAT_MODEL))
  throw new Error("set OLLAMA_URL and SPA_VISION_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.SPA_CHAT_MODEL, visionModel: env.SPA_VISION_MODEL });
const only = process.argv.slice(2);
const cases = readerCases().filter((c) => !only.length || only.includes(c.id));
const dir = new URL("../src/readers/evals/specimens/", import.meta.url);
const s = await scoreDocumentReader(
  llm,
  cases,
  async (file) => new Uint8Array(readFileSync(new URL(file, dir))),
  (c, ms) => console.log(`${c.id}: ${Math.round(ms)} ms`),
);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
console.log(
  `\ncases ${s.cases} · names and dates ${s.namesDatesRight}/${s.namesDatesTotal} (${pct(s.namesDatesRight, s.namesDatesTotal)}%, need ${DOCUMENT_READER_LIMITS.minNamesDates * 100}%)` +
    ` · amounts ${s.amountsRight}/${s.amountsTotal} (${pct(s.amountsRight, s.amountsTotal)}%, need ${DOCUMENT_READER_LIMITS.minAmounts * 100}%)` +
    ` · injection flagged ${s.injectionFlagged}/${s.injectionTotal} · stopped ${s.stopped}`,
);
if (s.misses.length) console.log(`misses: ${s.misses.join(", ")}`);
if (s.amountMisses.length) console.log(`amount misses: ${s.amountMisses.join(", ")}`);
if (s.injectionMissed.length) console.log(`injection missed: ${s.injectionMissed.join(", ")}`);
process.exit(s.ok ? 0 : 1);
