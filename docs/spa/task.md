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
- Note (S58): `docs/spa/mockup.html` is not in the repo; `docs/spa/design.md` is the source for every screen, as the user approved.

## P1 — Shared kernel (no behaviour change)

- [x] `platform/kernel` (`@platform/kernel`): move `Clock`, money, ids, `maskPii`, `Helper` contract, `defineMachine`, `Actor` from core
- [x] `@leasing/core` re-exports kernel; no leasing import changes
- [x] Loosen `EntityKind` and `StateMachine.entity` to `string`; add generic `defineGates<Gate, Role>()`
- [x] Profiles for shared helpers: `KycProfile` (kyc reader, prompt nouns, documents), `TemplateProfile` (contract-structure: party roles, data sheet, aliases); leasing profile is the default
- [x] Import boundary rule in `scripts/check-domain-rules.ts` (S1)

**Exit:** `bun run typecheck`, `bun run lint`, `bun test` and the leasing evals give the same results as before.

## P2 — SPA scaffold and its own runtime

- [x] Workspaces `modules/spa/apps/*`, `modules/spa/packages/*`; packages `@spa/core`, `@spa/rulebook`, `@spa/db`, `@spa/helpers`
- [x] `spa` and `spa_test` databases, `@spa/db` with own `drizzle.config.ts` and migrations
- [x] SPA env schema (architecture §11) loaded only from `.env.spa.local`; `.env.spa.example` committed; git-ignored; agents denied reading it
- [x] `modules/spa/apps/engine` (:4001): Hono, health, SPA `Clock` + demo clock, pg-boss in `spa`
- [x] Shared `platform/ui` (`@platform/ui`): move domain-free tokens and components out of `modules/leasing/apps/web` (leasing re-imports, no visual change) (design.md §11)
- [x] `modules/spa/apps/web` (:3001): shell per design.md §2 (rail · main · copilot dock, Portal and Sign out in the avatar menu, no other module referenced), sign-in, `spa_session` cookie, `@platform/ui` tokens
- [x] Root scripts `dev:leasing`, `dev:spa`, `spa:db:migrate`, `spa:demo:seed`, `spa:demo:reset`

- [x] P2b: move to `modules/leasing`, `modules/spa`, `platform/` (`@platform/*`); boundary rule per S34

**Exit:** `bun run dev:spa` starts with an empty dashboard; leasing still runs on its old ports.

## P3 — Domain core

- [x] Deal (three deal types, mortgage guards), Unit and Listing state machines with a test for every transition and type guard (architecture §4, S13)
- [x] `spaGates`, `SpaRole`, `canDecideSpaGate`, "nobody approves their own proposal"
- [x] Zod schemas: party (person/company), company details, signatory, beneficial owner, listing, deal, deal parties, payment plan, settlement, AML case, template version
- [x] SPA data-sheet keys and aliases (architecture §7)
- [x] `deal_events` append-only (triggers like leasing migrations 0001/0002)
- [x] `SpaManager.advance()` with transactional events and `spa_approvals`

## P4 — Rulebook and policy

- [x] `dubai-sales-2026-01` (values marked "confirm with legal") (C1, S36: unconfirmed values pending)
- [x] `registrationFee`, `validatePlan`, `discountCheck`, `amlRules` + tests for every branch and edge (C1/C2)
- [x] `transferFees`, `settlementStatement` (balances to zero) + tests (C1/C2)
- [x] `spa_policy`: discount limits, commission per side, deposit %, hold days, reminder days, signing order per deal type, developer NOC rules per project (C3, S37)

## P4b — Listings, parties and company checks (S12, S14)

- [x] Company `kind` (developer / brokerage / both) and the screens each sees (C5)
- [x] Listings with seller parties, ownership document and listing agreement (C5)
- [x] Parties as person or company; signatories with POA/board resolution; beneficial owners (C4)
- [x] `seller_verification` gate; co-owners all signing (C5)
- [x] Settings: projects and price lists. Projects, buildings, units and versioned price lists (a published list never changes), the project's escrow account shown masked, a price-list price used when a deal starts on a unit; admin writes, for developer and `both` companies; the Inventory screens (C32, S64: migrations 0055 and 0056, `GET`/`POST /api/projects`, `/api/price-lists/:id/publish`; the other settings pages are C34)

## P4c — Listing permit, public page, offers, deposit (S17, S18)

- [x] Permit fields, `spa.permit.expire` unpublish job, public listing page without personal data (C6, S38)
- [x] Offers: one open per listing, seller accept/reject link, expiry job, revision = new offer (C7, S39; link emailed since C28, S54)
- [x] Deposit cheque record, handover after transfer, `deposit_release` gate on cancellation (C8, S40)
- [x] Broker per side with commission % and split (confirm) (C8, S40)

## P4d — KYC and AML settings (S19, S20)

- [x] Move the domain-free KYC config model to `@platform/kernel` with document kinds as a parameter (leasing unchanged, tests) (done in P1, S32)
- [x] `spa_kyc_configs` per party role (+ deal-type override), versioned; settings screens (fields, documents, checks, cross checks, custom rules) (C9, S41; screens in C34)
- [x] `spa_aml_policy`: rules + thresholds, source-of-funds evidence, risk scoring + EDD, re-screening; `edd_signoff` gate (C10, S42; screens in C34)
- [x] Every check result records the config/policy version (KYC runs: `kyc_runs.config_scope/version` and `helper_runs.kyc_config_version`, `aml_policy_version`, `rules_version`, C17, S49; later helpers reuse `helper_runs`)

## P5 — Templates (uploaded structure = output structure, S5)

- [x] First: move the contract-structure reader from `@leasing/helpers` to `platform/` (profile passed in, no `@leasing/*` imports, leasing golden test unchanged) (S34) (C11, S43)
- [x] SPA profile for the contract-structure reader: Seller / Purchaser / Broker blocks, signature roles (C12, S44)
- [x] Repeatable purchaser block; fixed purchaser slots → `needs_human` when buyers exceed slots (reading in C12: slot keys `purchaser_name_2`; `needs_human` at render, C14, S46)
- [x] Mapping to SPA data-sheet keys (code first, then decision model on descriptions only) (C12, S44)
- [x] Template checks: sample values, DLD/RERA marks, fee % vs rulebook, missing core keys (C13, S45)
- [x] Named templates with versions, `document_kind` (spa, mou, assignment, listing_agreement), project scope, `template_approval` gate (C13, S45; upload and review screens in C34)
- [x] Repeatable seller block (co-owners) and company party block (name, licence, signatory) (C14, S46)
- [x] Render: same sections, numbering, tables, header/footer/logo; plan table in the template's style; e-sign anchors at signature blocks (`renderSpaAgreement`, C14, S46)
- [x] Tests: 3 fictional templates (numbered articles, decimal clauses, placeholders) round-trip with identical structure (C14)

## P5b — Resale steps (S13, S15)

- [x] NOC step: upload, match, expiry warning, `noc_review` (entered by a person; reading the documents is C20, S47)
- [x] Finance step: seller liability/release letters, buyer pre-approval/final offer, amount confirmation by a person (S47)
- [x] Settlement statement and `settlement_approval` (finance): built by code from confirmed amounts, hash-checked, read route (S48; the screen comes with the deal record)
- [x] Security deposit recording and return on cancellation (C8, S40)

## P6 — Helpers and evals

- [x] First: move the KYC document reader from `@leasing/helpers` to `platform/` the same way (S34) (C17, S49; leasing golden unchanged)
- [x] `spa-kyc` (shared reader + SPA profile); evals on fictional passports/IDs (C17, S49: person documents; company documents and deeds in C20; the `spa:kyc` runner and 40 fictional specimens are built, the real-model run is the user's)
- [x] `aml-screening`: fake lists, code matching and warning signs, model summary; evals incl. injection in names (C18, S50: `screenDeal`, `aml_cases`, the `spa:aml` runner and 30 invented cases are built, the real-model run is the user's; no screen yet, C34)
- [x] `spa-prepare`: fill, repeat blocks, field sources, hash (C19, S51: `prepareAgreement`, job `spa.prepare`, `agreements`, `payment_plan_rows`; no screen yet, C34)
- [x] `company-check`, `ownership-check`, `document-reader` (NOC, bank letters; amounts need a person's confirmation) (C20, S52: `readDocument`, `runCompanyCheck`, `runOwnershipCheck`, jobs `spa.document.read|company.check|ownership.check`, `document_reads`, `company_checks`; `companyChecksOk` is real; the `spa:document-reader`, `spa:company-check` and `spa:ownership-check` runners and 170 fictional specimens are built, the real-model run is the user's; no screen yet, C34)
- [x] `registry` helper for Oqood register/transfer and trustee transfer: rejection → field, one safe fix, else human (C21, S56: `mapRejection` (code table, then decision model, 0.6 bar), `runRegistry`, `registry_rejections`, tasks `registry_rejected` and `registry_unavailable`, retries at 5 min, 30 min and 2 h; eval `spa:registry` (30 invented messages, the real-model run is the user's); no screen yet, C34)
- [x] `collections`: instalment reminders from the plan (C21, S56: `spa.instalment.remind` 08:00 Dubai, template `instalment_reminder`, `collection_reminders`, policy `instalmentReminders`, task `instalment_overdue`; a milestone row gets no reminder, C22's task covers it)

## P6b — Payments, default flag, records, alerts (S26–S30)

- [x] `payment_receipt` reading + escrow account check + finance confirmation (C22, S55: `project_escrow_accounts`, `payments`, `registerPayment`, `confirmPayment`, real `instalmentsPaid`; 10 receipt specimens join `spa:document-reader`, the real-model run is the user's; no screen yet, C33)
- [x] `in_default` flag job and task (overdue days in policy; resale withdrawal/no-show recorded by agent) (C22, S55: `spa.default.check`, `spa_tasks`, `recordPartyDefault`, `clearDefaultFlag`, policy `defaultAfterDays`; milestone instalments get a task, not a reminder)
- [x] Retention review job, case export pack, monthly compliance report (compliance roles only) (C23, S62: `spa.retention.review` lists and a compliance role approves, nothing is deleted yet (open item for compliance); `exportCasePack` store-only ZIP with a manifest; `spa.report.monthly` CSV and PDF; tables `exports`, `retention_reviews`, `retention_review_items`, `compliance_reports`; migrations 0051 and 0052)
- [x] Alerts: per-gate thresholds, email + in-app, manager escalation (C23, S62: `spa.alerts` hourly, `alert_settings` via `GET`/`PUT /api/settings/alerts`, `GET /api/alerts`, `POST /api/alerts/:id/read`, bell and Alerts page; the Settings → Alerts screen is C34)

## P6c — Helper modes, chasing, assistants (S22–S24, specs §6)

- [x] `spa_helper_settings` + Settings → AI helpers (mode auto/review/off, models read-only); `helper_review` gate (C24, S59: `helper_review_holds`, `driveDeal`, off-mode tasks; migrations 0045 and 0046)
- [x] `agreement-review` helper (flags only, quote guard; C25, S60: `agreement_reviews`, job `spa.agreement.review`, 30-case eval `spa:agreement-review`, flags on the `agreement_approval` card and the deal record; helper mode applies)
- [x] `chaser`: schedule per company, admin-approved templates, neutral AML wording, stop rules (C25, S60: `chase_templates`, `chases`, `chase_pauses`, `spa.chase.sweep` and `spa.chase`, `chase_overdue` task; migrations 0047 and 0048; template editor screen is C34)
- [x] Party portal assistant (token scope, no AML mentions, contact agent) + evals (C26, S61: `POST /public/party/:token/assistant`, six tools, code output guard, `spa:party-assistant` 40 cases; the chat box is C35)
- [x] Listing page chat (published listings only, enquiry by email with consent, rate limit) + evals (C26, S61: `POST /public/listings/:ref/chat`, `listing_enquiries`, 20 messages an hour and 3 enquiries a day, chat box on the public listing page, `spa:listing-chat` 30 cases)
- [x] Template assistant (explain, compare, propose with click) + evals (C26, S61: `POST /api/template-assistant`, `assistant_proposals`, `POST /api/template-proposals/:id/apply`, `spa:template-assistant` 20 cases; the screen is C34)
- [x] Eval pass bars from specs §6.6 wired into `bun run eval -- spa:<helper>` (C26: party assistant, listing chat and template assistant; the staff copilot's is `spa:copilot`, C36, S68; the real-model runs are the user's)

## P7 — Adapters and mocks

- [x] `ScreeningAdapter` (fake, labelled simulated) (C18, S50)
- [x] `OqoodAdapter` (register, transfer) + `TransferAdapter` (trustee, new title deed) in `modules/spa/apps/oqood-mock` (:4101), realistic rejections, labelled simulated (C27, S53: `HttpOqoodAdapter`, `FakeOqood`, `registrations`, jobs `spa.oqood.submit` and `spa.transfer.submit`, `oqoodIssued` and `transferIssued` are real; the `registry` helper that proposes a fix is C21; no screen yet, C34)
- [x] Reuse `ESignAdapter` and portal signing; SPA mail templates (C28, S54: `outbound_messages`, `signing_envelopes`, `signatures`, `sendSpaMail`, the four mail templates, signing links in policy order, jobs `spa.signing.invite`, `spa.signing.remind` and `spa.signing.finish`, real `allSigned`; offer links are emailed; minimal pages `/b/<token>/offer` and `/b/<token>/sign`; the documents-request email and the rest of the buyer portal are C35, done: `documents_request`, `transfer_booked` and `registered` mails, S67)

## P8 — Staff web (from `docs/spa/mockup.html`)

- [x] Home, Workspace (Work: deals by type, filters, search, tasks) and Deal record: overview, parties, steps, approvals, tasks, payment plan, activity (C30, S58: reads only; demo seed of ten fictional deals)
- [x] Inventory and Listings screens: project table and project page (buildings, units with status, price-list price and deal link, price lists by version, template, masked escrow), listings table with permit warning, public page and offer state, and the listing record (sellers for sales roles only); Home and Work tabs per company kind (C32, S64)
- [x] The deal record's documents, AML (compliance roles), agreement, signing, NOC, finance, settlement and registration/transfer sections (each with its engine section) (C39, S71: eight new sections `documents`, `aml` (compliance_officer and mlro only), `agreement`, `signing`, `noc`, `finance`, `settlement`, `registration`; `RecordSection.steps` and `visibleTo`; role-free views beside each existing read; page `/compliance/deals/[id]`; no migration)
- [x] Inbox for `spa_approvals` with decision forms per gate (C31, S63: Work's Inbox tab, and "Waiting for your decision" on the Compliance screen for the two compliance roles; `helper_review` card shows the held result's reasons, `agreement_approval` card the review flags)
- [x] Timeline and approval reads filtered by role: AML events, `aml_flag`/`aml_report`/`edd_signoff` approvals only for compliance roles; others see "Compliance review" (S6, S35) (C29, S57: read routes `GET /api/deals`, `/api/deals/:id`, `/events`, `/api/approvals`, `/api/tasks`, `/api/summary` and `POST /api/approvals/:id/decide`, `RECORD_SECTIONS`, migration 0044; the screens that call them are C30 and later)
- [x] Compliance page (AML cases): tabs Open cases, More info asked, EDD, Reported, Closed; case view with screening per person (score against threshold, list, date), source-of-funds evidence, risk level and points, the model summary labelled "suggestion", the decision card and the case trail; compliance roles only (C33, S65: `GET /api/compliance/cases`, `/api/compliance/cases/:id`; no migration; existing Case export, Retention lists, Monthly reports and Export log kept)
- [x] Templates (upload → structure → fields → parties & signatures → preview → approval): Settings → Templates list, template page with the upload form (a ticked "no real customer data" box and a scan for IDs, passports, emails, phones and IBANs), uploads with their state, versions with checks, the version page (blanks and what each is filled from, remap by an admin, wording as plain text, preview PDF marked SAMPLE) and legal's decision in the inbox (C34, S66: migrations 0057 and 0058, `GET`/`POST /api/templates`, `POST /api/templates/:id/versions`, `GET /api/template-versions/:id` and `/preview`, `POST /api/template-versions/:id/blanks/:blankId/remap`, job `spa.template.read`)
- [x] Settings (company & signatories, plans, fees & rulebook, AML, signing, users & roles, models, integrations, demo clock) (C40, S72: company, plans, fees, signing, users, models, integrations and demo-clock pages; `GET`/`PUT /api/settings/company`, `GET`/`PUT /api/settings/policy/:page`, `GET /api/settings/rulebook`, `GET`/`PUT /api/settings/users`, `GET /api/settings/models`, `GET /api/settings/integrations`, `POST /api/demo/clock`; no migration. Earlier pieces: Templates, KYC forms, Alerts, AI helpers (C34, S66) and the compliance rules page `/compliance/policy`. Still open: adding a signatory outside a deal, creating users and passwords (portal CLI only), the chase-template editor, editing rulebook values, a models or integrations editor)
- [x] Buyer portal: upload documents, review plan, sign, instalments (C35, S67: `portal_links` (migrations 0059, 0060), `documents` and `view` links by email, `GET`/`POST /public/portal/:token/documents`, `POST .../documents/send`, `GET .../status`, pages `/b/<token>/documents` and `/b/<token>/status`, the party chat box; party bank-letter upload and plan acknowledgement are out of scope)

## P9 — SPA copilot

- [x] `@spa/copilot`: read tools (deal, listing, timeline, approvals, plan, template), draft tools, propose tools (C36, S68: 21 tools, one per file; `GET /api/copilot/rulebook`, `GET /api/deals/:id/noc-status`; `POST /api/copilot/chat`, `/proposals` (+ confirm, cancel), `/drafts`; `copilot_proposals`, `copilot_drafts`; the dock; migrations 0061, 0062)
- [x] AML report visibility by role; evals incl. injection and permission cases (C36, S68: `get_compliance_case` for compliance roles only, a code guard for every other role, `spa:copilot` 65 cases; the real-model run is the user's)

## P10 — Portal launcher

- [x] `apps/portal` (:3100): module tiles, links to leasing and SPA, `/summary` counts (C37, S69: two integers behind `x-portal-key`, counts only with `PORTAL_SHOW_COUNTS`, "Not available" when an engine is down; `dev:all`; boundary rules in `check-domain-rules`)
- [x] Stage 2: portal sign-in, signed token, each app verifies and keeps its own roles (C38, S70: `portal` database with `portal_accounts`, EdDSA 60 s hand-off token with no role, `POST /api/auth/portal-exchange` (+ `?check=1`) in each engine, `portal_handoffs` migrations leasing 0047 and SPA 0064, `portal:keygen`, `portal:db:migrate`, `portal:create-account`; tiles and counts only for modules where the email has an active user)

**Exit (module):** a fictional primary deal reaches Oqood and a fictional ready resale with a seller mortgage reaches a new title deed (both simulated), each agreement
matches the uploaded template's structure exactly, and every gate was decided by a person.
