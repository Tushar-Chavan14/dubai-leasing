/**
 * SPA listing chat eval against the real local models: `bun run eval -- spa:listing-chat [ids…]` (S61, C26). 30 invented cases
 * (FICTIONAL, SIMULATED) go through the assistant as the engine runs it: scope gate (decision model), chat model with tools,
 * the code checks. Hard limits are printed with each result and decide the exit code. Models come from `.env.spa.local`
 * (SPA_DECISION_MODEL, and SPA_ASSISTANT_MODEL or else SPA_CHAT_MODEL).
 */
import { OllamaLlm } from "@platform/llm";
import { ollamaChatModel } from "@platform/llm/agent";
import { loadSpaEnv } from "@spa/core/env";
import { LISTING_EVAL_CASES, LISTING_EVAL_LIMITS, scoreListingCases } from "../src/assistants/evals/listing.ts";

const env = loadSpaEnv();
const chat = env.SPA_ASSISTANT_MODEL || env.SPA_CHAT_MODEL;
if (!env.OLLAMA_URL || !chat || !env.SPA_DECISION_MODEL)
  throw new Error("set OLLAMA_URL, SPA_DECISION_MODEL and SPA_ASSISTANT_MODEL or SPA_CHAT_MODEL in .env.spa.local");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.SPA_DECISION_MODEL });
const model = ollamaChatModel({ url: env.OLLAMA_URL, model: chat });
const only = process.argv.slice(2);
const cases = LISTING_EVAL_CASES.filter((c) => !only.length || only.includes(c.id));
const s = await scoreListingCases({ model: () => model, llm }, cases, (c, reply, kind, ms) =>
  console.log(
    `${kind === "fallback" || kind === "timeout" ? "✗" : " "} ${c.id} [${kind}] ${Math.round(ms)} ms: ${reply.slice(0, 90).replace(/\n/g, " ")}`,
  ),
);
console.log(
  `\ncases ${s.cases} · seller data ${s.sellerLeaks.length} (must be ${LISTING_EVAL_LIMITS.maxSellerLeaks})` +
    ` · scope gate ${(s.scopeRate * 100).toFixed(1)}% (must be at least ${LISTING_EVAL_LIMITS.minScopeRate * 100}%)` +
    ` · enquiries without consent ${s.unconsentedEnquiries.length} (must be ${LISTING_EVAL_LIMITS.maxUnconsentedEnquiries})` +
    ` · unasked enquiries ${s.unaskedEnquiries.length} · action claims ${s.claims.length} · unverified answers ${s.unverified} · failed ${s.failed}`,
);
for (const [label, ids] of [
  ["seller data", s.sellerLeaks],
  ["scope wrong", s.scopeWrong],
  ["no consent", s.unconsentedEnquiries],
  ["unasked enquiries", s.unaskedEnquiries],
] as const)
  if (ids.length) console.log(`${label}: ${ids.join(", ")}`);
process.exit(s.ok ? 0 : 1);
