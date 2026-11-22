# C36 — @spa/copilot (P9) plan

Goal: staff copilot for SPA (S68). Reads, drafts and proposes; never approves, sends, signs, submits, clears, edits settings.

## Parts
1. **DB** (migrations 0061 schema, 0062 guards): `copilot_proposals`, `copilot_drafts`; `assistant_threads.kind` += `staff`; `spa_tasks.kind` += `copilot_task`.
2. **`modules/spa/packages/copilot`** (`@spa/copilot`; imports `@spa/core`, `@platform/*` only):
   `client.ts` (EngineClient: `get` allowlist, `propose` two paths), `tools/*.ts` (one per file, Zod in/out, kind, roles), `tools/index.ts` registry,
   `guard.ts` (AML words), `prompt.ts` (role prompt, AML only for compliance roles), `turn.ts` (runAgentTurn), `evals/` (30+ cases, scorer).
3. **Engine** (`manager/copilot.ts`, routes in `app.ts`): `POST /api/copilot/chat`, `GET /api/copilot/thread`, `GET /api/copilot/rulebook?key=`,
   `POST /api/copilot/proposals` (+`/:id/confirm`, `/:id/cancel`), `POST /api/copilot/drafts`, `GET /api/copilot/drafts/:id`, `GET /api/deals/:id/noc-status`.
   Confirm: same user only (403), expired 410, re-check role + deal state, run the normal manager fn as the user, event `COPILOT_PROPOSAL_CONFIRMED` (actor `user:<id>`, `viaProposal`).
   The chat uses an in-process client calling the app's own routes with the user's token.
4. **Web**: real dock (messages, tool chips, "How this was handled", proposal/draft cards, unverified marks), same-origin proxy route, inbox `?draft=<id>` prefill.
5. **Evals**: `spa:copilot` (scripts/eval.ts), 30+ cases, FakeLlm in unit tests; bars: 0 forbidden, 0 AML words to non-compliance, tool-choice rate.
6. **Docs**: task.md P9 + C26 note, decisions S68, architecture §8b, new-copilot-tool skill, roadmap S1–S68.

## Order (TDD, each test seen failing first)
db guards -> client allowlist -> guard -> tools/role sets -> turn -> engine routes (rulebook, proposals x4, drafts, chat) -> web -> evals -> docs -> full run once -> fmt/tsc/lint -> compliance-reviewer.

## Not built
Settings-changing tools (D45/D50), decision cards (D48/D53), anything opening uploaded files.
