# SPA tasks

Phases are numbered P0, P1, … so they are never confused with decisions (S1, S2, …).

Phased task list for the SPA module. Tick tasks as they're done (`- [x]`). The phase summary also
lives in `docs/roadmap.md` (section "SPA module"). Read `docs/spa/specs.md`,
`docs/spa/decisions.md` and `docs/spa/architecture.md` first. Phases P1 and P2 touch more than three packages and a new
database: plan first (CLAUDE.md).

## P0 — Docs and agreement

- [x] `docs/spa/design.md` (design system, screen templates, external links, writing) (S31)
- [x] `docs/spa/specs.md` (PRD: problem, users, scope, steps with acceptance criteria, gates, metrics, demo script)
- [x] `docs/spa/decisions.md` (S1–S30), `docs/spa/architecture.md`, this file
- [x] `.claude/skills/dubai-sales-spa/SKILL.md`, pointers in AGENTS.md / CLAUDE.md / roadmap / architecture
- [x] `docs/spa/mockup.html`: every screen in one file: dashboard, deals (primary + resale), listings with permit and offer, public listing page, inbox (all gates), compliance, templates, settings incl. KYC forms per role and AML policy, party portal (buyer/seller); header has only Portal and Log out
- [ ] Review the mockup and decisions with sales, legal and compliance; record changes as new S-decisions

## P1 — Shared kernel (no behaviour change)

- [x] `packages/kernel` (`@leasing/kernel`): move `Clock`, money, ids, `maskPii`, `Helper` contract, `defineMachine`, `Actor` from core
- [x] `@leasing/core` re-exports kernel; no leasing import changes
- [x] Loosen `EntityKind` and `StateMachine.entity` to `string`; add generic `defineGates<Gate, Role>()`
- [x] Profiles for shared helpers: `KycProfile` (kyc reader, prompt nouns, documents), `TemplateProfile` (contract-structure: party roles, data sheet, aliases); leasing profile is the default
- [x] Import boundary rule in `scripts/check-domain-rules.ts` (S1)

**Exit:** `bun run typecheck`, `bun run lint`, `bun test` and the leasing evals give the same results as before.

## P2 — SPA scaffold and its own runtime

- [x] Workspaces `spa/apps/*`, `spa/packages/*`; packages `@spa/core`, `@spa/rulebook`, `@spa/db`, `@spa/helpers`
- [x] `spa` and `spa_test` databases, `@spa/db` with own `drizzle.config.ts` and migrations
- [x] SPA env schema (architecture §11) loaded only from `.env.spa.local`; `.env.spa.example` committed; git-ignored; agents denied reading it
- [x] `spa/apps/engine` (:4001): Hono, health, SPA `Clock` + demo clock, pg-boss in `spa`
- [x] Shared `packages/ui` (`@leasing/ui`): move domain-free tokens and components out of `apps/web` (leasing re-imports, no visual change) (design.md §11)
- [x] `spa/apps/web` (:3001): shell per design.md §2 (rail · main · copilot dock, Portal and Sign out in the avatar menu, no other module referenced), sign-in, `spa_session` cookie, `@leasing/ui` tokens
- [x] Root scripts `dev:leasing`, `dev:spa`, `spa:db:migrate`, `spa:demo:seed`, `spa:demo:reset`

**Exit:** `bun run dev:spa` starts with an empty dashboard; leasing still runs on its old ports.

## P3 — Domain core

- [ ] Deal (three deal types, mortgage guards), Unit and Listing state machines with a test for every transition and type guard (architecture §4, S13)
- [ ] `spaGates`, `SpaRole`, `canDecideSpaGate`, "nobody approves their own proposal"
- [ ] Zod schemas: party (person/company), company details, signatory, beneficial owner, listing, deal, deal parties, payment plan, settlement, AML case, template version
- [ ] SPA data-sheet keys and aliases (architecture §7)
- [ ] `deal_events` append-only (triggers like leasing migrations 0001/0002)
- [ ] `SpaManager.advance()` with transactional events and `spa_approvals`

## P4 — Rulebook and policy

- [ ] `dubai-sales-2026-01` (values marked "confirm with legal")
- [ ] `registrationFee`, `validatePlan`, `discountCheck`, `amlRules` + tests for every branch and edge
- [ ] `transferFees`, `settlementStatement` (balances to zero) + tests
- [ ] `spa_policy`: discount limits, commission per side, deposit %, hold days, reminder days, signing order per deal type, developer NOC rules per project

## P4b — Listings, parties and company checks (S12, S14)

- [ ] Company `kind` (developer / brokerage / both) and the screens each sees
- [ ] Listings with seller parties, ownership document and listing agreement
- [ ] Parties as person or company; signatories with POA/board resolution; beneficial owners
- [ ] `seller_verification` gate; co-owners all signing

## P4c — Listing permit, public page, offers, deposit (S17, S18)

- [ ] Permit fields, `spa.permit.expire` unpublish job, public listing page without personal data
- [ ] Offers: one open per listing, seller accept/reject link, expiry job, revision = new offer
- [ ] Deposit cheque record, handover after transfer, `deposit_release` gate on cancellation
- [ ] Broker per side with commission % and split (confirm)

## P4d — KYC and AML settings (S19, S20)

- [x] Move the domain-free KYC config model to `@leasing/kernel` with document kinds as a parameter (leasing unchanged, tests) (done in P1, S32)
- [ ] `spa_kyc_configs` per party role (+ deal-type override), versioned; settings screens (fields, documents, checks, cross checks, custom rules)
- [ ] `spa_aml_policy`: rules + thresholds, source-of-funds evidence, risk scoring + EDD, re-screening; `edd_signoff` gate
- [ ] Every check result records the config/policy version

## P5 — Templates (uploaded structure = output structure, S5)

- [ ] SPA profile for the contract-structure reader: Seller / Purchaser / Broker blocks, signature roles
- [ ] Repeatable purchaser block; fixed purchaser slots → `needs_human` when buyers exceed slots
- [ ] Mapping to SPA data-sheet keys (code first, then decision model on descriptions only)
- [ ] Template checks: sample values, DLD/RERA marks, fee % vs rulebook, missing core keys
- [ ] Named templates with versions, `document_kind` (spa, mou, assignment, listing_agreement), project scope, `template_approval` gate
- [ ] Repeatable seller block (co-owners) and company party block (name, licence, signatory)
- [ ] Render: same sections, numbering, tables, header/footer/logo; plan table in the template's style; e-sign anchors at signature blocks
- [ ] Tests: 3 fictional templates (numbered articles, decimal clauses, placeholders) round-trip with identical structure

## P5b — Resale steps (S13, S15)

- [ ] NOC step: upload, read, match, expiry warning, `noc_review`
- [ ] Finance step: seller liability/release letters, buyer pre-approval/final offer, amount confirmation by a person
- [ ] Settlement statement screen and `settlement_approval` (finance)
- [ ] Security deposit recording and return on cancellation

## P6 — Helpers and evals

- [ ] `spa-kyc` (shared reader + SPA profile); evals on fictional passports/IDs
- [ ] `aml-screening`: fake lists, code matching and warning signs, model summary; evals incl. injection in names
- [ ] `spa-prepare`: fill, repeat blocks, field sources, hash
- [ ] `company-check`, `ownership-check`, `document-reader` (NOC, bank letters; amounts need a person's confirmation)
- [ ] `registry` helper for Oqood register/transfer and trustee transfer: rejection → field, one safe fix, else human
- [ ] `collections`: instalment reminders from the plan

## P6b — Payments, default flag, records, alerts (S26–S30)

- [ ] `payment_receipt` reading + escrow account check + finance confirmation
- [ ] `in_default` flag job and task (overdue days in policy; resale withdrawal/no-show recorded by agent)
- [ ] Retention review job, case export pack, monthly compliance report (compliance roles only)
- [ ] Alerts: per-gate thresholds, email + in-app, manager escalation

## P6c — Helper modes, chasing, assistants (S22–S24, specs §6)

- [ ] `spa_helper_settings` + Settings → AI helpers (mode auto/review/off, models read-only); `helper_review` gate
- [ ] `agreement-review` helper (flags only, quote guard)
- [ ] `chaser`: schedule per company, admin-approved templates, neutral AML wording, stop rules
- [ ] Party portal assistant (token scope, no AML mentions, contact agent) + evals
- [ ] Listing page chat (published listings only, enquiry by email with consent, rate limit) + evals
- [ ] Template assistant (explain, compare, propose with click) + evals
- [ ] Eval pass bars from specs §6.6 wired into `bun run eval -- spa:<helper>`

## P7 — Adapters and mocks

- [ ] `ScreeningAdapter` (fake, labelled simulated)
- [ ] `OqoodAdapter` (register, transfer) + `TransferAdapter` (trustee, new title deed) in `spa/apps/oqood-mock` (:4101), realistic rejections, labelled simulated
- [ ] Reuse `ESignAdapter` and portal signing; SPA mail templates

## P8 — Staff web (from `docs/spa/mockup.html`)

- [ ] Dashboard, Listings, Workspace (deals list by type), Deal record (overview, parties, documents, AML, agreement, signing, NOC, finance, settlement, registration/transfer, payments, activity)
- [ ] Inbox for `spa_approvals` with decision forms per gate
- [ ] Compliance page (AML cases)
- [ ] Templates (upload → structure → fields → parties & signatures → preview → approval)
- [ ] Settings (company & signatories, projects & price lists, plans, fees & rulebook, AML, signing, users & roles, models, integrations, demo clock)
- [ ] Buyer portal: upload documents, review plan, sign, instalments

## P9 — SPA copilot

- [ ] `@spa/copilot`: read tools (deal, listing, timeline, approvals, plan, template), draft tools, propose tools
- [ ] AML report visibility by role; evals incl. injection and permission cases

## P10 — Portal launcher

- [ ] `apps/portal` (:3100): module tiles, links to leasing and SPA, `/summary` counts
- [ ] Stage 2: portal sign-in, signed token, each app verifies and keeps its own roles

**Exit (module):** a fictional primary deal reaches Oqood and a fictional ready resale with a seller mortgage reaches a new title deed (both simulated), each agreement
matches the uploaded template's structure exactly, and every gate was decided by a person.
