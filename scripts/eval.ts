/**
 * `bun run eval [-- <name> [case ids…]]`: helper and copilot evals against real local models.
 *   reply    tenant reply classifier (decision model, packages/helpers)
 *   offer-reply  applicant offer-answer classifier (decision model)
 *   kyc      ID document reading and checks (vision model, fictional specimens)
 *   contract-review  addendum review for conflicts (chat model)
 *   contract-change  signer change requests: draft or not, money/date/injection never drafted (chat model, D67)
 *   contract-marks  marked contract paragraphs rewritten from notes; fixed/money/injection never rewritten (chat model)
 *   ejari-field  Ejari rejection → contract field (decision model)
 *   complaints  Complaint Triage: category, urgency, safety/legal routing (decision model) + acknowledgement (chat model)
 *   contract-template  sample contract PDF/text → addendum clauses with exact quotes (chat model)
 *   contract-structure sample contract PDF → sections, blanks with field mappings, look (chat model + code)
 *   leasing-assistant  Telegram enquiries: intent, flags, handoff (decision model) + unit answers (chat model)
 *   contract-agent  contract agent: clause choice, flags and term checks (chat model with tools)
 *   spa:kyc  SPA KYC reader: 40 fictional IDs and passports, fields exact >= 95%, no expired passes (vision model,
 *            SPA models from .env.spa.local; run it on its own)
 *   spa:aml  SPA AML summary: 30 invented cases, code verdict right, no summary contradicts a hit, injections flagged
 *            (chat model writes wording only; SPA models from .env.spa.local)
 *   spa:document-reader  SPA document reader: 50 fictional NOCs and bank letters, names and dates >= 95%, amounts >= 98%,
 *            injections flagged (vision model; SPA models from .env.spa.local)
 *   spa:company-check  SPA company check: 30 fictional companies, signer and owners >= 95%, no wrong pass (vision model)
 *   spa:ownership-check  SPA ownership check: 30 fictional title deeds, no wrong "matched" (vision model)
 *   spa:registry  SPA registry rejection → field: 30 invented messages, field right >= 90% at confidence 0.6, 0 wrong fixes
 *            (decision model; SPA models from .env.spa.local)
 *   spa:agreement-review  SPA agreement review: 30 invented cases, 0 false quotes, injections flagged 100% (chat model;
 *            SPA models from .env.spa.local)
 *   spa:party-assistant  SPA party portal assistant: 40 invented cases, 0 banned-word replies, 0 other-party data, 0 forbidden
 *            actions (chat model with tools + decision model for the scope gate; SPA models from .env.spa.local)
 *   spa:listing-chat  SPA listing page chat: 30 invented cases, 0 seller data, scope gate >= 95%, no enquiry without consent
 *   spa:template-assistant  SPA template assistant: 20 invented cases, 0 self-applied changes
 *   spa:copilot  SPA staff copilot: 60+ invented cases, 0 forbidden actions, 0 AML words to non-compliance roles, tool choice
 *            >= 85%, unverified <= 2% (chat model with the role's tools + decision model for the scope gate, against a fixed
 *            stand-in for the engine, no database; SPA models from .env.spa.local)
 *   copilot  staff copilot (chat model; uses TEST_DATABASE_URL, which it drops)
 * Without a name, runs them all. Exits non-zero if any eval fails its hard limits.
 */
const [name, ...rest] = process.argv.slice(2);
const runs: Record<string, string[]> = {
  reply: ["modules/leasing/packages/helpers/scripts/eval-reply.ts"],
  "offer-reply": ["modules/leasing/packages/helpers/scripts/eval-reply.ts", "--offer"],
  kyc: ["modules/leasing/packages/helpers/scripts/eval-kyc.ts"],
  "contract-review": ["modules/leasing/packages/helpers/scripts/eval-contract.ts"],
  "contract-change": ["modules/leasing/packages/helpers/scripts/eval-contract-change.ts"],
  "contract-marks": ["modules/leasing/packages/helpers/scripts/eval-contract-marks.ts"],
  "ejari-field": ["modules/leasing/packages/helpers/scripts/eval-ejari.ts"],
  "leasing-assistant": ["modules/leasing/packages/helpers/scripts/eval-leasing-assistant.ts"],
  complaints: ["modules/leasing/packages/helpers/scripts/eval-complaints.ts"],
  "contract-template": ["modules/leasing/packages/helpers/scripts/eval-contract-template.ts"],
  "contract-structure": ["modules/leasing/packages/helpers/scripts/eval-contract-structure.ts"],
  "contract-agent": ["modules/leasing/apps/engine/src/evals/contract-agent.ts"],
  copilot: ["modules/leasing/apps/engine/src/evals/copilot.ts"],
  "customer-agent": ["modules/leasing/apps/engine/src/evals/customer-agent.ts"],
  "spa:kyc": ["modules/spa/packages/helpers/scripts/eval-kyc.ts"],
  "spa:aml": ["modules/spa/packages/helpers/scripts/eval-aml.ts"],
  "spa:document-reader": ["modules/spa/packages/helpers/scripts/eval-document-reader.ts"],
  "spa:company-check": ["modules/spa/packages/helpers/scripts/eval-company-check.ts"],
  "spa:ownership-check": ["modules/spa/packages/helpers/scripts/eval-ownership-check.ts"],
  "spa:registry": ["modules/spa/packages/helpers/scripts/eval-registry.ts"],
  "spa:agreement-review": ["modules/spa/packages/helpers/scripts/eval-agreement-review.ts"],
  "spa:party-assistant": ["modules/spa/packages/helpers/scripts/eval-party-assistant.ts"],
  "spa:listing-chat": ["modules/spa/packages/helpers/scripts/eval-listing-chat.ts"],
  "spa:template-assistant": ["modules/spa/packages/helpers/scripts/eval-template-assistant.ts"],
  "spa:copilot": ["modules/spa/packages/copilot/scripts/eval-copilot.ts"],
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
  // SPA evals read only `.env.spa.local` (S25): never hand them leasing's `.env`.
  const envFile = n.startsWith("spa:") ? [] : ["--env-file=.env"];
  const p = Bun.spawn(["bun", ...envFile, ...args, ...rest], { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
export const evals = Object.keys(runs);
