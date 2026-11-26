# SPA decisions

Short records of choices already made for the SPA (Sale and Purchase Agreement) module. Leasing
decisions stay in `docs/leasing/decisions.md` (D1, D2, …). SPA decisions use their own numbers (S1, S2, …)
so the two logs never collide. Add new ones at the bottom; supersede rather than edit.

Where a leasing decision is followed as is, the SPA record says "same as Dn". Where it is not, the
SPA record says so. A leasing decision never changes SPA behaviour by itself.

## S1 — SPA is a separate module in the same monorepo

- **Why.** SPA (selling a unit) and leasing (renting a unit) are different products with different
  people, gates and laws. The user wants them fully separate at runtime. They still share a lot of
  code that has nothing to do with either domain: the helper runner, the Ollama model layer,
  `Clock`, money in fils, `maskPii`, state-machine and gate helpers, e-sign, mail, pdf and storage
  adapters, the template reader, lint rules and the eval runner.
- **Decision.** Keep one repository. SPA lives in its own top-level folder `spa/` with its own
  apps and packages. Shared code lives in shared packages only. A monorepo is not a monolith: no
  database, process, queue, clock or approvals table is shared (S2, S3).
- **Boundary (enforced by `scripts/check-domain-rules.ts`).** `spa/**` may import shared packages
  (`@platform/kernel`, `@platform/llm`, `@leasing/adapters`, the shared parts of
  `@leasing/helpers`). Leasing code never imports `@spa/*`. SPA code never imports leasing domain
  packages (`@leasing/core`, `@leasing/rulebook`, `@leasing/db`, `@leasing/copilot`).
- **When to split into its own repo.** A separate team, a separate release cadence, or a client
  that must not receive leasing source. Then move the shared packages to a private registry and
  move `spa/` out. The boundary above makes that a copy, not a rewrite.

## S2 — Separate runtime: own database, jobs, clock, engine and web

| | Leasing | SPA |
|---|---|---|
| Database | `leasing` (`DATABASE_URL`) | `spa` (`SPA_DATABASE_URL`) |
| Test database | `leasing_test` | `spa_test` (`SPA_TEST_DATABASE_URL`, must contain `test`) |
| Jobs | pg-boss in `leasing` | pg-boss in `spa` (own schema, own workers) |
| Clock / demo clock | `demo_settings` in `leasing` | `spa_demo_settings` in `spa` |
| Engine | `modules/leasing/apps/engine` :4000 | `modules/spa/apps/engine` :4001 |
| Staff web | `modules/leasing/apps/web` :3000 | `modules/spa/apps/web` :3001 |
| Registry mock | `modules/leasing/apps/ejari-mock` :4100 | `modules/spa/apps/oqood-mock` :4101 |
| Session cookie | `leasing_session` | `spa_session` |

- One module can be migrated, reset (`spa:demo:reset`) or taken down without touching the other.
- Same as D2 (pg-boss, `singletonKey`) and D3 (`Clock`), each in its own database.
- Root scripts: `dev:leasing`, `dev:spa`, `dev:portal`, and `dev` runs all of them.
  `bun run dev` keeps leasing on its current ports so the README demo steps don't change.

## S3 — SPA has its own approvals table, gates and roles

- **Table.** `spa_approvals` in the `spa` database. Never the leasing `approvals` table. The SPA
  inbox lives in `modules/spa/apps/web`; leasing keeps its own inbox.
- **Gates** (`@spa/core` `spaGates`): `price_out_of_range`, `kyc_review`, `aml_flag`,
  `aml_report`, `template_approval`, `agreement_approval`, `oqood_submission`, `cancellation`, `refund`.
  See `docs/spa/architecture.md` §5. **Extended by S13** (resale gates).
- **Roles** (`SpaRole`): `sales_officer`, `sales_manager`, `sales_admin`, `legal`,
  `compliance_officer`, `mlro`, `finance`, `admin`. Stored in the SPA database's `spa_users`.
- **Same as leasing:** nobody approves their own proposal; admin configures but approves nothing;
  every gate decision is an append-only event with actor, reason and `rulesVersion`.

## S4 — Shared code is reused by arguments and profiles, never by copying domain code

- A shared helper takes a **profile** (names, document set, prompt wording, data-sheet keys,
  party roles) instead of fixed leasing words. Leasing callers get the leasing profile by default,
  so leasing behaviour does not change.
- Examples: `kycHelper(llm, readImage, { profile: spaKycProfile })`;
  `contractStructureHelper(llm, readFile, { profile: spaTemplateProfile })`.
- SPA-only behaviour (AML screening, Oqood registration, payment plans) lives in `@spa/helpers`.
- Generic building blocks move to a new `platform/kernel` (`@platform/kernel`): `Clock`, money,
  ids, `maskPii`, the `Helper` contract, `defineMachine`, `defineGates`, `Actor`. `@leasing/core`
  re-exports them so no leasing import changes.

## S5 — The uploaded SPA template decides the document's structure

- **Why.** The user said every SPA must come out in exactly the structure of the template they upload:
  the same clauses in the same order, the same numbering, the same party and broker sections and
  the same signature blocks.
- **Decision.** Reuse the contract template reader (D38, D43, D47, D70, D74) with an SPA profile:
  - Code copies the wording verbatim and keeps the section order and numbering style. It also keeps
    the tables, header, footer, logo, fonts and margins. The model only proposes headings and labels (same as D38).
  - Blanks and named placeholders (`{purchaser_name}`, `[unit_no]`, `<price>`) are mapped
    to SPA data-sheet keys by code first, then the decision model picks from key descriptions only
    (same as D43/D74). Unknown names print an empty line and are listed in the review.
  - **Party blocks.** The reader marks the template's Seller, Purchaser and Broker blocks. When a
    deal has more purchasers than the template has purchaser blocks, the purchaser block is repeated
    for each buyer in the same layout. When the template has numbered fixed slots
    ("Purchaser 1 / Purchaser 2") and there are more buyers than slots, prepare stops with
    `needs_human`.
  - **Signature blocks.** Each detected signature line gets a role (purchaser n, broker, seller
    signatory, witness) and becomes the e-sign anchor at the same place on the page. The signing order
    comes from settings (S9), not from the page order.
  - **Schedules.** The unit schedule and the payment plan print as tables in the template's
    own table style, at the template's own `{payment_plan}` or schedule position.
  - Nothing is reordered or reworded. Extra clauses print only at `{additional_terms}`, else after
    the last clause under "Additional terms" (same as D74).
- **Approval.** A new template version needs the `template_approval` gate (legal). Every SPA made
  from it still needs `agreement_approval` (legal). Approval checks: sample values left in the wording,
  DLD/RERA marks in the header/footer/logo, fee percentages in the wording that differ from the SPA
  rulebook, and missing core placeholders (parties, unit, price, plan).
- Named templates with versions (same as D69). Each template lists the projects it may be used for
  (none = any project).

## S6 — AML: code raises flags, the model only summarises, people decide

- Screening against sanctions and PEP lists goes through a `ScreeningAdapter` (fake with fictional
  fixture lists in demo, labelled simulated). Name matching, the similarity threshold and the
  warning-sign rules (third-party payer, cash above threshold, high-risk country, unclear source of
  funds) are **code** using `@spa/rulebook` values and company policy.
- The model writes the case summary and suggests which documents to ask for. It never raises,
  clears or scores a flag.
- An open flag puts the deal on hold (`AML_HOLD`). Only a `compliance_officer` decides: clear,
  ask for more information, stop the sale, or stop and report. "Report" creates an `aml_report`
  gate for the `mlro`, who files with the FIU (goAML) outside the system and records the reference.
- Tipping-off: buyers are never told about a report; their emails and portal show "under review"
  only. Confirm the wording with legal.

## S7 — Money and fees come from the SPA rulebook

- `@spa/rulebook` versions per emirate (`dubai-sales-2026-01`, …). Values: DLD registration fee
  (4% in Dubai, confirm with legal), Oqood/admin fees, which party pays each fee, payment-plan rules
  (shares add up to 100%, booking amount minimum for primary sales), AML thresholds. Each deal pins its `rulesVersion`.
- Discount limits are company policy (Settings → Pricing), checked by code against the price
  list. Outside the limit → `price_out_of_range` (sales manager).
- Money is integer fils. Same as D4 and AGENTS.md rule 1: no model computes a legal or money value.

## S8 — Oqood is mocked behind `OqoodAdapter`

- Same shape as `RegistrationAdapter` (D9): `register`, `status`, `cancel`, `certificate`, with a
  `requestId` so retries are safe. `modules/spa/apps/oqood-mock` returns realistic rejections and is labelled
  "Simulated Oqood (demo)". No DLD logos, colours or screen copies.
- Submission always passes the `oqood_submission` gate (sales admin).

## S9 — Signing: purchasers, then broker, then seller

- Uses the shared `ESignAdapter` and the portal signing flow (same as D22): single-use links,
  typed name and consent, evidence stored, signature record page appended, signed hash stored.
- Default order: every purchaser (in deal order) → broker → seller's authorised signatory.
  Admin can change the order per company in Settings → Signing. Reminders every 48 h by email
  until signed or the link expires.
- The seller signs last, and only after every other signature is in.

## S10 — A launcher portal links the modules; sign-in is shared later (amended by S21)

- `apps/portal` (:3100) shows the modules the user may open (Leasing, SPA) and links to each
  web app. Stage 1: links only, each app keeps its own sign-in.
- Stage 2: the portal owns sign-in and issues a signed token (JWT, asymmetric key). Each app
  verifies it and keeps its own roles in its own database. Cookies use different names per app
  (on `localhost` cookies are shared across ports). In production each module gets a subdomain.
- The portal may show counts by calling each engine's `/summary` endpoint; it never reads a
  module's database.

## S11 — SPA copilot follows the leasing copilot rules

- A separate copilot in `@spa/copilot`, with its own tools and evals. It reads, drafts and
  proposes. It can't approve a gate, send a message, change state, submit to Oqood, clear an AML
  flag or open uploaded documents. Same safeguards as AGENTS.md rule 11.
- It must never reveal an AML report to someone without the `compliance_officer` or `mlro` role.

## S12 — Client kinds: developer, brokerage, or both

- **Why.** The user said a sale can come from a single person reselling their unit, or from a
  company selling units. Clients are either developers selling their own projects or agencies
  that list other people's property, and some are both.
- **Decision.** Each SPA company has `kind`: `developer`, `brokerage` or `both`. It decides which
  deal types (S13) and screens are shown. A developer keeps inventory (projects, units, price
  lists). A brokerage keeps **listings**: one property per listing, with its seller parties,
  ownership document, asking price and a signed listing agreement (Form A style, from a template).
- A `both` client has both inventory and listings; a deal points to exactly one of them.

## S13 — One `deals` entity with three deal types (renames bookings)

- **Why.** "Booking" fits a developer sale but not a resale. Resales add steps (developer NOC,
  banks, settlement, trustee transfer) that primary sales don't have.
- **Decision.** The entity is `deals` (was `bookings`; events `deal_events`, parties
  `deal_parties`). `deal_type`: `primary_offplan`, `resale_ready`, `resale_offplan`. Mortgage flags:
  `seller_mortgage`, `buyer_mortgage`. One state machine with type guards: steps that don't apply
  to a type are skipped by guard, never by a model (architecture §4).
- **States.** `OFFER_AGREED → PARTY_CHECK (⇄ AML_HOLD) → AGREEMENT_DRAFT → LEGAL_REVIEW → SIGNING`,
  then primary: `REGISTRATION → INSTALMENTS → HANDED_OVER`; resale: `NOC → FINANCE (if a mortgage)
  → SETTLEMENT → TRANSFER → COMPLETED` (off-plan resale continues to `INSTALMENTS → HANDED_OVER`
  when a plan is taken over). `CANCELLED` from any open state.
- **Agreements.** Templates have a `document_kind`: `spa`, `mou` (Form F style), `assignment`,
  `listing_agreement`. Each deal type names which kind it needs. S5 applies to all of them.
- **Gates added** (amends S3): `seller_verification` (sales manager), `noc_review` (sales admin),
  `settlement_approval` (finance), `transfer_submission` (sales admin). `spa_approval` is renamed
  `agreement_approval` (legal), since it now covers SPAs, MOUs, assignments and listing agreements.

## S14 — Sellers are parties: individuals, co-owners or companies

- **Decision.** A seller is a `deal_parties` row like a buyer (role `seller`, order, share). Every owner on the title
  deed or Oqood is a seller and must sign. A developer seller is the client company itself.
- **Individual seller:** KYC like a buyer; names must match the ownership document.
- **Company (buyer or seller):** valid trade licence; signatory proof (POA or board resolution naming
  the person who signs); ownership document in the company's name; beneficial owners (25% or more,
  confirm with compliance) recorded and each screened like a person.
- **AML runs on sellers too** in resales, with the same code rules and the same `aml_flag` gate (S6).
- A mismatch in ownership, co-owners or signatory → `seller_verification` (sales manager).

## S15 — Developer NOC and bank letters: the model reads, code checks, people confirm money

- NOCs, liability letters, release letters, pre-approvals and final offers are uploaded by staff
  or the party and read by the vision model through `document-reader` profiles.
- Code checks names, unit, dates and validity. **Amounts read from a bank letter are never used
  until a person confirms them** (rule 1: models extract, they don't decide money).
- The **settlement statement** for a resale is built by code from the price, deposits, confirmed
  bank amounts, rulebook fees and commission policy, must balance to zero, and always needs
  `settlement_approval` (finance). Any later change makes it stale.

## S16 — Transfers are mocked like registrations

- `OqoodAdapter` gains `transfer` (off-plan resale). A `TransferAdapter` (trustee office) books an
  appointment and returns a new title-deed number. Both are mocked in `modules/spa/apps/oqood-mock`
  (renamed in docs as the "registry mock"), labelled simulated, same retry rules as S8.
- `transfer_submission` (sales admin) gates every transfer.

## S17 — Listings need an advertising permit; an optional public page

- **Why.** The user chose: after a listing is ready, record the DLD advertising permit and optionally
  publish a listing page; no lead or viewing management in the MVP.
- **Decision.** A listing stores the permit number, issue and expiry dates. States: `DRAFT → VERIFIED
  (agreement signed, ownership matched) → ACTIVE (valid permit) → PUBLISHED → UNDER_OFFER → SOLD`;
  `WITHDRAWN`. A daily job unpublishes a listing whose permit expired. The public page (in `modules/spa/apps/web`,
  no login) shows photos, description, asking price, community and the permit number, never seller
  names, title-deed numbers or documents. Enquiries go to the agent's email. Confirm the permit rules with legal.

## S18 — One offer at a time; the deposit is a cheque held by the brokerage

- **Offers.** A listing has at most one open offer (`offers`: buyer parties, price, mortgage flag, target
  transfer date, conditions, valid until). The seller accepts or rejects through an emailed link; while
  open the listing is `UNDER_OFFER`. Rejected or expired → the listing is free; a revision is a new
  offer. Accepting creates the deal. Every offer and answer is an event.
- **Deposit.** The buyer's security deposit is a cheque in the seller's name held by the brokerage
  (`deposits`: amount from policy % × price by code, cheque number masked, bank, date, holder, status
  `held → handed_to_seller | returned_to_buyer`). Required before leaving `SIGNING` in a resale; handed
  to the seller only after the transfer is issued. On cancellation the release is a decision:
  `deposit_release` gate (sales manager), with the MOU clause shown.
- **Brokers** (assumption, confirm): a seller's agent and a buyer's agent, same or another agency,
  each with a commission % and payer; shown as settlement lines.

## S19 — KYC is configurable per party role, like leasing's KYC settings

- **Why.** The user wants admins to add, remove and edit fields and validations for every document
  in the SPA process (passports, IDs, company and AML documents), as leasing already allows (D46, D49, D50).
- **Decision.** Reuse the leasing KYC configuration model (`FormField`, document rules with
  severities, cross checks, company rules, safe patterns, locked severities, the protected-trait
  refusal) by moving its domain-free parts to the shared kernel and adding SPA document kinds (title
  deed, Oqood, POA, board resolution, memorandum of association, NOC, bank letters). SPA keeps one form
  and rule set per **party role**: `buyer_person`, `seller_person`, `company_party`, `beneficial_owner`,
  each optionally overridden per deal type. Stored in `spa_kyc_configs` with versions; a check records
  the version it used.
- Same safety as leasing: a model check can only warn; expired IDs never pass; no rule on nationality or similar traits.

## S20 — AML is configurable: rules, source-of-funds evidence, risk level and EDD, re-screening

- Rules (on/off, severity, thresholds, high-risk list), source-of-funds evidence per declared source,
  risk scoring (points per rule and factor, low/medium/high cut-offs), EDD documents for high risk,
  and re-screening points live in `spa_aml_policy` with versions.
- Risk level is computed by code. High risk always needs `edd_signoff` (compliance officer) after the
  EDD documents are in, even with no flag. S6 still holds: no model raises, scores or clears anything.

## S21 — Inside a module there is no other module; the mockup's look is the design system (look amended by S31)

- **Why.** The user said: once a module is chosen, no switcher or reference to another module; only
  log out or go back to the portal and choose again.
- **Decision.** The SPA web app's header has the product name, "Portal" (returns to the module chooser)
  and "Log out". No link, tab, badge, count, setting or text in SPA names or points to leasing (and the
  same rule applies to the leasing app). Only the portal lists modules. **Amends S10:** the portal's
  module counts stay on the portal page only.
- **Look.** The tokens in `docs/spa/mockup.html` are the SPA design system: white page, gypsum `#f4f6f1`
  raised surfaces, ink `#0b0b0b`, muted `#5b6157`, lines `#e2e6dc`, sage accent `#dbe6cf`, green
  `#2f5d50` for done, saffron `#8a5200` on `#f7ecd9` for warnings, brick `#b42318` for errors, Geist and
  Geist Mono, 16 px card and 10 px input radius. They match the leasing app's tokens so both feel like one family.

## S22 — Helpers auto-advance by default; each can be switched to review

- **Why.** The user chose auto-advance plus a per-helper setting.
- **Decision.** When a helper returns `ok` and every code check passes, `SpaManager` moves on. In Settings →
  AI helpers an admin can put `ownership-check`, `spa-kyc`, `company-check`, `document-reader` (per document
  kind), `spa-prepare` or `registry` auto-fix into **review** mode: an `ok` result then waits for a
  `helper_review` click by a sales officer or manager. A helper can also be switched off (its step becomes a manual
  task). Stored in `spa_helper_settings`, audited. Not switchable: `aml-screening`, `settlement`, `chaser`,
  `collections`, and every always-on gate. Low confidence always goes to a person in both modes.

## S23 — Parties are chased by code with fixed, approved templates

- Missing, failed, expired or compliance-requested items trigger reminder emails on a per-company schedule
  (default: at request, +2 d, +5 d, then a task for the agent at +7 d). Templates are written and approved by an
  admin; code fills names, property, items and reasons from a fixed list. No model writes chase text.
- AML and EDD requests use neutral wording ("additional documents needed"). Chasing stops on upload, cancel or pause.

## S24 — Four assistants: staff copilot, party assistant, listing chat, template assistant

- All share: a scope gate before the chat model; Zod-typed tools that call the engine as the user or the party's
  token; a post-check that every amount, date and percentage in an answer came from a tool in that turn; 60 s per
  turn; stored conversations.
- **Party portal assistant:** only the token's deal and party; never mentions AML, EDD, screening or reports; no
  advice; no other party's personal data; can email the agent a question.
- **Listing page chat:** only published listings of the company; never the seller's identity, lowest price or
  whether an offer would be accepted; sends an enquiry (with consent) to the agent's email. Rate-limited.
- **Template assistant:** explains mappings, compares versions, proposes changes that an admin applies with a click.
- **Staff copilot:** as S11.

## S25 — SPA settings and models live in `.env.spa.local`

- **Why.** The user asked for a separate env file for SPA.
- **Decision.** SPA apps load only `.env.spa.local` (never `.env` or `.env.local`). The committed template is
  `.env.spa.example`. `.env.spa.local` is git-ignored and denied to coding agents in `.claude/settings.json`, like `.env`.
- Models are fixed there (no UI choice): `SPA_CHAT_MODEL`, `SPA_VISION_MODEL`, `SPA_DECISION_MODEL`,
  `SPA_COPILOT_MODEL` and `SPA_ASSISTANT_MODEL` (the last two empty = chat model). Settings → AI helpers shows
  them read-only. A model or prompt change needs the helper's eval to pass (specs §6.6).

## S26 — Primary payments are checked against the project escrow account

- Each project stores its escrow account (masked in logs). Every primary payment needs an uploaded receipt.
  `document-reader` (`payment_receipt`) reads amount, date, payer and receiving account; code checks the account is
  the escrow account and the payer is a buyer (else the third-party-payer AML rule). Finance confirms the amount
  before the payment counts (S15). Any other account → not counted, finance task.

## S27 — Default is a flag for now

- **Why.** The user chose "flag only for now, track later".
- An instalment overdue beyond policy days, or a resale party withdrawing or missing the transfer appointment
  (recorded by the agent), sets `deals.in_default` and creates a sales-manager task. No state change, notices,
  termination or deposit-forfeit workflow in the MVP. Revisit with legal.

## S28 — Only companies act through representatives in the MVP

- Companies act through signatories proven by POA or board resolution (S14). Individual buyers and sellers
  upload and sign themselves. POA holders for individuals are out of scope until decided.

## S29 — Compliance records: retention, export pack, monthly report

- Retention at least 5 years after the deal ends (confirm with compliance); deletion only after a compliance
  officer approves the monthly list; the deletion is an event. Case export pack (ZIP + PDF summary) for compliance
  roles, each export logged. Monthly compliance report (CSV/PDF) for compliance roles.

## S30 — Staff alerts for waiting gates

- Per-gate waiting thresholds in Settings → Alerts. Past the threshold the approver role gets an email and an
  in-app notice; past twice the threshold, the manager too. Alerts never contain AML details outside compliance roles.

## S31 — `docs/spa/design.md` is the SPA design system and screen guide

- **Why.** The user asked for one file that says what every screen contains (settings, work, records),
  how external links for buyers, sellers and brokers work, how things are worded, and that uses the
  leasing app's colours. Mockups follow it, not the other way round.
- **Decision.** `docs/spa/design.md` is the source for SPA UI. Tokens and components are the leasing app's
  (`modules/leasing/apps/web/lib/design/tokens.ts`, `components/ui/*`), moved in P2 into a shared domain-free `@platform/ui`
  package that both apps import. The staff shell is the leasing rail · main · copilot dock; "Portal" and
  "Sign out" live in the avatar menu (refines S21's header). Older mockups and artifacts are illustrations only;
  where they differ, design.md wins. Changes to design.md need a new S-decision.

## S32 — How the P1 kernel split was made, and what still reaches leasing code

- **Why.** P1 (S1, S4, S19) moved the domain-free code into `@platform/kernel` without changing leasing. A few
  choices were not spelled out in S4 and are recorded here.
- **Decision.**
  - `Actor` in the kernel is `system`, `system:<job>`, `import`, `demo`, `user:`, `helper:`, `copilot:` plus a
    module's own parties as a type parameter. Leasing adds `tenant:`, `landlord:`, `enquirer:`; SPA adds its own.
  - The kernel helper contract and `StateMachine.entity` take any string. Leasing keeps its `EntityKind` enum (the
    database columns and engine types use it), and its `StateMachine` and `defineMachine` stay pinned to leasing
    entities and `GateId`.
  - `defineGates<Gate, Role>(table, { standIn })`: the named approver, or a role the module lets stand in for it.
    Leasing's stand-in is the leasing manager for leasing-officer gates, as before.
  - `dates.ts` (Asia/Dubai calendar dates) moved with `Clock`, which needs it.
  - The KYC form model takes the reader's document kinds and each kind's checks, expiry and issue date
    (`defineKycForm`); `custom` and `other` are always added. Locked severities are the same in every module.
  - Shared helpers are imported by exactly these entry points: `@leasing/helpers/runner`, `/kyc`,
    `/contract-structure` (not their internals). The package root stays leasing's. Lint also keeps the kernel free of
    other workspace packages. Profiles: `KycProfile`, `TemplateProfile`; leasing's is the default, proved by a golden test.
- **Still open (lint checks direct imports only).** `@leasing/adapters` re-exports the Ejari adapter, which imports
  leasing types; `@platform/llm` lists `@leasing/core` as a dependency without using it; the KYC reader's code checks
  (`assessKyc`, `applyKycRules`), its context schema and the contract-structure data sheet, rendering and legal
  wording still import `@leasing/core`. SPA importing these today would load leasing code. Adapter subpaths (P2),
  the SPA template profile (P5) and the SPA KYC reader (P6) must remove these before SPA depends on them.

## S33 — P2 runtime choices: scripts, sign-in, rail by role, env keys (amends S2 on `dev`)

- **`dev` stays leasing-only for now.** `bun run dev` and `dev:leasing` start leasing on its old ports; `dev:spa`
  starts the SPA engine (:4001) and web (:3001) in parallel (`spa:engine`, `spa:web`; `bun --filter` would wait for the
  engine, which the web app depends on for its API types). S2's "`dev` runs all of them" waits for the portal (P10, `dev:all`).
- **Sign-in, same as leasing.** An HMAC session token (kernel `issueToken`/`verifyToken`, moved from the leasing
  engine unchanged), sent by the web server as a Bearer header, kept in the httpOnly `spa_session` cookie. In demo mode
  the sign-in page is a picker of the seeded users (no passwords) and, with no `SPA_SESSION_SECRET` set, sessions are
  signed with a fixed SPA demo secret that differs from leasing's, so a leasing session never opens SPA. Outside demo
  mode `SPA_SESSION_SECRET` is required and staff sign in with email and password (`spa_users.password_hash`,
  argon2id, null for demo users); one answer for a wrong email or password.
- **Rail by role** (design.md §2–3 made exact): Home everyone; Work sales roles, legal, finance; Inventory and
  Listings sales roles and admin (by company kind); Compliance compliance officer and MLRO only; Settings admin, and
  sales manager read-only. Until companies exist (P4b) the company kind is `both`.
- **Env (S25).** `loadSpaEnv` reads `.env.spa.local` at the repo root itself and never `process.env` (Bun loads
  leasing's `.env` there). New keys: `SPA_SESSION_SECRET` (required only when demo mode is
  off, ≥ 32 characters) and `SPA_PORTAL_URL` (Portal link, default `http://localhost:3100`). Model keys stay optional until P6.
- **Shared UI (S31).** `@platform/ui` holds tokens, `theme.css` (palette, dark variant, `@theme`, `@source` for its
  own components) and `base.css`; each app imports `base.css` from its root layout so its CSS output is unchanged.
- **Open (before any client pilot):** sign-in has no rate limit or lockout yet; the session cookie is `secure` only
  outside demo mode. Emails are stored lower case (database check) and matched in any case.

## S34 — Two modules as peers, one shared platform (supersedes S1's folder layout and S32's helper subpaths)

- **Why.** With leasing at the repo root and SPA in a subfolder, and shared and leasing-only packages mixed under
  `packages/` with one `@leasing/` name, the user found the monorepo confusing.
- **Decision.** `modules/leasing/{apps,packages}` and `modules/spa/{apps,packages}` are peers; shared, domain-free
  code is in `platform/` named `@platform/*` (`kernel`, `ui`, `llm`, `adapters`); `apps/portal` (P10) is the only
  app that knows both modules; docs are `docs/leasing/`, `docs/spa/`, `docs/platform/`. Package names say where code
  lives: `@leasing/*` only leasing, `@spa/*` only SPA.
- **Boundary (lint).** A module imports its own packages and `@platform/*`, never another module; `platform/`
  imports no module; the portal imports only `@platform/*`; a relative import never leaves its owner.
- **Moves.** The helper runner and session tokens are in `@platform/kernel`; mail sending, PDF, storage and e-sign
  types are `@platform/adapters`; Ejari, the Telegram channel and leasing email wording stay in `@leasing/adapters`,
  which re-exports the platform ones so leasing imports did not change.
- **Not moved yet.** The KYC and contract-structure readers stay in `@leasing/helpers` (they still import leasing
  types, S32) and move to `platform/` in P5/P6. The S32 exception letting SPA import them by subpath is withdrawn, so
  SPA cannot use them until they move: P5 (template reader) and P6 (KYC reader) start with that move.
- Commands, ports and scripts did not change (`bun run dev` is leasing; `dev:spa`).

## S35 — P3 domain core: routed events, fail-closed facts, cancelling and cascades

- **Why.** The P3 plan (docs/superpowers/plans/2026-11-18-spa-p3-domain-core.md) needed five choices the spec left
  open; the user agreed them on 2026-11-18.
- **Decision.**
  1. The branching steps (`ALL_SIGNED`, `NOC_OK`, `TRANSFERRED`) are routed by deal type and flags to one machine event
     per destination; callers and the event log use the spec's names.
  2. Guards read a facts snapshot. Until KYC, AML (P6), NOC and bank letters (P5b), registry (P7) and plans (P4)
     exist, their facts are false: a deal can be created and cancelled but cannot pass `PARTY_CHECK`.
  3. `CANCEL` from `OFFER_AGREED` needs no gate; from every later open state the `cancellation` gate (sales manager);
     not from `INSTALMENTS` (after Oqood registration or transfer: a legal termination flow, confirm with legal).
  4. Cascades: primary unit `HELD` on create, `SOLD` on all signed, `REGISTERED`, `HANDED_OVER`, back to `AVAILABLE`
     on cancel (from held or sold); resale listing `UNDER_OFFER` on create (from `ACTIVE`, `PUBLISHED` or already
     `UNDER_OFFER`), `SOLD` on transfer, `ACTIVE` on cancel.
  5. `deal_events.rules_version` is null until the SPA rulebook exists (P4).
- Deal refs come from a sequence (`D-0001`); a refused insert uses a number, so refs may skip.
- From the compliance review: units and listings move only through their deal (`advance` is deal-only); one open
  deal per unit and per listing (code check + partial unique indexes); an approval key dedupes only while pending;
  AML outcomes are kept on the compliance-only approval row, never on the deal timeline, and the report approval is
  titled "Compliance review". Reading the timeline and approvals must filter AML events to compliance roles (P8).

## S36 — Unconfirmed rulebook values are pending and refused

- **Why.** Several sales values await legal or compliance confirmation (specs §11): who pays the DLD fee, Oqood,
  trustee and mortgage-registration fees, the AML cash and name-match thresholds. Leasing had the same problem; a
  guessed number in a money function is worse than none.
- **Decision.** A `SalesRulebook` lists such fields in `pending`. Any function that needs one returns
  `{ ok: false, reasons: ["<field> awaits legal confirmation"] }`; it never uses the placeholder. Confirming a value
  means publishing a new version without it in `pending`. `dubai-sales-2026-01` confirms only the 4% DLD fee, the 10%
  minimum booking and the 25% beneficial-owner threshold (all from the spec).

## S37 — Policy versions and version pinning

- **Decision.** Company policy (`spa_policy`) is published by an admin as numbered versions that never change
  (trigger); version 0 is the code default (placeholders, not law). A deal stores the rulebook in force on its Dubai
  creation date and the current policy version; later versions never change it. Every event of a deal and of its
  unit or listing records the deal's rulebook version (closes S35 decision 5). No rulebook in force → no deal.
- Database guards (from the P3 review): CHECKs on every state, gate, status and a positive price; a decided approval
  is final except recording its consumption once; approvals are never deleted.

## S38 — Advertising permit expiry and the public listing page

- **Decision.** A listing's `permit_expires_on` is the permit's last valid day (the `ACTIVATE`/`PUBLISH` guard and
  the sweep agree). A pg-boss job `spa.permit.expire` runs daily at 00:05 Asia/Dubai and once on engine start (one per
  Dubai day); it takes down every published listing whose last valid day has passed (`UNPUBLISH`, actor
  `system:permit-expire`), safe to run twice. The public page `/properties/<ref>` (no sign-in) reads
  `GET /public/listings/:ref`, which answers only for `PUBLISHED` listings and returns a fixed list of fields: ref,
  title, description, community, bedrooms, size, asking price, permit number and the agent's name and email. Never
  owner names, title-deed or plot numbers, documents or offers. Confirm with legal whether "expires on" means the
  last valid day.
- From the C1–C6 review (amends S37/S38): owner names match one-to-one after Unicode normalisation (accents dropped);
  a name with no letters is refused; an approved `seller_verification` covers only the document and owners it was
  given for; the public route also checks the permit date itself; party events carry no personal data; a deal's
  versions, type, price and property are fixed by trigger and approval events carry its rulebook version; settlement
  refuses any non-whole or negative amount; an unscreened party raises `not_screened`.

## S39 — Offers: every co-owner answers; links are single-use

- **Decision.** A listing has at most one `SENT` offer (partial unique index); sending one moves the listing
  `UNDER_OFFER`. Each seller on the listing gets a single-use link (only its SHA-256 is stored). Every seller must
  accept for the offer to be accepted; one rejection rejects it. Accepting creates the deal at the offer price with
  the offer's buyers and the listing's sellers (deal type from the ownership document: title deed → ready resale,
  Oqood → off-plan resale). `valid_until` is the last day to answer (default today + policy `offerValidityDays`, 3,
  a placeholder); a daily job `spa.offer.expire` expires late offers and frees the listing. An offer's terms never
  change (trigger): a revision is a new offer. The link page shows the terms and listing title, never names.
  Until SPA mail templates exist (C28) the links are returned to staff instead of being emailed.
- Also: refs always come from the sequence; a resale's sellers must be the listing's sellers; nobody is both buyer
  and seller; ownership is recorded only before a listing is verified; one failing listing or offer never stops a sweep.
- **Amendment (offer flags).** An offer carries `seller_mortgage` and `plan_taken_over`, fixed with the other terms
  (trigger). For an off-plan resale (Oqood) both are required (422 if missing); for a ready resale `plan_taken_over`
  must be false and both default to false. Accepting creates the deal with the offer's values, no longer hard-coded false.

## S40 — Deposit cheque and brokers

- **Decision.** A resale's deposit cheque is recorded once, before signing completes; its amount is the deal's
  pinned policy `depositBps` × price by code (staff never type it); only the cheque's last four digits are kept. The
  `depositRecorded` fact is real: a resale can't leave `SIGNING` without a held cheque. It is handed to the seller only
  after the transfer was issued. On a cancelled resale, staff propose who gets it (per the MOU clause) and the sales
  manager decides `deposit_release`; applying it consumes the approval. One broker per side, commission defaulting to
  the pinned policy's side %, paid by that side, amount by code (settlement lines in C16). Confirm the split with the business.
- **Amendment (commission approval, AML hold).** A broker commission that differs from the deal's pinned policy % for
  that side is stored `pending` and opens a `price_out_of_range` gate (dedupe `<dealId>:broker_commission:<side>`;
  sales manager decides). Settlement lines use only the policy % or an override whose approval was approved; a pending or
  rejected one falls back to the policy %. A broker can't be set on a deal in a terminal state (409 `deal_closed`). A
  deposit can't be recorded during `AML_HOLD` (409 `too_late`): no money moves while compliance reviews.

## S41 — KYC configs: drafts and immutable versions per role and deal type

- **Decision.** `@spa/core` builds the SPA KYC model on the kernel's `defineKycForm` with SPA document kinds
  (passport, Emirates ID, visa, trade licence, title deed, Oqood, POA, board resolution, memorandum, proof of address,
  custom). Each party role has one draft and numbered published versions, per scope (`any` or a deal type); a
  published version never changes (trigger). In force: the deal type's latest published version, else the role's,
  else the starter config (version 0). Only an admin saves or publishes. Rules naming nationality, religion, race or
  similar traits are refused on save (a form may still ask for nationality); an AI check can only warn; an expired
  document's check is locked. The reader (C17) records the version it used. Settings screens are C34.

## S42 — AML policy versions, code risk level, EDD sign-off

- **Decision.** `spa_aml_policy` holds immutable versions (admin or compliance officer publishes; version 0 is the
  code default, placeholders to confirm with compliance). The policy switches warning-sign rules on or off, sets
  severity (`flag` → AML hold, `warning` → points only) and points; thresholds (name match, cash) stay in the rulebook
  (S36). `sanctions` always flags and can't be switched off; `not_screened` and `unconfirmed` hits always flag.
  `assessRisk` adds rule, party-type, payment-method and price-band points against the cut-offs by code. Each
  assessment is an immutable `risk_assessments` row with the policy and rulebook versions; its hits and points are
  compliance-only, and the deal timeline only says a review was recorded. High risk always opens `edd_signoff`
  (titled "Compliance review"), flag or not. Cancelling from `AML_HOLD` stays with the sales manager (S35) until
  compliance confirms otherwise.

## S43 — The contract-structure reader lives in `platform/readers`

- **Decision.** The agreement reader (PDF text, look, sections, blanks, placeholders, filled-sample values, model
  labels and mappings, the helper itself) moved from `@leasing/helpers` to `@platform/readers` and imports no module.
  Everything module-specific comes in through `TemplateProfile`: parties and their words, the data sheet
  (`validateMapping` checks against `profile.sheet`), `labelWords` (words that make a line a label), prompt wording,
  `detectFilled` (how a filled sample's values become blanks; default: the generic value-pattern sweep) and
  `afterMapping` (leasing numbers cheque-date runs there). Leasing keeps its rules (label table, filled-sample
  label→field table, cheque runs, data sheet, render, remap) and passes `leasingTemplateProfile`; `@leasing/helpers`
  re-exports the old names with leasing defaults. UAE authority marks stay a fixed check in `look.ts`.
- **Why.** S34: SPA reuses the reader by passing a profile, not by copying it. The filled-sample label table is
  two-party leasing logic, so it became a hook rather than a shared table; SPA writes its own in C12.
- **Proof.** Leasing golden test byte-identical, full suite green, `eval -- contract-structure` 27/27.

## S44 — The SPA template profile

- **Decision.** `spaTemplateProfile` (`@spa/helpers`) is the shared reader's SPA profile (helper `spa_template`).
  Parties: `seller` (seller, vendor, developer, transferor), `purchaser` (purchaser, buyer, transferee), `broker`
  (broker, brokerage, agent, agency); "owner" names no party. Keys are `spaDataSheet`'s; `bps` and `table` keys read
  as text (C14 prints them by their own type). `instalment_<n>_amount|due` (n 1–60) are keys, the literal `_n_` is not.
  A party key under a numbered block ("PURCHASER 2", "Second Purchaser") becomes its slot key (`purchaser_name_2`,
  slots 1–10; above 10 left empty); an unnumbered block keeps the plain key and prints per party. `partyBlocks` and
  `signatureRoles` (code) report the parties, slots and who signs each signature line, for C13 to store.
- **Platform additions (no leasing change).** `TemplateProfile.keyFitsParty`: code refuses any key of another party,
  the model's answers included (leasing passes none). `inferBlankType` reads a numbered instalment's amount or due
  date as money or date, not a count. Leasing golden test, suite and `eval -- contract-structure` 27/27 unchanged.
  The fictional sample-PDF generator moved to `@platform/readers/testing/sample-pdf` for both modules' tests.
- **Why.** S5, S34, S43: code maps first, the model only picks from key descriptions, and values from a filled sample
  never reach it (tested with three fictional templates).

## S45 — Template checks, versions and `template_approval`

- **Decision.** `spa_templates` (name + `document_kind` unique; `project_codes`, empty = every project, FK when P4b adds
  projects) and `spa_template_versions` (what the `spa-template` helper read, the checks, the rulebook version, status).
  The Manager stores the helper's validated result as the next version (`addTemplateVersion`, admin), runs the checks
  by code and opens `template_approval` (legal) with the blockers as reasons. Checks: `sample_value` (any value pattern
  or grouped amount left in the fixed wording; the message never repeats the value), `authority_marks`
  (header/footer/logo, rule 9), `fee_rate` (a % within 40 characters of registration/transfer fee or DLD must equal the
  rulebook's `registrationFeeBps`; pending → blocker, S36), `missing_core_key` (seller and purchaser name, unit number,
  price; listing agreements: no purchaser) — blockers; `no_payment_plan` (SPA: resale use only) and `unmapped_blank` —
  warnings. Approving with a blocker → 422 `template_checks_failed`, nothing changes; approving retires the previous
  approved version in the same transaction (one approved per template, unique index); `edit` is refused (the admin
  remaps blanks instead, `remapBlank`, which checks type and party like the model's answers and re-runs the checks).
  A trigger keeps the read template fixed, allows only `in_review → approved|rejected` and `approved → retired`, and
  refuses deletes. `currentTemplate(kind, project)` picks the project's approved version, else the general one.
  Approval re-runs the checks against the rulebook in force that day, and the trigger lets a version become `approved`
  only when its `template_approval` row is already `approved`. Rows keep the sample's verbatim wording (versions are
  never deleted), so companies should upload blank or fictional samples; scrubbing names from filled samples is a C34
  upload-time step.
- **Deferred.** Upload, running the helper (storage and model in the SPA engine) and the review screens: C34.

## S46 — Rendering a template: the generic part moved to `platform/`, fixed slots, plan order

- **Decision.** The generic part of leasing's template render moved to `@platform/readers/render/blocks`: block types
  (now with `table`, and `role`/`slot` on `sigline`), `RenderProfile` (`coreKeys`, `neutralWhenAbsent`, `formatValue`,
  with the reader profile), `nextSectionNumber`, `effectiveStyle`, `fillPlaceholderText`, `emptyLine`, `liveBlankIds`,
  `mappingProblem` (checks against `profile.sheet`), `unprintable` and `TemplateRenderError`. Leasing keeps
  `templateContractBlocks` (addendum, schedule, fees, required terms) and re-exports the old names; its output is
  byte-identical (golden test: blocks, extracted PDF text and PDF bytes, recorded before the move). `@platform/adapters`
  gained `renderStyledPdfWithAnchors` (one `{role, slot, page, xPt, yPt, widthPt}` per signature line), `table` blocks
  (head repeats on each page) and a `now` option for the PDF dates (default epoch, so leasing is unchanged); the C19 hash
  is stable because the caller passes its Clock. `renderStyledPdf` keeps its signature.
- **SPA render** (`renderSpaAgreement`, `@spa/helpers`). Pure code. Numbered blocks ("Purchaser 2") are fixed slots:
  more parties than the highest slot is `needs_human` ("3 purchasers, template has 2 slots."), never a dropped party or an
  invented slot. A slot the deal doesn't use is left out (its paragraphs, and a label that names only that slot). An
  unnumbered party block, or a signature line, repeats once per party, with the label that leads it (its own paragraph
  or the tail of the one before it); a paragraph that mixes values of two parties that appear more than once fails
  rather than guess. Signature lines print their label without the trailing colon; anchors carry `purchaser`/`seller`
  and the slot (1-based; the repeat index when unnumbered), broker has none. A core key with no value, a null-role
  signature line, an authority mark in the stored look (rule 9), an unprintable value or a bad mapping returns
  `{ok:false, status:"needs_human", problems}` and no PDF. Values are formatted by code (`formatMoneyFils`,
  `formatCalendarDate`, shares as %, the price in words by `moneyInWords`). The logo bytes come from the caller.
- **Company party.** `spaDataSheet` gained `purchaser_licence_no`, `purchaser_signatory_name`,
  `purchaser_signatory_title` (buyer group, not core), with label rules; a company prints name, licence and signatory
  like a company seller.
- **Plan and settlement tables.** `payment_plan` and `settlement_table` print as tables in the template's font and
  accent. Plan rows sort by (due date, instalment number) with milestone rows (no date) after the dated ones, so the booking
  is row 1; the printed "No." and `instalment_<n>_*` keys use that position. This closes the deferred C1-C6 minor. The
  settlement table keeps statement order.
- **Why.** S5, S34, S44: the output keeps the company's own structure, and nothing a model said reaches a legal value.
- **Proof.** Leasing golden unchanged; round trip on the three fictional templates (render, then re-read with the same
  reader: numbering, headings, fixed wording, tables, header, footer, look). Known limit: a one-page sample reads back
  large top and bottom margins, which can push a footer out of the reader's band when re-read.

## S47 — NOC and bank letters entered by a person; what counts

- **Decision.** A person uploads the developer NOC and bank letters and types their fields (`documents`, `noc_records`,
  `bank_letters`); reading them is C20 and will fill the same records (`source = reader`, `*_read_fils`). The Manager
  (`recordNoc`, `recordBankLetter`, `confirmBankAmount`, `setTargetTransferDate`, `setDealUnit`, `uploadDocument`)
  runs the checks by code (`nocChecks`, `@spa/core`): `unit_mismatch`, `seller_names_mismatch` (names normalised like
  S14 and matched one to one; an empty list or a name without letters never matches), `expired_before_transfer`,
  `no_target_date`, `service_charges_not_cleared`, and for an off-plan resale `paid_unconfirmed` and
  `below_minimum_paid` (the project's `minPaidBps` of the price, cross-multiplied in integers). Any blocker opens
  `noc_review` (sales admin; proposer `system:noc-check`; admin decides nothing, S3).
- **`nocOk` and `bankLettersConfirmed` are real, fail-closed, and computed now.** `nocOk`: the current NOC, valid
  today (`expires_on` ≥ today, never passes once expired, even after an approval), whose checks pass when run at that
  moment, or whose every blocker an approved `noc_review` covered for that record (the proposal lists the codes, so a
  later change of target date or unit that adds a blocker needs a new review). `bankLettersConfirmed`: a seller
  mortgage needs a current liability letter with a confirmed amount whose `valid_until` is on or after the target date
  and today; a buyer mortgage a current pre-approval and final offer with confirmed amounts. A valuation and a release
  letter (entered after transfer) don't gate `FINANCE_OK`. An amount counts only with `confirmed_by` and
  `confirmed_at` (a CHECK); the read or typed value sits beside it, and the confirming event records both and whether
  they differ.
- **Rulings.** (1) The NOC's `expires_on` must be on or after the deal's target transfer date; the daily job
  `spa.noc.expiry` writes `NOC_EXPIRY_WARNING` 7 days before expiry (and `NOC_EXPIRED` once after), each once per NOC
  (event key `<dealId>:noc_expiry:<expires_on>`), and re-checks open NOCs. (2) The policy's `nocRules[].validityDays`
  stays unused: the NOC's own expiry date decides, and the policy supplies only `minPaidBps` per project. (3) A sales
  admin, sales manager or admin sets the target transfer date (`target_transfer_on`, today or later). Entering NOC
  and bank-letter records and confirming amounts: sales officer, manager, sales admin and admin.
- **Moving on.** When the facts allow, the Manager calls `advance` as `system:noc-check` (`NOC_OK`, then `FINANCE_OK`),
  after each record, each confirmation, a target-date or unit change, a `noc_review` decision and each daily check.
  A record is entered while the deal waits in `NOC` (a NOC) or in `NOC`/`FINANCE` (a letter; a release letter after
  `COMPLETED`). A newer NOC or letter supersedes the old one; the records change only by being superseded (triggers),
  and `documents` never change.
- **Added by this chunk.** `deals.target_transfer_on`, and `deals.unit_no` and `project_code`: neither a resale's
  listing nor its deal named a unit, so the NOC could not be matched; a person sets them (`setDealUnit`) until the
  project and unit records of P4b exist. Uploads: PDF or image by its first bytes, at most 10 MB, stored by
  `LocalDiskStore` under `data/spa-uploads`; the event carries the hash and kind, not the file name.
- **Known gap.** `nocOk` is read only at `NOC_OK_*`; a NOC that expires while the deal is in `SETTLEMENT` or `TRANSFER`
  gets the warning events but no guard (C16/C17 may add one).

- **Amendment (C14-C20 review).** (1) A NOC a reader wrote (`source = reader`) never passes `nocOk`, even with an approved
  `noc_review`, until a person confirms it: `confirmNoc(recordId, user)` (sales officer, manager, sales admin, admin;
  `POST /api/noc-records/:id/confirm`) writes a new record with the person as the enterer and `source = manual` (the reader's is
  superseded; its paid amount stays beside it as read and counts only if the person types `paidFils`), runs the checks again and
  records `NOC_CONFIRMED`. Same shape as `confirmBankAmount`, so no schema change. (2) `confirmBankAmount` now also takes the
  confirmed end date: a liability letter, pre-approval and final offer need it (422 `valid_until_required`), the new row stores
  the person's date, and the event records it beside the read one (`validUntilRead`, `validUntilDiffers`). Only a confirmed row
  counts, so `bankLettersConfirmed` uses only person-confirmed dates. (3) The buyer's pre-approval and final offer must also be
  valid on or after the target date and today, as the seller's liability letter is. (4) Migration 0035: TRUNCATE is refused on
  `noc_records` and `bank_letters` (the update and delete guards already existed).

## S48 — Settlement statement, `settlement_approval`, and the NOC guard after `NOC_OK`

- **Decision.** On a resale in `SETTLEMENT`, code builds the transfer-day statement from `settlementStatement` (C2) and
  stores it as `settlements` + `settlement_lines` (version N+1 per deal). Inputs, all by code and only confirmed amounts:
  the deal's price; the deposit while its cheque is held; the seller's payoff from the current `liability_letter` and the
  buyer's loan from the current `final_offer`, each only with `confirmed_by`/`confirmed_at`; commissions as
  `bpsOfFloor(commissionBps, price)` from `deal_brokers` (the policy % or an approved override, S40), the payer from the
  row, the broker as payee. A missing letter, an unconfirmed amount or a pending rulebook value (S36) returns its
  reasons and stores nothing; `GET` shows the reasons so a person sees what to fix. Each line keeps its `source` and a
  `source_ref` (letter, deposit, broker, rulebook or deal). `bpsOfFloor` is now BigInt (it refuses non-integers and
  negatives); a test shows the old float product was off by a fil at about 10^12 fils.
- **Gate and staleness.** `proposeApproval('settlement_approval')` (dedupe key `<settlementId>:settlement_approval`,
  proposed by `system:settlement`, finance decides, never the proposer, admin none). `input_hash` is the sha256 of the
  canonical inputs, the rulebook and policy versions and the letter row ids (re-confirming a letter writes a new row, so
  it changes the hash even for the same amount). Anything that changes an input (`confirmBankAmount`, `setBroker`, a
  decided broker-commission approval, entering `SETTLEMENT`, every NOC re-check and the daily sweep) runs
  `refreshSettlement`: a live statement whose hash changed becomes `stale` (an approval of it no longer counts: the fact needs
  an approved *live* statement; a pending approval is cancelled) and a new version is proposed. Approving checks the hash and the
  balance again: 422 `settlement_stale` or `settlement_unbalanced`, nothing written; `edit` is refused (422
  `edit_not_allowed`). A rejection retires the statement (`superseded`); a person asks for the next one
  (`POST /api/deals/:id/settlement/refresh`: sales officer, sales manager, sales admin, finance or admin). After the transfer step
  the inputs are fixed: a liability or final-offer amount and a broker are refused with 409 `statement_fixed`.
- **`statementBalanced` is real and fail-closed.** True only when the live statement is `approved`, its inputs hash the
  same today and its price lines add up to the deal's price. No statement, a stale one, one waiting for finance, or a
  primary deal is false. An approval moves the deal on in the same transaction (`advance(SETTLED)` as
  `system:settlement` consumes it); if a guard refuses (the NOC, below), the approval stands and the next
  check (a new NOC, the daily `spa.noc.expiry` sweep) retries once.
- **NOC guard after `NOC_OK` (closes the S47 known gap).** `nocOk` is now in the guard of `SETTLED` and of both
  `TRANSFERRED_COMPLETE` and `TRANSFERRED_PLAN` (`@spa/core` deal machine): a NOC that expires (or stops matching) while
  the deal is in `SETTLEMENT` or `TRANSFER` blocks the step with "The NOC isn't valid today." To avoid a dead end, a
  replacement NOC may now be entered in `SETTLEMENT` and `TRANSFER` too (it supersedes the old one; a blocker opens
  `noc_review` there as in `NOC`). Tested per branch (core and engine).
- **Database.** Migration 0024 (tables) and 0025 (guards): statement content is fixed by trigger, only status moves
  (`proposed → approved|stale|superseded`, `approved → stale|superseded`), the approval is linked once, nothing is
  deleted or truncated; lines are insert-only and only while their statement is `proposed`; a deferred constraint
  trigger refuses a `proposed` or `approved` statement whose `price:*` lines don't add up exactly to its price or whose
  price differs from the deal's. One `proposed` or `approved` statement per deal (partial unique index).
- **Cancellation.** The deposit cheque is S40's (`deposit_release`) and `refund` is untouched. A cancelled deal's live
  statement becomes `superseded` and its pending approval `cancelled`, with an event.
- **Read.** `GET /api/deals/:id/settlement`: sales officer, sales manager, sales admin, legal and finance (not admin,
  compliance or MLRO) get the lines with sources, status, version history and reasons.
- **Deferred.** The statement screen (deal record, P8/C34); the transfer itself and `transferIssued` (C17). The
  real 2026-01 rulebook still has pending trustee, Oqood-transfer and mortgage fees (S36), so on real data the
  statement refuses until legal confirms them in a new rulebook version.

- **Amendment (C14-C20 review).** (1) `SETTLED` also needs `bankLettersConfirmed` when a mortgage exists, so a letter that expired
  while the statement waited holds the step; re-confirming the letter with a later date (allowed in `SETTLEMENT`) makes a new
  statement. (2) Migration 0035: a statement becomes `approved` only if its linked approval is an `approved`
  `settlement_approval` of the same deal (the database checks it, not only the Manager). (3) A broker commission override is used
  only when the linked approval is an approved `price_out_of_range` of this deal whose proposal names this side and exactly this
  %; otherwise the policy % applies. `deal_brokers` rows are never deleted, the approval link is write-once, and once linked the
  % and side are fixed (trigger); `commission_status` was a copy of what the approval row says and is dropped (migration 0034).
  (4) Guard reasons about an open compliance case now read "A compliance review is open." on every forward step (see S50).

## S49 — The KYC reader lives in `platform/readers/kyc`; `spa-kyc` and the real KYC facts

- **Decision.** The KYC document reader (the vision-model helper, `assessKyc`, `applyKycRules`, `kycAiChecks`, the prompt,
  the schemas) moved from `@leasing/helpers` to `platform/readers/src/kyc/` with `git mv`, the same way as the agreement
  reader (S43). The pure helpers it needs moved too: `parseTd3`/`makeTd3`, `isValidEmiratesId`/`normaliseEmiratesId` and
  `compareNames`/`normaliseName` to `platform/kernel`; the document-form and rule model (`READ_DOC_KINDS`, `DOC_CHECKS`,
  `KycBaseRules`, `KycRules`, `KycCompanyRule`, `effectiveDocRules`, `effectiveCross`, `fieldRules`, `defaultDocRules`)
  to `platform/readers/src/kyc/config.ts`. `@leasing/core` and `@leasing/helpers` re-export every old name; leasing's starter
  form, defaults and applicant wording stay in leasing. The platform helper takes a `KycProfile` as a required argument;
  leasing's wrappers (`kycHelper`, `readPrompt`, `kycAiChecks`) pass `leasingKycProfile`. `KycProfile` gained `aiCheckSubject`
  (who set the plain-English rules), `extraReads` (a Zod schema per read key beyond the built-in ones, uploaded as kind
  `extra` with the key in `fieldKey`) and `personDocs` (`resident_set` default, or `any_id`: a passport alone is complete).
- **SPA profile and context.** `spaKycProfile` (`@spa/helpers/src/kyc`) reads `passport`, `emirates_id_front|back`, `visa` and
  `proof_of_address` (its own schema: document type, holder name, address, issue date). `spaKycContext` turns a role's
  published `SpaKycConfig` into the reader's rules: its confidence, its three cross checks with their severities, its
  company rules and each form field's own rules. Validity counts from today (a deal has no lease start). Company documents,
  title deeds, powers of attorney and the licence number as an answer wait for C20. Code decides: an expired document never
  passes, a model `ai_check` can only warn, no rule may look at nationality or other protected traits (S19).
- **Runs.** New tables (migrations 0026, 0027): `helper_runs` (append-only), `kyc_runs` (immutable), `document_requests`
  (one per deal and party); `documents.kind` accepts the SPA read kinds. `runKyc` records the config scope and version, the
  rules version, the AML policy version and the model and prompt versions on every run. A flag raised only as a warning
  makes the run `review` and opens one `kyc_review` (dedupe key `<runId>:kyc_review`); a blocking flag makes it `blocked`
  (reasons only: emailing a fresh link is the chaser's job, C25, and sending links is C28/C35); a model that fails twice
  gives `needs_human`. The model answer is validated with Zod and retried once inside the reader. The same documents under the
  same config version are never read twice; the job key is `<partyId>:kyc:<docsHash>` (`spa.kyc.run`, exclusive queue).
  Without a vision model in `.env.spa.local` the worker doesn't start the handler and jobs wait.
- **Facts.** `documentsRequested`: the deal has buyers or sellers and each has a `document_requests` row (brokers are not
  asked for documents; a company brings its beneficial owners). `kycOk`: every buyer, seller and beneficial owner who is a
  person has a latest run that `passed` or is a `review` with an approved `kyc_review` for that run id; `valid_until` (the
  earliest document expiry) is today or later by the Clock, so a passport that expired since never passes, approved or not;
  the documents on file hash the same as the run's (a later upload must be read first); blocked and `needs_human` runs never
  count. A deal with no such party is false, never vacuously true. Company parties are not part of `kycOk` (C20 adds
  `companyChecksOk`).
- **`factsComplete` guard (deferred from P3).** `DEAL_FACT_KEYS` (core) lists every `DealFacts` key and the compiler refuses a
  missing one; `failClosedFacts.deal` returns `Required<DealFacts>` and a test checks its keys equal the list. A loader that
  throws refuses the step and rolls back (tested); nothing defaults to true.
- **Eval.** `bun run eval -- spa:kyc` runs 40 fictional specimens (10 invented people × valid and expired passport and
  Emirates ID front, generated by `make-kyc-specimens.ts`) and fails below 95% exact fields or if any expired document passes.
  The runner and fixtures are built and checked with a labelled "perfect reader" in a unit test; the run on the real model
  is not part of this chunk.
- **Why.** S34 and S4: SPA reuses the reader by passing a profile, not by copying it, and leasing's output must not change.
  S19 and S41: the role's published config decides, and every check result records its version.
- **Proof.** A new golden (`kyc-reader.golden.json`: `assessKyc`, `applyKycRules` with and without rules, `kycAiChecks`
  prompts and the read prompts on the 36 specimen cases in five variants) was recorded before the move and is identical
  after it, next to the earlier profile golden. `eval -- kyc` was not run: the golden is the proof (the user's ruling).
- **Known gaps.** No screen yet (deal record, C34). Nothing advances a deal on `kycOk` by itself: a person or a later job
  sends `CHECKS_PASSED`. `kyc_review` approvals are decided through the normal `spa_approvals` route.

- **Amendment (C14-C20 review).** `kycOk` counts a run only if its `config_version` and scope equal the config in force now
  (`effectiveKycConfig` for that role and deal type). Publishing a new version therefore makes `kycOk` false until the party is read
  again under it (same documents, new config: a new run, never read twice under the same version).

- **Amendment (follow-ups: OLLAMA_URL, source of funds, instruction-like text).**
  (1) *Model host.* The SPA engine accepts `OLLAMA_URL` only if its host is loopback (`localhost`, `127.0.0.0/8`, `::1`), a private
  network (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`) or a name that can't be public: a single label (`gpu-box`), `.local`,
  `.lan`, or the project's own `ollama.systemone`. Otherwise it logs a warning and does not start the model-backed handlers
  (document read, company check, ownership check, KYC; AML wording falls back to the code template). The check is a pure
  function (`apps/engine/src/ollama-url.ts`, no DNS lookup). Leasing is untouched. (2) *Source of funds.* The buyer's starter KYC
  form has a required `source_of_funds` select whose choices are the AML policy's `FUND_SOURCES` (S42). `runKyc` and the run
  route take optional form `answers`, keep only valid ones (a key on the form, a choice for a select, trimmed), store them in
  `kyc_runs.answers` (no longer always `{}`) and pass them to the reader. A run sent no answers keeps the latest run's; new
  answers on the same documents are a new run and a new job key (`<partyId>:kyc:<docsHash>:a<hash>`). Only a buyer is asked: a
  company is answered for by its owners and its KYC runs are not person runs. (3) *Instruction-like text.* If any string the
  model returns for a KYC document reads like an instruction (`documentInstructionLike`, S52), `spaKycHelper` makes the run
  `review`: one non-blocking `manual_review` flag (`check: read.instruction_found`) per document, which opens the usual
  `kyc_review`. The identity and every other flag are unchanged, and a blocking flag stays blocking.

- **Amendment (C21-C30 review).** `OLLAMA_URL` may name a private-network host (the user approved LAN hosts). `assertLocalModel`, `assertLocalVision` and `OllamaLlm` take an optional `allowHost(host)` predicate; the default stays loopback-only, so leasing is unchanged (tested in `platform/llm/test/vision.test.ts`). The SPA engine passes a predicate built from `checkOllamaUrl`, and a refused assistant model is logged as a warning at boot instead of crashing it.

## S50 — AML screening in code, compliance-only cases (C18)

- **Status.** Decided and built in C18 (needs approval: DB schema, given). Builds on S6, S20, S35, S36, S42 and S49.
- **What.** `screenDeal` screens every buyer, seller, company, beneficial owner and non-party payer (whoever holds the deposit
  cheque when that is not a buyer) against lists behind a `ScreeningAdapter`. `FakeScreening` is the only adapter: its lists
  are invented, labelled "FICTIONAL, SIMULATED", and C27 wraps a real provider behind the same interface. Name similarity is a
  pure function (normalise, sort tokens, edit distance). The match threshold comes from the rulebook; a pending threshold makes
  the hit `unconfirmed` (S36). A party the service could not screen has null scores and gets `not_screened`. `amlRules` (C2)
  and `assessRisk` (C10) run by code; `sanctions`, `not_screened` and `unconfirmed` always flag; a rule the policy switched off
  leaves no hit (sanctions can't be switched off). A source of funds comes from the person's latest KYC answer
  `source_of_funds` (`kyc_runs.answers`, S49); a company is answered for by its owners; cash is zero until payments exist.
- **A flag does three things:** one `aml_cases` row, one pending `aml_flag` approval titled "Compliance review", and
  `AML_HOLD`. Running it twice leaves one case and one pending approval. A repeat screening that records the same hits under
  the same policy writes no new risk assessment, so a decided `edd_signoff` is not opened again.
- **Ruling: the hold from later states.** `AML_FLAGGED` is also allowed from `AGREEMENT_DRAFT` and `LEGAL_REVIEW`, with the same
  guard as from `PARTY_CHECK` (the re-screen before the agreement). `AML_CLEARED` still returns to `PARTY_CHECK`. In other
  states (for example `OFFER_AGREED`) a flag opens the case and approval but no transition exists; `openAmlFlag` stops
  `CHECKS_PASSED`. Later re-screening points are C22 and C27; today a screening starts by `POST /api/deals/:id/aml/screen`
  (queues `spa.aml.screen`, key `<dealId>:aml:<trigger>:<day>`, answers `{queued}` only) or by the job.
- **Facts become real.** `amlFlaggedByRule`: a current party's latest screening has a flagging hit that no cleared hit
  covers (hits match by `party:rule:listVersion`). `openAmlFlag`: a current party has no screening, or a case is `open` or
  `info_requested`, or an `aml_flag`, `aml_report` or `edd_signoff` is pending. So an unscreened party blocks
  `CHECKS_PASSED`: a deal can't pass by silence. Existing walk-through tests switch `openAmlFlag` off by hand, as they do other facts.
- **Outcomes** (decided in `decideApproval` by a compliance officer, never admin, never the proposer): `clear` closes the case
  and the deal moves with `AML_CLEARED`; `more_info` sets `info_requested` and the deal stays on hold: no email goes to the
  party, compliance records the request (this is the `more_info` flow deferred from P3); a new screening then reopens the
  case with a new approval and a new dedupe key (even when it finds nothing new, otherwise the hold could never be decided);
  `stop` closes it and moves with `AML_STOPPED`; `stop_and_report` also opens `aml_report` for the MLRO.
- **The model writes wording only.** It is called after code flagged, with rule codes, scores and "Party A/B" labels; names
  are fenced as untrusted with our delimiters stripped. Output is validated with Zod (summary up to 800 characters, suggested
  documents filtered to the policy's EDD list), retried once, then the code template. A summary that says clear, false
  positive, no concern and the like while a hit exists is replaced by the template. A name that reads like an instruction sets
  `instruction_like` on the case for compliance and changes nothing else. The model is never asked about a deal code did not
  flag, and nothing it says raises, scores, clears or lowers a flag.
- **No tipping-off.** The `AML_*` moves are written as `COMPLIANCE_REVIEW_RECORDED` with `machineEvent: "compliance_review"`;
  payloads carry no rule, score or outcome. The model's wording is a `helper_runs` row with `visibility = 'compliance'`
  (never `staff`). `screenings`, `aml_cases` and `aml_hits` are read only by `GET /api/deals/:id/aml` for `compliance_officer`
  and `mlro`; anyone else, admin included, gets 403 and no data.
- **Schema (migrations 0028, 0029).** `screenings` (append-only), `aml_cases` (only status, approval and closing time change;
  closed stays closed; never deleted), `aml_hits` (append-only). Two additions to the plan, both needed for a non-party payer
  and for matching cleared hits: `screenings.party_id` and `aml_hits.party_id` are nullable beside a `subject_key`, and
  `aml_hits.list_version` is stored. Scores are nullable (null means not screened).
- **Eval.** `bun run eval -- spa:aml` runs 30 invented cases (6 exact and 2 near sanctions names, 4 PEP, 5 clean including
  look-alikes, missing source of funds, payer, high-risk country, ownership layers, and 7 injection names). It fails if code
  reaches a wrong verdict, any final summary contradicts a hit, an injection case isn't flagged, or `instruction_like` is
  wrong. Built and checked with FakeLlm only; the real-model run is the user's.
- **Known gaps.** No screen yet (compliance page and deal record, C34). Re-screening triggers other than the manual route and
  the job (offer, before agreement, party change, every N days) come in C22 and C27. The fake lists are not a real list.
  Sending the party anything about `more_info` is the chaser's job (C25) and must stay neutral.

- **Amendment (C14-C20 review).** (1) **Every forward step after the agreement is held by an open flag**: `APPROVED`,
  `ALL_SIGNED_*`, `REGISTERED`, `NOC_OK_*`, `FINANCE_OK`, `SETTLED`, `TRANSFERRED_*` and `HANDOVER` now have the guard
  `!openAmlFlag`, with the neutral reason "A compliance review is open." (the `CHECKS_PASSED` reason is neutral too: guard reasons
  reach staff who can't see compliance matters). Tested per branch in `@spa/core`. (2) `openAmlFlag` stays true for a party whose
  latest risk assessment is `high` until an **approved** `edd_signoff` names that party and that assessment; a rejected one keeps
  blocking, and a newer high assessment needs a new sign-off. (3) The engine registers `FakeScreening` only in demo mode
  (`SPA_DEMO_MODE`); otherwise no screening handler is registered, a warning is logged and facts fail closed as not screened.
  (4) **Freshness**: `openAmlFlag` is true when a current subject's latest screening is older than the policy's `rescreen.everyDays`
  (Dubai calendar days; a screening exactly that old still counts) or was made under a list version other than the registered
  adapter's (`SpaContext.amlListVersion`; `screenings.list_version` was already stored). **Default:** when the policy has
  `everyDays = null` the period is 90 days (`DEFAULT_RESCREEN_DAYS`); a policy can shorten or lengthen it but can't switch freshness
  off. Entering `AGREEMENT_DRAFT` queues a `before_agreement` screening and entering `TRANSFER` a `before_transfer` one, through
  the existing `spa.aml.screen` job with the usual `<dealId>:aml:<trigger>:<day>` key (hook `SpaContext.onDealEntered`; a queue that
  is down is logged and never undoes the step: the freshness rule still holds the deal). (5) The `APPROVAL_DECIDED` event of a
  compliance gate no longer carries `status` (approved meant clear, rejected meant everything else). (6) A subject whose name
  normalises to nothing is never sent to the lists: it is "not screened", which flags. (7) `decideApproval` locks the deal row
  before the approval row, the order `advance` uses.

- **Amendment (follow-ups).** `missing_source_of_funds` fires only when the party's latest `kyc_runs.answers.source_of_funds` is
  absent: the buyer's KYC form now collects it and `runKyc` stores it (S49 amendment). Sellers and beneficial owners are still
  subjects of the rule but their starter forms have no such question, so it still fires for them until a company adds one in Settings.

## S51 — `spa-prepare`: the agreement, its data sheet and its payment plan (C19)

- **Status.** Decided and built in C19 (needs approval: DB schema, given). Builds on S5, S36, S44–S50.
- **Document kind per deal type (confirm with legal).** `primary_offplan` prints an `spa`, `resale_ready` an `mou`,
  `resale_offplan` an `assignment`. The template is `currentTemplate(kind, projectCode)` (a project's own approved
  version, else the general one); with none, preparation stops with "No approved template". A listing agreement reuses
  the render later. This mapping is the product's assumption, not law: legal must confirm which form each deal uses.
- **The data sheet** (`buildDealSheet`, `manager/sheet.ts`) reads only this deal's records: its buyers and sellers
  (person fields; a company's licence and signatory), its one broker, the unit (`deals.unit_no`, else a primary deal's unit
  code), the price (and its words by code), `registrationFee` from the rulebook pinned on the deal, the deposit from the
  pinned policy's `depositBps` (resale), the booking from the first plan row (primary), title deed or Oqood number from the
  listing, the target transfer date, and a loan amount only when a person confirmed it. Every value carries a source
  (`deal`, `party:<id>`, `unit:<id>`, `listing:<id>`, `letter:<id>`, `plan:<n>`, `policy:<v>`,
  `rulebook:<v>:<rule>`, `broker:<side>`, `code:price`). A pending rulebook value (S36) leaves the key out with its reason; it
  is never guessed. Two brokers on one deal fill no broker key: a template with a broker block then stops (it has one block;
  the deal has two). A broker's commission override prints only once a manager approved it (S40 amendment). Not filled,
  because the records don't exist yet: `building`, `project_name`, `floor`, addresses, `noc_ref`, banks, `agreement_date`
  (a template that prints a core one of these stops).
- **`values_hash`** is the sha256 of the deal's raw inputs (records as stored, plus the rulebook and policy versions, which
  never change for a deal), so a fact can compare it without the rulebook. Any change to a party, the price, the unit, the
  plan, a broker or a confirmed loan makes a prepared agreement stale.
- **Payment plan** (`payment_plan_rows`, migration 0030): sales (officer, manager, sales admin, admin) types shares through
  `setPaymentPlan`; the rulebook's `validatePlan` turns them into amounts that add up to the price to the fil (a primary
  deal's booking must meet the minimum; the remainder goes to the last row). Rows carry a due date or a milestone (an addition
  to the plan: a milestone row has no date, C14 prints it after the dated ones). A primary deal requires `payment_plan`; a
  resale doesn't. The rows are fixed while a live agreement exists (the Manager says 409 `plan_fixed`; a trigger enforces it); a
  rejection supersedes the agreement and frees them.
- **Prepare checks** (any one stops preparation, nothing is stored): the C14 problems (an empty core key, a party that
  doesn't fit the template's slots, an authority mark); an email, Emirates ID, passport number or AED amount in the printed
  text that isn't one of this deal's values; the C13 `fee_rate` check re-run against the deal's pinned rulebook (a template
  approved under rulebook A is stopped, not trusted, on a deal pinned to B; a pending fee rate stops too). A stop writes a
  `helper_runs` row (`spa_prepare`, `needs_human`, visibility `staff`, reasons without values) and a `PREPARE_STOPPED` event
  with codes and data-sheet keys, never values; the same stop twice writes once. There is no tasks table yet: C30 lists
  these stops.
- **Prepare** (`prepareAgreement`) takes the deal lock, renders by `renderSpaAgreement` with the Clock's `now` (the same
  sheet and `now` give the same bytes), hashes the PDF, stores it with `LocalDiskStore` (`data/spa-uploads`), inserts
  `agreements` version N+1 (an older live one is superseded), calls `advance(PREPARED)` as `system:prepare` and proposes
  `agreement_approval` (`{agreementId, docHash}`, dedupe key `<agreementId>:agreement_approval`). No model is called.
  Running it again with unchanged values returns the same agreement (`created: false`). Job `spa.prepare`, singletonKey
  `<dealId>:prepare:<valuesHash>`, started by `POST /api/deals/:id/prepare` (sales officer, manager, sales admin, admin; 202
  `{queued}`, 409 outside `AGREEMENT_DRAFT`); `PUT /api/deals/:id/payment-plan` sets the plan. Review mode (`helper_review`)
  comes in C24: for now preparation moves on its own.
- **`agreementPrepared` is real and fail-closed:** a live agreement whose `values_hash` equals the hash of the deal's inputs
  now. After a change it is false again.
- **Legal's decision.** Approving checks the agreement is still `in_review`, the deal still in `LEGAL_REVIEW` and the hash
  unchanged: else 422 `agreement_stale`, nothing written. `edit` is refused (422 `edit_not_allowed`). **Ruling:** an
  approval moves the deal to `SIGNING` in the same transaction (the step consumes the approval) and marks the agreement
  `approved`, as S48 does for the statement; a rejection supersedes the agreement and moves the deal back to
  `AGREEMENT_DRAFT` (`RETURNED`), where preparing again makes version N+1. A deal that left `LEGAL_REVIEW` meanwhile (an AML
  hold) keeps its state and only the agreement closes.
- **Database.** Migration 0030 (`agreements`, `payment_plan_rows`) and 0031 (guards): an agreement's content is fixed, its
  status only moves forward (`prepared → in_review → approved → superseded`), the approval is linked once, never deleted or
  truncated; one live agreement per deal and kind; plan rows are fixed while an agreement is live.
- **Known gaps.** No screen (the agreement card and field-source view, C34). Nothing starts preparation by itself on entering
  `AGREEMENT_DRAFT` (a person or a later job calls the route; the chaser, C25, may). A cancelled deal's pending
  `agreement_approval` was not cancelled (closed in C20, S52). `agreement-review` warnings (C21) and review mode (C24) are
  not built. The kind mapping above awaits legal.

- **Amendment (C14-C20 review).** (1) Preparing again when the deal is back in `AGREEMENT_DRAFT` (a compliance hold sent it back
  from `LEGAL_REVIEW`) and the live agreement's values hash is unchanged now advances `PREPARED` and keeps the existing agreement
  and its pending approval; nothing is rendered. Tested along LEGAL_REVIEW, AML_HOLD, AML_CLEARED, PARTY_CHECK, AGREEMENT_DRAFT.
  (2) Migration 0035: an agreement becomes `approved` only if its linked approval is an `approved` `agreement_approval` of the same
  deal. TRUNCATE is refused on `payment_plan_rows` (the other guards existed). (3) A broker's commission override is printed only
  under the same approval rule as the statement (S48): the sheet input holds whether the override is approved, so the hash still
  changes when it is.

## S52 — The readers: `document-reader`, `company-check` and `ownership-check` (C20)

- **Status.** Decided and built in C20 (needs approval: DB schema, given). Builds on S4, S13–S15, S47, S49–S51.
- **The model only copies text; code interprets it.** A vision model (`@platform/llm`, local, `FakeLlm` in tests) returns each
  field as `{value, confidence}` exactly as printed, validated with Zod (one retry, then `needs_human`: nothing advances on an
  unparsed answer). Code parses: `parseMoneyFils` (AED to whole fils, grouped digits, at most two decimals, above zero, no
  floats), `parseBps` (a percent sign or "percent" is required, at most two decimals, 0 < p ≤ 100), `parseDate` (the KYC date
  parser), `parseClearance` (outstanding beats cleared) and `parsePageOf`. A field that fails to parse is unreadable; so is one
  below `READ_MIN_CONFIDENCE` (0.8). The model never adds, sums or compares. The prompt (`spa-reader.v1`) says all of that and
  that everything on the page is data.
- **Untrusted text.** Every string in a read is scanned (`documentInstructionLike`: the AML name check from S50 plus wording
  documents carry). A hit sets `document_reads.instruction_found`, writes a `DOCUMENT_READ` event and a `helper_runs` reason, and
  an `instruction_found` finding (severity `info`) on a company check. It changes nothing else: a read with injection text gives
  the same NOC record, the same checks and the same verdicts as one without (tested).
- **`document-reader`** (job `spa.document.read`, singletonKey `<documentId>:read`; `POST /api/documents/:id/read`; every upload of
  a readable kind queues it, and a queue that is down never loses the upload). Profiles: `noc`, `liability_letter`,
  `release_letter`, `pre_approval`, `final_offer`, `trade_licence`, `moa`, `poa`, `board_resolution`, `title_deed`, `oqood`
  (plus `sof_evidence` and `edd`, defined and allowed in the table but with no document kind to upload yet: C22 adds
  `payment_receipt` and may add them). `ensureRead` stores one immutable `document_reads` row per document and prompt version
  and a `helper_runs` row; a model that fails twice stores only a `needs_human` run.
  - **A NOC read** writes a `noc_records` row with `source = reader`, `entered_by = system:document-reader` and only
    `paid_read_fils` (`paid_fils` and `paid_confirmed_by` stay null), through the same `storeNoc` as a person's entry (extracted
    from `recordNoc`), then `evaluateNoc` runs the C15 checks. Names, unit and dates count without a person; an off-plan resale's
    read amount stays unconfirmed, so it is `paid_unconfirmed` and goes to review. A different unit or seller name, or an expiry
    before the target date, opens `noc_review` as before. **Addition:** a NOC with an unreadable required field, or one already
    past its expiry, writes no record (the table needs the values) and opens one `noc_review` with `proposal.reason`
    `unreadable|expired` (once per document and reason); a later NOC, read or typed, cancels it. The read is kept when the deal is
    not yet in a NOC step; reading again once it is applies the stored read (the model is not asked twice).
  - **A bank-letter read** writes `bank_letters.amount_read_fils` only, never `amount_fils`, through `storeBankLetter` (extracted
    from `recordBankLetter`), with the same state and mortgage rules, and a confirmation task for the agent: a `helper_runs` row
    (`entityKind bank_letter`, `needs_human`, `result.task = confirm_amount`) until the task list exists (C30). An unreadable
    issue date stores no letter and a `needs_human` row. `bankLettersConfirmed` and the settlement still need `confirmBankAmount`,
    whose event records the confirmed and the read amount and whether they differ.
- **`company-check`** (job `spa.company.check`, singletonKey `<partyId>:company:<docsHash>`; `POST
  /api/deals/:id/parties/:partyId/company-check/run`; `GET /api/deals/:id/company-checks`). Company documents
  (`trade_licence`, `memorandum`, `poa`, `board_resolution`) are uploaded for the company party on any deal type. Code
  (`companyChecks` in `@spa/helpers`) checks: the licence is readable, not expired, valid at least 30 days from today and on the
  target transfer date, and in the company's name; a recorded signatory is named in the POA or resolution under that kind of
  authority, with a listed power over the sale, purchase or transfer of property (negated or low-confidence powers don't count) and
  not expired; and which shareholders hold at least the rulebook's `beneficialOwnerBps` (2500). Person owners at or above it
  become `beneficial_owner` parties through `addBeneficialOwner` (C4, now joinable to a transaction) as `system:company-check`,
  **only** when every percentage was read clearly, no page is missing and they add to at most 100%. A missing or unconfirmed page
  number (a memorandum must read "1 of 1"), an unread percentage, a corporate shareholder, shares adding to less or more than
  100% and an owner that would take the total over 100% each give `review` and count an ownership layer: `company_checks.layers`
  adds to the AML rule's `ownershipLayers` (S50), so a company with one unresolved layer is already at the `complex_ownership`
  threshold. It never concludes "no other owners" by default. `review` opens `seller_verification` (sales manager) for that run
  id; a failed read is `needs_human`. The same documents are never checked twice (`docs_hash`, an addition to the plan's
  columns, like `kyc_runs`).
- **Beneficial owners found by a reader** are person parties created with their name as read and a reserved
  `owner-<id>@pending.invalid` address (the table requires an email): staff add real details when they ask the person for
  documents; they are KYC subjects like any owner (S49) and unscreened until the next screening (`openAmlFlag` stays true).
- **`companyChecksOk` is real and fail-closed:** every company buyer or seller has a latest check that `passed`, or a `review`
  whose run id an approved `seller_verification` names, on the documents on file now (a later upload must be checked first), with
  the licence still valid today whatever was approved. A deal with no company party is false. **Ruling (deviation from the
  plan):** the guard of `CHECKS_PASSED` now reads `!hasCompanyParty || companyChecksOk` with a new real fact `hasCompanyParty`
  (in `DEAL_FACT_KEYS`). Without it a deal of only people could never leave `PARTY_CHECK`, because their `companyChecksOk` is false.
- **`ownership-check`** (job `spa.ownership.check`, singletonKey `<dealId>:ownership:<docsHash>`; `POST
  /api/deals/:id/ownership-check/run`). It reads the deal's title deed (ready resale) or Oqood (off-plan) and the trade licence of
  every company seller, and checks by code against the deal's sellers: the C5 matching (`matchOwners`, one to one, every owner a
  seller and every seller an owner; moved to `@spa/helpers` and re-exported from `listings.ts`, so `recordOwnership` and this check
  share one function), shares adding to exactly 10000 bps with every share read, the property number equal to `deals.unit_no` (a
  number the record lacks is `property_not_checked`, which is review), and a company owner equal to the name on its read licence
  (none read is `licence_not_read`, review). Anything else, and anything unread, is `review` and opens `seller_verification` for the
  deal; `matched` opens nothing. The result is a `helper_runs` row (`spa_ownership_check`) and an `OWNERSHIP_CHECKED` event; a
  model can't make it `matched`.
- **Cancellation (the C19 gap).** A cancelled deal's live agreement is superseded and its pending `agreement_approval` cancelled
  (`AGREEMENT_SUPERSEDED`, `reason: deal cancelled`), as C16 does for the settlement statement. Tested.
- **Database.** Migration 0032 (`document_reads`, `company_checks`) and 0033 (immutability triggers, no truncate). `document_reads`
  has no confirmation column; an amount counts only as `amount_fils` with `confirmed_by` (C15 CHECK). Facts and the AML layer
  count read the latest check.
- **Eval.** `bun run eval -- spa:document-reader` (50 fictional NOCs and bank letters, 10 per profile: names and dates at least
  95%, amounts at least 98%, injections flagged), `spa:company-check` (30 companies: signer and owners at least 95%, no wrong pass)
  and `spa:ownership-check` (30 deeds: no wrong "matched"). Fixtures are invented and labelled (`fixtures.ts`), drawn by
  `make-reader-specimens.ts` as 170 PNGs marked SPECIMEN · FICTIONAL. Built and checked with FakeLlm only (an ideal reader passes,
  a lying or blank reader is caught); the real-model run is the user's.
- **Known gaps.** No screen (the document, company and ownership cards, C34). Nothing queues a company or ownership check by itself
  (a person or the chaser, C25, calls the route); an ownership result doesn't gate a step on its own (there is no deal fact for it;
  the listing's own `ownershipMatched` guard is C5's); `sof_evidence` and `edd` have no upload kind; review mode (`helper_review`)
  is C24; the 30-day licence minimum and the page-number rule are assumptions to confirm with legal.

- **Amendment (C14-C20 review).** (1) New real fact `ownershipOk` (in `DEAL_FACT_KEYS`): the latest ownership check of the document
  set on file now is `matched`, or an approved `seller_verification` names that `ownershipDocsHash`; a new upload makes it false
  until checked. `CHECKS_PASSED` needs it on a resale (the "no deal fact for it" gap above is closed). (2) The guard reads
  `hasCompanyParty === false || companyChecksOk`: an unknown `hasCompanyParty` blocks. (3) Ownership-structure signals stay out of
  staff surfaces: the `COMPANY_CHECK_RUN` event, the staff `helper_runs` row, the `seller_verification` proposal and
  `GET company-checks` carry no layer count, owners or the codes `corporate_shareholder`, `shares_under_100`, `shares_over_100`,
  `owner_not_added`, `no_shareholders` (a generic "needs a person's review" line stands in); `company_checks` keeps all of it
  for the AML rule and the compliance read. (4) Migration 0035 also refuses TRUNCATE on `deal_brokers`; the NOC confirmation and
  bank-letter dates are in S47.

- **Amendment (follow-ups).** (1) *Licence validity is policy.* `MIN_LICENCE_DAYS` is gone: the SPA policy has
  `companyLicenceMinDays` (default 30, 1-365, **confirm with legal**), read from the deal's pinned policy (`policyAt`), so a
  later policy never moves a deal already pinned; older stored policies parse with the default. (2) *Instruction-like text
  routes to review.* A read with `instruction_found` can no longer be `passed` or `matched`; the read values stay untouched.
  Company check: the `instruction_found` finding is `review`, so the check is `review` and opens `seller_verification`.
  Ownership check: a new `instruction_found` finding (deed or any company licence read) is `review`, opening
  `seller_verification`. NOC read: the stored record gets status `review` and `instruction_found` in `mismatches`, and one
  `noc_review` opens (`proposal.reason = instruction`, once per document; a later NOC cancels it); a reader's NOC never counted
  for `nocOk` before a person confirmed it, and still doesn't. Bank letter: the confirmation task (`confirm_amount`) carries
  `instructionFound` and a reason to check the letter itself. The same rule applies to `spa-kyc` (S49 amendment).


## S53 — Registry mocks: `oqood-mock`, `OqoodAdapter` and `TransferAdapter` (C27)

- **Status.** Decided and built in C27 (needs approval: DB schema, more than three packages, given). Builds on S8, S16, S35.2 and S50.
  No model is used anywhere in this chunk.
- **The shell is shared, the wording is not.** What both simulated registries need moved to `platform/adapters/src/registry-mock/`:
  `simulatedPage` (an escaped, plain grey console), `simulatedCertificate` (a watermark, no logo), `replayByRequestId`,
  `maybeUnavailable` and `replyWithAnswer`, with a `RegistryMockProfile` (`wording {title, subline, watermark, producer}`, system
  label) per module. Leasing's `ejari-mock` now uses it. **Before anything moved**, a golden test
  (`modules/leasing/apps/ejari-mock/test/golden.test.ts`, files in `test/golden/`) recorded the console page (empty, with rows and
  after real requests), both certificate PDFs (bytes, with the date pdf-lib stamps frozen) and the 201, 422, 400 and 503 bodies for
  `ejari` and `tawtheeq`. They are byte-identical after the move; `UPDATE_GOLDEN=1` rewrites them and must only be used on
  unchanged behaviour. No file moved as a whole (the shell was cut out of the leasing files), so there is no `git mv`.
- **`oqood-mock`** (`modules/spa/apps/oqood-mock`, :4101, `bun run spa:oqood-mock`, part of `dev:spa`) lives in the `oqood_mock`
  schema of the `spa` database with its own migrations folder, as `ejari_mock` does. Tables: `unit_records`, `title_deeds`
  (owners; a transfer retires a record and issues a new one), `person_records`, `registrations`, `trustee_bookings`,
  `submissions` (UNIQUE `kind` + `request_id`: the same id gets the first answer back, a rejection too; an outage stores no id, so
  a retry is a new request). One advisory lock per unit makes two requests for one unit register it once. Numbers are
  `SIM-OQD-<yyyy>-<7 digits>` (registration), `SIM-TRF-…` (Oqood transfer and trustee booking) and `SIM-TD-…` (new title deed).
  Rejections are `BUYER_NAME_MISMATCH` (names compared exactly), `UNIT_NOT_FOUND`, `UNIT_ALREADY_REGISTERED`, `SELLER_NOT_OWNER`
  (also a developer that isn't the unit's), `NOC_MISSING`, `INVALID_ID` (unknown or expired document) and
  `SERVICE_CHARGES_OUTSTANDING`. `REGISTRY_MOCK_FAILURE_RATE` gives a 503; demo-only `reject-next` forces a name mismatch once.
  It uses its own injected clock (`SystemClock` in `main.ts`, `FixedClock` in tests): it is a service, not domain code.
- **Labelling (rule 9).** Every page, every JSON body (`simulated: true`), certificate title, watermark and PDF producer says
  "Simulated Oqood (demo)" or "Simulated trustee transfer (demo)". A test reads the drawn text of each PDF (inflated content
  streams) and scans the console HTML: no image, no logo, and "Dubai Land Department" only inside "not connected to the Dubai Land
  Department". The appointment date of a trustee booking (seven days after the booking) is a simulated figure, not a rule.
- **Adapters** (`@spa/helpers/src/registry/`; schemas and rejection codes in `@spa/core` `registry.ts`): `OqoodAdapter {register,
  transfer, status, certificate}` and `TransferAdapter {book}`, each call with `{requestId}`; a result is `{ok: true, no, issuedOn}` or
  `{ok: false, reasons}`; `RegistryUnavailableError` (a network error, a timeout or a 5xx) is never a rejection. `HttpOqoodAdapter`
  reads `REGISTRY_MOCK_URL`; `FakeOqood` is scripted for tests. Payloads are built by code from `buildDealSheet` values and the
  current NOC (`buildOqoodRegister`, `buildOqoodTransfer`, `buildTrusteeTransfer`); a missing record is named and nothing is sent.
  The engine registers the HTTP adapter only in demo mode (like screening, S50): elsewhere the two jobs wait and the facts stay
  false until a real registry's adapter exists.
- **Gates and jobs.** `onDealEntered` now gets the step's transaction: entering `REGISTRATION` proposes `oqood_submission`, entering
  `TRANSFER` proposes `transfer_submission` (sales admin, `system:registry`, dedupe key `<dealId>:<gate>`, no ID number in the
  proposal). Approving a submission gate queues `spa.oqood.submit` (primary) or `spa.transfer.submit` (resales), singletonKey
  `<dealId>:<kind>:<approvalId>`, **after** the decision commits (new `onGateApproved`); a queue that is down never undoes the
  decision. Editing such a gate is refused (`edit_not_allowed`): the payload is code's. `submitRegistration` re-checks the gate
  (an approved, unused approval of the right gate for this deal, else 409 `gate_required`; one that already ran, a deal in another
  state or an issued number is `skipped`), makes one attempt with request id `<dealId>:<kind>:<attempt>` and, in one transaction
  that locks the deal and the approval again, stores the row and the event `REGISTRATION_ATTEMPTED`. A number calls
  `advance(REGISTERED | TRANSFERRED)` as `system:registry` with that approval, which consumes it. A rejection or an "unavailable"
  answer is stored and writes a `needs_human` `helper_runs` row (`spa_registry`); nothing retries by itself (C21 adds the fix, the
  retry and the task). A rejected gate submits nothing. `POST /api/deals/:id/registration/request` (sales officer, manager, admin,
  sales admin) raises a new proposal, returns the pending one, or queues an approved gate that never ran; it approves nothing.
  `GET /api/deals/:id/registrations` lists the attempts (sales roles, legal, finance, admin) without payload, request id or ID numbers.
- **Facts.** `oqoodIssued` is an `issued` `oqood_register` row of a primary deal. `transferIssued` is an `issued` `trustee_transfer`
  (ready resale) or `oqood_transfer` (off-plan resale); a primary deal never gets it from transfer rows, and a resale never from the
  other kind. A rejected or unavailable attempt counts for nothing, so `REGISTERED` and `TRANSFERRED_*` fail closed.
- **Database.** Migration 0036 (`registrations`: unique `(deal, kind, attempt)`, unique request id, one `issued` row per deal and
  kind, CHECKs on kind, status, an issued row's number and date) and 0037 (triggers: a row needs an `approved` gate of the right kind
  for the same deal, an issued row too; rows are immutable, never deleted or truncated). `payload_hash` is the hash of the payload
  (which holds ID numbers); the payload itself is not stored.
- **Known gaps.** No screen (the registration card, C34). The `registry` helper that turns a rejection into a field and one safe
  fix, the retry and the task are C21. A real registry adapter, and trustee fee or Oqood fee payment, are later. Both new env keys
  (`REGISTRY_MOCK_URL`, `REGISTRY_MOCK_FAILURE_RATE`) have defaults in the schema; `.env.spa.example` is not changed in this chunk.

## S54 — Signing and mail (C28)

- **Decision.** After legal approves an agreement, each signer gets a single-use emailed link and signs in order; the last
  signature stamps the PDF, stores its hash and advances `ALL_SIGNED`. Every outbound mail is stored as evidence. No model
  writes any text. Amends S39: the offer-answer links are no longer returned to staff.
- **Rulings (from the coordinator).** Signing is sequential in policy order: buyers, then the broker, then the seller (a
  company signs through its signatory). Signing links are valid 14 days (policy `signingLinkDays`, default 14, 1 to 60;
  confirm with the business). `sendOffer` returns `{offerId, validUntil, emailed:[{sellerPartyId, status}]}`: links go by
  email only. Design §7.4 is changed to match (it said buyers, sellers, agents).
- **Shared code (platform, leasing unchanged).** `appendSignatureRecord` takes an optional `roleLabels` profile (default:
  leasing's tenant and landlord words); new `stampSignatures` (typed names at the C14 anchors, matched by role and slot) and
  `mailEvidence` (body hash with the formula leasing always used, attachment hashes, the server's answer). Golden tests
  recorded first: the leasing signature-record PDF bytes (clock frozen) and the leasing body-hash value, both pinned in
  `platform/adapters/test/golden-shared.test.ts`. Leasing call sites were not edited.
- **Mail.** `sendSpaMail` claims one `outbound_messages` row per (entity, purpose, milestone) before sending, so a mail
  sent or being sent is never sent twice; a `failed` row is claimed again. SMTP runs outside the claim's transaction. The
  row keeps hashes, never the body, so the raw token exists only in the email. Errors are scrubbed of addresses. Without
  mail configured (`ctx.mail`) offers and signing refuse with 503 `mail_unavailable`. Templates are fixed code; reminders
  carry no link (the token exists only in the first email: a lost link is a staff resend).
- **Signing.** `openSigning` (on entering `SIGNING`, same transaction) re-renders the approved agreement with its own
  `preparedAt` and needs the same bytes (`agreement_changed` otherwise, no envelope, a person is told). Every buyer and every
  seller or signatory signs; the broker signs only when the template has a broker line and the deal one broker. Links are
  issued by `spa.signing.invite` (a fresh token each time; only its hash is stored); a resend replaces the hash, so the old
  link is dead (an unknown token is 404). Typed name: `compareNames` exact or typo-class, else 422 `name_mismatch`; out of
  turn 409 `not_your_turn`; used, expired or superseded 410 (`link_used`, `link_expired`, `link_superseded`). The database
  also enforces order, one-time signing and immutability.
- **Finish and `allSigned`.** `spa.signing.finish` stamps, appends the record page, stores the signed PDF with its hash,
  completes the envelope and calls `ALL_SIGNED` as `system:signing`; the resale deposit guard still applies and a blocked
  advance is recorded and retried by running the job again. The signed copy is then emailed to every signer. `allSigned` is
  true only for a complete envelope of the live approved agreement with the same hash, every signature signed, and the deal
  still hashing as it did when prepared. A cancelled or superseded agreement supersedes its open envelope in the same
  transaction. The listing-agreement signing stays staff-recorded (C5).
- **Database.** Migration 0038 (`outbound_messages`, `signing_envelopes`, `signatures`) and 0039 (triggers). The FK from
  `signing_envelopes` to `agreements` means `truncate agreements` now needs `cascade`; the C19 test says so.
- **Known gaps.** No staff screen for signing (C34) and no offer-resend route: a failed offer mail is shown in the answer
  and the offer stands until it expires. Nothing re-runs the finish job when a resale's deposit is recorded after signing
  (run the job again). The documents-request email waits for the C35 portal page. The IP stored with a signature is the first
  `x-forwarded-for` value, which is only as trustworthy as the proxy in front. Real SMTP keys have defaults in the schema;
  `.env.spa.example` was not edited.

- **Amendment (C21-C30 review).** A mail row stuck in `sending` (a worker died mid-send) may be claimed again once its claim is older than `STALE_MAIL_CLAIM_MINUTES` (15; `mail.staleClaimMinutes` overrides it). `outbound_messages.claimed_at` (migration 0053) is the claim's own clock, set on insert and on every re-claim, so a freshly retried row is not stale; the claim is one conditional update, so two workers send once. A `sent` row stays final (the guard trigger is unchanged). The listing chat's per-visitor key is no longer the first `x-forwarded-for` entry, see S61.

## S55 — Payments, escrow accounts, the default flag and tasks (C22)

- **Status.** Decided and built in C22 (needs approval: DB schema, given). Builds on S15, S26, S27, S37, S47, S50 and S54. No model decides an
  amount, an account match or a default: the reader copies text, code checks it, finance confirms the amount.
- **Escrow account.** An admin enters it per project (`PUT /api/escrow-accounts`; finance and admin read). `project_escrow_accounts` is
  append-only: a change supersedes the current row and adds a new one (one current row per project). The IBAN is checked by code
  (`parseIban`: AE plus 21 digits and mod-97, any spacing or case accepted, stored normalised); events carry `AE07...3456` only. A deal with
  no `project_code`, or whose project has no current account, cannot count a payment (fail closed). Because `setDealUnit` is resale-only, a
  new `setDealProject` (`PUT /api/deals/:id/project`, sales roles and admin) sets the project of any deal type.
- **Reading and checking a receipt.** New document kind and read profile `payment_receipt` (amount, date, payer name, receiving account,
  reference; reader prompt version unchanged: only a new profile text was added). Sales or finance uploads it, on any deal type, many per
  deal; none supersedes another. `registerPayment(dealId, {documentId, seq, method})` uses the stored read (409 `not_read` until the
  reader job ran) and checks by code: `into_escrow` is the IBAN equal to the project's current escrow account, `payer_is_buyer` is
  `compareNames` exact or typo-class against a buyer. One payment per receipt (unique `document_id`). **Not into the escrow account** (also: no
  account on file, or the account unreadable) is `not_counted`, opens exactly one `payment_not_escrow` task for finance, and
  `confirmPayment` refuses it with 422 `not_escrow`, finance included; the database CHECK (`counted` needs `into_escrow`) says the same.
  **Payer not a buyer** is `needs_review`: staff see only "Payer name needs review"; the payer joins `dealAmlSubjects` as the non-party
  subject `payer:<name>` (S50), which only compliance roles see, and a screening is queued. Text on the receipt that reads like an
  instruction is `needs_review` too (reason `instruction_found`). The payer's name, the reason and the payer check never reach an event,
  a task or a list for a non-compliance role; compliance roles read them from `GET /api/deals/:id/payments`.
- **Finance confirms.** `confirmPayment(paymentId, amountFils)` (`POST /api/payments/:id/confirm`, finance only, nobody else) takes a typed
  whole number of fils above zero. Until then nothing counts: `amount_read_fils` is shown beside the receipt, `counted` is
  reachable only through the confirmation (CHECKs and a trigger: a row is inserted unconfirmed and changes once, `read` or
  `needs_review` to `counted`). The event `PAYMENT_CONFIRMED` records the read and the confirmed amount and whether they differ (as S47).
  A `needs_review` payment may be confirmed by finance: the payer stays a screening subject, so the deal's AML flag still holds the
  steps that check it.
- **`instalmentsPaid` is real.** True only for a primary deal or an off-plan resale that took a plan over, when the plan has rows and each
  row's counted payments (by `seq`) sum to at least its `amount_fils`, integer fils. A ready resale, a resale taking no plan and a deal with
  no rows are false. `handoverRecorded` stays false: the handover step is a later chunk.
- **Cash feeds AML.** Each payment records its method (`transfer|cheque|cash|card|other`). `dealAmlSubjects` sets `cashFils` to the party's
  counted cash payments (a buyer by `payer_party_id`, a non-party payer by name) instead of the hard-coded 0, so the rulebook's cash rule
  can fire on the confirmed total (its threshold stays the rulebook's, pending until legal confirms it). Cash only read, or not yet
  confirmed, adds nothing. Confirming a cash payment queues a screening so the rule sees it.
- **Default.** Policy gains `defaultAfterDays` (1 to 180, default 30; a placeholder: **confirm with legal**; older policy versions parse
  with the default). Daily `spa.default.check` (00:20 Dubai, singletonKey `default-check:<date>`, also once at start-up) reads each deal's
  pinned policy and flags a deal in `INSTALMENTS` when a dated, unpaid plan row has `due_on + defaultAfterDays` before today (equal is not yet
  default). `flagDefault` sets `in_default` (+ since and reason) as `system:default-check`, writes `DEFAULT_FLAGGED` and opens one
  `default_flagged` task for the sales manager (key `<dealId>:default`); it changes no state and sends no notice (S27); running twice flags
  once. `recordPartyDefault` (sales officer or manager) records `withdrew` or `no_show` with a note, the same way. Only a sales manager
  clears the flag, with a reason (`clearDefaultFlag`, event `DEFAULT_CLEARED`, the task is finished). **A row that was already overdue when
  the manager cleared the flag does not flag again** (otherwise tomorrow's job would undo the decision); a row that falls overdue after
  the clearing does. This rule is mine, the ruling was silent.
- **Milestone instalments** (no due date) get no reminders and are never overdue by date. Instead a sales person records that the
  milestone was reached (`POST /api/deals/:id/milestones/:seq/reached`) and staff get one `milestone_reached` task (for the sales
  officer role, once per milestone, even after it is done). Nothing in the data says a milestone was reached by itself, so a person
  says it; a later chunk may read it from site progress.
- **Tasks.** `spa_tasks` is general for every chunk: open, done or cancelled; one open task per `dedupe_key`; only `open` to `done|cancelled`,
  once (trigger); never deleted. `POST /api/tasks/:id/done` needs the task's role or a sales manager. Titles and `detail` are plain words
  and ids: no compliance wording, no names, no numbers. Kinds: `payment_not_escrow`, `payment_review`, `confirm_amount`, `default_flagged`,
  `milestone_reached`; later chunks widen the kind CHECK.
- **C28 gap closed.** `recordDeposit` takes an optional queue; when a resale's deposit is recorded while the deal waits in `SIGNING` with
  every signature signed, it queues `spa.signing.finish` (key `<envelopeId>:finish`) so the deal isn't stuck. A queue that is down never
  undoes the deposit.
- **Database.** Migration 0040 (generated: `project_escrow_accounts`, `payments`, `spa_tasks`, `deals.in_default*`, `payment_receipt` added to the
  `documents_kind` and `document_reads_profile` CHECKs) and 0041 (triggers: escrow append-only, payments, tasks).
- **Evals.** Ten fictional receipts (valid AE IBANs, one with an injected instruction) join `spa:document-reader` (60 cases; amounts at
  least 98%, names and dates at least 95%, every injection flagged); the receiving account and reference are scored as names. Unit
  tests use FakeLlm only; the real-model run is the user's.
- **Known gaps.** No screen (C33). Overpayment and a repeated bank reference across two receipt files are not detected: finance confirms the
  typed amount per receipt. The collections reminders (C23) are separate. `.env.spa.example` is unchanged.

- **Amendment (C21-C30 review).** (1) `completeTask` answers 404 when `taskVisibleTo(task.role, user.role)` is false, the same as a missing task, and no error names a role; a visible task the user may not finish is a neutral 403. (2) A non-buyer payer's screening job key gains the payment id (`<deal>:aml:manual:<day>:<paymentId>`; `amlJobKey` takes an optional `subject`), so two different new payers on one day are both screened. (3) A receipt whose read is held for a person's check (S59) is skipped by `registerPayment` (`heldDocumentIds`): it answers `not_read` until the read is released.

## S56 — Registry rejections and instalment reminders (C21)

- **Status.** Decided and built in C21 (needs approval: DB schema, more than three packages, given). Builds on S8, S16, S22, S23, S27,
  S53, S54 and S55. No model decides a value: the decision model only maps a rejection message to a field, with a confidence, and code
  decides what happens. No new fact becomes real (the registry facts came in C27).
- **Rejection to field (`mapRejection`, `@spa/helpers`).** A code in a table maps directly and never reaches a model (`BUYER_NAME_MISMATCH`
  to `buyer_name`, `UNIT_NOT_FOUND` and `UNIT_ALREADY_REGISTERED` to `unit`, `SELLER_NOT_OWNER` to `ownership`, `NOC_MISSING` to `noc`,
  `INVALID_ID` to `buyer_id`, `SERVICE_CHARGES_OUTSTANDING` to `service_charges`; `seller_name` and `price` come only from the model). A
  message with no known code goes to the decision model (`SPA_DECISION_MODEL`, 15 s per call, prompt `spa-registry.v1`): it returns a field
  from the list or `unknown`, plus a confidence, validated with zod; the message is fenced as untrusted data, cut to 400 characters with
  numbers masked and unable to close the fence. Below 0.6 confidence, `unknown` or no model configured is unmapped; invalid output or a
  timeout is retried once, then `needs_human`. A message that reads like an order to a model (`documentInstructionLike`) never reaches
  the model and is unmapped. Both unmapped and `needs_human` become a task.
- **One safe fix.** Only for `buyer_name` or `seller_name`, only when every reason of the rejection maps to one of them, and only if every
  party of that side has a KYC-verified name (the latest `kyc_runs` identity that passed, or was approved after review) and each differs
  from the stored one by case or spacing alone. Ruling: this is stricter than `compareNames`' typo class (which also forgives punctuation,
  accents and word order): the two names must be equal once whitespace and case are ignored. A primary deal's seller (the developer), a
  company, a party with no verified name, or any other difference means no fix. The fix puts the verified spelling in the resubmitted
  payload only: stored party records are never edited. It resubmits under the same approval with a new request id (`<dealId>:<kind>:<n+1>`),
  once per (deal, kind) ever: any second rejection, of any kind, opens task `registry_rejected` (sales admin) and no third attempt is made.
  A dry run of the fix decides whether a fix exists before it is recorded.
- **"Unavailable".** The same attempt is tried again under the same request id (the registry replays an id it answered) after 5 minutes,
  30 minutes and 2 hours (`startAfter` 300, 1800 and 7200 s; job data `retryAttempt`, singletonKey
  `<dealId>:<kind>:<approvalId>:<attempt>:retry:<n>`); the fourth failure opens task `registry_unavailable` once. A retry of the fix attempt
  sends the fixed name again. A retry whose rebuilt payload differs from the one first sent is not sent (a task asks a person to request
  again). A job that runs twice makes no second call for an answered attempt (`never submit twice for one request id`).
- **Tasks and records.** Task titles say what was refused in plain words (never the registry's text, a name or a number); `detail` holds
  codes and field names. Every outcome writes a `helper_runs` row (helper `registry`, the decision model tag when one answered, prompt
  `spa-registry.v1`) and the event `REGISTRATION_REJECTION_HANDLED`; the C27 `spa_registry` row per attempt is kept. `runRegistry` works from
  the stored rows, so a crash between recording a fix and resubmitting is finished by running the job again.
- **Collections (`spa.instalment.remind`).** Daily 08:00 Dubai (singletonKey `instalments-remind:<date>`; the start-up catch-up send runs
  only from 08:00 Dubai, so a restart in the night emails nobody). For a deal in `INSTALMENTS`, every dated plan row not covered by counted
  payments gets mail to each buyer at T-14, T-3 and T+1 (policy `instalmentReminders {beforeDays: [14, 3], afterDays: [1]}`, read from the
  deal's pinned policy; older versions parse with the default; placeholders: confirm the days with the business) through `sendSpaMail`
  (template `instalment_reminder` v1: fixed wording, the outstanding amount from the plan in integer fils, dates from the Clock, no link,
  nothing about checks). Ruling: **milestone rows (no date) get no reminder**; C22 already gives staff a task when a milestone is reached.
  A paid row is skipped. A job that was down sends only the latest milestone that has come due. Each (row, milestone) is recorded once in
  `collection_reminders` (unique, insert-only), and only when every buyer's mail is `sent`: a failed one is tried again the next day. At the
  first day after the due date an unpaid row also opens one `instalment_overdue` task for the sales officer (a finished task is not opened
  again). Collections and the chaser stay non-switchable (S22).
- **Database.** Migration 0042 (`registry_rejections`, `collection_reminders`, the three new `spa_tasks` kinds, and the `registrations`
  unique indexes on (deal, kind, attempt) and on the request id made partial, `status <> 'unavailable'`) and 0043 (triggers). Ruling: a
  retry under the same request id needs room for another row of the same attempt, so an `unavailable` try is a new insert-only row (rows
  stay immutable); once the registry answered, nothing answers that attempt or request id again. The `milestone` CHECK is a pattern
  (`T-<days>` or `T+<days>`) rather than three literals, because the policy sets the days. Because `registry_rejections` and
  `collection_reminders` reference other tables, `truncate registrations`, `truncate spa_tasks` and `truncate outbound_messages` now need
  `cascade` in tests (the trigger still refuses it).
- **Eval.** `bun run eval -- spa:registry`: 30 invented rejection messages (three are injections) through the helper as the engine runs it;
  limits: the field right in at least 90% of cases at confidence 0.6 or more, and no name field used for a case about something else (0 wrong
  fixes). An injection counts as right when it is left to a person. Unit tests use FakeLlm only (an ideal reader passes, one that calls
  everything a name is caught, an obeying one is caught); the real-model run is the user's.
- **Known gaps.** No screen (the registration and instalment cards, C33 and C34). No route to see a task list beyond C22's. The registry
  facts, `registrations` listing and the request route are as C27; a rejected gate is not resubmitted by the helper beyond the one fix, and a
  person asks again through the existing request route. `.env.spa.example` is unchanged (`SPA_DECISION_MODEL` already exists).

- **Amendment (C21-C30 review).** `listRegistrations` masks every registry `reasons[].message` (`maskPiiText`), as `listKycRuns` and `listCompanyChecks` do for their messages. The registry auto-fix reads a party's verified name only from a KYC run that is not held or rejected (S59): a held run names nobody, so the rejection goes to a task.

## S57 — Read routes and the role filter (C29)

- **Status.** Decided and built in C29 (needs approval: DB trigger migration, given). Builds on S3, S6, S35, S42, S50 and the P8 line
  "timeline and approval reads filtered by role". No state change and no new fact: only reads, plus the decide route.
- **Compliance roles.** `COMPLIANCE_ROLES` = `compliance_officer`, `mlro` (`@spa/core` `visibility.ts`). Admin is not one: it configures but
  never reads a case, a screening or a risk detail.
- **Ruling (amendment to design §4.3): sales roles read "Compliance review: open" or "none", never "no hits" and never any AML detail.**
  Each party fact cell and the deal's `compliance` section carry `{label: "Compliance review", status: "open" | "none"}`; the hold stage reads
  "On hold · review open", with the key `ON_HOLD` for every role but the two compliance roles (`AML_HOLD` stays the key for them; a sales role
  that asks for `stage=AML_HOLD` gets a 400). A neutral view never uses the words AML, screening, sanction, PEP, EDD or risk (a response-text
  scan in the tests).
- **Events.** An allowlist per role, fail closed. `STAFF_EVENTS` and `COMPLIANCE_EVENTS` are the two sets (`AML_POLICY_PUBLISHED` and the AML
  move names are compliance-only); a type in neither is hidden from every non-compliance role and shown to the compliance roles.
  `COMPLIANCE_REVIEW_RECORDED` shows to all as "Compliance review" with an empty payload and a neutral actor. A test scans the engine source
  for every appended event `type` (literals, the ternary and the `OFFER_${status}` template) and fails on an unclassified one; the machine
  events are classified from the machines' own lists. The filter runs in the query, so a page is never short because of hidden rows.
  `APPROVAL_PROPOSED` and `APPROVAL_DECIDED` of a compliance gate lose their `approvalId` for other roles.
- **Approvals.** `edd_signoff`, `aml_flag` and `aml_report` read to other roles as `{id, gate: "compliance_review", title, status: "open" |
  "closed", entity}` and never appear in their inbox; `proposal`, `reasons`, `decisionNote`, `outcome` and `editedProposal` are removed. All
  other gates pass `title`, `reasons`, `decisionNote` and the proposal through the PII mask (this closes the P3 deferred masking item). The
  inbox is the pending gates the role can decide (admin: none), oldest first; each item says `mayDecide` (so a proposer reads "you can't
  approve your own proposal"). `helper_runs` with visibility `compliance` are hidden from other roles; a task for a compliance role is seen
  by compliance roles only (`taskVisibleTo`).
- **Routes** (all signed in, `limit` 1 to 100 default 50, opaque keyset cursor `(time, id)`; a bad query is 400, an unknown or malformed id 404):
  `GET /api/deals?type&stage&q&mine&hold&default` (one row per deal: ref, type, stage, property, sellers and buyers by name, price,
  `waitingFor {role, label, since, waitedDays}` from the oldest open gate or else the state, owner; search covers ref, property and party
  names, never ID numbers); `GET /api/deals/:id` (header, `waitingFor` and `sections` from `RECORD_SECTIONS`, a registry of `{key, appliesTo,
  load}`: `parties`, `steps`, `compliance`, `approvals`, `tasks`, `helper_runs`, and `payment_plan` only for a primary deal or a taken-over
  plan; a section that does not apply is absent; later chunks append their own); `GET /api/deals/:id/events` (newest first);
  `GET /api/approvals?scope=inbox|deal&dealId&status`; `GET /api/approvals/:id`; `GET /api/tasks?scope=mine|all&status&dealId` (`all` is a
  sales manager's: 403 for others); `GET /api/summary` (inbox and task counts, open deals by the stage the role may read).
  Every answer passes `maskPii` once more on the way out.
- **Decide route.** `POST /api/approvals/:id/decide` calls `decideApproval` with the session's user. The body is the decision only: a key
  other than `decision`, `note`, `proposal` or `outcome` (a `role`, an `actor`, a `decidedBy`) is a 400 and decides nothing. `mayDecide`
  still refuses admin, the wrong role and the proposer (403). Ruling: a role with no part in a compliance gate gets the plain 403 "you
  can't decide this" instead of a message naming the gate.
- **Ruling: the `waitingFor` role for a review.** Others read `{role: null, label: "Compliance review"}`; the oldest open gate decides, so a
  deal with a compliance review and a later sales gate reads as waiting for the review. Signing waits for no staff role (`role: null`).
- **Database (migration 0044, trigger only, made with `--custom`).** Read against 0001 to 0043 first: `spa_policy` rows were already
  immutable (0005) and a decided approval already final (0005). Added: a pending approval's `id`, `gate`, `entity_kind`, `entity_id`,
  `dedupe_key`, `title`, `proposal`, `rules_version`, `approver_role`, `proposed_by` and `created_at` can't change; TRUNCATE is refused on
  `spa_approvals` and `spa_policy`. Ruling: `reasons` is not frozen while pending, because the template re-check refreshes it (S45); the
  decision columns and `consumed_by_event_id` stay writable. This closes the "pending approvals editable by raw SQL" minor.
- **Known gaps.** No screen (C30 calls these routes). The routes that already existed (kyc, signing, payments and the rest) keep their own
  role checks and are not wrapped by `maskPii`. The `steps` come from the deal's own state and events; per-step detail comes with each
  step's section in later chunks. No copilot tool reads these yet (P9).

## S58 — Work, deal record and demo deals (C30)

- **Status.** Decided and built in C30 (no approval needed: web screens, no schema, no state change, no new fact). Builds on S21, S31, S57.
  `docs/spa/mockup.html` is not in the repo, so `docs/spa/design.md` §2 to §4.3, §6, §8 and §9 are the source for the screens (the user
  approved this).
- **Read only.** The pages call only C29's read routes (`GET /api/summary`, `/api/deals`, `/api/deals/:id`, `/api/deals/:id/events`,
  `/api/approvals?scope=inbox`, `/api/tasks`) and one write, `POST /api/tasks/:id/done` ("Mark done" on the Tasks tab; the engine
  checks the task's own role or a sales manager again). Every answer is parsed with zod (`lib/contracts.ts`); a section that fails its
  own shape is left out. A test scans the page and loader sources for any other write route.
- **Screens.** `/` Home (what waits for the role: open gates it decides and its tasks, oldest first; open deals by stage as links into
  Work), `/work` (tabs Deals and Tasks; deal type, "Mine", "On hold", "In default", stage and search live in the address, so a filtered
  list is a link; `TableFrame` rows with `Sub` lines; keyset paging "Next page"), `/work/deals/[id]` (header, state pill, `In default`
  pill, stepper, "Waiting for" banner, then Overview, Parties, Payment plan, Approvals, Tasks; Activity and "How this was handled" in
  the right column). The rail's Work item shows a count of what waits for the role (open gates it decides plus its tasks), nothing else.
- **Rulings.** (1) The record renders only the sections the engine sent (`RECORD_SECTIONS`), in design order; a later chunk adds its
  engine section and its web renderer together. Documents, agreement, signing, NOC and banks, settlement and registration have no
  record section yet, so they are not shown (never empty, never faked), and `SignerList` is not built until a signing section exists.
  (2) Steps per deal type come from `stepsFor(dealType, flags)` in `@spa/core` (`steps.ts`), which `dealSteps` now uses; a test walks
  the deal machine and checks every non-end state is a step of some type and that no type lists a step it cannot reach (an off-plan
  resale's taken-over plan adds Instalments; a ready resale's flag does not, as the machine's own rule). (3) `RecordStepper` in
  `@platform/ui` gained an optional `states` prop (additive: leasing is unchanged) because a finished or cancelled deal has no
  current step. (4) A pending gate shows only the approver role and the title; its proposal and reasons are never shown, and a compliance
  gate would show as "Compliance review" whatever it carried. (5) "Read, not confirmed" is built (`Amount`) and shown when a row says
  `confirmed: false`; the engine sends no unconfirmed amount in the record yet, so none shows today. (6) Compliance roles and admin get
  404 on `/work`, as the rail rule says; their Home shows counts without links. (7) A stage the Work list may filter by is an `ON_HOLD`
  or a deal state other than the internal hold name; any other value in the address is dropped. (8) Dates are `4 Dec 2026` and times
  UAE time, formatted from the engine's values; the web never reads the clock (a test scans for `Date.now` and `new Date()`).
  (9) Home has no "Today" or "Helper activity" block: no C29 route says them yet (a later chunk).
- **Demo seed (`bun run spa:demo:seed`, demo mode only).** Ten fictional deals through SpaManager functions: primary U-101 (offer
  accepted), U-102 (agreement being prepared, plan set), U-103 (legal approval, plan set), U-104 (checking parties, flagged in default
  with its manager task), U-105 (cancelled); ready resale on its own listing at checking parties, on hold with a real review (the buyer's
  name is on the invented screening list, so `screenDeal` opens a real case and gate), and with a buyer mortgage at preparing the
  agreement; off-plan resale with a taken-over plan at legal approval, and at offer accepted. Three open tasks (one done) cover the
  Tasks tab. Names are "Sample ...", "Fictional ..." or the invented list name; every email ends `.test`; ID fields are placeholders.
  Ruling (mine): a deal is moved to its stage with `advance()` using demo-only facts that say the evidence steps (KYC documents, an
  uploaded template and its preparation) are done, because they can't be faked without files; the facts loader is in `seed.ts` and the
  engine never uses it. So the seed stops at legal approval: signing needs an approved agreement from a prepared template, so no seeded
  deal is later than that (and none has a pending `agreement_approval`, which could not be approved without an agreement). Idempotent
  (skipped when a ready resale exists).
- **Known gaps.** No decide controls (C31). No Listings, Inventory, Compliance or Settings screens. No visual check by browser in this
  chunk (tests and typecheck only). The web tests render components and pages to HTML and run the real engine routes on `spa_test`.

## S59 — Helper modes, review holds and the deal driver (C24)

- **Status.** Decided and built in C24 (needs approval: DB schema, more than three packages, given in the plan
  `docs/superpowers/plans/2026-11-20-spa-c24-helper-modes.md`). Builds on S22, S25, S49 to S52, S55, S56, S57. Migrations 0045 (tables, made by
  drizzle-kit) and 0046 (triggers, made with `--custom`).
- **Switchable.** `ownership_check`, `spa_kyc`, `spa_company_check`, `spa_document_reader` (scope = document kind, `*` for all), `spa_prepare`,
  `registry` (the auto-fix only). Not switchable, refused by a CHECK on `spa_helper_settings.helper` and by a 422 `not_switchable`:
  `aml_screening`, `settlement`, `chaser`, `collections`, and any gate that is always required.
- **Settings.** `spa_helper_settings` holds append-only versions per (`helper`, `scope`); the latest is in force, a kind's row overrides `*`,
  default `auto`. `PUT /api/settings/helpers` is admin only (a sales manager reads with `GET`); it writes a version row and a `HELPER_MODE_SET`
  event (previous mode, new mode, version) and does nothing when the mode is unchanged. Any key with `model`, `prompt` or `tag` in it is 422
  `model_read_only` (S25); models come from the engine's env tags and are shown read-only.
- **Review.** `afterHelperResult` runs inside each helper's transaction. Only an `ok` result that would count is held (a `passed` KYC run, a
  `passed` company check, a `matched` ownership check, a clean NOC or letter read, a prepared agreement, a registry auto-fix): a
  `helper_review_holds` row (unique per run) and a `helper_review` gate for the sales officer (sales manager stands in; admin and the proposer
  cannot decide). `needs_human` and anything that already has a gate (`kyc_review`, `seller_verification`, `noc_review`) are untouched, in both
  modes. Held runs are skipped by `kycOkFact`, `companyChecksOkFact`, `ownershipOkFact`, `nocOkFact`, `bankLettersFact` and
  `agreementPreparedFact`, so a held or rejected result never counts, even after a person confirms an amount (a manager's own
  `seller_verification` approval is a different path and still works). Approve releases the hold and drives the deal; reject needs a note,
  closes the hold for good and opens a `helper_rejected` task for the sales officer. A helper result is approved or rejected, never edited.
- **Prepare.** In review mode the agreement is rendered and stored (status `prepared`) but `PREPARED` and the legal gate wait; approving sends it to
  legal only if the deal is still in `AGREEMENT_DRAFT` and its values still hash the same, otherwise nothing is sent and the next preparation makes a
  fresh one. **Registry.** In review mode the fix is decided and recorded, but the resubmission waits; a release queues the job again for the same
  approval (singleton key per run). Off: no auto-fix, every rejection is the sales admin's task.
- **Off.** The job is not queued (409 `helper_off` at the route) and a job queued earlier is not run either (the handler throws the same, the
  worker answers it); one `helper_off` task per deal, helper and scope while open tells the agent, in plain words and with no compliance wording,
  to do the step by hand with the same checks. The facts stay fail-closed: off never lets a deal pass.
- **Driver.** `driveDeal` (`manager/drive.ts`, actor `system:driver`) takes `CHECKS_STARTED` once documents are requested, then `CHECKS_PASSED`,
  only when the real facts already pass the guard and the transition has no gate; `advance` checks again. It never goes past `PARTY_CHECK`, never
  leaves a hold and never skips a gate; the NOC steps keep their own drive. It runs after a KYC run, a company check, an ownership check, a document
  read, a screening, a document request and a released review; its failure there is logged and never undoes what happened. Idempotent.
- **Rulings (mine).** (1) The mode is read where the result is written, so a job already running finishes under the mode it read. (2) A scope
  for the document reader is the document kind; `auto` for a kind overrides a `review` on `*`. (3) The AML screening stays fixed, but it also
  calls the driver, because a finished clean screening can be the last fact `CHECKS_PASSED` waits for. (4) No model or prompt is set from this screen.
  (5) `helper_review` is not a compliance gate: sales roles see it as itself.
- **Known gaps.** The inbox card for `helper_review` shows the generic gate title; a richer "Looks right" card with the result's reasons belongs to
  the inbox screen (C31). Review mode for the registry holds the resubmission only, as specified. No per-company settings yet (one setting for the
  whole install).

- **Amendment (C21-C30 review).** (1) Review is offered only where a read feeds something that can be held: `REVIEWABLE_READER_SCOPES` = `noc`, the four bank letters and `payment_receipt` (a read of a receipt is now held through `afterHelperResult`). `title_deed`, `trade_licence`, `memorandum`, `poa`, `board_resolution` and `oqood` can be `auto` or `off`; `setHelperMode` refuses `review` for them (422 `review_not_available`) and Settings hides the button (`reviewScopes`). Their reads change nothing alone: ownership and company facts are held by those checks' own modes. (2) The `helper_review_holds_guard` trigger (migration 0054) lets a hold become `released` only when its own approval is a `helper_review` on the same deal and `approved`, and `rejected` only when that approval is `rejected`.

## S60 — Agreement review and chasing (C25)

- **Status.** Decided and built in C25 (needs approval: DB schema, more than three packages, given in the plan
  `docs/superpowers/plans/2026-11-20-spa-c25-review-chasing.md`). Builds on S22, S23, S51, S54, S56, S57, S58 and S59. Migrations 0047 (tables, made by
  drizzle-kit) and 0048 (triggers, made with `--custom`). No new fact becomes real and no model writes outbound text.
- **`agreement-review` (flags only).** Job `spa.agreement.review`, singletonKey `<agreementId>:review`, queued by the `spa.prepare` job after an agreement is
  stored (a failure to queue is logged and never undoes the preparation). It runs on `SPA_CHAT_MODEL` and reads the agreement's printed text (rebuilt from the same
  inputs as the PDF; a deal that changed since is `stale` and skipped) and the accepted offer's free-text conditions, both fenced as untrusted data that cannot close
  the fence. The model returns at most 20 `{kind: conflict | unknown_amount | unknown_date | instruction_like, quote, note ≤ 200}` flags (zod; prompt
  `spa-agreement-review.v1`; invalid output is retried once, then `needs_human`). **Quote guard (code):** a flag whose quote is not found, after whitespace is
  normalised, in the agreement or the conditions is dropped and counted in `dropped` (case must match; a quote of fewer than four characters never counts; quote marks around it
  are ignored). Code raises `unknown_amount` and `unknown_date` flags itself from the stray-value scan (`strayMatches`, now shared with `spa-prepare`: `strayValues` calls
  it, and the prepare tests are unchanged), and flags instruction-like sentences of the conditions itself (`documentInstructionLike`), so a model that obeys the text changes none of
  those. A note that sounds like a legal opinion or tells legal what to decide is replaced by fixed words, and PII in a note is masked. Ruling (mine): the agreement's own text is not
  scanned for instruction-like words (it is admin-approved template wording filled by code; an "instructions" clause is legal prose); only the buyers' and sellers' free text is.
- **Never blocks.** One `helper_runs` row (`spa_agreement_review`, entity kind `agreement`, visibility `staff`) and, when it worked, one immutable `agreement_reviews` row per
  agreement and prompt version. A failed run (`needs_human`) stores no review, and `agreement_approval` stays decidable; the card says "Review not available". Flags join
  the `agreement_approval` card on the two staff approval routes (`agreementReview` on `GET /api/approvals` and `/api/approvals/:id`) and the record section `agreement_review`
  (LEGAL_REVIEW and later); no party or public route reads them (a test scans the engine source). Labels: "Suggestions for legal", "Review in progress", "Review waiting for a
  person to look at it", "Review is switched off", "Review not available". The event `AGREEMENT_REVIEWED` carries counts and kinds, never the quotes.
- **Helper modes (S59) apply.** `spa_agreement_review` is the seventh switchable helper (the CHECK on `spa_helper_settings.helper` is replaced in 0047; label "Agreement review"; chat
  model shown read-only). `off`: nothing is queued, a job queued earlier is refused with `helper_off` and one `helper_off` task tells the agent to read the agreement and the conditions by hand.
  `review`: the flags are held behind a `helper_review` gate for the sales officer; held flags show as "waiting", released ones show, rejected ones never do (and a `helper_rejected` task opens).
  The legal gate itself is never held, in any mode: the review is advice, not a step.
- **`chaser`.** Open items come from code only (`openChaseItems`): the required documents of the KYC config in force (against `document_requests` and the uploaded kinds), the latest
  failed or expired KYC run's reasons, and compliance info requests. A KYC flag maps to a code from the fixed `CHASE_REASONS` list (`document_missing`, `passport_expired`, `document_expired`,
  `photo_unreadable`, `name_differs_title_deed` for a resale seller, `name_differs_deal`, `wrong_document`, `additional_documents`); a flag with no party-fixable reason (a person's call) is not chased,
  and the reader's own message never leaves. **Neutral wording:** any item compliance asked for (an `info_requested` case), and every item of a party under an open compliance case, collapses to
  one item, `additional_documents` ("Additional documents needed", key `additional_documents:<caseId>`), printed with no document name; `neutralChaseReason()` takes no argument, so the original
  reason cannot be passed through it. An open case with nothing owed sends nothing (a plain open case is not a request).
- **Schedule and stops.** Step 0 on the first run that finds the item, then one step after each of the deal's pinned `reminderDays` (default 2 and 5), counted from the first chase (ruling: this
  anchors on the first chase rather than on the request, so an item found late is not chased with a final reminder first); a job that was down sends only the latest step that has come due. At
  the new policy field `chaseTaskAfterDays` (default 7, 1 to 90, must exceed the last reminder day: checked by `SpaPolicy`; an older stored policy parses with 7) an unanswered item opens one
  `chase_overdue` task for the sales officer (key `<dealId>:<partyId>:<itemKey>:chase_overdue`; plain title, no name, no number, no reason). Stops: a cancelled, completed or handed-over deal, an
  upload after the item's first chase (a missing document is answered by a document of its kind; a KYC item by any new upload after the run, which is read again), and an agent's pause
  (`chase_pauses`; `POST /api/deals/:id/chase/pause|resume` for sales officer, manager, sales admin and admin; pausing twice or resuming when not paused changes nothing; a closed deal can't be paused).
- **Sending.** `chaseSweep` (`spa.chase.sweep`, 08:30 Dubai, key `chase-sweep:<date>`; the start-up catch-up send runs only from 08:30) queues one `spa.chase` job per open deal (key
  `<dealId>:chase:<date>`, as the plan says); `chaseDeal` is safe to run twice. Every email goes through `sendSpaMail` (purpose `reminder`, template `chase`, template version = the admin's version) and is stored
  as evidence. One email per party lists everything still owed; the milestone is `<partyId>:<itemKey>@<step>[+<itemKey>@<step>…]` (a small change from the plan's one mail per item: a party with three missing
  documents gets one mail, not three). A `chases` row per item and step is written only once the mail is `sent` (a failed one is tried again the next run) and keeps the template id and version, the
  subject and `body_sha256` (the formula the outbound row uses: text, a newline, html). Mail unconfigured: 503 `mail_unavailable` like the other reminders. No approved template: nothing is sent.
  The agent's name and address come from the deal's owner (else "your agent" and "this address"); `{company_name}` from the company row (else "the sales team").
- **Templates.** `POST /api/chase-templates` (admin) saves the next draft version; `POST /api/chase-templates/:id/approve` (admin) approves it, retires the approved one before it and is checked again.
  On both, code allows only `{party_name}`, `{property}`, `{items}`, `{agent_name}`, `{agent_email}`, `{company_name}` and requires `{items}`; it refuses a text with a banned word (aml, anti-money-laundering,
  laundering, sanction(s), screening, screened, pep, edd, suspicious, compliance: the plan's list plus "compliance", so a chase never names a compliance review either) with 422 `invalid_chase_template`. A draft is never
  edited (a change is a new version); an approved version never changes except to `retired` (trigger). Ruling: the admin who wrote a draft may approve it (a demo has one admin); a separate approver is a
  policy question for the business. Filling is one pass, so a value can't bring a placeholder in; a stored template with a code that can't be filled is refused, not sent half filled.
- **Database.** 0047: `agreement_reviews`, `chase_templates`, `chases`, `chase_pauses` (also `resumed_by`, and `created_at` on templates, small additions to the plan's columns), the `spa_tasks.kind` CHECK with
  `chase_overdue`, and the `spa_helper_settings.helper` CHECK with `spa_agreement_review`. 0048 (triggers): reviews immutable and never emptied; a draft template can only be approved; an approved one is immutable
  but may be retired; chases insert-only; a pause can only be resumed, once; nothing is ever deleted or truncated.
- **Record.** `RECORD_SECTIONS` gains `agreement_review` (LEGAL_REVIEW and later) and `chasing` (every live deal): what is owed, the schedule, the template version, what was sent, whether it is paused. The
  section `load` now also receives the context (it needs the Clock). Events `AGREEMENT_REVIEWED`, `CHASE_SENT`, `CHASE_PAUSED`, `CHASE_RESUMED`, `CHASE_TEMPLATE_CREATED` and `CHASE_TEMPLATE_APPROVED` are classified
  as staff events (a chase event carries reason codes and steps, never a name or a document).
- **Eval.** `bun run eval -- spa:agreement-review`: 30 invented cases (8 clean, 8 conflicts, 6 stray amounts or dates, 8 injections in the conditions); the hard limits are 0 false quotes among the flags kept and
  every injection flagged; recall, clean cases that got a flag and the invented quotes the guard dropped are printed. Unit tests use FakeLlm only (an ideal reader passes, an inventor is caught by the guard, an
  obeying model changes nothing, a guard that let a false quote through fails the run); the real-model run is the user's.
- **Known gaps.** No screen: the template editor, the pause and resume controls and the inbox card for the review's flags belong to C34 and C31 (the web shows both sections read only). No approved template is seeded, so
  nothing is chased until an admin writes and approves one. The party portal page for uploading (C35) does not exist, so a chase carries no link and says to reply to the agent. Ownership-check name differences
  are not a chase source (the plan names three sources). `.env.spa.example` is unchanged.

- **Amendment (C21-C30 review).** A neutral chase item's key is `additional_documents:<12-hex hash>` of the compliance case id, not the id itself: the key lands in chase rows and a task's `detail`, which every sales role reads. The banned-word list for chase templates now also holds `risk`, `flag`, `report`, `review` and `hold` (with plain endings); whether an admin may approve their own chase template stays open (user decision).

## S61 — Assistants: party portal, listing page chat and template assistant (C26)
- **Status.** Decided and built in C26 (needs approval: DB schema, more than three packages, moves leasing code; given in plan
`docs/superpowers/plans/2026-11-20-spa-c26-assistants.md`). Builds on S11, S24, S38, S54, S57, S59 and S60. Migrations 0049 (tables, made by drizzle-kit) and 0050
(triggers, made with `--custom`). The staff copilot is C36. Rule 11 applies as written: they read, draft and propose; nothing here approves, sends on its own, changes state, or opens a document.
- **Shared code moved to `platform/llm/src/agent/` (`@platform/llm/agent`).** `git mv` of leasing's scope gate (`checkScope`, now taking an `AgentProfile`:
channel words, previous-reply label, instructions, criteria, fixed off-topic reply), the value post-check (`verifyAnswer`, `actionClaim`, `asciiDigits`; the customer agent's version, with
Arabic and times), `untrusted`/`untrustedDeep` and the Ollama tool-calling model (`ollamaChatModel`, `ScriptedModel`, plus `ScriptedAgentModel`, `callTool`, `say`). Leasing keeps re-exports at the old paths
(`customer-agent/{scope,verify,prompt}.ts`, `copilot/src/{untrusted,models}.ts`; `ollamaCopilotModel` is `ollamaChatModel`) and its own `LEASING_CUSTOMER_PROFILE`, so `checkScope(llm, text, last, threshold)` keeps its signature. `@platform/llm` gained
`@langchain/core`, `@langchain/ollama` (versions already pinned by leasing) and `@platform/kernel`; `@leasing/copilot` gained `@platform/llm`.
- **Goldens first.** `agent-golden.test.ts` in leasing helpers (customer agent transcripts for search, unverified retry, claim retry, a tool's final reply and the fence, a model that throws; a value and claim corpus; the scope question and verdicts)
and in leasing copilot (its value check, fence and scripted model) were recorded as snapshots (12) before anything moved, and pass unchanged after. Ruling (amends the plan's task 1, using its own fallback): the leasing **loops** (the customer agent's LangGraph graph with choice cards and status stand-ins, the copilot's graph) were **not** rewired onto the new loop,
and the **copilot's own `verifyAnswer`** stayed in leasing: it is a different, simpler check (no Arabic, other duration keys) and the plan forbids changing a leasing transcript. `runAgentTurn` is new, used by the SPA assistants only.
- **`runAgentTurn` (the common rules).** (1) Scope gate before the chat model: an off-topic message gets the profile's fixed reply and the chat model never runs; a doubt, a missing answer or a failing decision model is "in scope" (as leasing). (2) The person's text is always fenced as untrusted; history too. (3) At most six tool calls a message; every call is
Zod-parsed first; an unknown tool, bad arguments or a thrown error go back to the model, never to the tool. (4) 60 s for the whole turn (gate, model and tools), then the fixed fallback (`timeout`). (5) Post-check: an amount, date, time, weekday, percentage, duration or contact detail no tool result of this turn contains (the person's words and text inside `<untrusted>` never count) is retried once, then the answer goes
out **marked unverified** (`verified:false`, the values listed) rather than dropped; an action claimed ("I've sent", "I will contact you") that no tool took is retried once and then replaced by the fixed fallback. (6) An optional code guard (`banned`) checks the model's reply, every tool result before the model sees it, and a tool's fixed text. (7) A tool may carry `final(out)`: code-written
text that ends the turn when the tool did its job, so confirmations ("I've emailed your question to your agent") are never model-written. Never throws. Stored: every turn in `assistant_threads` (kind, subject, hashed principal) and `assistant_messages` (user, tool and assistant rows, content passed through `maskPiiText`, tool arguments through `maskPii`, `verified`, `unverified_values`, `scope_blocked`, model tag), append-only by trigger.
- **Party assistant.** `POST /public/party/:token/assistant` (body `{text}` 1 to 2,000 characters; 404 for any bad link with one body; 429 over 60 messages an hour per link; 503 without a model). `resolvePartyToken` returns the one deal and party behind a **sign link** (not superseded, not used, not expired) or an **offer link** (not answered, offer still `SENT`; no deal yet, the tools speak of the offer); the hash of the token keys the thread and the limits; C35's portal token will join the resolver. Tools are closed over that scope and take no scope argument
from the model: `my_deal_status` (step label from `stepsFor`, words from `PARTY_STATE_WORDS` in `@spa/core/vocab.ts`, "Under review" for a compliance hold, whose turn it is to sign, the agreed price), `my_missing_documents` (this party's items from `openChaseItems`, fixed `CHASE_REASONS`, the neutral line for anything compliance asked), `my_payments` (buyers: the plan rows with counted amounts;
others: "doesn't apply"), `transfer_day_info` (the target date the agent set, "it can change", a fixed list), `explain_step` (fixed `PARTY_GLOSSARY`), `contact_agent` (takes **no arguments**: the email is the party's own message, word for word, plus the deal ref and the party's name, to the listing's agent else the deal's owner, through `sendSpaMail`, entity kind `party_question`, purpose `notice`; 5 a day per link; nothing the model wrote goes out).
**Output guard (code):** `partyBanned` (aml, anti-money, sanction(s), screening/screened, pep, edd, risk, flag, report, compliance, laundering, suspicious, whole words) on every reply, tool result and fixed line; a hit sends "Your agent can help with that." Advice, price talk, other people and off-topic messages are `off_topic` in the party profile, so they get the fixed reply from the gate. A test keeps every state word, glossary line and chase reason free of banned words.
- **Listing chat.** `POST /public/listings/:ref/chat` (body `{text, session, consent}`; `session` is a browser-tab id, so two visitors behind one address keep two conversations). `findPublicListing` (new, in `listings.ts`) is the page route's own check (published, permit valid today), now used by both, so the chat never talks about a listing the page would hide; anything else is the same 404. Rate limits (table `assistant_rate_limits`, key hashed, buckets from the Clock): 20 messages an hour per client address and listing (429
`rate_limited`) and 3 enquiries a day. Tools: `listing_facts` (the page's own public fields; title and description fenced as data; never an owner, seller, document, ownership column or floor price, none of which is selected), `other_published_listings` (up to five other published, permitted listings; this install is one company, S33, and listings have no company column yet), `send_enquiry`
(`{name, email}`): **consent comes from the page's tick box in the request, not from the model**, the name and the email must appear verbatim in messages the visitor typed, and the message sent is the visitor's last five messages, joined, as written; the row is stored in `listing_enquiries` (consent time NOT NULL), emailed to the listing's agent through `sendSpaMail` (entity kind `listing_enquiry`, purpose `notice`), and the reply is code text. No agent or no mail configuration: nothing stored or sent, the model says it could not.
The client address comes from `x-forwarded-for` (the web app passes the visitor's on); behind no trusted proxy a visitor can change it, so the limit is as strong as the deployment's proxy (a known gap).
- **Template assistant.** `POST /api/template-assistant` (admin and legal; `{versionId, text}`). Tools: `template_version` (sections, blanks with field, source and type, checks; headings and labels read from the uploaded document are fenced as data), `data_keys`, `compare_versions` (a code diff against another version: sections, blanks, mapping changes, checks), `explain_check` (fixed text per check code), `propose_remap` and `propose_rename`.
A proposal is validated by code (`checkRemap` is a dry run of `remapBlank`; a label is 1 to 80 characters with no braces), stored in `assistant_proposals` as `proposed` with the note masked, and the reply is code text saying nothing has changed. A version that is not `in_review` is refused. **Only `POST /api/template-proposals/:id/apply` (admin, a click) changes anything**, by `remapBlank`, or by `relabelBlank` (new: label only, checks run again,
event `TEMPLATE_BLANK_RELABELED`, classified a staff event; the plan named only the remap function, a relabel has no other home); it records who and when (trigger: only status and the apply columns change, once), refuses a version no longer in review (409) and applying twice (409); `POST /api/template-proposals/:id/dismiss` (admin) sets one aside. The assistant has no approve, apply or edit tool and never says a clause is valid ("ask legal" is the gate's off-topic reply for legal-validity questions).
- **Web.** The only screen is the chat box on the public listing page (`components/listing-chat.tsx`, `lib/listing-chat.ts`, a Next route `/properties/[ref]/chat` that forwards to the engine so the engine address stays server-side): a labelled live log, "You" and "Assistant" on every line, unverified values marked with a dotted underline and "(Not confirmed by the listing)" for screen readers, a consent tick box in words, no ID numbers asked.
The party assistant's box comes with C35's party pages and the template assistant's with C34's template screens.
- **Evals** (`bun run eval -- spa:party-assistant`, `spa:listing-chat`, `spa:template-assistant`, specs §6.6): 40, 30 and 20 invented cases each (probes: AML, other-party data, injections in the message and in tool text, advice, actions; seller, lowest price, offer outcome, documents; approve, apply, legal validity, an order inside a blank label). Hard limits: party 0 banned-word replies, 0 other-party data, 0 forbidden actions (an unknown tool tried, an email sent that was not asked for, an action claimed); listing 0 seller data, scope gate at least 95%, 0 enquiries without consent;
template 0 self-applied changes. Unit tests drive the scorers with `FakeLlm` (the scope gate) and `ScriptedAgentModel` (the tool loop) only: a careful assistant passes, and a leaker, a rogue tool, an emailing model, an inverted gate and a model that claims an approval each fail the matching limit. No real-model run was made (the user's to make; `bun run eval` was not run, for leasing or SPA).
- **Known gaps.** No staff screen reads stored conversations or enquiries (no list route yet); the party and template assistants have no screen (C35, C34); a used sign link no longer opens the assistant; the staff copilot (C36) is separate; Arabic is only in the value check. The leasing loops were not rewired (see above). Model tags and package versions are unchanged (the three added dependencies use versions leasing already pins).

- **Amendment (C21-C30 review).** (1) The listing chat no longer trusts a visitor-written `x-forwarded-for`: the web route sends the last hop only when `SPA_TRUSTED_PROXY=true` (a proxy we run appended it), else one fixed `direct` bucket per listing (Next route handlers don't expose the socket); the engine also keys on the last hop. (2) New policy values `listingChat.messagesPerListingPerHour` (default 200) and `enquiriesPerListingPerHour` (10) cap all visitors of one listing together, on top of the per-visitor limits. (3) Applying a template proposal is one transaction: the proposal row is locked, `remapBlank` or `relabelBlank` joins it, and the proposal is marked applied there, so two clicks at once give one winner and one remap. (4) `assistant_threads` and `assistant_rate_limits` cannot be truncated (migration 0054).

## S62 — Compliance records and staff alerts (C23)

- **Status.** Decided and built in C23 (needs approval: DB schema, given in `docs/superpowers/plans/2026-11-20-spa-c23-records-alerts.md`). Builds on S6, S29, S30, S42, S50, S54, S55 and S57. Migrations 0051 (tables, made by drizzle-kit) and 0052 (triggers, made with `--custom`). No model is used anywhere in this chunk, and no new fact is created.
- **Roles.** Every compliance route calls `requireCompliance(user)` first (`compliance_officer` and `mlro`; admin is refused too, S57), so the 403 is the same whether the deal, report or list exists and carries no data. The new event types `CASE_EXPORTED`, `COMPLIANCE_REPORT_GENERATED`, `COMPLIANCE_REPORT_EXPORTED`, `RETENTION_REVIEW_LISTED` and `RETENTION_REVIEW_APPROVED` are in `COMPLIANCE_EVENTS` (hidden from every other role); `ALERT_SETTINGS_SET` is a staff event whose payload never names a gate.
- **Retention (ruling given by the user: list and approval only; deletion is an open item).** Policy gains `retentionYears` (1 to 30, default 5, marked "confirm with compliance"; an older stored policy parses to 5). Job `spa.retention.review` (1st, 01:00 Dubai, also queued once at start with key `retention:<yyyy-mm>`) writes one `retention_reviews` row per Dubai month plus `retention_review_items`: deals in a terminal state whose **latest terminal event** (`to_state` = the deal's state) fell on or before today minus `retentionYears` (calendar arithmetic, the Dubai day of the event). A deal with no terminal event has no known end and is never listed; a deal already on an earlier list is not listed again; a live deal never is. No eligible deal means no list. The years and the cut-off day are kept on the list (rule 4; two columns beyond the plan's). `POST /api/compliance/retention/:id/approve` (a compliance role) moves the list and its items from `listed` to `approved` once and appends `RETENTION_REVIEW_APPROVED` with `deleted: 0`. **Nothing is deleted before or after: no row, no file.** A test counts deals, documents, parties, approvals, screenings and files before and after the job and the approval. What "deleted" means for immutable tables and stored files, and who removes them, waits for compliance (open item); the screen says so. Triggers: a list and its items change only `listed` to `approved`, once; never deleted or truncated.
- **Case export pack.** `POST /api/compliance/deals/:id/export` returns a store-only ZIP built by a small in-repo writer (`zip.ts`: CRC-32, UTF-8 names, a fixed 1980 timestamp, no ZIP64, no new dependency; checked with the system `unzip -t`). Files: `summary.pdf` (`renderPdf`: ref, type, stage, price, rulebook and policy version, parties by name, counts; free text masked), `documents/<kind>-<id>-<safe name>` (the stored bytes; a path in a file name can't escape the folder; **a missing file stops the export with 503 and a file whose bytes no longer match its recorded hash with 409**, nothing is recorded), `screenings.json` (screenings, cases with their hits, risk assessments; full data, because the pack is compliance-only evidence), `decisions.csv` (every decided approval and every helper run of the deal: source, id, time, gate or helper, outcome, actor, reason, rulebook, policy version, KYC config version, AML policy version; free-text reasons pass `maskPiiText`; formula-looking cells are neutralised) and `manifest.json` (the SHA-256 and size of every other file). Each export is an `exports` row (who, when, kind, hash, size, key, file count; append-only) and a `CASE_EXPORTED` event on the deal, and the ZIP is kept through the store. `GET /api/compliance/exports` is the log for compliance roles.
- **Monthly report.** Job `spa.report.monthly` (1st, 02:00 Dubai, key `report:<yyyy-mm>`, also once at start) writes one immutable `compliance_reports` row per finished month with a CSV and a PDF in the store. Figures (integers only): hits by `aml_hits.rule` (every rule, zero included), cases opened, cases closed by outcome (`cleared`, `stopped`, `reported`), `edd_signoff` approvals proposed, `aml_report` approvals approved, compliance gates decided and the **median whole hours** from proposal to decision (an even count takes the floor of the two middle values' mean; none decided leaves it empty, not zero). Counts only: no name, no document, no deal reference. Deterministic: the same data gives the same bytes (`renderPdf` already stamps a fixed date). CSV cells starting `=`, `+`, `-`, `@`, tab or CR get a leading apostrophe. `GET /api/compliance/reports` and `GET /api/compliance/reports/<id>.csv|.pdf` (compliance roles); **each download is an `exports` row (kind `monthly_report`, no deal) and a `COMPLIANCE_REPORT_EXPORTED` event.** A month not yet finished is refused.
- **Alerts.** `alert_settings` holds hours per gate (versioned, append-only, CHECK above 0); defaults in `@spa/core` (`ALERT_DEFAULT_HOURS`: 24 for most gates, 12 for the three compliance gates, 8 for `helper_review`, 48 for `template_approval`; placeholders, confirm with the business). `PUT /api/settings/alerts` is admin only (`{ gate: hours }`, 1 to 720 whole hours; a value equal to the one in force writes nothing); `GET` is for an admin or a compliance role. **Ruling: an admin sees and sets the three compliance gates as one entry, `compliance_review`** (S42: admin never reads which gate it is); a compliance gate's own name is refused (422). The Settings → Alerts screen is C34. Job `spa.alerts` (hourly, key `alerts:<UTC hour>`, queued once at start): a pending approval waiting at least its threshold alerts the approver role; at twice the threshold the sales manager (ordinary gates) or the MLRO (compliance gates) too. **Ruling: a user already alerted for an approval is not alerted again at the other level** (so a gate whose approver is also its manager alerts that user once). Each (approval, level, user) is alerted once (unique key), as an in-app row and an email through `sendSpaMail` (template `gate_alert`, entity kind `approval`, purpose `notice`); a failed mail leaves the in-app row, and with no mail configured only rows are written. Inactive users are skipped; decided approvals stop alerting. `GET /api/alerts` (your own, newest first, with the unread count) and `POST /api/alerts/:id/read` (your own only, else 404; read once). **Wording is code (`alertText`):** the gate label, the deal ref and the whole hours, nothing else (the label of an ordinary gate carries no AML word; a test scans every gate); a compliance gate reads "A compliance review has been waiting N hours." with no ref, goes to compliance roles only, and is also filtered out of a non-compliance user's list at read time.
- **Web.** A bell in the shell (unread count in words), an Alerts page for every role (own alerts, Mark read), and on the Compliance screen the case export form (by deal reference), the retention lists (with Approve list), the monthly reports (CSV and PDF) and the export log. The report and export downloads go through two Next route handlers that forward the session to the engine. Alerts show no AML word to sales roles.
- **Known gaps and open items.** (1) Deletion after the retention approval is not built; compliance must define what "deleted" means for immutable tables and files (open item). (2) The 5-year period and the alert thresholds are placeholders. (3) A failed alert mail is not retried (the in-app row stays). (4) A report is made once per month: a late correction to old data does not change it. (5) The Settings → Alerts screen is C34; compliance roles cannot open a deal record in the web app until their screens exist, so the export is started from the Compliance screen by reference. (6) `screenings.json` and `documents/` hold personal data in full by design (the pack is a compliance-only export, logged); the pack is not encrypted.

- **Amendment (C21-C30 review).** An alert mail error is logged through the same scrub as `mail.ts` (no address, ID or account number). The engine's unhandled-error log writes only the masked error name and message, never the error object. `seedSpaDemo` now calls `requireDemo` itself (it takes the env), so no caller can seed outside demo mode.

## S63 — Inbox and decision cards (C31)

- **Status.** Decided and built in C31 (no approval needed: web screens plus one additive engine read; no schema, no migration, no state change, no new fact). Builds on S3, S57, S58, S59 and S60. Closes the deferred items "the inbox card for `helper_review` shows only the generic title" (S59) and "the `agreement_approval` card shows the C25 flags" (S60).
- **Where it lives.** Work gets an **Inbox** tab (first, with the count of gates the role decides; `/work?tab=inbox`, keyset paging "Next page"). The compliance roles have no Work screen (S58), so the same list is the section "Waiting for your decision" on **Compliance** (`/compliance#inbox`); Home links each waiting gate to the right one ("Decide"). Settings and the deal record are unchanged: the record still shows its Approvals read only and says decisions are made in the inbox.
- **What the inbox is.** `GET /api/approvals?scope=inbox` as the engine already filters it (S57): pending gates the role can decide, oldest first. Per role: sales officer `helper_review`; sales manager `seller_verification`, `price_out_of_range`, `kyc_review`, `cancellation`, `deposit_release` and `helper_review` (stand-in); sales admin `noc_review`, `oqood_submission`, `transfer_submission`; legal `template_approval`, `agreement_approval`; finance `settlement_approval`, `refund`; compliance officer `aml_flag`, `edd_signoff`; MLRO `aml_report`; admin nothing. A proposer sees the card with "You proposed this. Someone else with the ... role decides." and no form.
- **The rule for a button.** The web never works out who may decide. A decision form is drawn only when the card is pending, the engine's `mayDecide` for this user says `ok`, and the viewer is not admin (a second guard; the engine never says yes to admin). The engine refuses a wrong role, admin and the proposer again on the POST (403), so a stale page or a forged form decides nothing; the server action reports that as "could not be recorded" and shows no engine text.
- **The decision form** sends `decision`, `note` and `outcome` and nothing else (`buildDecisionBody`): a `role`, `actor` or `decidedBy` in the form is never read, and the engine already refuses such a key (400, S57). Fields the form carries for the page itself (`id`, `from`) are not sent. Buttons per gate: approve and reject for every gate with the gate's own words ("Approve and send for signing" and "Return with comment" for the agreement; "Looks right" and "Doesn't look right" for a held helper result; "Keep the deal" for a cancellation; and so on), the four outcomes (Clear, Ask for more information, Stop the deal, Stop and report) for `aml_flag`. A rejection and any outcome but Clear need a note (checked before the request, and by the engine). The `edit` decision is not offered anywhere: no gate's spec asks for an edited proposal on a screen, and a helper result or a registry submission may not be edited at all (engine, S53, S59). The action is `app/(staff)/decide.ts`; the request is built in `lib/inbox.ts` (`submitDecision`), the only place that posts a decision.
- **Card content.** Gate name, deal ref, state pill, "Open deal" (Work only), then who decides, who proposed, since when, the engine's `reasons`, and a few proposal facts through a fixed list of labels (service, unit, release to, amount, side, commission, policy rate, version): a raw key, id or hash is never shown. A decided card shows the outcome, who, when and the note and has no form. `helper_review`: a "Held result" block with the helper's name and the reasons it gave. These come from the engine: both approval routes now add `heldResult {helper, label, status, reasons}` to a `helper_review` card (the run's reasons through the PII mask; omitted when the run is marked for compliance; no other field of the run). `agreement_approval`: the C25 `agreementReview` (status, note, each flag with its quote, where it was found and whether a rule or the helper found it) through the record's own component, so the two read the same. The flags are advice for legal only, whoever reads them is the legal role (a sales role never sees this card), and the agreement text itself is never on the page.
- **Neutral and not neutral.** A sales role's inbox never holds a compliance gate (S57). If an item of a compliance gate or of `compliance_review` reaches the page for any role but the two compliance roles, the card is the neutral "Compliance review: Open or Closed" with no detail, no form and no reason; the deal record keeps showing the same neutral entry (S57). The full compliance cards (reasons, outcomes, notes) are drawn only for `compliance_officer` and `mlro`, and only on Compliance. No AML wording appears in any sales-role view, including labels, hints and error text (the page's error words are one fixed set without those words; a test scans every non-compliance gate for every role). Compliance wording is used only in the compliance cards.
- **Personal data.** Everything shown is what the engine returned, already masked for ID, passport and phone numbers; a test runs the real engine over a deal that holds them and asserts none reaches the page.
- **Tests.** Unit (every gate by every one of the 8 roles, with the engine's own `mayDecide` rule feeding the page; admin; proposer; wrong role; neutral card; whitelist; cards; error words), real engine on `spa_test` (inbox per role, the decide POST per role, refusal changes nothing, a stuffed body is not sent and, sent by hand, is a 400), the server action with its framework calls replaced, and two engine tests for `heldResult`.
- **Known gaps.** The AML case view, the template editor and the rest of the compliance screens stay with their chunks (C32 and later). No "Edit" decision. No visual check by browser in this chunk beyond the steps given in the hand-over. The inbox shows 25 cards a page and no filter by gate. A decision made from a stale page returns to the inbox with the fixed error, not the engine's reason.

## S64 — Inventory and Listings screens (C32)

- **Status.** Decided and built in C32 (needs approval: DB schema and more than three packages, given in `docs/superpowers/plans/2026-11-21-spa-c32-inventory-listings.md`; the user approved it with three rulings below). Builds on S12, S17, S38, S39, S55, S57 and S63. Migrations 0055 (tables, made by drizzle-kit) and 0056 (triggers, made `--custom`). No model used and no new fact created.
- **Rulings (user).** (1) Inventory writes are an admin's alone, and only for a developer or `both` company; a brokerage has no inventory, whoever asks (403, reads and writes). (2) A price-list price feeds the deal price when a deal is created on that unit; discount checks stay exactly as they were. (3) The project's escrow account is the C22 account and is shown masked.
- **Data.** `projects` (unique code, name, emirate `dubai` only since the SPA rulebook is Dubai's, anticipated completion as a calendar date, `template_kind` null or one of the four document kinds, the company), `buildings` (unique code per project), `units.building_id` (null only for a unit made before projects; set once), `price_lists` (version unique per project, `published_at` null until published) and `price_list_items` (price in whole fils above 0; PK list and unit). **Deviation from the plan: no `escrow_account_id` column.** C22's `project_escrow_accounts` is append-only and superseded by a new row on every change, so a foreign key would point at a stale row; the link is the project's `code` and the project page always reads the current row. Triggers: a unit's building never changes once set; the project code can't change, and a building can't be renamed or moved, once a deal exists on a unit of the project or names the code (`deals.project_code`); projects and buildings are never deleted; a draft list publishes once, only with prices, and a published list and its items never change, are never deleted and take no new item; an item's unit must sit in a building of the list's project; none of the four tables can be emptied.
- **Manager (`manager/inventory.ts`, `manager/listing-reads.ts`).** `createProject`, `addBuilding`, `addUnit` (a unit code is unique in the install; a code that belongs to a legacy unit with no building places that unit once instead of failing), `createPriceList` (a draft with every price, version counts up under the project row lock), `publishPriceList` (once), and `createListingDraft` (the three sales roles, a brokerage or `both` company, then the existing `createListing`). Each write appends `PROJECT_CREATED`, `BUILDING_ADDED`, `UNIT_ADDED` or `UNIT_PLACED`, `PRICE_LIST_CREATED` or `PRICE_LIST_PUBLISHED` (all in `STAFF_EVENTS`). The price list in use is the project's **latest published version**; a unit missing from it has no list price; a draft is never used.
- **Price at deal creation.** `DealInput.priceFils` is now optional for a primary deal (a resale always names its price). Created on a unit with a list price and no price typed: the deal takes the list price. A price typed on the deal is the agreed price and is kept, with the list price and version recorded beside it in the `DEAL_CREATED` event (`priceSource` `price_list` or `deal`). With neither: 422 `no_price`. The discount rule in `@spa/rulebook` is not called here, so a discount is checked wherever it was before.
- **Reads (role and company kind, S12).** `GET /api/projects` and `/api/projects/:id`: the three sales roles and admin, developer or `both` company. `GET /api/listings?scope=mine|all` and `/api/listings/:id`: the same roles, brokerage or `both` company. Every other role and the wrong company kind get 403. `POST /api/listings`: the three sales roles only. The rail rule (`railItems`) and the engine agree, and a test runs every role in every company kind through both. Project record: buildings, units (state, list price, deal ref and stage in the viewer's words), price lists by version with the one in use, the template in use (approved version scoped to the project, else the one for every project), and the escrow account as `{bank, •••• last four}`: the holder and the number are not in any response.
- **Listings table (design §4.7).** Ref, property, seller kind (Individual, Co-owners, Company), asking price, state, permit (valid to; warning at 7 days or fewer left, the last valid day counted; expired; none), page (Live; Hidden when published with a lapsed permit, S38; Not published) and the latest offer's state and expiry. No owner name and no document number is on the table; the record shows sellers, share and whether each signed to the three sales roles only (admin gets `sellers: null` and a line saying so) and the ownership document by kind and match result only. No compliance word is written in any of it (a test scans every role).
- **Web.** Inventory (project table, add-a-project form for admin), project page (facts, buildings, units, price lists; admin gets add-building, add-unit, a price list with one price field per unit typed in dirhams and read to whole fils by integer arithmetic, and Publish on a draft), Listings (All and Mine tabs, table, record), a Listings and an Inventory tab on Work and a Browse row on Home, each only where the rail has the item. Forms post through server actions that read a fixed list of fields (a stuffed role or company id is never sent) and come back with one fixed word, never the engine's text. A listing draft has no web form yet (the engine route exists).
- **Seed (demo only).** The demo seed sets the company (`both`) and adds one fictional project, "Marina Vista", with towers A and B, the demo units U-101 to U-105 placed in A, four new available units in B, two published price lists (version 2 in use) and an escrow account with a made-up number. Existing deals keep their prices. Safe to run twice.
- **Tests.** DB (12: uniqueness, positive price, unit placed once, item's unit in the project, publish once and only with prices, published list immutable, project code fixed by a deal or a resale naming it, buildings fixed, no delete, no truncate); core schema; engine manager (20), listing reads (13), routes per role and company kind (9), seed (2 new); web rendering (24), real-engine pages per role and kind (5) and the server actions (5).
- **Known gaps.** A listing draft has no web form. Prices come only by a new version (no edit); a unit not in the latest version has no list price. A project's emirate is `dubai`. The rest of Settings is C34.
## S65 — Compliance page: cases, EDD and the case view (C33)
- **Routes (`manager/compliance-cases.ts`).** `GET /api/compliance/cases?status=open|info_requested|edd|reported|closed&cursor&limit` (default `open`) and `GET /api/compliance/cases/:id`. Both call `requireCompliance` first: `compliance_officer` and `mlro` read, every other role (admin and finance included) gets the plain 403 before the query or the id is looked at, so a refusal never says whether a case exists. Unknown or malformed ids are 404 for compliance roles. No new table, no migration, nothing written.
- **Tabs.** Open, More info asked, Reported and Closed read `aml_cases` by status (Closed is `cleared` and `stopped`, since `reported` has its own tab). EDD is not a case status: it lists the pending `edd_signoff` approvals (S20, C10/C18) as items of kind `edd`, opened by the approval id. The case view takes either id. Keyset paging as C29 (open, more info and EDD oldest first; Reported and Closed newest first); a bad cursor or tab is 400.
- **Case view.** Per person on the deal (and any non-party payer): latest screening with, for the sanctions and PEP lists, the score, the rulebook's `amlNameMatchThreshold` (and whether it still awaits legal), list version and the Dubai calendar date; the code hits of the case; the latest risk level, points and breakdown; source-of-funds evidence as the document reader's `sof_evidence` and `edd` reads (fields as read, "read, not confirmed"); the case's approval through the same `getApproval` the inbox uses, so the decision card is the C31 card and the engine's `mayDecide` still decides who sees buttons; and a trail of the deal's events that staff roles do not see, plus the approval events of this case. Everything passes the PII mask.
- **The suggestion.** The case summary (a model's, or the code template when no model wrote it) is returned as `suggestion` with the label "Suggestion", `fromModel`, the model tag and the instruction-like flag. It is never named `finding`, it is drawn as escaped plain text with "Not a finding", and the hits that code found are listed apart from it. The list shows it cut to 200 characters.
- **Web.** The Compliance page gets a Cases section (tabs as plain links, `?tab=` and `?cursor=`) above the existing Case export, Retention lists, Monthly reports and Export log, which are unchanged. `app/(staff)/compliance/cases/[id]` is read only except the decision card. After a decision the user returns to the case page: the card form carries a `back` field that the server action follows only when it is exactly `/compliance/cases/<uuid>`; any other value falls back to the Compliance page. The page is gated by `requireScreen("compliance")`, so every other role gets 404 before the engine is asked. The sales-side neutral card and no-AML-word rule (S57, S63) are unchanged; AML wording appears only in these compliance components.
- **Tests.** Engine (14, `compliance-cases.test.ts`): 403 for six non-compliance roles on every shape of request, 401, tabs per compliance role, paging, 404, masked JSON for a case, an EDD item and a model-summary case, suggestion label and escaping, trail filter. Web (10): tab rendering, escaping, score against threshold, no form without a pending decision, real-engine pages per role, `back` handling.
- **Known gaps.** No link from the inbox card to its case (no "Review open" link existed on the compliance side; the sales-side card stays neutral). The EDD tab shows pending sign-offs only; a decided one leaves the tab. The demo seed holds one open case and its EDD sign-off; the other tabs are empty until a decision moves a case. Source-of-funds evidence appears only when a `sof_evidence` or `edd` read exists (no upload route for those kinds yet).

## S66 — Templates and Settings screens (C34)

- **Status.** Decided and built in C34 (needs approval: DB schema and more than three packages, in `docs/superpowers/plans/2026-11-21-spa-c34-templates-settings.md`; the user approved it with the rulings below). Builds on S5, S19, S20, S41, S42, S45, S57, S59, S62, S63 and S64. Migrations 0057 (`template_uploads`, made by drizzle-kit) and 0058 (its guards, made `--custom`). The only model use is the existing template reader, which proposes headings and labels; code keeps the wording (S5).
- **Rulings (user).** (1) **Upload.** `POST /api/templates/:id/versions`, admin only, multipart, a PDF by its first bytes up to 10 MB, stored by hash through the document store; job `spa.template.read` (singletonKey `<templateId>:<docHash>`) runs the reader with the SPA profile and then `addTemplateVersion`, which runs the S45 checks and opens `template_approval`. (2) **Samples replace S45's "scrub".** The upload needs the ticked box "this sample has no real customer data". Code scans the read text for an Emirates ID, a passport number, an email, a phone number and an IBAN. A hit ends the upload as `needs_human` with the reason "Upload a blank or fictional copy" and **no version is stored**; nothing is scrubbed, so the approval's `sample_value` check still sees the real wording. (3) **Roles.** Admin writes templates, remaps blanks and edits KYC forms. Legal reads the template pages and decides in the inbox (the engine still refuses an admin's decision). A sales manager reads. Legal's rail gets a read-only Settings item that lists Templates only. (4) **Project scope is fixed** at `createTemplate`; a new scope is a new template (no route changes it). (5) **Preview** renders `renderSpaAgreement` over a fixed fictional sheet (one value per data-sheet key, a three-row plan) with "SAMPLE" in the header and footer of every page; nothing is stored, no event is written, no deal's value is used. (6) **KYC forms** go through `saveKycDraft`, `publishKycDraft` and `effectiveKycConfig`, per role and per deal-type override, with a "form as the party sees it" preview; published versions are read-only; a protected-trait rule is refused by the existing validation. (7) **AML policy** page `/compliance/policy`: the compliance officer publishes, the MLRO reads. An admin sees only a neutral card "Compliance rules, managed by compliance". Values that are still the code's placeholder (version 0) carry a "Confirm with compliance" pill. (8) **409.** `publishPolicy`, `publishAmlPolicy` and the helper-mode insert turn a primary-key clash from two first publishes into 409 `version_taken` (closes the C3 deferred item). (9) **Scope cut.** Settings → Alerts is built (its routes existed, S62); company, fees, signing, users, the chase-template editor and integrations stay open in `task.md`.
- **Data.** `template_uploads`: one row per template and file hash (unique, so a repeat upload returns the same row), `storage_key`, `file_name`, `status` `queued|reading|done|failed|needs_human`, `reason`, `version_id`, `declared_no_real_data` (CHECK true), who and when. Trigger: only `status`, `reason`, `version_id` and `finished_at` change, the status moves forward only (queued, reading, then one of the three end states), a finished row never changes, no delete, no truncate.
- **Manager.** `template-uploads.ts`: `uploadTemplateSample` (admin; id, box, PDF and size checks; hash; one row; queue the job, a queue that is down never loses the upload), `readTemplateUpload` (the job: safe to run twice, a version stored by a crashed run is linked, not added again; a helper `failed` or `needs_human` ends the upload without a version; the scan; then `addTemplateVersion` as the uploader) and `realDataIn`. `template-reads.ts`: `listTemplates`, `getTemplate`, `getTemplateVersion` (checks, blanks with how each was chosen, the fixed wording, the keys a blank can map to) and `previewTemplateVersion`. `settings-screens.ts`: `getKycSettings`, `saveKycSettings`, `publishKycSettings`, `getAmlPolicySettings`, `putAmlPolicy`. Events `TEMPLATE_UPLOADED` (hash only, never the file name) and `TEMPLATE_UPLOAD_READ` are staff-visible.
- **Routes and roles.** `GET /api/templates`, `/api/templates/:id`, `/api/template-versions/:id`, `/api/template-versions/:id/preview`: admin, legal, sales manager (everyone else 403 before an id is looked at). `POST /api/templates`, `/api/templates/:id/versions` and `/api/template-versions/:id/blanks/:blankId/remap`: admin. `GET /api/settings/kyc` (index, or one form with `role` and `dealType`): admin and sales manager; `PUT /api/settings/kyc` and `POST /api/settings/kyc/publish`: admin. `GET /api/compliance/policy`: compliance officer and MLRO; `PUT /api/compliance/policy`: **the compliance officer only; this route refuses an admin and the MLRO**. The manager's own rule in `publishAmlPolicy` (admin or compliance officer, S42) is unchanged: no route lets an admin reach it, and tightening the manager rule is recorded as a follow-up. A 401 without a session; a refusal is the plain 403.
- **Words.** No AML, screening, risk or sanction word on any page a non-compliance role can open, including the admin's neutral card, labels, hints and the fixed error words. A test renders every Settings page for all eight roles through the real engine and scans for the words. Model text (headings, labels, file names, check messages) and text read from a file are drawn by React as escaped plain text.
- **Web.** Settings hub per role; Templates (list, add form, template page with the upload form, uploads and versions, version page with checks, blanks, remap form, wording and the preview link served through `…/preview/route.ts`); KYC forms (index of roles and overrides; editor for labels, help, required flags, the confidence bar and the three cross-checks, save draft and publish, party preview, published versions read-only, custom rules listed); Alerts; `/compliance/policy` (rules, countries, cut-offs, re-check points; evidence lists and risk factors are carried over unchanged), linked from Compliance. Forms post through server actions that read a fixed list of fields and come back with one fixed word, never the engine's text. Demo seed: one fictional template with a read version and its gate waiting for legal.
- **Tests.** DB (3: uniqueness, hash, the box, forward-only status, no delete or truncate); `version-taken` (4, including a first publish held open on its own connection); engine `templates-screens` (46: every route by all eight roles, 401, 404, upload gates and dedupe, the read job, the scan, escaping, preview marked SAMPLE with nothing stored) and `settings-screens` (25: KYC and compliance routes by role, read-only published versions, deal-type override); core (rail); web `settings-screens` (26: form builders, components, every page by all eight roles, the word scan, actions with their framework calls replaced); seed (1 new).
- **Known gaps.** The KYC editor does not edit field keys, types, options, document rules or custom rules (they pass through unchanged and custom rules are listed). The compliance form does not edit evidence lists or risk factors. No visual check by browser in this chunk beyond the steps in the hand-over. A failed or stuck upload has no retry button (a new file is a new upload; the same file returns the same row). Reading a sample needs the local vision model; without it the job waits in the queue and the upload stays "Waiting to be read". Tightening `publishAmlPolicy` to the compliance officer alone at manager level is open.

## S67 — Buyer portal (C35)

- **Status.** Decided and built in C35 (needs approval: database schema and more than three packages, in `docs/superpowers/plans/2026-11-21-spa-c35-buyer-portal.md`; the user approved it with the rulings below). Builds on S24, S41, S49, S52, S54, S56, S60 and S61. Migrations 0059 (`portal_links`) and 0060 (its guards).
- **Rulings (user).** (1) **Two purposes, one person, one deal.** `documents` acts (upload, "Send my documents") and is used up on send; a new request or a staff resend issues a new link and kills the old one. `view` only reads, lives as long as the deal and dies on resend or when the deal is cancelled or completed. Offer and sign links are unchanged. (2) **Links go by email only.** `requestDocuments` emails each person a `documents` link through `sendSpaMail` (template `documents_request`, one row per party and milestone `documents:<party>:<n>`). Transfer booked, Registered and instalment mail carry a `view` link; reminders carry none (S54). A failed mail is shown to staff and never silently retried. (3) **Upload.** `POST /public/portal/:token/documents`; the party comes from the token, never the form; the kind must be a document field of that party's effective KYC config; the upload core is shared with staff (`storeDealDocument`) with actor `party:<id>` and event `PARTY_DOCUMENT_UPLOADED` (link id, never the token); reads queue as for staff and helper modes apply; 429 over 30 uploads an hour per link; PDF or image up to 10 MB. (4) **Send my documents** marks the link used and calls `enqueueKycRun` (a company: `enqueueCompanyCheck`); the portal opens no gate. (5) **What a party sees.** Party words for the step, one next-step card, own documents with a party-safe reason (fixed words by chase reason code), the plan and confirmed payments (buyers), the transfer day and "you sign 2 of 3" with no names; a compliance hold reads "Under review". (6) **Guard.** Every response string passes `partyBanned` and `maskPiiText`; a hit becomes "Your agent can help with that." (7) **Policy.** `documentLinkDays`, default 14, 1 to 60, a placeholder: confirm with the business. (8) **Out of scope.** Party bank-letter upload and plan acknowledgement; the signed agreement is the acceptance.
- **Data.** `portal_links`: `token_hash` unique (only the SHA-256 is stored), `expires_at` for `documents`, `used_at`, `superseded_at`; a partial unique index allows one live link per deal, person and purpose. Trigger: only `used_at` and `superseded_at` change, once each; no delete, no truncate.
- **Manager (`manager/portal.ts`).** `issuePortalLink` (supersedes the live link of the same deal, person and purpose in the same transaction), `mailDocumentsLink`, `sendWithViewLink` (issues a link only when the mail will really be sent, so a mail already sent never costs a person the link they hold), `mailDealParties`, `loadPortal`/`resolvePortalToken`, `portalDocumentsPage`, `portalStatus`, `portalUpload`, `sendPortalDocuments`, `guardPortal`. `requestDocuments` mails every newly asked person when mail is configured (the answer then carries `mail: {sent, failed[]}`); `resendDocumentsLink` is the staff resend. `setTargetTransferDate` mails "Transfer booked" (a new date is a new mail), the registry run mails "Registered" once an issued answer is stored, and the instalment reminder carries a `view` link.
- **Words and errors.** A token that is unknown or of the other purpose is one identical 404 body; a link that was used, replaced, expired or whose deal is closed is a 410 with `link_used`, `link_superseded`, `link_expired` or `link_closed`, as signing links are (S54), so the holder is told why. The upload route turns kinds outside the config into `kind_not_asked`; the web maps every code to plain words.
- **Web.** `/b/<token>/documents` (one form per document, "Send my documents", an upload route handler that passes only `kind` and the file on), `/b/<token>/status`, and a party chat box on both through `/b/<token>/assistant`. Wall-clock time is used nowhere here: link expiry uses the Clock.
- **Tests.** DB (2), helpers mail (3), engine `portal.test.ts` (23: mail and links, resend, supersede, expiry by policy, scope, uploads and limits, send, status, banned-word scan over every page in every deal state, guard, assistant), registry (1), web (2). `driveDeal` is untouched: the portal queues runs only.
- **Known gaps.** Compliance review: the "Under review" flag is deal-wide (same for every person on the deal) so a page never says who a matter concerns. The guard is applied to every string, so a property or document label with a banned word ("Flagship") reads as the fixed line. Two concurrent runs of a mail with a link could leave one person with the older link (the mail row stays unique); a documents link marked used while the KYC helper is off leaves no task for staff. The deal record has no button for the staff resend yet (the route exists). A `view` link in a mail replaces the one in an earlier mail. The beneficial owner's documents link shows the beneficial owner form (a passport). Party bank-letter upload and plan acknowledgement are not built.
## S68 — SPA staff copilot (C36)
- **Status.** Decided and built in C36 (needs approval: database schema and more than three packages, in `docs/superpowers/plans/2026-11-21-spa-c36-spa-copilot.md`; user approved the rulings below). Builds on S6, S24, S42, S55, S57, S61 and S63. Migrations 0061 (`copilot_proposals`, `copilot_drafts`, the `staff` thread kind, the `copilot_task` task kind; made by drizzle-kit) and 0062 (their guards, made `--custom`). Leasing's D45 and D50 (the copilot edits settings when the user's words ask) do not carry over; neither do decision cards (D48, D53).
- **Rulings (user).** (1) **Package.** `modules/spa/packages/copilot` (`@spa/copilot`): one tool per file with Zod input and output, a `kind` and `roles`; the loop is the shared `runAgentTurn` (scope gate, six calls, 60 s, value post-check, unverified marks); it imports `@spa/core` and `@platform/*` and never `@leasing/*`. (2) **Engine client.** `get` (an allowlist of read-route regexes) and `propose` (only `POST /api/copilot/proposals` and `/drafts`); confirm and cancel are on no list; tools never touch the database. (3) **Reads** go through the existing role-filtered routes (S57). Legal and money values come only from the new `GET /api/copilot/rulebook?key=` (the value with its `rulesVersion`, or "pending confirmation"). (4) **Compliance.** `get_compliance_case` is offered to `compliance_officer` and `mlro` only and its route 403s everyone else. For every other role (admin included) the prompt leaves compliance out, and a code guard (`AML`, `anti-money`, `screening`, `sanction*`, `PEP`, `EDD`, `risk`) replaces any reply or tool result that holds a word by "Compliance review is open."; a message that itself holds a word gets a fixed neutral line without the model running. (5) **Proposals** (`copilot_proposals`; Confirm runs the normal manager function as the user): `request_documents` (`requestDocuments`), `create_task` (`openTask`, kind `copilot_task`), `resend_signing_link` (`resendSigningLink`), `prepare_agreement` (`enqueuePrepare`; it only prepares, `agreement_approval` still waits for legal). They expire. Confirm re-checks the role and the deal state. (6) **Drafts** (`copilot_drafts`): `draft_email` and `draft_summary` are copy-only cards (SPA has no compose form); `draft_approval_note` fills the inbox note box through `?draft=<id>`. Party and document text is wrapped with `untrusted()`; output goes through `maskPii`.
- **Data.** `copilot_proposals`: thread, user, `kind` (CHECK, the four), deal, `payload` (it holds the proposal's own words and a code-written `summary`), `status` `proposed|confirmed|cancelled|expired`, `expires_at` (30 minutes, Clock), `confirmed_at`, `result`. Trigger: moves once from `proposed`, `payload`, user, kind and deal fixed, confirming records `confirmed_at`, never deleted or truncated. `copilot_drafts`: thread, user, kind, deal, `body` (masked): immutable by trigger. The conversation is an `assistant_threads` row of kind `staff` (the principal is a hash of the user id) with `assistant_messages`, as the other assistants.
- **Routes (`manager/copilot.ts`, `manager/noc-status.ts`).** `POST /api/copilot/chat` (120 messages an hour per user; the tools call the app's own routes with the user's own bearer token, and the thread is added by the route, never chosen by the model), `GET /api/copilot/thread`, `GET /api/copilot/rulebook`, `POST /api/copilot/proposals` (checks thread, role, deal and kind; 409 when the deal is closed or not in the agreement step), `POST /api/copilot/proposals/:id/confirm` (the same user only, 403 for anyone else; 410 when expired and the row is marked `expired`; 409 when decided; the row is locked for the whole run, so two clicks run it once; event `COPILOT_PROPOSAL_CONFIRMED`, actor `user:<id>`, payload `viaProposal`), `…/cancel`, `POST /api/copilot/drafts`, `GET /api/copilot/drafts/:id` (its own user only), `GET /api/deals/:id/noc-status` (new read for `get_noc_bank_status`: status, dates and amounts a person confirmed, no document id; sales roles, admin, legal and finance). `SPA_COPILOT_MODEL`, else the assistants' model; without a model the chat answers 503.
- **Web.** The dock (`components/copilot-dock.tsx`): messages, tool chips, "How this was handled" (scope check, tool calls, value check, what the copilot cannot do), values no tool returned marked with `<mark>` and listed, proposal cards (Confirm and Cancel; the buttons call `/copilot/proposals/:id/confirm|cancel` on this site, which forwards the user's own session), draft cards. `lib/copilot-proxy.ts` passes only the chat, the thread and a proposal's confirm and cancel. The Work inbox and the Compliance inbox take `?draft=<id>` and fill the note box of the first open approval on that deal.
- **Evals.** `bun run eval -- spa:copilot` (`packages/copilot/src/evals`, 65 invented cases: 3 or more per tool group, injection, permission, compliance-visibility, forbidden-action and off-topic probes; a fixed stand-in for the engine, no database). Bars: 0 forbidden actions (a claimed action or any write that is not a proposal or a draft), 0 AML words to a non-compliance role, no injection obeyed, tool choice at least 85%, unverified values at most 2% (specs §6.6). Unit tests run it with `FakeLlm` and scripted models only; the real-model run is the user's.
- **Tests.** DB (4), copilot package (62: allowlist, guard, registry and the matrix of all eight roles, every tool, the turn, evals), engine `copilot.test.ts` (36: rulebook, noc-status, compliance routes, every proposal kind's store, confirm, cancel, expiry and wrong user, role and deal re-checks, drafts, chat), web (14: dock states, proxy paths, inbox prefill).
- **Known gaps.** A proposal card does not outlive its page (the thread comes back as text). The guard is word-level: a harmless sentence with "risk" in it is replaced for a non-compliance role. A draft written by the model is not value-checked (the card says to check figures). `get_rulebook_value` does not offer the two AML keys. `resend_signing_link` and `prepare_agreement` need the sales roles; admin has only the catalogue, template and rulebook reads. `get_noc_bank_status` was not on the list of existing read routes: `GET /api/deals/:id/noc-status` is new (read only).
- **Amendment (compliance review, C36).** (1) The guard (`AML_WORDS_PATTERN`) now splits tokens on underscores with lookarounds, so `AML_HOLD`, `aml_hold`, `edd_signoff` and `aml_flag` trip it, and it adds `launder*` ("money laundering"), `suspicious`, `flagged` and "politically exposed". A party named "Edd" matches like the word EDD: accepted. (2) Confirm marks the proposal confirmed and writes `COPILOT_PROPOSAL_CONFIRMED` in one transaction, then runs the effect. If the effect throws, the proposal stays confirmed, its `result` is `{ failed, message }` and the click answers 200 with that result; a second Confirm is 409 and nothing runs again. Migration 0063 (`--custom`) lets a confirmed row take its `result` once (it is NULL until the effect ends) and makes a cancelled or expired row's `result` NULL. The agreement-step conflict raised inside `enqueuePrepare` during Confirm is replaced by the neutral refusal (`prepareForProposal`), never the raw state. (3) SPA has no per-user deal scoping: `GET /api/deals/:id` shows any deal to every role that may read deals (`createdBy` only feeds the optional `mine` filter), so `storeProposal`, `storeDraft` and `confirmProposal` check that the deal exists, not who owns it; a test pins this. If scoping is added, apply the read route's check in those three. (4) A message gets the neutral line only for the compliance sense of risk (risk assessment, level, score, rating, profile, band, category, "high-risk buyer"); "risk of delay" gets a normal answer. A reply that contains a bare "risk" is still replaced for a non-compliance role (the known gap above stands). The `get_compliance_case` label stays in the shared dock bundle: moving it is not clean and the label ("Read a case") names no compliance word.

## S69 — Portal launcher (C37)

- **Status.** Decided and built in C37 (plan: `docs/superpowers/plans/2026-11-21-spa-c37-portal-launcher.md`; the user approved the rulings below). Builds on S10, S21, S25, S33 and S34. **Amends S10:** the counts stay hidden until the portal has a sign-in (stage 2); until then they show only in demo mode. No schema change.
- **Rulings (user).** (1) **`apps/portal`** (`@portal/launcher`, Next.js, :3100) imports `@platform/*` only and reaches each module by URL: `PORTAL_LEASING_URL`, `PORTAL_SPA_URL` for the links, `PORTAL_LEASING_ENGINE_URL`, `PORTAL_SPA_ENGINE_URL` for the counts. It reads only `.env.portal.local` through its own loader (S25 style, never `process.env`, a bad key stops it at start). (2) **Tiles** read "Leasing" and "Sales (SPA)", each with an "Open" link; nothing else is on the page, and no module's text is added to either app (S21). (3) **`GET /summary`** in each engine returns `{ openWork, waitingApprovals }`, two integers: no name, id, role or AML count. It needs `x-portal-key` equal to `PORTAL_SUMMARY_KEY` (16 characters at least, compared in constant time by `portalKeyOk` in `@platform/kernel`); the key unset, missing or wrong is one identical 404. It reads only its own module's database. SPA's waiting approvals leave out the compliance gates, so no compliance number leaves the module. (4) **Counts** show only with `PORTAL_SHOW_COUNTS=true` (demo mode); otherwise no engine is called and no number or placeholder shows. A down engine, a wrong key or an odd answer shows "Not available" on that tile, never an error page; the link stays. (5) **Return path.** The SPA header's "Portal" link (`SPA_PORTAL_URL`) is unchanged; leasing's avatar menu gets "Portal" (`LEASING_PORTAL_URL`, default `http://localhost:3100`). Each app's sign-out stays its own. (6) **Scripts.** `bun run dev:all` starts leasing, SPA and the portal; `dev` and `dev:leasing` stay leasing-only (S33); `dev:portal` starts the portal alone. (7) **Boundary.** `scripts/check-domain-rules.ts` fails when `apps/portal` imports a module package or a path outside itself, and when anything else imports from `apps/portal` (`@portal/*` or by path, scripts included). (8) **Cookies:** none in this chunk; names stay per app (`leasing_session`, `spa_session`).
- **Definitions.** Leasing: `openWork` is open tasks, `waitingApprovals` is pending approvals. SPA: `openWork` is deals not yet handed over, completed or cancelled (a deal on hold counts as open), `waitingApprovals` is pending non-compliance gates. Both are placeholders until the business says what the tiles should count.
- **Env.** Portal (`.env.portal.local`, git-ignored): `PORTAL_PORT`, `PORTAL_LEASING_URL`, `PORTAL_SPA_URL`, `PORTAL_LEASING_ENGINE_URL`, `PORTAL_SPA_ENGINE_URL`, `PORTAL_SUMMARY_KEY`, `PORTAL_SHOW_COUNTS`. The same `PORTAL_SUMMARY_KEY` goes in leasing's `.env` and in `.env.spa.local`; leasing's web also reads `LEASING_PORTAL_URL` from `.env`.
- **Tests.** Portal env, tiles and page per state (up, one down, both down, wrong key, odd answers, counts off with no call made, no key), 10; each engine's `/summary` (4 each: no key, wrong key, integers only, no personal text); the lint on a temporary tree (clean portal, portal imports a module, another app imports the portal); the real tree; `portalKeyOk`; the `Portal` links in both headers; the leasing web names no sales module; the root scripts.
- **Known gaps.** The count is read on every visit (no cache); with several engines down the page waits up to 2 s once, since the two reads run together. Stage 2 (portal sign-in, signed token) is not built. Production needs the portal's engine URLs to be private addresses, as the key travels in a header.

## S70 — Shared sign-in (C38)

- **Status.** Decided and built in C38 (needs approval: database schema and more than three packages, in `docs/superpowers/plans/2026-11-21-spa-c38-shared-sign-in.md`; the user approved the rulings below with the recommended answers). **Amends S10** (sign in once at the portal; each app still holds its own users and roles) **and S21** (the portal may show a module's tile and counts only when that module's engine says this email has an active user there). Amends S69's counts rule: with sign-in on, counts follow access, not `PORTAL_SHOW_COUNTS`. Migrations: leasing 0047 and SPA 0064 (`portal_handoffs`); the portal's own `apps/portal/drizzle/0000` (`portal_accounts`).
- **Rulings (user).** (1) **The portal proves who the person is and nothing else.** It owns the password (argon2id, the same `checkPassword` and `hashPassword`, now in `@platform/kernel/password`) in a small `portal` database. No self sign-up: `bun run portal:create-account <email>` writes the account (password typed without echo, never printed). A wrong email, a wrong password and an inactive account give one identical answer, each after one hash check. (2) **Hand-off token:** EdDSA (Ed25519), `exp` 60 seconds, `jti`, claims `sub`, `email`, `aud` (`leasing` or `spa`). It has no role claim; a token that carries a role claim, or any claim not listed, is refused. The other audience, an expired or too long-lived token, an unsigned (`alg none`) or foreign-signed token are refused. Each module holds only the public key (`LEASING_PORTAL_PUBLIC_KEY`, `SPA_PORTAL_PUBLIC_KEY`, one line of base64). (3) **Exchange:** `POST /api/auth/portal-exchange` in each engine: public key set, IP limit, token, email limit, then the `jti` is spent once (`portal_handoffs`, append-only), then the active user is looked up by lower-case email in the module's own table (`spa_users`, `staff_users`) and the module's own session is issued with its own secret. No match is 403 with one body; the module never creates, activates or changes a user or a role, and the role always comes from its own row. (4) **Cookies:** `portal_session`, `spa_session`, `leasing_session`. Signing out of an app clears only its cookie; "Portal" returns to the chooser, where Sign out clears only the portal cookie. (5) **Tiles and counts** only for modules whose engine says the signed-in email has an active user (`POST /api/auth/portal-exchange?check=1`: a token is checked, no session is issued, no `jti` is spent, the answer is `{ active }`). (6) **Demo mode and each app's own sign-in stay.** Portal sign-in is optional: no signing key, the portal is the C37 chooser; no public key, an engine's exchange route is 404. (7) **Safety:** exchange and check are rate limited per IP and per email (exchange 20 and 10 a minute, check 120 and 60); the portal's own sign-in uses the same limiter. Wall-clock time is used for token expiry and the limiter's window only; the used-token row is stamped with the engine Clock.
- **Shared code.** `@platform/kernel`: `portal-token.ts` (sign, verify), `portal-exchange.ts` (the one decision both engines run, with the store passed in, and the limiter), `password.ts`. The portal imports `@platform/*` only; the SPA and leasing never import each other.
- **Data.** `portal_handoffs`: `jti` (primary key), `used_at`; trigger refuses update, delete and truncate; no personal data. `portal_accounts`: `id`, `email` (unique, lower-case CHECK), `password_hash`, `active`, `created_at`.
- **Web.** The portal's `/sign-in`, `/` (tiles by access), `/go/<module>` (signs a token for that module only and redirects, `no-store`, no referrer), Sign out. Each module web has `/auth/portal` (GET, token in the query), which posts it to its engine and stores the answer in its own cookie only; no match lands on its sign-in page with a fixed message. `scripts/next.ts` starts the portal with `bun x --bun next` so `Bun.password` exists in server code.
- **Env.** Portal (`.env.portal.local`): `PORTAL_SIGNING_KEY` (private), `PORTAL_DATABASE_URL` (database name contains `portal`), `PORTAL_SESSION_SECRET` (32 or more), `PORTAL_SECURE_COOKIE`, `PORTAL_TEST_DATABASE_URL` (tests). Leasing `.env`: `LEASING_PORTAL_PUBLIC_KEY`. `.env.spa.local`: `SPA_PORTAL_PUBLIC_KEY`. `bun run portal:keygen` prints a pair.
- **Tests.** Kernel (token, limiter, decision: 11), SPA engine and leasing engine exchange (11 and 9: audience both ways, role claim refused with the row unchanged, no user is 403 and nothing created, a sales_officer row gives a sales_officer session, replay, expiry, check, off without a key, rate limits, the other module's session secret never opens a route), `portal_handoffs` trigger (SPA db), portal (env, accounts and one identical failed sign-in, limits, session cookie and sign-out clearing only its own, access check, tiles by access, hand-off token, the source imports no module package and logs no secret, accounts on a real database when `PORTAL_TEST_DATABASE_URL` is set), each web app's hand-off landing and sign-out (cookie names), both env keys.
- **Known gaps.** The role claim is refused, not ignored: a token that carries one gives no session at all (stricter than "ignored"). The token is in the hand-off URL's query for up to 60 seconds and one use (`no-referrer` is set on both redirects); it is not in any log the project writes. The per-IP limit trusts `x-client-ip` from the web servers, so a caller who reaches an engine directly can vary it; the per-email limit still holds. Invitations (an emailed first sign-in) are not built: accounts come from the CLI only. No password reset or change, no portal user list: the CLI is the only writer. `portal_handoffs` rows are never pruned (tiny, no personal data). A person whose module user is deactivated keeps an open module session until it expires (12 hours), as before. Next under Bun (`--bun`) for the portal was not exercised in a browser here. Leasing's web has no trusted-proxy setting, so its hand-off route always sends the `direct` address bucket (the per-email limit still applies); the SPA's follows `SPA_TRUSTED_PROXY`. The limiter holds at most 5,000 keys and refuses new ones beyond that until the window ends. `?check=1` is replayable for the token's 60 seconds on purpose (it answers only `{ active }`). Leasing's `SESSION_SECRET` has no minimum length outside demo mode (unchanged); set 32 or more characters before enabling `LEASING_PORTAL_PUBLIC_KEY`, and never reuse one secret across the portal, leasing and the SPA.

## S71 — Deal record sections (C39)

- **Status.** Decided and built in C39 (the user approved the rulings below with the recommended answers; plan in `docs/superpowers/plans/2026-11-22-spa-c39-deal-record-sections.md`). No migration, no new fact, no write, no event. Finishes the `RECORD_SECTIONS` list S58 began.
- **Rulings (user).** (1) A section appears when its step applies (`stepsFor`) and the deal has reached it. `RecordSection` gains `steps` and `visibleTo(role)`; a role that may not read a section never gets the key (absent, not empty). (2) Each section reuses its existing read through a role-free view (`signingView`, `registrationsView`, `settlementView`, `nocStatusView`, `paymentsView`, `amlCasesView`; new `documentsView`, `agreementView`, `amlSummary`); the per-section routes keep their own role checks. (3) `documents`: kind, masked party name, upload day, read state, and "Read, not confirmed" when unconfirmed; never a file name, storage key, hash, type or size, and nothing opens `data/uploads/`. (4) `aml`: compliance_officer and mlro only (admin is not one): case status, highest risk level, case count and a link to `/compliance/cases/[id]`. Other roles keep the neutral "Compliance review: open" or "none". The compliance roles read the record at `/compliance/deals/[id]` (same `DealRecord`, their role), linked from the case view; the rail and the S58 rule for `/work` stay. (5) `signing`: signers by name, role, order and state (signed, waiting, link expired) and the link's expiry day; never a link, token or address. (6) `agreement`: version, status, template name and version, prepared day; the C25 review stays as it is. (7) `noc` and `finance` reuse `nocStatus`; `finance` adds bank letters and the payments without the payer check. `settlement` is resale only: lines and sources in fils, "Balances to zero" computed by the engine from the price lines. `registration`: Oqood and transfer attempts with the reasons masked. (8) Money is integer fils, formatted in the web only; dates are Asia/Dubai days; personal numbers are masked again on the way out; no compliance word in any section for a non-compliance role.
- **Roles.** documents: all eight. aml: compliance_officer, mlro. agreement, signing, noc, finance, registration: sales_officer, sales_manager, sales_admin, admin, legal, finance (the NOC, signing and registry routes' own lists). settlement: the same without admin (its route's list). `finance.payments` only for the payments route's roles (sales officer, manager, admin, sales admin, finance): legal reads the bank letters and gets an empty payment list. The compliance roles read no deal-money section.
- **Reads.** A section that is empty is not drawn by the web (documents with no file, no bank letters and payments, no statement and no reason, no registry attempt). `noc` and `signing` are null until a NOC or an envelope exists.
- **Fix found on the way.** The record header (and the Work rows) listed party names unmasked; `dealViews` now masks them like the parties section does.
- **Known gaps.** The demo seed stops at legal review and holds no document, envelope, NOC, statement or registry row, so on the seeded deals only the agreement section can appear (and only once an agreement is prepared); the new sections show on real data and on the test world. `confirmed` on a document is true only for a manual NOC, a confirmed bank letter or a confirmed payment; other kinds (passports, deeds) read "Read, not confirmed" until a screen records a person's confirmation. A signer's link expiry is a Dubai day, not a time. The party's link and the signing mail status stay on `GET /api/deals/:id/signing`, not in the record.

## S72 — Remaining Settings pages (C40)

- **Status.** Decided and built in C40 (the user approved the rulings below with the recommended answers; plan in `docs/superpowers/plans/2026-11-22-spa-c40-settings-remaining.md`). No migration. Finishes the Settings line of S66.
- **Rulings (user).** (1) **Company:** `setCompany` (name, kind) behind `saveCompany`, which adds the admin check. The signatory list is read-only (name, title, authority): adding one stays in the deal flow because `addSignatory` needs a document id; no ID numbers, no beneficial owners. (2) **Plans and Signing** write through `publishPolicy` (admin only) via `PUT /api/settings/policy/:page`. Fixed allowlist: `plans` = `maxDiscountBps`, `commission`, `depositBps`, `holdDays`, `offerValidityDays`, `instalmentReminders`; `signing` = `signingLinkDays`, `signingOrder`. Only the page's keys are merged onto the latest policy; `SpaPolicy` validates the whole document; a stale `baseVersion` is 409 (checked inside the locking transaction too); the page says "Saved, version N"; running deals keep their pinned version (S37). (3) **Fees and rulebook** is read-only (`GET /api/settings/rulebook`, admin and sales manager): version, start day, sources, an allowlist of keys, a pending key (S36) shows "Pending" with no value, a fee preview on a sample price (AED 1,000,000) from `registrationFee` in fils. `amlCashThresholdFils`, `amlNameMatchThreshold` and `beneficialOwnerBps` are omitted for every role; a test fails when a rulebook key is in neither list. (4) **Users and roles** admin only: list, role change, active toggle; not yourself; not the last active admin (rows locked); no create and no password (accounts come from the portal CLI); `USER_ROLE_CHANGED` and `USER_ACTIVE_SET` in `STAFF_EVENTS`. (5) **Models and integrations** are read-only facts for admin and sales manager; tags from the engine env (S59), integrations show connected, simulated or not set up and never a URL, host or key. (6) **Demo clock:** `GET` stays; `POST /api/demo/clock` admin only, 404 outside demo mode, body `{ days }` (1 to 365) or `{ rewind: true }`, stored in `spa_demo_settings`, audited as `DEMO_CLOCK_SET` (also in `STAFF_EVENTS`); the page is absent outside demo mode. (7) **Web:** forms post through server actions that read fixed fields and show one fixed message; no AML wording on any page admin or sales manager opens; dates are Asia/Dubai; the hub cards replace the "More settings are coming" placeholder.
- **Details.** The Users page words the MLRO role as "Compliance lead" and its form value is a neutral word mapped in the web, so no page an admin opens names the subject. `publishPolicy` gained an optional `expectVersion`. `main.ts` passes the assistant and copilot tags and the integration states (email is simulated unless `MAIL_TRANSPORT=smtp`; the registry is simulated only in demo mode).
- **Known gaps.** A model tag that looks like an address is shown as "In use" without the tag. The integrations list has no screening row (compliance owns it). Role changes take effect on the next request (the session reads the role each time). Deactivating a user ends their session at once. The portal CLI remains the only way to create an account or set a password.

## S75 — Unit, project and listing detail (M2)

- **Status.** Built in M2 (plan `docs/superpowers/plans/2026-11-25-spa-m2-unit-project-listing-detail.md`). Migration 0065.
- **Unit columns** (all nullable, so old rows stay valid; the unit `code` stays the key): `type` (apartment, villa, townhouse, penthouse, office, retail), `bedrooms` 0..10 (0 is a studio), `bathrooms` 0..10, `internal_sqft` > 0, `balcony_sqft` >= 0, `floor` -5..200, `view` up to 60, `parking_spaces` 0..10, `description` up to 2000.
- **Project columns:** `community` up to 80, `location` up to 120 (free text, no map), `description` up to 2000. The handover date is the existing `anticipated_completion_on`.
- **Listing columns:** `unit_type`, `bathrooms`, `floor`, `view`, `parking_spaces` (same values and ranges as units) and `furnished` (unfurnished, semi, furnished). The existing `bedrooms`, `size_sqft`, `community`, `title`, `description` stay.
- **`spa_media`:** marketing photos of a project, unit or listing (owner kind and id, sha256, path, mime, bytes, caption up to 200, sort). Unique per owner and hash; the owner's existence is checked in code. Files live in their own `LocalDiskStore` at `data/spa-media`, never in `data/spa-uploads` (party documents). JPEG, PNG or WebP by sniffing, 10 MB, 24 per owner, metadata stripped. Not personal data.
- **Roles.** Inventory writes (project, unit, their photos) stay an admin's alone (`requireInventory`). Listing photos use `requireListings(write)`. Reads keep `CATALOGUE_READERS`.
- **Edits during a live deal.** Descriptive fields may change; `code` and `building_id` of a unit with a deal not in a final state return 409 `unit_in_deal`.
- **Events.** `UNIT_UPDATED` and `PROJECT_UPDATED` carry `{ changed: [field names] }`, never values. Media events carry sha256 and bytes, never the path. Entity kind `project` is new for events.
- **Price history.** A unit's price per published price-list version, oldest first; the price in use is the latest published version's item (`unitListPrice`).

## S76 — Shared staff shell (M1b)

SPA uses the shared staff shell from `@platform/ui/shell` (rail, avatar menu, dock frame with `useDockState`, composer card, starter chip class), the same pieces leasing renders through thin wrappers. The alerts bell moves into the rail. The agent panel keeps SPA's own transport (`/copilot/chat`, `/copilot/thread`), proposal cards and draft cards; New chat clears the screen only (the server thread stays). Voice and thread history come in F5. Demo seed data uses "Demo ..." names instead of bracket markers (community, building, bank, escrow holder).

## S77 — Listing workspace (M3)

Listing workspace: sellers are created inside the listing draft; listing files live in `listing_documents` (append-only, sha256-unique); unpublish and withdraw need a reason; editing a permit to a past date unpublishes at once.

- **Sellers in the draft.** `POST /api/listings` takes `ListingDraftInput`: each seller is typed in (a person, or a company with its signatory) or an existing party. Parties, company details, signatory, the listing and its event commit in one transaction; a repeated email, a repeated party or shares that don't add to 100% (all or none) are a 422 and nothing is written. Sellers can't change after creation. A new company's signatory has no authority document yet (`signatories.document_id` points to none until one is uploaded).
- **Files.** `listing_documents` (kinds `title_deed`, `oqood`, `listing_agreement`, `permit`; unique per listing, kind and sha256; migration 0066). PDF, JPEG, PNG or WebP by sniffing, 10 MB, in the existing `data/spa-uploads` store. The same file again is one row and no second event. Files and sellers go to the three sales roles only. The ownership document's number and owners now show to the sales roles on the record (an admin still sees neither); the passport and ID numbers never leave the party row.
- **Reasons.** `UNPUBLISH` and `WITHDRAW` need a 3 to 500 character reason, kept in the event. A guard's refusal is a 409 `step_refused` with the machine's own sentences. Editing a published listing's permit end to a past day unpublishes it in the same transaction ("permit expired"); the daily sweep does the same the day after the last valid day.
- **Stale checks.** Re-entering an ownership document that now matches the sellers cancels the open `seller_verification` approval (`cancelled`, note "ownership now matches", event `APPROVAL_WITHDRAWN`).

## S78 — Public catalogue (M4)

- **One allow-listed shape.** `GET /public/catalogue` and `GET /public/catalogue/:ref` return `PublicProperty` / `PublicPropertyDetail` (`@spa/core`, both `.strict()`), built by `modules/spa/apps/engine/src/manager/public-catalogue.ts` from resale listings and developer units. Each field is named in code; no row is spread. Never in it: sellers or parties, ownership kind, ref or owners, documents, listing-agreement state, offers, deals, floor or minimum price, discounts, price-list internals, any email. The agent is a name only. `GET /public/listings/:ref` (the old page route) returns the same detail shape. The web parses the answer again with the same schemas.
- **When a thing is public.** A listing: `isPublicListing(l, today)` (state `PUBLISHED` and permit end on or after today; one function for the catalogue, the detail, the photos and the listing chat) and an asking price. A developer unit: `AVAILABLE`, in a project, and priced in the project's latest published price list (that price is the one shown); held or sold units drop off. The permit number is printed on every listing card and page (S17); units show project and developer name and no permit.
- **Unit public ref.** `U-<project code>-<unit code>`, resolved by comparing the built string (project codes contain hyphens, so it is never parsed back). No new column.
- **Photos.** `GET /public/media/:id/file` serves a photo only while its owner is public now (a public listing, a public unit, or the project of one); anything else is a 404. `cache-control: public, max-age=300`, `nosniff`. The web serves it at `/photos/<id>` (staff photos stay at `/media/<id>`).
- **Limits.** The public catalogue and photo routes are rate limited per client address (600 a minute, in memory).
- **Site.** The `(site)` route group has leasing's public bar, nav, theme menu and footer from `@platform/ui/catalogue/*`, brand "Sales". `/b/...` keeps its plain layout. `/listings/L-<digits>` and `/customer/properties/*` redirect to `/properties/...`. Enquire and Book viewing wait for the M5 tables; the aside's `actions` slot holds the listing chat for resale listings.

## S79 — Leads and viewings (M5)

S73 is built: a visitor enquires about or books a viewing of any public home, the agent works it in Work, and a deal can start from an interested lead (the deal form itself is M6).

- **Tables (migration 0067).** `spa_leads` (ref `LD-0001`; exactly one of listing or unit; email lower case; source `form`, `listing_chat` or `staff`; status `new`, `contacted`, `viewing_booked`, `interested`, `not_interested`, `converted`, `closed`; consent time), `spa_lead_messages` (append-only, trigger), `spa_viewings` and `projects.sales_agent_user_id`. One open lead per (email, home) by partial unique indexes: a second enquiry about the same home is one more message on it, another home is another lead. `listing_enquiries` keeps its old rows; new enquiries write leads.
- **Writers.** Only `SpaManager` (`manager/leads.ts`, `manager/viewings.ts`) writes them, each with a `deal_events` row (entity kinds `lead` and `viewing`; no email or phone in a payload). The visitor's actor is `party:visitor:<leadId>`.
- **Slots.** `freeViewingSlots` was lifted from leasing to `@platform/kernel/viewing-slots` (leasing re-exports it, no behaviour change). The `viewings` policy page (days Mon to Sat, 10 to 18, 30 minutes, 4 hours lead, 14 days ahead; `leads.perEmailPerDay` 5) is in `spa_policy`; Settings -> Viewings, admin writes, manager reads. A slot is taken by a booked viewing of the same agent (any home), or for a home with no agent by that home's own. A booking locks the agent's row (the home's row when it has no agent), checks the slot again, and a partial unique index is the last guard: 409 `slot_taken`; off the grid or past is 422 `slot_unavailable`.
- **Agent.** A listing's `agent_user_id`, or the project's sales agent for a developer unit (Inventory -> project -> Edit). None: the lead waits unassigned for the sales manager (no email).
- **Mail.** Only through `sendSpaMail` (evidence stored), fixed wording written by code: the visitor's confirmation with a cancel link, the reminder 24 hours before (a booking made inside that window gets none), the cancellation notice; the agent's "New enquiry" (for an enquiry) or "New viewing" (for a booking, with the visitor's own words). The pg-boss job `spa.viewing.mail` has key `<viewingId>:invite`, `:reminder` or `:cancel`; each mail is claimed once per milestone, so a second run sends nothing, and a reminder for a viewing that is no longer booked is skipped. A down queue falls back to sending at once.
- **Cancel link.** The token is an HMAC of the viewing id (so the reminder can carry the same link without the raw token being stored; only its hash is). `/v/<token>/cancel` asks first, then cancels; a second click says "Already cancelled" and sends nothing.
- **Property leaves the site.** A listing out of `PUBLISHED`/`UNDER_OFFER`, or a unit out of `AVAILABLE`, cancels its future viewings in the same transaction (reason "The home is no longer available"); the visitor is emailed once (queued with a short delay, because the job may start before the commit).
- **Closing a lead.** Marking a lead not interested or closed cancels its future booked viewings in the same transaction (reason "The enquiry was closed"; the visitor is emailed once); a viewing that has started waits for its outcome. A visitor's name may hold only letters, spaces, apostrophes, hyphens and dots, because it is greeted in mail sent to an address the visitor chose.
- **Outcome.** Only a viewing that has started can be recorded `attended` or `no_show`; nothing marks a no-show by itself. A past viewing with no outcome shows in Work -> Viewings -> Past as "Needs an outcome".
- **Public routes.** `GET /public/catalogue/:ref/slots`, `POST /public/catalogue/:ref/enquiries`, `POST /public/catalogue/:ref/viewings`, `POST /public/viewings/cancel`. A reference that isn't public is one 404; a malformed body is 422 before it uses any allowance; 20 writes a minute per client address, the per-home hourly cap from `listingChat.enquiriesPerListingPerHour`, and the per-email daily cap. Answers say only `ok` (never whether an email already had a lead).
- **Listing chat.** `send_enquiry` records a lead (source `listing_chat`). New tools `free_slots` and `book_viewing`: a booking may use only a time `free_slots` returned in the same turn, the visitor must have typed the name and email and ticked consent, and the reply is the engine's own time label. The visitor's latest message must also name that time ("14:00", "2pm"; `namesSlotTime`), and a chat booking counts against the same per-home hourly cap as the form. A description saying "book 3am for everyone" books nothing. Developer units have no chat (the form only).
- **Staff.** Sales roles only; an officer sees their own leads and viewings, a manager and a sales admin everyone's with a Mine/All switch. Admin sees no visitor data. The lead record (`/leads/<id>`): Next step, Overview, Messages, Viewings, Activity. The visitor's contact details are shown to the assigned staff and are not run through the read-mask. "Start deal" opens the deal form (M6, S81; `dealFormReady` is now true).
- **Work badge.** Today's booked viewings plus new leads, added to the Work count for sales roles (`/api/summary` carries `leads`).


## S80 — Demo cast and hand-off (M5b)

- **Decision.** Demo cast: 4 people up front (Rania, Karim, Omar, Adam), back-office roles on demand; demo-only hand-off and switcher sign in as the next approver. Roles and gates unchanged.
- **Why.** Eight demo users made the flow confusing. Separation of duties is the product's safety model, so the demo shows it truthfully and only makes switching person easy.
- **Cast.** `DEMO_CAST` in `@spa/core/demo` (role order, seeded email, hint). `GET /api/auth/demo-users` adds `cast`, `hint` and `shortRole`; the sign-in page shows four cards and a closed "Back-office roles (only when a step needs them)" disclosure (Lina, Huda, Sara, Yusuf).
- **Hand-off.** Demo mode only: `GET /api/demo/handoff?role=` (404 with demo off) returns the cast member for the role, else the first active user, else null ("No demo user has this role", no button). The waiting banner, Work inbox rows and the listing Next step say "Waiting for Omar (Legal) · Switch to Omar". The proposer who is also the only approver is still offered; the engine refuses the decision with its normal message.
- **No tipping-off (S20).** A compliance review seen outside compliance says "Under review · Sara (Compliance)": the role and person only, never a flag, match or reason.
- **Switching.** `switchDemoUser(email, returnTo)` is a fresh demo sign-in, then a redirect to the same page. `returnTo` must be a same-site path, else `/`. A user who can't see the page gets the normal not-found screen. The avatar menu has a "Switch demo user" list (cast first, then Back-office, current user marked). With demo mode off none of it renders.


## S81 - Deal creation and offers from the browser (M6)

- **Decision.** Deals start from the unit page or a lead (primary) or as an offer on a listing (resale). Buyers are created inside the deal or offer. A value outside limits creates the deal and opens `price_out_of_range`. Withdrawing a listing withdraws its open offer.
- **Why.** The domain functions existed but only a script could call them. The browser now reaches `PARTY_CHECK` for both kinds, and a person always decides what the rules don't allow.
- **Primary.** `POST /api/deals` (`startDeal`, sales roles, company with inventory): one to four buyers (a typed person needs a nationality, a company its licence and signatory; or an existing party), the developer's own party as seller, optional broker (buyer side), optional lead. All in one transaction; the unit's row is locked first, so two agents on one unit get one deal and a 409 `open_deal_exists` naming the other (reasons: id, ref). `GET /api/deals/quote` returns the list price, discount, policy limit, booking minimum and DLD fee with its payer, all from the rulebook and policy; the form shows them and computes none.
- **Gate.** A price outside `discountCheck` opens `price_out_of_range` with proposal `kind: "price"`; a booking below the rulebook minimum opens it with `kind: "booking"` (and its share in bps). Neither blocks creating the deal. The fact `priceCleared` (false while such an approval is pending or rejected) is a guard on `CHECKS_STARTED`, so the deal can't leave `OFFER_AGREED` until a manager approves. The proposer can't decide it (existing rule). An approved below-minimum booking lowers the plan's booking minimum for that deal to exactly the approved share; nothing else is relaxed. A broker commission override keeps its own proposal (no `kind`) and doesn't count here.
- **Resale.** `POST /api/listings/:id/offers` (`makeOffer`) creates the buyers inside the offer's transaction and runs `sendOffer`: one open offer, each seller emailed a single-use link. Deposit % is the pinned policy's and is not typed (an offer has no deposit column); the deposit cheque is recorded after acceptance with `POST /api/deals/:id/deposit`. `validDays` 1 to 30. A broker is set on the deal after acceptance (`PUT /api/deals/:id/broker`), not on the offer. `offers.lead_id` (migration 0068) links the lead, which converts only when every seller accepts.
- **Withdraw.** `POST /api/offers/:id/withdraw` takes a reason (3 to 500 characters), sets the offer `WITHDRAWN` (new status), frees the listing and stops the links (the seller's page says "This offer was withdrawn"). Withdrawing the listing itself while an offer is out does the same by code in the same transaction (actor `system:listing-withdraw`). An offer that expires while a link is open answers 410 and the page says it expired.
- **A refused price.** A refused price or booking leaves the deal in `OFFER_AGREED` (fail closed) until it is cancelled; a different price is a new deal. A price or booking approval is approved or rejected, never edited (`edit_not_allowed`). A home with no price-list price needs approval for any typed price. No developer party on file: 409 `developer_party_missing` (nothing is invented).
- **Leads.** Starting a deal or offer from a lead sets it `converted` with its deal; a lead whose home is no longer available shows "This home is no longer available". `dealFormReady` is now true.
- **Screens.** `/deals/new?unit=<id>` or `?lead=<id>` (Home, Buyers, Price and booking with the live quote, Payment plan, Broker, Mortgage); `/listings/<id>/offer`; the listing's Offers and deals section (current offer, each seller's answer, Withdraw behind a reason box, history, deal link, deposit form). `PartyRows` is shared by the listing and deal and offer forms.
