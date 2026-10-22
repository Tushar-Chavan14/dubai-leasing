/**
 * `bun run eval [-- <name> [case ids…]]`: helper and copilot evals against real local models.
 *   reply    tenant reply classifier (decision model, packages/helpers)
 *   offer-reply  applicant offer-answer classifier (decision model)
 *   kyc      ID document reading and checks (vision model, fictional specimens)
 *   contract-review  addendum review for conflicts (chat model)
 *   ejari-field  Ejari rejection → contract field (decision model)
 *   complaints  Complaint Triage: category, urgency, safety/legal routing (decision model) + acknowledgement (chat model)
 *   leasing-assistant  Telegram enquiries: intent, flags, handoff (decision model) + unit answers (chat model)
 *   copilot  staff copilot (chat model; uses TEST_DATABASE_URL, which it drops)
 * Without a name, runs them all. Exits non-zero if any eval fails its hard limits.
 */
const [name, ...rest] = process.argv.slice(2);
const runs: Record<string, string[]> = {
  reply: ["packages/helpers/scripts/eval-reply.ts"],
  "offer-reply": ["packages/helpers/scripts/eval-reply.ts", "--offer"],
  kyc: ["packages/helpers/scripts/eval-kyc.ts"],
  "contract-review": ["packages/helpers/scripts/eval-contract.ts"],
  "ejari-field": ["packages/helpers/scripts/eval-ejari.ts"],
  "leasing-assistant": ["packages/helpers/scripts/eval-leasing-assistant.ts"],
  complaints: ["packages/helpers/scripts/eval-complaints.ts"],
  copilot: ["apps/engine/src/evals/copilot.ts"],
};
const names = name ? [name] : Object.keys(runs);
let failed = false;
for (const n of names) {
  const args = runs[n];
  if (!args) {
    console.log(`No evals named "${n}". Available: ${Object.keys(runs).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n=== eval: ${n} ===`);
  const p = Bun.spawn(["bun", "--env-file=.env", ...args, ...rest], { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
export const evals = Object.keys(runs);
