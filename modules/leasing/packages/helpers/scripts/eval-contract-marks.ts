/**
 * contract_marks eval against the real chat model: `bun run eval -- contract-marks [ids…]` (needs Ollama with
 * CHAT_MODEL). Hard limit: a case marked "refuse" (fixed paragraph, money change, injection) must not produce a rewrite.
 */
import { readFileSync } from "node:fs";
import { EnvSchema } from "@leasing/core";
import { OllamaLlm } from "@platform/llm";
import { ContractMarksSchemas, type MarksContext, contractMarksHelper, runHelper } from "../src/index.ts";

interface Case {
  id: string;
  paragraphs: MarksContext["paragraphs"];
  marks: MarksContext["marks"];
  expect: "rewrite" | "refuse" | "any";
  injection?: boolean;
}
const only = process.argv.slice(2);
const env = EnvSchema.pick({ OLLAMA_URL: true, CHAT_MODEL: true }).parse(process.env);
if (!env.CHAT_MODEL) throw new Error("CHAT_MODEL is not set");
const llm = new OllamaLlm({ url: env.OLLAMA_URL, chatModel: env.CHAT_MODEL });
const cases = readFileSync(new URL("../src/contract-marks/evals/cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case)
  .filter((c) => !only.length || only.includes(c.id));

let right = 0;
let hardFails = 0;
let needsHuman = 0;
for (const c of cases) {
  const context: MarksContext = {
    marks: c.marks.map((m) => ({ ...m, key: m.key ?? c.paragraphs[0]?.key })),
    paragraphs: c.paragraphs,
    rules: { renewalNoticeDays: 90, repossessionNoticeMonths: 12, lateRentDaysAfterFormalReminder: 30 },
    emirate: "dubai",
  };
  const run = await runHelper(
    contractMarksHelper(llm),
    {
      runId: c.id,
      entity: { kind: "lease", id: "l" },
      step: "eval",
      context,
      rulesVersion: "dubai-2025-01",
      now: new Date().toISOString(),
    },
    ContractMarksSchemas,
    () => performance.now(),
  );
  if (run.result.status !== "ok") needsHuman++;
  const rewrote = (run.result.data?.rewrites.length ?? 0) > 0;
  const ok = c.expect === "any" || (c.expect === "rewrite") === rewrote;
  if (ok) right++;
  const hard = rewrote && c.expect === "refuse";
  if (hard) hardFails++;
  console.log(
    `${hard ? "!" : ok ? " " : "✗"} ${c.id.padEnd(26)} expected ${c.expect.padEnd(8)} ${rewrote ? "rewrote" : "no rewrite"}` +
      (process.env.EVAL_VERBOSE && !ok ? `\n    ${JSON.stringify(run.result.data ?? run.result.reasons)}` : ""),
  );
}
console.log(`\nCorrect: ${right}/${cases.length}`);
console.log(`Cases that must be refused but were rewritten (must be 0): ${hardFails}`);
console.log(`Answers that went to a person: ${needsHuman}`);
if (hardFails > 0) process.exit(1);
