# AGENTS.md

Instructions for any coding agent (Claude Code, Codex, Copilot, Cursor) working in this repo.
Claude Code reads this through `CLAUDE.md`.

## What this project is

An engine that runs the Dubai residential leasing lifecycle end to end: unit preparation,
enquiries, applicant checks, offer, contract, Ejari registration, move-in, rent collection,
complaints, renewal, move-out and disputes. Small AI helpers do the reading, classifying and
drafting. A deterministic Manager owns state and legal deadlines. People approve every step
that creates a legal or money commitment. A staff copilot (chat agent for leasing staff) sits
alongside the engine: it reads, drafts and proposes through engine API tools, but never
approves or changes state (`docs/architecture.md` §8b).

We will sell it to leasing-industry clients, self-hosted or hosted. For pitches, Ejari is a
local mock.

Read before larger changes:

- `docs/specs.md` — what we are building, scope, acceptance criteria
- `docs/architecture.md` — components, state machines, data model, helper contract
- `docs/decisions.md` — decisions already made; don't reopen them without a reason
- `docs/roadmap.md` — phases and the current task list
- `docs/source/leasing-guide.txt` — the original business guide

## Non-negotiable rules

These come from Dubai law or from the product's safety model. Breaking one is a bug, even if
tests pass.

1. **No LLM decides a legal or money value.** Notice periods, rent caps, deadlines, deposit
   deductions and allowed discounts come from the published rulebook version pinned on the lease,
   computed by `packages/rulebook` functions. Models may classify, extract and draft text only.
2. **Only the Manager changes state.** Helpers return data. They never write to `leases`,
   `applications` or `units`.
3. **Human gates are mandatory.** Never auto-approve: final contract, Ejari submission,
   formal late-payment reminder, rent-increase or vacate notice, refund above threshold, any
   value outside rulebook limits. See `approvalGates` in `packages/core`.
4. **Every decision is auditable.** State changes append to `lease_events` with the actor
   (system, helper name, or user id), the inputs used and the `rulesVersion`.
5. **Time comes from `Clock`.** Never call `new Date()` or `Date.now()` in domain code. Legal
   dates are calendar dates in `Asia/Dubai`, stored as `date`, not `timestamptz`.
6. **Helper output is validated.** Parse every model result with Zod. Invalid → retry once →
   `needs_human`. Nothing advances on an unparsed answer.
7. **Scheduled jobs are idempotent.** pg-boss jobs use `singletonKey = "<entityId>:<milestone>"`.
   A job must be safe to run twice.
8. **Personal data stays local.** Don't log Emirates ID numbers, passport numbers or phone
   numbers in plain text (use `maskPii`). Don't send documents to cloud APIs. Never read or
   commit `data/uploads/`.
9. **The Ejari mock is labelled as simulated.** No DLD logos, colours or screen copies.
10. **Channels have fixed jobs.** Telegram receives enquiries only. Everything outbound to
    applicants, tenants and landlords goes by email through the `mail` adapter, which stores the
    message, attachment hashes and SMTP response as evidence. The 12-month repossession notice is
    never sent by email: it goes by notary or registered mail, handled by a person.
11. **The copilot only reads, drafts and proposes.** Copilot tools call the engine API as the
    logged-in user. No tool may approve a gate, send a message, change state, submit to Ejari,
    edit rules or policy, or open uploaded documents. Legal and money values in its answers
    come from rulebook tools. Tenant-written text reaching the copilot is untrusted data.
    `propose` tools need the user's Confirm click. One confirmed action exists (decision D25):
    a `propose_application` proposal creates an application, and its viewing invitation email,
    through the normal route, as the user, only when that user clicks Confirm in the chat. The
    copilot's client can store a proposal but can never confirm one.

## Repo map

```
apps/
  engine/          Manager worker + HTTP API (Hono). State machine, pg-boss jobs, helper runner.
  web/             Next.js: staff app (approval inbox, lease views, copilot panel, demo console) + tenant portal (/t/...).
  telegram-bot/    grammY bot for incoming enquiries only (step 2). Posts events to engine API.
  ejari-mock/      Simulated Ejari service (Hono). Same contract as the future DLD adapter.
  mcp/             (phase 5) MCP server exposing the copilot tool registry to Claude, ChatGPT, etc.
packages/
  core/            Domain types, Zod schemas, state machines, approval gates, Clock, maskPii.
  rulebook/        Versioned rules per emirate + pure functions. 100% unit-tested.
  db/              Drizzle schema, migrations, seed + demo fixtures.
  llm/             Model adapter: chat(), vision(), decide() (ollama.systemone).
  helpers/         One folder per helper (kyc, offer, contract, registration, renewal, ...).
  copilot/         Staff copilot: LangGraph tool loop, prompt, tools/ registry (read/draft/propose), evals.
  adapters/        channel/ (telegram), mail/ (nodemailer), ejari/ (mock, dld), esign/ (mock), storage/ (local disk).
docs/
.claude/           Claude Code skills, subagents, settings.
```

## Commands

```bash
createuser -P leasing && createdb -O leasing leasing   # once; local Postgres, no Docker
ollama pull tev1                # decision model; also pull CHAT_MODEL and VISION_MODEL from .env
bun install
bun run db:migrate
bun run db:studio               # Drizzle Studio: browse the database at https://local.drizzle.studio
bun run demo:seed               # fictional units, tenants, leases (lives in apps/engine: uses the Manager)
bun run demo:reset              # drop all tables, migrate, seed (DEMO_MODE=true only)
bun run demo:rewind             # demo clock back to today; keeps all data (DEMO_MODE=true only)
bun run dev                     # all apps
bun test                        # all tests (DB tests need TEST_DATABASE_URL → a *_test database)
bun test packages/rulebook      # one package
bun run typecheck
bun run lint                    # oxlint + oxfmt --check + domain-rule guard (scripts/check-domain-rules.ts)
bun run lint:fix                # oxlint --fix + oxfmt (writes)
bun run eval                    # helper + copilot evals against labelled fixtures (needs Ollama running)
bun run eval -- copilot         # copilot evals only
```

## Stack

- Bun + TypeScript (strict), Bun workspaces
- Postgres installed locally (no Docker) + Drizzle ORM; pg-boss for durable jobs (same database)
- Nodemailer over SMTP for all outbound email: offers, contract links, reminders, notices, receipts
- LangGraph.js for helpers that loop, branch or converse; plain async functions for one-shot helpers
- Ollama: `ollama` npm ≥ 0.6.4 for `systemone()` decision calls; `@langchain/ollama` `ChatOllama` for chat
- Zod for every boundary (HTTP, helper I/O, model output, env)
- grammY for the Telegram enquiry bot; Hono for engine and mock services; Next.js for the web app
- oxlint for lint, oxfmt for formatting (decision D16)

## Conventions

- Domain names follow the business guide: unit, applicant, tenant, landlord, lease, notice, PDC,
  Ejari, Smart Rental Index (SRI), RDC. Don't invent synonyms.
- Money is integer fils (AED × 100). Never floats for money.
- IDs are UUIDv7 strings.
- One helper = one folder with `index.ts`, `schema.ts`, `prompt.ts` (if any), `*.test.ts`,
  `evals/` fixtures. Follow the `new-helper` skill.
- One copilot tool = one file in `packages/copilot/tools/` with Zod input and output, a `kind`
  (`read` | `draft` | `propose`) and `roles`. Follow the `new-copilot-tool` skill.
- Adapters are interfaces in `packages/adapters/*/types.ts`; pick the implementation from env.
- Prefer small pure functions; keep side effects at the edges (engine, adapters).
- Tests: Bun test. Rulebook and state machine changes need tests for every branch.
  Model calls are mocked in unit tests; real models run only in `bun run eval`.

## Definition of done

- `bun run typecheck`, `bun run lint` and `bun test` pass
- New behaviour has tests; rulebook or gate changes have a test per rule
- If you changed a state, gate, rule or notice template: `docs/architecture.md` and the
  `dubai-leasing` skill are updated in the same change
- No new `Date.now()`, no unmasked PII in logs, no direct state writes from helpers
- New or changed copilot tools have role tests and eval cases (including one injection case)
