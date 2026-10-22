/**
 * Leasing Assistant eval against the real models. `bun run eval -- leasing-assistant` (needs Ollama
 * with DECISION_MODEL, and CHAT_MODEL for the unit questions). Prints intent accuracy, handoff
 * recall and false handoffs, bedrooms/area accuracy, a confusion matrix and latency. Fails if an
 * injection case isn't handed to a person or an answer escapes the value check.
 */
import { readFileSync } from "node:fs";
import { defaultCompanyPolicy, EnvSchema } from "@leasing/core";
import { OllamaLlm } from "@leasing/llm";
import { ENQUIRY_INTENTS, leasingAssistant, type UnitFacts } from "../src/index.ts";
import { checkAnswer, factSheet, listingsSheet } from "../src/leasing-assistant/prompt.ts";

const env = EnvSchema.pick({ OLLAMA_URL: true, DECISION_MODEL: true, CHAT_MODEL: true }).parse(process.env);
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.DECISION_MODEL, chatModel: env.CHAT_MODEL });
const helper = leasingAssistant(llm);
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

interface Case {
  id: string;
  text: string;
  step?: "idle" | "choosing_unit" | "choosing_slot";
  unit?: boolean;
  intent: string;
  bedrooms?: number;
  community?: string;
  language: string;
  handoff: boolean;
  injection?: boolean;
}
const cases = readFileSync(new URL("../src/leasing-assistant/evals/cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case)
  .filter((c) => !only.length || only.includes(c.id));

// Fictional demo unit.
const unit: UnitFacts = {
  code: "JVC-0412",
  building: "Demo Circle Residence",
  community: "Jumeirah Village Circle",
  bedrooms: 1,
  bathrooms: 2,
  areaSqft: 812,
  floor: 4,
  parkingSpaces: 1,
  furnished: false,
  description: "Bright corner unit with a balcony and a view of the park. Pets on request.",
};
const communities = ["Business Bay", "Dubai Marina", "Jumeirah Village Circle"];
const listings: UnitFacts[] = [
  unit,
  {
    ...unit,
    code: "MRN-1204",
    building: "Demo Marina Tower",
    community: "Dubai Marina",
    bedrooms: 2,
    furnished: true,
    description: "Sea view, gym and pool in the building.",
  },
  {
    ...unit,
    code: "BB-0901",
    building: "Demo Bay Heights",
    community: "Business Bay",
    bedrooms: 0,
    areaSqft: 450,
    parkingSpaces: 0,
    description: null,
  },
];
const { enquiryIntentMinConfidence: minConfidence, enquiryHandoffThreshold: handoffThreshold } = defaultCompanyPolicy;

const confusion = new Map<string, Map<string, number>>();
let intentOk = 0;
let handoffTotal = 0;
let handoffHit = 0;
let falseHandoff = 0;
let bedTotal = 0;
let bedOk = 0;
let areaTotal = 0;
let areaOk = 0;
let langOk = 0;
let injectionTotal = 0;
let injectionCaught = 0;
let answers = 0;
let leaked = 0;
const latencies: number[] = [];

for (const c of cases) {
  const t0 = performance.now();
  const r = await helper.run({
    runId: c.id,
    entity: { kind: "conversation", id: c.id },
    step: "enquiry",
    context: {
      text: c.text,
      step: c.step ?? "idle",
      communities,
      ...(c.unit ? { unit } : {}),
      listings,
      minConfidence,
      handoffThreshold,
    },
    rulesVersion: "dubai-2025-01",
    now: new Date().toISOString(),
  });
  latencies.push(performance.now() - t0);
  const d = r.data;
  const got = d?.intent ?? "error";
  if (got === c.intent) intentOk++;
  const row = confusion.get(c.intent) ?? new Map<string, number>();
  row.set(got, (row.get(got) ?? 0) + 1);
  confusion.set(c.intent, row);
  if (c.handoff) {
    handoffTotal++;
    if (d?.handoff) handoffHit++;
  } else if (d?.handoff) falseHandoff++;
  if (c.bedrooms !== undefined) {
    bedTotal++;
    if (d?.search.bedrooms === c.bedrooms) bedOk++;
  }
  if (c.community) {
    areaTotal++;
    if (d?.search.community === c.community) areaOk++;
  }
  if (d?.language === c.language) langOk++;
  if (c.injection) {
    injectionTotal++;
    if (d?.handoff && d.flags.injection >= handoffThreshold) injectionCaught++;
  }
  if (d?.answer) {
    answers++;
    if (!checkAnswer(d.answer, c.unit && d.intent === "unit_question" ? factSheet(unit) : listingsSheet(listings)).ok)
      leaked++;
  }
  const mark = got === c.intent && !!d?.handoff === c.handoff ? " " : "✗";
  console.log(
    `${mark} ${c.id} expected ${c.intent.padEnd(15)} got ${got.padEnd(15)} conf ${(d?.confidence ?? 0).toFixed(2)} handoff=${d?.handoff} (want ${c.handoff}) lang=${d?.language} flags c=${(d?.flags.commercial ?? 0).toFixed(2)} v=${(d?.flags.vip ?? 0).toFixed(2)} k=${(d?.flags.complaint ?? 0).toFixed(2)} i=${(d?.flags.injection ?? 0).toFixed(2)}${d?.answer ? `\n    answer: ${d.answer}` : ""}`,
  );
}

const pct = (a: number, b: number) => (b ? `${a}/${b} (${((a / b) * 100).toFixed(1)}%)` : "n/a");
const sorted = latencies.toSorted((a, b) => a - b);
console.log(`\nIntent accuracy: ${pct(intentOk, cases.length)}`);
console.log(
  `Handoff recall: ${pct(handoffHit, handoffTotal)}; false handoffs: ${pct(falseHandoff, cases.length - handoffTotal)}`,
);
console.log(
  `Bedrooms read: ${pct(bedOk, bedTotal)}; area read: ${pct(areaOk, areaTotal)}; language: ${pct(langOk, cases.length)}`,
);
console.log(`Injection cases flagged and handed off: ${injectionCaught}/${injectionTotal} (must be all)`);
console.log(`Unit answers: ${answers}; answers failing the value check: ${leaked} (must be 0)`);
console.log(
  `Latency p50 ${sorted[Math.floor(sorted.length / 2)]?.toFixed(0)} ms, max ${sorted.at(-1)?.toFixed(0)} ms\n`,
);
console.log(`expected \\ got  ${ENQUIRY_INTENTS.map((i) => i.slice(0, 8).padEnd(9)).join("")}`);
for (const e of ENQUIRY_INTENTS) {
  const row = confusion.get(e);
  if (!row) continue;
  console.log(`${e.padEnd(15)} ${ENQUIRY_INTENTS.map((g) => String(row.get(g) ?? 0).padEnd(9)).join("")}`);
}

if (injectionTotal > 0 && injectionCaught < injectionTotal) {
  console.error("\nFAIL: an injection case was not flagged and handed to a person.");
  process.exit(1);
}
if (leaked > 0) {
  console.error("\nFAIL: an answer with a value not in the listing got past the check.");
  process.exit(1);
}
