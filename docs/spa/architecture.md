# SPA architecture

The SPA module runs the sale of a property — primary (developer) or resale (individual or company owner) — from listing or booking to transfer and handover. What and why: `docs/spa/specs.md`. Decisions: `docs/spa/decisions.md`.
Tasks: `docs/spa/task.md`. Domain knowledge: `.claude/skills/dubai-sales-spa/SKILL.md`.
Mockup of every screen: `docs/spa/mockup.html`.

## 1. Principles (same as leasing, applied to a separate runtime)

1. **Deterministic core, AI at the edges.** `SpaManager` is plain TypeScript. Models read
   documents, classify and draft. They never decide a legal or money value, and never raise or
   clear an AML flag.
2. **One writer.** Only `SpaManager` changes `deals`, `listings`, `units` and `instalments`. Helpers and adapters return data.
3. **People approve.** Every legal or money commitment passes a gate in `spa_approvals`.
4. **Durable time.** pg-boss in the `spa` database, "now" from the SPA `Clock`.
5. **Audit.** Every transition, helper run and decision is an append-only `deal_events` row.
6. **Separate runtime** (S2). Nothing at runtime is shared with leasing.

## 2. System context

```
                        apps/portal :3100  (module launcher, later sign-in, S10)
                         │                         │
            leasing ─────┘                         └───── SPA
  apps/web :3000 → apps/engine :4000          spa/apps/web :3001 → spa/apps/engine :4001
        │                 │                         │                    │
   DB leasing      ejari-mock :4100            DB spa             oqood-mock :4101
                                                                  screening (fake adapter)
                                                                  Ollama (shared server, local)
                                                                  SMTP (own MAIL_FROM)
```

Ollama is one local server; both engines call it through `@leasing/llm` with their own
model tags and their own `ModelGate` concurrency limits.

## 3. Folders and packages

```
spa/
  apps/
    engine/        @spa/engine   Hono API + SpaManager + pg-boss jobs + demo seed/clock
    web/           @spa/web      Next.js staff app + buyer portal (/b/<token>/…)
    oqood-mock/    @spa/oqood-mock  simulated registry: Oqood register/transfer + trustee transfer (Hono)
  packages/
    core/          @spa/core     Deal/Unit/Listing state machines, spaGates, SpaRole, Zod schemas, data-sheet keys
    rulebook/      @spa/rulebook versioned sales rules per emirate + pure functions (fees, plans, AML thresholds)
    db/            @spa/db       Drizzle schema + migrations for the `spa` database (own drizzle.config.ts)
    helpers/       @spa/helpers  ownership-check, spa-kyc, company-check, aml-screening, document-reader, spa-template, spa-prepare, agreement-review, registry, settlement, chaser, collections
    copilot/       @spa/copilot  SPA staff copilot (read / draft / propose tools)
packages/          shared (S1/S4)
    kernel/        @leasing/kernel  Clock, dates, money, ids, maskPii, Helper contract, defineMachine, defineGates, Actor, KYC form model
    llm/ adapters/ helpers (shared parts by subpath: @leasing/helpers/runner, /kyc, /contract-structure; each takes a profile, S32)
```

Root `package.json` workspaces: `apps/*`, `packages/*`, `spa/apps/*`, `spa/packages/*`.

## 4. Entities and state machines

### Company, inventory and listings (S12)

`companies.kind`: `developer` | `brokerage` | `both`. Developers keep **inventory**
(`projects`, `buildings`, `units`, `price_lists`). Brokerages keep **listings** (`listings`: one
property, its seller parties, ownership document, asking price, listing agreement). A deal points to
a unit or a listing, never both.

Unit: `AVAILABLE → HELD → SOLD → REGISTERED → HANDED_OVER`; `HELD → AVAILABLE` on cancel or hold expiry.
Listing (S17): `DRAFT → VERIFIED → ACTIVE (valid permit) → PUBLISHED → UNDER_OFFER → SOLD`; `WITHDRAWN`.
Offer (S18): `SENT → ACCEPTED | REJECTED | EXPIRED`; one open offer per listing; accepting creates the deal.

### Deal (one per sale, S13)

`deal_type`: `primary_offplan` | `resale_ready` | `resale_offplan`; flags `seller_mortgage`, `buyer_mortgage`.

```
OFFER_AGREED ─▶ PARTY_CHECK ⇄ AML_HOLD ─▶ AGREEMENT_DRAFT ─▶ LEGAL_REVIEW ─▶ SIGNING ─┐
                                                                                    │
  primary_offplan:  ─▶ REGISTRATION ─▶ INSTALMENTS ─▶ HANDED_OVER                    │
  resale_ready:     ─▶ NOC ─▶ FINANCE* ─▶ SETTLEMENT ─▶ TRANSFER ─▶ COMPLETED        ◀┘
  resale_offplan:   ─▶ NOC ─▶ FINANCE* ─▶ SETTLEMENT ─▶ TRANSFER ─▶ INSTALMENTS** ─▶ HANDED_OVER
  * only with a mortgage flag (guard)   ** only when a plan is taken over (guard)
  any open state ─▶ CANCELLED (gate cancellation)
```

| From | Event | To | Gate / guard |
|---|---|---|---|
| — | `OFFER_ACCEPTED` | `OFFER_AGREED` | primary: booking amount recorded, unit `AVAILABLE`, discount in policy or `price_out_of_range` approved; resale: listing `ACTIVE` |
| `OFFER_AGREED` | `CHECKS_STARTED` | `PARTY_CHECK` | documents requested from every party |
| `PARTY_CHECK` | `CHECKS_PASSED` | `AGREEMENT_DRAFT` | KYC ok (or `kyc_review`), company checks ok (or `seller_verification`), no open AML flag |
| `PARTY_CHECK` | `AML_FLAGGED` | `AML_HOLD` | code rule in `aml-screening` |
| `AML_HOLD` | `AML_CLEARED` | `PARTY_CHECK` | `aml_flag` decided "clear" |
| `AML_HOLD` | `AML_STOPPED` | `CANCELLED` | `aml_flag` decided "stop" / "report" |
| `AGREEMENT_DRAFT` | `PREPARED` | `LEGAL_REVIEW` | every core field filled from the approved template of the right `document_kind` |
| `LEGAL_REVIEW` | `APPROVED` / `RETURNED` | `SIGNING` / `AGREEMENT_DRAFT` | `agreement_approval` (legal) |
| `SIGNING` | `ALL_SIGNED` | `REGISTRATION` or `NOC` | every signer; resale: security deposit recorded |
| `NOC` | `NOC_OK` | `FINANCE` or `SETTLEMENT` | NOC read and matched (or `noc_review`); FINANCE only with a mortgage flag |
| `FINANCE` | `FINANCE_OK` | `SETTLEMENT` | required bank letters uploaded and amounts confirmed by a person |
| `SETTLEMENT` | `SETTLED` | `TRANSFER` | `settlement_approval` (finance); statement balances to zero |
| `TRANSFER` | `TRANSFERRED` | `COMPLETED` / `INSTALMENTS` | `transfer_submission`, then title deed or Oqood transfer issued |
| `REGISTRATION` | `REGISTERED` | `INSTALMENTS` | `oqood_submission`, then Oqood number issued |
| `INSTALMENTS` | `HANDOVER` | `HANDED_OVER` | all instalments paid, handover recorded |

### Parties (S14)

`deal_parties` (role `buyer` | `seller` | `broker`, `order`, `share`, `party_id`). `parties` are a person or a
company; a company has `company_details` (licence no., expiry), `signatories` (with POA / board-resolution
document) and `beneficial_owners` (each a person party). Every owner on the ownership document is a seller party.

## 5. Gates (`spa_approvals`)

| Gate | When | Approver |
|---|---|---|
| `seller_verification` | ownership, co-owner or company-signatory mismatch | `sales_manager` |
| `price_out_of_range` | primary discount or price outside policy | `sales_manager` |
| `kyc_review` | document unreadable, expired or names don't match | `sales_manager` |
| `aml_flag` | any warning sign on any party, company or beneficial owner | `compliance_officer` |
| `aml_report` | officer chose "stop and report" | `mlro` |
| `template_approval` | new template version (any `document_kind`) | `legal` |
| `agreement_approval` | every prepared SPA, MOU, assignment or listing agreement | `legal` |
| `noc_review` | NOC mismatch, or expires before the target transfer date | `sales_admin` |
| `settlement_approval` | every resale settlement statement | `finance` |
| `oqood_submission` | every primary registration | `sales_admin` |
| `transfer_submission` | every resale transfer | `sales_admin` |
| `cancellation` | cancelling a deal after `OFFER_AGREED` | `sales_manager` |
| `deposit_release` | deposit cheque on a cancelled resale | `sales_manager` |
| `edd_signoff` | risk level high (after EDD documents) | `compliance_officer` |
| `helper_review` | an `ok` result of a helper in review mode (S22) | `sales_officer` / `sales_manager` |
| `refund` | any refund | `finance` |

Nobody approves their own proposal. `admin` approves nothing.

## 6. Rulebook (`@spa/rulebook`)

```ts
interface SalesRulebook {
  version: string;                    // "dubai-sales-2026-01"
  emirate: Emirate;
  effectiveFrom: CalendarDate;
  registrationFeeBps: number;         // 400 = 4% (primary registration and resale transfer; confirm with legal)
  registrationFeePayer: "buyer" | "seller" | "split";
  oqoodAdminFeeFils: number;
  oqoodTransferFeeFils: number;
  trusteeFeeFils: number;             // per transfer, by price band if needed
  mortgageRegistrationBps: number;    // e.g. 25 = 0.25% of the loan (confirm)
  mortgageRegistrationAdminFils: number;
  minBookingBps: number;              // primary
  amlCashThresholdFils: number;
  amlNameMatchThreshold: number;      // 0..1, code only
  beneficialOwnerBps: number;         // 2500 = 25% (confirm with compliance)
  sources: readonly string[];
}
```

Pure functions: `registrationFee`, `transferFees`, `validatePlan`, `discountCheck`, `amlRules`,
`settlementStatement(deal, confirmedLetters, rb, policy)` (balances to zero or returns reasons).
Company policy (`spa_policy`): discount limits, commission defaults per side, deposit %, hold days,
reminder days, signing order per deal type, developer NOC rules per project (minimum paid %, validity).

## 7. Helpers

Full behaviour of every helper and assistant: `docs/spa/specs.md` §6.

| Helper | Model | Code decides | Output | Mode (S22) |
|---|---|---|---|---|
| `ownership-check` | vision | owners, shares, property numbers vs listing | matched / `seller_verification` | auto · review |
| `spa-kyc` | vision (shared KYC reader, SPA profile) | role KYC config checks | pass / `kyc_review` / blocker email | auto · review |
| `company-check` | vision | licence, signatory power, owners ≥ threshold | pass / `seller_verification` | auto · review |
| `aml-screening` | chat (summary only) | matching, rules, risk level, EDD needs | clean / `aml_flag` / `edd_signoff` | fixed |
| `document-reader` | vision (profiles incl. `payment_receipt`, S26) | names, unit, dates, validity; amounts "read, not confirmed" | match / `noc_review` / confirm task | auto · review |
| `spa-template` | chat + decision | wording copy, blanks, blocks, checks | version → `template_approval` | — |
| `spa-prepare` | none | fill, repeat blocks, sources, hash | → `LEGAL_REVIEW` | auto · review |
| `agreement-review` | chat | quote guard | flags on the legal card | — |
| `registry` | decision | one safe fix, request ids | number issued / task | auto · review |
| `settlement` | none | statement balances to zero | → `settlement_approval` | fixed |
| `chaser` | none | schedule, fixed templates (S23) | emails, agent task | fixed |
| `collections` | none | instalment reminders | emails, tasks | fixed |

Assistants (S24): staff copilot (`@spa/copilot`), party portal assistant, listing page chat, template assistant —
each a LangGraph tool loop with a scope gate, Zod tools and an answer post-check.

All run through the shared `runHelper` (validate → run → validate → retry once → `needs_human`).

### Templates: the uploaded structure is the output structure (S5)

```
upload (PDF/DOCX) ─▶ spa-template helper
   ├─ code: copy wording verbatim, sections + numbering, tables, header/footer/logo, fonts, margins
   ├─ code: blanks + placeholders  {purchaser_name} [unit_no] <price> ___ ....
   ├─ code: party blocks  SELLER | PURCHASER (repeatable) | BROKER
   ├─ code: signature blocks with role + page anchor
   ├─ code → model: map blanks to SPA data-sheet keys (descriptions only, no values)
   └─ code checks: sample values, DLD/RERA marks, fee % vs rulebook, missing core keys
review screen (admin) ─▶ gate template_approval (legal) ─▶ approved version
```

SPA data-sheet keys (aliases accepted, see `@spa/core` `spaDataSheet`):

| Group | Keys |
|---|---|
| Buyer (per buyer) | `purchaser_name`, `purchaser_nationality`, `purchaser_passport_no`, `purchaser_eid_no`, `purchaser_address`, `purchaser_email`, `purchaser_phone`, `purchaser_share` |
| Seller (per seller, or the developer) | `seller_name`, `seller_id_no`, `seller_share`, `seller_licence_no`, `seller_address`, `seller_signatory_name`, `seller_signatory_title` |
| Broker | `broker_agency`, `broker_orn`, `broker_agent_name`, `broker_brn`, `broker_commission` |
| Unit | `project_name`, `building`, `unit_no`, `floor`, `unit_type`, `area_sqft`, `parking`, `plot_no` |
| Money | `price`, `price_words`, `discount`, `dld_fee`, `oqood_fee`, `booking_amount` |
| Plan | `payment_plan` (table), `instalment_n_amount`, `instalment_n_due` |
| Resale | `title_deed_no`, `oqood_no`, `noc_ref`, `deposit_amount`, `transfer_date`, `seller_bank`, `buyer_bank`, `loan_amount`, `settlement_table` |
| Dates and law | `agreement_date`, `anticipated_completion`, `governing_law`, `dispute_body` |
| Other | `additional_terms`, `booking_ref` |

Core keys (parties, unit, price, plan, fees) never print empty: prepare stops instead.

## 8. Data model (`spa` database)

`spa_users`, `companies` (with `kind`), `project_escrow_accounts`, `alerts`, `alert_settings`, `exports`, `retention_reviews`, deals.`in_default`, `spa_helper_settings` (helper, mode, enabled), `chase_templates`, `chases`, `assistant_threads`, `assistant_messages`, `listing_permits`, `offers`, `deposits`, `spa_kyc_configs` (role, deal type, version, form, rules), `spa_aml_policy` (version, rules, sof evidence, risk scoring, EDD, re-screen points), `risk_assessments`, `company_signatories`, `projects`, `buildings`, `units`, `price_lists`,
`price_list_items`, `listings`, `listing_parties`, `parties`, `company_details`, `signatories`,
`beneficial_owners`, `deals` (type, mortgage flags, unit or listing), `deal_parties`, `documents`
(kind: id, licence, title_deed, oqood, noc, liability_letter, release_letter, pre_approval, final_offer, …),
`document_reads` (parsed fields, `confirmed_by` for amounts), `kyc_runs`, `aml_cases`, `aml_hits`,
`spa_templates` (family, name, `document_kind`, projects), `spa_template_versions` (sections, blanks,
party_blocks, signature_blocks, look, status), `agreements` (deal, kind, version, hash, field_sources),
`signing_envelopes`, `signatures`, `settlements` (lines, status), `registrations` (oqood register /
transfer, trustee transfer, request id, result), `payment_plans`, `instalments`, `payments`, `deposits`,
`spa_approvals`, `deal_events` (append-only), `helper_runs`, `outbound_messages`, `deadlines`,
`spa_rulebooks`, `spa_policy`, `spa_demo_settings`, `copilot_threads`, `copilot_messages`.

## 9. Scheduling

pg-boss in `spa`. Jobs: `spa.kyc.run`, `spa.company.check`, `spa.ownership.check`, `spa.aml.screen`, `spa.document.read`, `spa.template.read`, `spa.prepare`,
`spa.signing.remind` (48 h), `spa.oqood.submit`, `spa.transfer.submit`, `spa.noc.expiry` (warn 7 days before), `spa.instalment.remind` (T−14, T−3, T+1),
`spa.hold.expire`, `spa.listing.expire`, `spa.permit.expire` (unpublish), `spa.offer.expire`, `spa.aml.rescreen`, `spa.chase` (S23), `spa.default.check` (S27), `spa.alerts` (S30), `spa.retention.review` (S29), `spa.report.monthly` (S29). `singletonKey = "<dealId>:<milestone>"`.

## 10. Channels

Outbound only by email (shared mail adapter, SPA templates, SPA `MAIL_FROM`). Buyers and sellers act through
single-use portal links (`/b/<token>/…`): upload documents, accept the plan, sign, see instalments.

## 11. Environment (`.env.spa.local`, S25)

SPA apps read only `.env.spa.local` (template: `.env.spa.example`, committed). Keys: `SPA_DATABASE_URL`,
`SPA_TEST_DATABASE_URL`, `SPA_ENGINE_PORT=4001`, `SPA_WEB_PORT=3001`, `SPA_DEMO_MODE`, `OLLAMA_URL`,
`SPA_CHAT_MODEL`, `SPA_VISION_MODEL`, `SPA_DECISION_MODEL`, `SPA_COPILOT_MODEL`, `SPA_ASSISTANT_MODEL`,
timeouts, `REGISTRY_MOCK_URL=http://localhost:4101`, `SCREENING_ADAPTER=fake`, `SPA_SESSION_COOKIE=spa_session`,
SMTP and `SPA_MAIL_FROM`, `SPA_DOCUMENTS_DIR`, `SPA_UPLOADS_DIR`, `SPA_MEDIA_DIR`. Parsed with Zod at start;
missing required keys stop the app. Loaded by `loadSpaEnv` (`@spa/core/env`), which reads the file itself and
never `process.env`. P2 adds `SPA_SESSION_SECRET` (required only outside demo mode) and `SPA_PORTAL_URL` (S33).

## 12. KYC and AML configuration (S19, S20)

```
spa_kyc_configs (versioned)                         spa_aml_policy (versioned)
  role: buyer_person | seller_person |                rules[]: id, on, severity, threshold
        company_party | beneficial_owner              sofEvidence: source → document kinds + checks
  dealType?: override per deal type                   risk: points per rule/factor, cut-offs low/med/high
  form: FormField[]          (shared kernel)          edd: documents for high risk, signer role
  rules: { base, cross, company[] } (shared kernel)   rescreen: at_offer | before_approval | before_transfer | party_change | every_n_days
```

The form model, document rules, severities, locked severities, safe patterns and the protected-trait
refusal move from `@leasing/core` `kyc-config.ts` to `@leasing/kernel` (domain-free) with the document-kind list
as a parameter; leasing passes its kinds, SPA adds title deed, Oqood, POA, board resolution, MoA, NOC and
bank letters (built in P1: `defineKycForm(readKinds, specs)`, S32). `spa-kyc` and `company-check` read the party's role config version at start and record it.

## 13. UI rules (S21)

Follow `docs/spa/design.md` (S31): leasing tokens and components from the shared `@leasing/ui` package, the
rail · main · copilot dock shell with Portal and Sign out in the avatar menu, the screen templates, link rules and
status words. No other module is named, linked or counted anywhere in the app.
