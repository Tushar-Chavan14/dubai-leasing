/**
 * SPA agreement-review eval against the real local chat model: `bun run eval -- spa:agreement-review [ids…]` (S60, C25).
 * Runs 30 invented cases (FICTIONAL, SIMULATED; eight carry an injection in the offer conditions) through the helper as the
 * engine does and holds to: 0 false quotes among the flags kept, and every injection flagged. Recall, clean cases that got a
 * flag and the number of invented quotes the guard dropped are printed, not gated. The model only points things out; code
 * decides what is kept. Models come from `.env.spa.local` (SPA_CHAT_MODEL).
 */
import { OllamaLlm } from "@platform/llm";
import { loadSpaEnv } from "@spa/core/env";
import {
  AGREEMENT_REVIEW_EVAL_CASES,
  AGREEMENT_REVIEW_EVAL_LIMITS,
  scoreAgreementReviewCases,
} from "../src/agreement-review/evals/score.ts";

const env = loadSpaEnv();
if (!env.OLLAMA_URL || !env.SPA_CHAT_MODEL) throw new Error("set OLLAMA_URL and SPA_CHAT_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.SPA_CHAT_MODEL });
const only = process.argv.slice(2);
const cases = AGREEMENT_REVIEW_EVAL_CASES.filter((c) => !only.length || only.includes(c.id));
const s = await scoreAgreementReviewCases(llm, cases, (c, r, ms) =>
  console.log(
    `${r.status === "ok" ? " " : "✗"} ${c.id} ${r.status === "ok" ? `${r.flags.length} flags, ${r.dropped} dropped` : "needs a person"} ${Math.round(ms)} ms`,
  ),
);
console.log(
  `\ncases ${s.cases} · false quotes ${s.falseQuotes.length} (must be ${AGREEMENT_REVIEW_EVAL_LIMITS.maxFalseQuotes})` +
    ` · injections flagged ${s.injectionTotal - s.injectionMissed.length}/${s.injectionTotal} (must be all)` +
    ` · recall ${(s.recall * 100).toFixed(1)}% · invented quotes dropped ${s.droppedQuotes} · failed ${s.failed}`,
);
if (s.falseQuotes.length) console.log(`false quotes: ${s.falseQuotes.join(", ")}`);
if (s.injectionMissed.length) console.log(`injections missed: ${s.injectionMissed.join(", ")}`);
if (s.missed.length) console.log(`flags missed: ${s.missed.join(", ")}`);
if (s.cleanFlagged.length) console.log(`clean cases flagged: ${s.cleanFlagged.join(", ")}`);
process.exit(s.ok ? 0 : 1);
