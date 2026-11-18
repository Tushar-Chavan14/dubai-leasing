# SPA decisions

Short records of choices already made for the SPA (Sale and Purchase Agreement) module. Leasing
decisions stay in `docs/decisions.md` (D1, D2, …). SPA decisions use their own numbers (S1, S2, …)
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
  (`@leasing/kernel`, `@leasing/llm`, `@leasing/adapters`, the shared parts of
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
| Engine | `apps/engine` :4000 | `spa/apps/engine` :4001 |
| Staff web | `apps/web` :3000 | `spa/apps/web` :3001 |
| Registry mock | `apps/ejari-mock` :4100 | `spa/apps/oqood-mock` :4101 |
| Session cookie | `leasing_session` | `spa_session` |

- One module can be migrated, reset (`spa:demo:reset`) or taken down without touching the other.
- Same as D2 (pg-boss, `singletonKey`) and D3 (`Clock`), each in its own database.
- Root scripts: `dev:leasing`, `dev:spa`, `dev:portal`, and `dev` runs all of them.
  `bun run dev` keeps leasing on its current ports so the README demo steps don't change.

## S3 — SPA has its own approvals table, gates and roles

- **Table.** `spa_approvals` in the `spa` database. Never the leasing `approvals` table. The SPA
  inbox lives in `spa/apps/web`; leasing keeps its own inbox.
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
- Generic building blocks move to a new `packages/kernel` (`@leasing/kernel`): `Clock`, money,
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
  `requestId` so retries are safe. `spa/apps/oqood-mock` returns realistic rejections and is labelled
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
  appointment and returns a new title-deed number. Both are mocked in `spa/apps/oqood-mock`
  (renamed in docs as the "registry mock"), labelled simulated, same retry rules as S8.
- `transfer_submission` (sales admin) gates every transfer.

## S17 — Listings need an advertising permit; an optional public page

- **Why.** The user chose: after a listing is ready, record the DLD advertising permit and optionally
  publish a listing page; no lead or viewing management in the MVP.
- **Decision.** A listing stores the permit number, issue and expiry dates. States: `DRAFT → VERIFIED
  (agreement signed, ownership matched) → ACTIVE (valid permit) → PUBLISHED → UNDER_OFFER → SOLD`;
  `WITHDRAWN`. A daily job unpublishes a listing whose permit expired. The public page (in `spa/apps/web`,
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
  (`apps/web/lib/design/tokens.ts`, `components/ui/*`), moved in P2 into a shared domain-free `@leasing/ui`
  package that both apps import. The staff shell is the leasing rail · main · copilot dock; "Portal" and
  "Sign out" live in the avatar menu (refines S21's header). Older mockups and artifacts are illustrations only;
  where they differ, design.md wins. Changes to design.md need a new S-decision.

## S32 — How the P1 kernel split was made, and what still reaches leasing code

- **Why.** P1 (S1, S4, S19) moved the domain-free code into `@leasing/kernel` without changing leasing. A few
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
  leasing types; `@leasing/llm` lists `@leasing/core` as a dependency without using it; the KYC reader's code checks
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
- **Shared UI (S31).** `@leasing/ui` holds tokens, `theme.css` (palette, dark variant, `@theme`, `@source` for its
  own components) and `base.css`; each app imports `base.css` from its root layout so its CSS output is unchanged.
- **Open (before any client pilot):** sign-in has no rate limit or lockout yet; the session cookie is `secure` only
  outside demo mode. Emails are stored lower case (database check) and matched in any case.
