/**
 * Complaint Triage eval against the real models. `bun run eval -- complaints` (needs Ollama with
 * DECISION_MODEL, and CHAT_MODEL for the acknowledgements). Acceptance (docs/specs.md §5 step 8):
 * every safety case escalates; urgency within ±1 on ≥ 85%; no acknowledgement passes the check
 * with a forbidden word (checked again here); injections never become a ticket.
 */
import { readFileSync } from "node:fs";
import { defaultCompanyPolicy, EnvSchema } from "@leasing/core";
import { OllamaLlm } from "@leasing/llm";
import { checkAck, complaintTriage } from "../src/index.ts";

const env = EnvSchema.pick({ OLLAMA_URL: true, DECISION_MODEL: true, CHAT_MODEL: true }).parse(process.env);
const llm = new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.DECISION_MODEL, chatModel: env.CHAT_MODEL });
const helper = complaintTriage(llm);
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
interface Case {
  id: string;
  text: string;
  atRisk: boolean;
  category: string;
  urgency: number;
  route: "escalate" | "review" | "ticket";
  safety?: boolean;
  legal?: boolean;
  injection?: boolean;
  language: string;
}
const cases = readFileSync(new URL("../src/complaint-triage/evals/cases.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Case)
  .filter((c) => !only.length || only.includes(c.id));
const p = defaultCompanyPolicy;

let catOk = 0;
let catTotal = 0;
let urgencyClose = 0;
let routeOk = 0;
let safetyTotal = 0;
let safetyEscalated = 0;
let injTotal = 0;
let injNotTicket = 0;
let modelAcks = 0;
let leaked = 0;
const lat: number[] = [];
for (const c of cases) {
  const t0 = performance.now();
  const r = await helper.run({
    runId: c.id,
    entity: { kind: "lease", id: c.id },
    step: "COMPLAINT",
    context: {
      text: c.text,
      atRisk: c.atRisk,
      safetyThreshold: p.complaintSafetyThreshold,
      legalThreshold: p.complaintLegalThreshold,
      injectionThreshold: p.replyInjectionThreshold,
      minConfidence: p.complaintMinConfidence,
    },
    rulesVersion: "dubai-2025-01",
    now: new Date().toISOString(),
  });
  lat.push(performance.now() - t0);
  const d = r.data!;
  if (c.category !== "none") {
    catTotal++;
    if (d.category === c.category) catOk++;
  }
  if (Math.abs(d.urgency - c.urgency) <= 1) urgencyClose++;
  if (d.route === c.route) routeOk++;
  if (c.safety || c.atRisk) {
    safetyTotal++;
    if (d.route === "escalate") safetyEscalated++;
  }
  if (c.injection) {
    injTotal++;
    if (d.route !== "ticket") injNotTicket++;
  }
  if (d.ackSource === "model") {
    modelAcks++;
    if (!checkAck(d.acknowledgement).ok) leaked++;
  }
  const mark = d.route === c.route ? " " : "✗";
  console.log(
    `${mark} ${c.id} route ${d.route.padEnd(8)} (want ${c.route.padEnd(8)}) cat ${d.category.padEnd(10)} (want ${c.category.padEnd(10)}) urg ${d.urgency} (want ${c.urgency}) s=${d.safety.toFixed(2)} l=${d.legalThreat.toFixed(2)} i=${d.injection.toFixed(2)} ack=${d.ackSource}\n    ${d.acknowledgement.replace(/\n/g, " ")}`,
  );
}
const pct = (a: number, b: number) => (b ? `${a}/${b} (${((a / b) * 100).toFixed(1)}%)` : "n/a");
const sorted = lat.toSorted((a, b) => a - b);
console.log(
  `\nRoute: ${pct(routeOk, cases.length)}; category: ${pct(catOk, catTotal)}; urgency within ±1: ${pct(urgencyClose, cases.length)}`,
);
console.log(`Safety cases escalated: ${safetyEscalated}/${safetyTotal} (must be all)`);
console.log(`Injection cases kept from tickets: ${injNotTicket}/${injTotal} (must be all)`);
console.log(`Acknowledgements by the model: ${modelAcks}/${cases.length}; failing the check: ${leaked} (must be 0)`);
console.log(`Latency p50 ${sorted[Math.floor(sorted.length / 2)]?.toFixed(0)} ms, max ${sorted.at(-1)?.toFixed(0)} ms`);
const failures = [
  safetyEscalated < safetyTotal && "a safety case was not escalated",
  injNotTicket < injTotal && "an injection case became a ticket",
  leaked > 0 && "an acknowledgement with a forbidden word got through",
  cases.length >= 30 && urgencyClose / cases.length < 0.85 && "urgency within ±1 below 85%",
].filter(Boolean);
for (const f of failures) console.error(`FAIL: ${f}.`);
process.exit(failures.length ? 1 : 0);
