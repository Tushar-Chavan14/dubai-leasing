/**
 * Reply-classifier eval against the real decision model. `bun run eval -- reply` (needs Ollama with DECISION_MODEL).
 * Prints accuracy, a confusion matrix, legal-threat recall and the cases that went to a person.
 */
import { readFileSync } from "node:fs";
import { defaultCompanyPolicy, EnvSchema } from "@leasing/core";
import { OllamaLlm } from "@leasing/llm";
import { offerReplyClassifier, replyClassifier } from "../src/index.ts";
import { INTENTS, OFFER_INTENTS } from "../src/reply-classifier/prompt.ts";

// `bun run eval -- reply` (renewal replies) or `bun run eval -- offer-reply` (offer answers).
const offer = process.argv.includes("--offer");

// Only the model settings matter here; mail and session checks are for the running engine.
const env = EnvSchema.pick({ OLLAMA_URL: true, DECISION_MODEL: true }).parse(process.env);
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.DECISION_MODEL });
const helper = offer ? offerReplyClassifier(llm) : replyClassifier(llm);
const cases = readFileSync(
  new URL(`../src/reply-classifier/evals/${offer ? "offer-cases" : "cases"}.jsonl`, import.meta.url),
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map(
    (l) =>
      JSON.parse(l) as {
        id: string;
        choice: string;
        comment: string;
        intent: string;
        legal: boolean;
        injection?: boolean;
      },
  );

// The thresholds the engine uses (company policy), so the numbers below are the real ones.
const {
  replyMinConfidence: minConfidence,
  replyLegalThreatThreshold: legalThreatThreshold,
  replyInjectionThreshold: injectionThreshold,
} = defaultCompanyPolicy;
const confusion = new Map<string, Map<string, number>>();
let correct = 0;
let legalHit = 0;
let legalTotal = 0;
let falseLegal = 0;
let latency = 0;
let injectionTotal = 0;
let injectionToPerson = 0;
for (const c of cases) {
  const t0 = performance.now();
  const r = await helper.run({
    runId: c.id,
    entity: { kind: "lease", id: c.id },
    step: "RENEWAL",
    context: { choice: c.choice as never, comment: c.comment, minConfidence, legalThreatThreshold, injectionThreshold },
    rulesVersion: "dubai-2025-01",
    now: new Date().toISOString(),
  });
  latency += performance.now() - t0;
  const got = r.data?.intent ?? "error";
  if (got === c.intent) correct++;
  const row = confusion.get(c.intent) ?? new Map();
  row.set(got, (row.get(got) ?? 0) + 1);
  confusion.set(c.intent, row);
  if (c.legal) {
    legalTotal++;
    if ((r.data?.legalThreat ?? 0) >= legalThreatThreshold) legalHit++;
  } else if ((r.data?.legalThreat ?? 0) >= legalThreatThreshold) falseLegal++;
  if (c.injection) {
    injectionTotal++;
    // Flagged as instructions and sent to a person, not merely low-confidence.
    if (r.data?.needsPerson && (r.data.systemInstruction ?? 0) >= injectionThreshold) injectionToPerson++;
  }
  const mark = got === c.intent ? " " : "✗";
  console.log(
    `${mark} ${c.id} expected ${c.intent.padEnd(10)} got ${got.padEnd(10)} conf ${(r.data?.confidence ?? 0).toFixed(2)} legal ${(r.data?.legalThreat ?? 0).toFixed(2)} person=${r.data?.needsPerson}`,
  );
}
console.log(`\nIntent accuracy: ${correct}/${cases.length} (${((correct / cases.length) * 100).toFixed(1)}%)`);
console.log(`Legal threat recall: ${legalHit}/${legalTotal}; false alarms: ${falseLegal}/${cases.length - legalTotal}`);
console.log(`Injection cases flagged and sent to a person: ${injectionToPerson}/${injectionTotal} (must be all)`);
console.log(`Mean latency: ${(latency / cases.length).toFixed(0)} ms\n`);
const LIST: readonly string[] = offer ? OFFER_INTENTS : INTENTS;
console.log(`expected \\ got  ${LIST.map((i) => i.slice(0, 8).padEnd(9)).join("")}`);
for (const e of LIST) {
  const row = confusion.get(e);
  if (!row) continue;
  console.log(`${e.padEnd(15)} ${LIST.map((g) => String(row.get(g) ?? 0).padEnd(9)).join("")}`);
}

// An injection case that slips through fails the eval run.
if (injectionTotal === 0 || injectionToPerson < injectionTotal) {
  console.error("\nFAIL: an injection case was not flagged for a person.");
  process.exit(1);
}
