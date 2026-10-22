/**
 * Ejari rejection → field eval against the real decision model: `bun run eval -- ejari-field
 * [ids…]` (needs Ollama with DECISION_MODEL). Prints accuracy at the policy confidence threshold
 * and a confusion matrix. Hard limit: no rejection about something else may be tied to a name
 * field (the only fields the Registration helper may correct, and only by case or spacing).
 */
import { readFileSync } from "node:fs";
import { defaultCompanyPolicy, EnvSchema } from "@leasing/core";
import { OllamaLlm } from "@leasing/llm";
import { fieldQuestion, rejectionState } from "../src/index.ts";

interface Case {
  id: string;
  code: string;
  field: string | null;
  message: string;
  expect: string;
  injection?: boolean;
}
const only = process.argv.slice(2);
const env = EnvSchema.pick({ OLLAMA_URL: true, DECISION_MODEL: true }).parse(process.env);
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.DECISION_MODEL });
const cases = readFileSync(new URL("../src/registration/evals/cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case)
  .filter((c) => !only.length || only.includes(c.id));
const min = defaultCompanyPolicy.ejariFieldMinConfidence;
const NAME = new Set(["tenantNameEn", "landlordNameEn"]);

let right = 0;
let unsafe = 0;
let abstained = 0;
const confusion = new Map<string, Map<string, number>>();
const latencies: number[] = [];
for (const c of cases) {
  const t0 = performance.now();
  const r = await llm.decide(rejectionState({ code: c.code, field: c.field, message: c.message }), fieldQuestion());
  latencies.push(performance.now() - t0);
  const a = r.answers.field;
  const choice = a?.type === "choice" ? a.choice : "error";
  const confidence = a?.type === "choice" ? a.confidence : 0;
  // What the helper would use: a confident answer (the registry's hint check is unit-tested).
  const used = confidence >= min ? choice : "none";
  if (used === "none" && c.expect !== "none") abstained++;
  if (used === c.expect) right++;
  if (NAME.has(used) && used !== c.expect) unsafe++;
  const row = confusion.get(c.expect) ?? new Map<string, number>();
  row.set(used, (row.get(used) ?? 0) + 1);
  confusion.set(c.expect, row);
  console.log(
    `${used === c.expect ? " " : "✗"} ${c.id} expected ${c.expect.padEnd(18)} got ${choice.padEnd(18)} conf ${confidence.toFixed(2)}`,
  );
}
const p50 = latencies.toSorted((x, y) => x - y)[Math.floor(latencies.length / 2)] ?? 0;
console.log(
  `\nAccuracy at confidence ≥ ${min}: ${right}/${cases.length} (${((right / Math.max(1, cases.length)) * 100).toFixed(1)}%)`,
);
console.log(`Not mapped (a person reads it): ${abstained}`);
console.log(`Wrongly tied to a name field (must be 0): ${unsafe}`);
console.log(`Latency p50: ${(p50 / 1000).toFixed(2)} s`);
console.log("\nConfusion (expected → got):");
for (const [exp, row] of confusion) {
  console.log(`  ${exp.padEnd(18)} ${[...row].map(([g, n]) => `${g}:${n}`).join("  ")}`);
}
if (unsafe > 0) process.exit(1);
