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
                        apps/portal :3100  (module launcher C37, S69; shared sign-in C38, S70; DB `portal`)
                         │                         │
            leasing ─────┘                         └───── SPA
  modules/leasing/apps/web :3000 → modules/leasing/apps/engine :4000          modules/spa/apps/web :3001 → modules/spa/apps/engine :4001
        │                 │                         │                    │
   DB leasing      ejari-mock :4100            DB spa             oqood-mock :4101 (schema `oqood_mock`, S53)
                                                                  screening (fake adapter)
                                                                  Ollama (shared server, local)
                                                                  SMTP (own MAIL_FROM)
```

The portal (C37, S69; C38, S70) is a leaf: it imports `@platform/*` only and reaches each module by URL. It owns one table, `portal_accounts` (database `portal`, argon2id, no role), written only by `bun run portal:create-account`. Signed in (`portal_session`), a person's tile for a module shows only when that engine's `POST /api/auth/portal-exchange?check=1` says the email has an active user there; counts (`GET /summary`, `x-portal-key`) are read only for those tiles. "Open" goes to the portal's `/go/<module>`, which signs a 60-second EdDSA token (`sub`, `email`, `aud`, `jti`; no role) and redirects to the module web's `/auth/portal`; the web app posts the token to its engine, which checks the public key (`SPA_PORTAL_PUBLIC_KEY`, `LEASING_PORTAL_PUBLIC_KEY`), the audience and the expiry, spends the `jti` once (`portal_handoffs`, append-only), finds the active user by lower-case email in its own table and issues its own session with its own secret (403 with one body when there is none; a user, an activation or a role is never created here). Each app keeps its own cookie (`spa_session`, `leasing_session`); signing out of an app or of the portal clears only that cookie. Without a signing key the portal is the C37 chooser, and without a public key an engine's exchange route is off (404). Demo mode and each app's own sign-in are unchanged. Its own settings live in `.env.portal.local`. Neither module's web app names the other; each has a "Portal" link in its avatar menu. `scripts/check-domain-rules.ts` keeps the portal free of module imports and keeps every other app and package from importing it.

Ollama is one local server; both engines call it through `@platform/llm` with their own
model tags and their own `ModelGate` concurrency limits.

## 3. Folders and packages

```
modules/spa/
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
platform/          shared by every module, no domain code (S34; docs/platform/README.md)
  kernel/          @platform/kernel  Clock, dates, money, ids, maskPii, Helper contract + runner, defineMachine, defineGates, Actor, KYC form model, session tokens
  ui/ llm/ adapters/  @platform/ui (tokens, theme, components), @platform/llm, @platform/adapters (mail, pdf, storage, e-sign types)
  (P5/P6) the KYC reader and the contract-structure reader move here from @leasing/helpers, each taking a profile
```

Root `package.json` workspaces: `modules/leasing/apps/*`, `modules/leasing/packages/*`, `modules/spa/apps/*`, `modules/spa/packages/*`, `platform/*`.

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

As built in P3 (S35): `ALL_SIGNED`, `NOC_OK` and `TRANSFERRED` are routed by `routeDealEvent` to one machine event per
destination (`ALL_SIGNED_PRIMARY|RESALE`, `NOC_OK_FINANCE|SETTLEMENT`, `TRANSFERRED_COMPLETE|PLAN`); the event log keeps
the spec name. Guards read a facts snapshot; facts for steps not built yet are false (fail closed). `CANCEL` from
`OFFER_AGREED` needs no gate, from later open states `cancellation`, and none from `INSTALMENTS`. Cascades: primary
holds the unit on create, sells it on `ALL_SIGNED`, registers it on `REGISTERED`, hands it over on `HANDOVER`, releases
it on cancel; resale moves the listing `UNDER_OFFER` on create (from `ACTIVE` or `PUBLISHED`, or keeps it there), `SOLD`
on `TRANSFERRED`, back to `ACTIVE` on cancel. Code: `@spa/core` `state/`, `modules/spa/apps/engine/src/manager/`.

| From | Event | To | Gate / guard |
|---|---|---|---|
| — | `OFFER_ACCEPTED` | `OFFER_AGREED` | primary: booking amount recorded, unit `AVAILABLE`, discount in policy or `price_out_of_range` approved; resale: listing `ACTIVE` |
| `OFFER_AGREED` | `CHECKS_STARTED` | `PARTY_CHECK` | documents requested from every party |
| `PARTY_CHECK` | `CHECKS_PASSED` | `AGREEMENT_DRAFT` | KYC ok under the KYC config in force now (or `kyc_review`), company checks ok (or `seller_verification`; asked only when a company is on the deal, an unknown answer blocks, S52), ownership matched or approved (resale, S52), no open compliance flag (S50) |
| `PARTY_CHECK`, `AGREEMENT_DRAFT`, `LEGAL_REVIEW` | `AML_FLAGGED` | `AML_HOLD` | a flagging hit that no cleared hit covers (same guard from each state, S50); written to the timeline as a compliance review |
| `AML_HOLD` | `AML_CLEARED` | `PARTY_CHECK` | `aml_flag` decided "clear" |
| `AML_HOLD` | `AML_STOPPED` | `CANCELLED` | `aml_flag` decided "stop" / "report" |
| `AGREEMENT_DRAFT` | `PREPARED` | `LEGAL_REVIEW` | every core field filled from the approved template of the right `document_kind` |
| `LEGAL_REVIEW` | `APPROVED` / `RETURNED` | `SIGNING` / `AGREEMENT_DRAFT` | `agreement_approval` (legal); `APPROVED` also needs no open compliance flag |
| `SIGNING` | `ALL_SIGNED` | `REGISTRATION` or `NOC` | every signer; resale: security deposit recorded; no open compliance flag |
| `NOC` | `NOC_OK` | `FINANCE` or `SETTLEMENT` | NOC matched and confirmed by a person (or `noc_review`; a reader's NOC needs `confirmNoc` first, S47); FINANCE only with a mortgage flag; no open compliance flag |
| `FINANCE` | `FINANCE_OK` | `SETTLEMENT` | required bank letters uploaded, amounts and end dates confirmed by a person, valid on the target date and today; no open compliance flag |
| `SETTLEMENT` | `SETTLED` | `TRANSFER` | `settlement_approval` (finance) of a fresh, balanced statement (`statementBalanced`); the NOC is still valid today (`nocOk`, S48); the bank letters still hold when a mortgage exists; no open compliance flag |
| `TRANSFER` | `TRANSFERRED` | `COMPLETED` / `INSTALMENTS` | `transfer_submission`, then title deed or Oqood transfer issued; the NOC is still valid today (`nocOk`, S48); no open compliance flag |
| `REGISTRATION` | `REGISTERED` | `INSTALMENTS` | `oqood_submission`, then Oqood number issued; no open compliance flag |
| `INSTALMENTS` | `HANDOVER` | `HANDED_OVER` | all instalments paid, handover recorded; no open compliance flag |

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
| `settlement_approval` | every resale settlement statement (built by code; approving a stale or unbalanced one is refused, S48) | `finance` |
| `oqood_submission` | every primary registration | `sales_admin` |
| `transfer_submission` | every resale transfer | `sales_admin` |
| `cancellation` | cancelling a deal after `OFFER_AGREED` | `sales_manager` |
| `deposit_release` | deposit cheque on a cancelled resale | `sales_manager` |
| `edd_signoff` | risk level high (after EDD documents) | `compliance_officer` |
| `helper_review` | an `ok` result of a helper in review mode (S22, S59: one per held run, `helper_review_holds`) | `sales_officer` / `sales_manager` (never admin, never its proposer) |
| `refund` | any refund | `finance` |

Nobody approves their own proposal. `admin` approves nothing. `aml_flag` is decided with an outcome (clear · more
info · stop · stop and report); "stop and report" opens `aml_report` for the MLRO. `agreement_approval` rejected is
what `RETURNED` consumes; `APPROVED` needs it approved. An approval is used once (`consumed_by_event_id`).

`aml_flag` in practice (C18, S50): `screenDeal` screens every buyer, seller, company, beneficial owner and non-party payer
against the lists (fake in C18), runs `amlRules` and `assessRisk` by code, and a flag opens one `aml_case`, one pending
`aml_flag` (titled "Compliance review") and `AML_HOLD`. The model writes only a labelled summary after the flag exists.
Deciding it in `decideApproval` moves the case and the deal: **clear** closes the case (`cleared`) and the deal returns to
`PARTY_CHECK` (`AML_CLEARED`); **more info** sets the case to `info_requested` and the deal stays on hold: no email goes
to anyone, compliance records the request and a new screening opens a new round with a new approval; **stop** closes the
case (`stopped`) and cancels the deal (`AML_STOPPED`); **stop and report** closes it as `reported`, cancels the deal and
opens `aml_report` for the MLRO. The two `AML_*` moves and every AML detail appear on the timeline only as
`COMPLIANCE_REVIEW_RECORDED` and "compliance review". A sanctions hit is also high risk, so its `edd_signoff` must be
decided too before `openAmlFlag` goes false.

Reads and the role filter (C29, S57): every staff read goes through `manager/views.ts` and `manager/reads.ts` with the session's
role, and the answer is masked for ID, passport and phone numbers on its way out. The compliance roles are `compliance_officer` and
`mlro` (`COMPLIANCE_ROLES`, `@spa/core` `visibility.ts`); admin is not one. Events use two allowlists, `STAFF_EVENTS` and
`COMPLIANCE_EVENTS`: a type in neither is hidden from every other role, and a test scans the engine source so a new event type must
be classified. A compliance review is the neutral "Compliance review" entry for everyone; the stage `AML_HOLD` reads `ON_HOLD`
("On hold · review open") outside the compliance roles. The approvals of `edd_signoff`, `aml_flag` and `aml_report` read
`{id, gate: "compliance_review", title, status: open | closed}` to other roles and never appear in their inbox; other gates pass
title, reasons and note through the PII mask. Routes: `GET /api/deals`, `/api/deals/:id` (sections from `RECORD_SECTIONS`, each with
its own `appliesTo`; from C39, S71 a section may also carry `steps` (it appears only when its step is in the deal type's list and the deal has reached it) and `visibleTo(role)` (a role that may not read it never gets the key: absent, not empty); the evidence sections are `documents` (kind, masked party, upload day, read state, `confirmed`; never a file name, key, hash, type or size), `aml` (compliance_officer and mlro only: case ids and status, highest risk level, count), `agreement`, `signing` (name, role, order, state, link expiry day; never a link, token or address), `noc`, `finance` (bank letters and payments without the payer check), `settlement` (resale only, lines and sources in fils, `balancesToZero` computed by the engine, not for admin) and `registration` (Oqood and transfer attempts, reasons masked); each reuses its route's read through a role-free `...View` and the route keeps its own role check; the compliance roles read the record at web `/compliance/deals/[id]`), `/api/deals/:id/events`, `/api/approvals?scope=inbox|deal`, `/api/approvals/:id`, `/api/tasks`,
`/api/summary`, and `POST /api/approvals/:id/decide` (the body is the decision only; the person is the session's). Both approval reads add
`heldResult {helper, label, status, reasons}` to a `helper_review` card (masked; left out when the run is marked for compliance, S63) next to the
`agreementReview` of an `agreement_approval` card (S60). Migration 0044
freezes a pending approval's gate, record, proposal, role, proposer, title and key, and refuses TRUNCATE on `spa_approvals` and
`spa_policy`.
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
Built in C1/C2: unconfirmed values are `pending` and refused (S36); AML rules with a pending threshold raise an
`unconfirmed` hit (fail closed to a person); a settlement never uses an unconfirmed bank amount.
Company policy (`spa_policy`): discount limits, commission defaults per side, deposit %, hold days,
reminder days, signing order per deal type, developer NOC rules per project (minimum paid %, validity).

## 7. Helpers

Full behaviour of every helper and assistant: `docs/spa/specs.md` §6.

| Helper | Model | Code decides | Output | Mode (S22) |
|---|---|---|---|---|
| `ownership-check` | vision (reader in `@spa/helpers`, S52) | owners (the C5 `matchOwners`), shares = 10000 bps, property number, company owner = licence name | matched / `seller_verification` (never matched on anything unread) | auto · review |
| `spa-kyc` | vision (shared KYC reader in `platform/readers/kyc`, SPA profile, S49) | role KYC config checks | pass / `kyc_review` / blocked (reasons only) | auto · review |
| `company-check` | vision | licence valid and long enough, named signer with a power over property, owners ≥ `beneficialOwnerBps` (S52) | pass / `seller_verification` (counts an ownership layer for AML) | auto · review |
| `aml-screening` | chat (summary only) | matching, rules, risk level, EDD needs | clean / `aml_flag` / `edd_signoff` | fixed |
| `document-reader` | vision (profiles incl. `payment_receipt`, S26; C20: NOC, bank letters, licence, MoA, POA, resolution, deed, Oqood) | strict parsers for money, dates, percentages; names, unit, dates, validity; amounts "read, not confirmed" | match / `noc_review` / confirm task | auto · review |
| `spa-template` | chat + decision | wording copy, blanks, blocks, checks | version → `template_approval` | — |
| `spa-prepare` | none | fill, repeat blocks, sources, hash | → `LEGAL_REVIEW` | auto · review |
| `agreement-review` | chat (`SPA_CHAT_MODEL`) | quote guard (every flag quotes words found in the agreement or the offer's conditions), stray amounts and dates, instruction-like conditions | suggestions on the `agreement_approval` card and the deal record (never blocks, approves or edits; S60) | auto · review · off |
| `registry` | decision (field only, S56) | one safe fix (name case or spacing against the KYC-verified name), request ids, retries | number issued / task | auto · review |
| `settlement` | none | statement balances to zero | → `settlement_approval` | fixed |
| `chaser` | none | items, fixed reasons, schedule, admin-approved templates filled by code (S23, S60) | emails, `chase_overdue` task | fixed |
| `collections` | none | instalment reminders at the policy's days, amounts from the plan | emails, tasks (S56) | fixed |

Helper modes (C24, S59): a switchable helper (`ownership-check`, `spa-kyc`, `company-check`, `document-reader` per document kind,
`spa-prepare`, `agreement-review` (S60), `registry` auto-fix; the database refuses any other) is `auto` (default), `review` or `off`, set by an admin in
Settings → AI helpers (`GET`/`PUT /api/settings/helpers`; a sales manager reads; models are shown read-only). The latest
`spa_helper_settings` version of a (helper, scope) is in force (a kind overrides `*`). `afterHelperResult` runs at the end of each
helper: an `ok` result in review mode gets a `helper_review_holds` row and a `helper_review` gate, and the fact loaders
(`kycOkFact`, `companyChecksOkFact`, `ownershipOkFact`, `nocOkFact`, `bankLettersFact`, `agreementPreparedFact`) skip a held or rejected
run (`heldRunIds`), so nothing advances on it. For `spa-prepare` the agreement is stored but `PREPARED` is held; for `registry` only the
auto-fix resubmission is held. Approving releases the hold and calls `driveDeal`; rejecting closes it and opens a `helper_rejected` task.
`off`: the job is not queued or run, the route answers 409 `helper_off`, one `helper_off` task tells the agent to do the step by hand, and
the fact stays fail-closed. `driveDeal` (`manager/drive.ts`, `system:driver`) takes `CHECKS_STARTED` then `CHECKS_PASSED` when the real facts
pass the guards; it never takes a step with a gate and never goes past `PARTY_CHECK`. AML screening stays compliance-only and fixed.
Agreement review and chasing (C25, S60): `spa.agreement.review` (key `<agreementId>:review`, queued by the `spa.prepare` job once an agreement is stored; `SPA_CHAT_MODEL`)
rebuilds the agreement's printed text from the same inputs as the PDF (a deal that changed since is `stale` and skipped), asks the model for at most 20
`{kind: conflict|unknown_amount|unknown_date|instruction_like, quote, note ≤ 200}` flags (prompt `spa-agreement-review.v1`; invalid output is retried once, then
`needs_human`), and code then drops every flag whose quote is not in the agreement or the offer's conditions (counted in `agreement_reviews.dropped`),
adds `unknown_amount` / `unknown_date` flags from the stray-value scan (`strayMatches`, shared with `spa-prepare`), flags instruction-like conditions itself and
replaces a note that sounds like a legal opinion or an order. One `helper_runs` row (`spa_agreement_review`, entity kind `agreement`) and one immutable
`agreement_reviews` row per agreement and prompt version; event `AGREEMENT_REVIEWED` (counts and kinds, never the quotes). The flags join the
`agreement_approval` card (`GET /api/approvals`, `/api/approvals/:id`: `agreementReview`) and the record section `agreement_review`; no party route reads them. They never
block: a failed run says "Review not available" and the approval stays decidable. Helper modes apply: `off` queues nothing and opens the `helper_off` task, `review`
holds the flags behind a `helper_review` gate. Chasing: `chaseSweep` (`spa.chase.sweep`, 08:30 Dubai, key `chase-sweep:<date>`) queues one `spa.chase` job per open deal
(key `<dealId>:chase:<date>`); `chaseDeal` derives each party's open items by code (`openChaseItems`: required documents not on file against the document requests and
the KYC config, the latest failed or expired KYC run's reasons, and compliance info requests) and sends the approved `chase_templates` version (placeholders
`{party_name}`, `{property}`, `{items}`, `{agent_name}`, `{agent_email}`, `{company_name}` filled by code in one pass; reasons from the fixed `CHASE_REASONS` list)
through `sendSpaMail` (purpose `reminder`, milestone `<partyId>:<itemKey>@<step>[+…]`) at step 0, then after each policy `reminderDays` counted from the first chase (a job that was
down sends the latest step due), then opens a `chase_overdue` task for the sales officer at `chaseTaskAfterDays` (must exceed the last reminder day). A party under an open compliance
matter, and any item compliance asked for, reads only "Additional documents needed" (`neutralChaseReason`). Stops: a cancelled, completed or handed-over deal, an upload after the first chase,
and an agent's pause (`chase_pauses`; `POST /api/deals/:id/chase/pause|resume`). Admin routes `POST /api/chase-templates` and `…/:id/approve` (a draft is validated on save and again on
approval; an approved version never changes). Each `chases` row (insert-only) keeps the template version, the subject and the body hash. Record sections: `agreement_review`, `chasing`.
Registry mocks (C27, S53): `modules/spa/apps/oqood-mock` (:4101, schema `oqood_mock` of the `spa` database, own migrations folder like
`ejari_mock`) is a simulated registry behind `OqoodAdapter {register, transfer, status, certificate}` and `TransferAdapter {book}`
(`@spa/helpers`, `HttpOqoodAdapter` reads `REGISTRY_MOCK_URL`, `FakeOqood` for tests; each call carries a request id and the
registry gives the same answer to the same id). Routes: `/api/v1/oqood/{register,transfer}`, `/api/v1/oqood/:no` and
`/certificate.pdf`, `/api/v1/trustee/transfers`, demo-only `/api/v1/demo/{reset,reject-next}`. Numbers: `SIM-OQD-<yyyy>-<7 digits>`
(registration), `SIM-TRF-…` (Oqood transfer and trustee booking), `SIM-TD-…` (new title deed). Rejection codes (`@spa/core` `registry.ts`):
`BUYER_NAME_MISMATCH`, `UNIT_NOT_FOUND`, `UNIT_ALREADY_REGISTERED`, `SELLER_NOT_OWNER`, `NOC_MISSING`, `INVALID_ID`,
`SERVICE_CHARGES_OUTSTANDING`. `REGISTRY_MOCK_FAILURE_RATE` gives a 503 (`RegistryUnavailableError`: nothing registered, never a
rejection). Everything it shows or issues says "Simulated Oqood (demo)" or "Simulated trustee transfer (demo)" and `simulated: true`,
with no DLD logo, colours or screen copy (AGENTS rule 9); its shell is `@platform/adapters` `registry-mock`, shared with leasing's
`ejari-mock`. The two deal facts: `oqoodIssued` is an `issued` `oqood_register` row; `transferIssued` is an `issued`
`trustee_transfer` (ready resale) or `oqood_transfer` (off-plan resale), never from rows of another kind.

`spa-kyc` flow (C17, S49): `POST /api/deals/:id/document-requests` records a request per buyer, seller and beneficial
owner; person documents are uploaded per party; `POST /api/deals/:id/parties/:partyId/kyc/run` queues job `spa.kyc.run`
with singletonKey `<partyId>:kyc:<docsHash>`; `runKyc` reads the party's current documents under `effectiveKycConfig`, records a
`helper_runs` and a `kyc_runs` row and a `KYC_RUN` event, and opens a `kyc_review` gate when only warnings were raised. A
blocking flag (an expired document, an unreadable expiry date, a blocker the config sets) makes the run `blocked`: reasons
only, no gate can approve past it. Facts: `documentsRequested` (every buyer and seller has a request row) and `kycOk` (every
buyer, seller and beneficial owner has a latest run that `passed` or a review a sales manager approved for that run id,
read from the documents now on file, with `valid_until` today or later; no parties means false). `GET /api/deals/:id/kyc`
gives the per-party view without ID numbers. `DEAL_FACT_KEYS` (core) lists every fact; the fail-closed loader's keys must equal it.

Readers flow (C20, S52): an upload of a readable kind queues `spa.document.read` (singletonKey `<documentId>:read`). `ensureRead` stores
an immutable `document_reads` row (fields as `{value, confidence}`, `instruction_found`) and a `helper_runs` row; code parses and
decides. A NOC read feeds `noc_records` (`source = reader`, only `paid_read_fils`) through `storeNoc` and a bank-letter read feeds
`bank_letters` (only `amount_read_fils`, plus a confirm task) through `storeBankLetter`; neither amount counts until
`confirmBankAmount` or a person's NOC entry. `POST /api/deals/:id/parties/:partyId/company-check/run` queues `spa.company.check`
(`<partyId>:company:<docsHash>`): `companyChecks` (pure) decides licence, signer and owners; owners at or above the rulebook's
`beneficialOwnerBps` become `beneficial_owner` parties on clear readings only (as `system:company-check`); a finding opens
`seller_verification` for that `company_checks` id and adds its layers to the AML rule. `POST /api/deals/:id/ownership-check/run`
queues `spa.ownership.check` (`<dealId>:ownership:<docsHash>`): `ownershipChecks` uses `matchOwners` (C5) on the title deed or Oqood.
Facts: `companyChecksOk` (every company has a passed check, or a review whose run an approved `seller_verification` names, on the
documents now on file, licence valid today) and `hasCompanyParty`; `CHECKS_PASSED` needs `!hasCompanyParty || companyChecksOk`.
`GET /api/deals/:id/company-checks` shows the latest check per company. Without `SPA_VISION_MODEL` the three jobs wait.

Assistants (S24, S61, S68): staff copilot (`@spa/copilot`, C36), party portal assistant, listing page chat, template assistant.
The four share `runAgentTurn` in `platform/llm/src/agent/` (a scope gate with an `AgentProfile`, Zod-typed tools,
at most six tool calls, 60 s a turn, the value post-check `verifyAnswer` and `actionClaim`, an optional code guard for banned
words, a tool's fixed `final` text that ends the turn) and keep their words, tools and fixtures in `@spa/helpers`
(`assistants/`). The engine gives each one a backend closed over its scope, stores the conversation (`assistant_threads`,
`assistant_messages`, masked) and answers on:

| Assistant | Route | Who | Tools | Never |
|---|---|---|---|---|
| Party portal | `POST /public/party/:token/assistant` | the party behind a sign link or an offer link (`resolvePartyToken`; C35's portal token joins it) | `my_deal_status`, `my_missing_documents`, `my_payments`, `transfer_day_info`, `explain_step`, `contact_agent` (emails the agent the party's own words, 5 a day) | any banned word (`partyBanned`: replaced by "Your agent can help with that."), another party's data, advice, price comment, a promised date, a document; a compliance hold reads "Under review" |
| Listing chat | `POST /public/listings/:ref/chat` | the public, one listing that `findPublicListing` shows (the page's own check) | `listing_facts`, `other_published_listings`, `send_enquiry` (name and email the visitor typed, consent from the page's tick box, the message is their own words; `listing_enquiries`; emailed through `sendSpaMail`) | the seller, the lowest price, an offer's outcome, documents or ID numbers; 20 messages an hour per visitor and listing, 3 enquiries a day (`assistant_rate_limits`, Clock buckets) |
| Template | `POST /api/template-assistant` (admin, legal) | one template version | `template_version`, `data_keys`, `compare_versions` (a code diff), `explain_check`, `propose_remap`, `propose_rename` (store `assistant_proposals`, status `proposed`) | approve, apply, edit, say a clause is legally valid; only `POST /api/template-proposals/:id/apply` (admin) changes anything, through `remapBlank` or `relabelBlank`, and an approved version is refused |
| Staff copilot | `POST /api/copilot/chat` (any signed-in role; the dock) | the signed-in user, with that user's own session: every read goes through the existing role-filtered routes | read: `search_deals`, `get_deal`, `get_deal_timeline`, `list_approvals`, `list_tasks`, `get_payment_plan`, `get_noc_bank_status`, `get_settlement`, `get_signing_status`, `list_listings`, `get_listing`, `get_template_status`, `get_rulebook_value` (value + `rulesVersion`, or "pending confirmation"), `get_compliance_case` (compliance officer and MLRO only); draft: `draft_email`, `draft_summary` (copy-only cards), `draft_approval_note` (pre-fills the inbox note box through `?draft=<id>`); propose (stored in `copilot_proposals`, run only by the same user's `POST /api/copilot/proposals/:id/confirm`): `request_documents`, `create_task` (kind `copilot_task`), `resend_signing_link`, `prepare_agreement` (it only prepares; `agreement_approval` still waits for legal) | decide a gate, clear a flag, confirm an amount, send, sign, submit, register, change a setting, open an uploaded file; show a compliance matter to any role but the two compliance roles (the prompt leaves it out and a code guard replaces any reply or tool result with an AML word by "Compliance review is open."); state an amount, date or rate no tool returned this turn without marking it unverified |

Model: `SPA_ASSISTANT_MODEL`, else `SPA_CHAT_MODEL`, must be a local Ollama model (rule 8); the staff copilot uses `SPA_COPILOT_MODEL`, else the
assistants' model; the scope gate uses `SPA_DECISION_MODEL`. Without them the routes answer 503. Evals: `bun run eval -- spa:party-assistant|spa:listing-chat|spa:template-assistant|spa:copilot`.

**Staff copilot (C36, S68).** `@spa/copilot` imports `@spa/core` and `@platform/*` only. Its `EngineClient` has `get` (an allowlist of read-route
regexes) and `propose` (only `POST /api/copilot/proposals` and `/drafts`); the confirm and cancel routes, every decide, send, sign, submit, clear and
settings route are on no list, and a test fails on any extra path. The chat route builds the client from the app's own routes and the user's own
bearer token, so a tool can read only what that user's role reads. A proposal is a `copilot_proposals` row (kinds `request_documents`,
`create_task`, `resend_signing_link`, `prepare_agreement`; 30 minutes; status `proposed|confirmed|cancelled|expired`, moves once, payload fixed by
trigger). `POST /api/copilot/proposals/:id/confirm` by another user is 403, an expired one 410 (marked `expired`), a decided one 409; confirm locks the
row, re-checks the role and the deal, runs `requestDocuments`, `openTask`, `resendSigningLink` or `enqueuePrepare` as the user and appends
`COPILOT_PROPOSAL_CONFIRMED` (actor `user:<id>`, payload `viaProposal`). A draft is a `copilot_drafts` row (immutable; kinds `email`, `summary`,
`approval_note`); nothing is ever sent from it. Not built: tools that change settings, decision cards, anything that opens an uploaded file.

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

**Upload and preview (C34, S66).** An admin uploads a blank or fictional sample as a PDF (up to 10 MB, checked by its first bytes) with the box ticked that it holds no real customer data; the file is stored by hash and one `template_uploads` row exists per template and hash. Job `spa.template.read` (key `<templateId>:<docHash>`) reads it with the reader and the SPA profile, then code scans the read text for an Emirates ID, passport number, email, phone number or IBAN: a hit ends the upload as `needs_human` ("Upload a blank or fictional copy") and stores no version (nothing is scrubbed, so the approval's `sample_value` check still sees the real wording). Otherwise `addTemplateVersion` stores the version, runs the S45 checks and opens `template_approval` for legal. Admin, legal and a sales manager read the template pages; an admin remaps blanks while a version is in review; legal decides in the inbox. The project scope is fixed when the template is created. The preview (`GET /api/template-versions/:id/preview`) prints the version with a fixed fictional sheet and "SAMPLE" in every header and footer; it stores nothing and writes no event.

## 8. Data model (`spa` database)

`spa_users`, `companies` (with `kind`), `alerts` (C23, S62: approval, level approver|manager, user, waited hours, outbound message, read time; unique per approval, level and user; only `read_at` and the mail link are set, once; never deleted), `alert_settings` (gate, version, threshold hours > 0; append-only), `exports` (deal, kind case_pack|monthly_report, who, when, sha256, size, store key, file count; append-only), `retention_reviews` (one per Dubai month, status listed|approved, years and cut-off day, approver; moves forward once, never deleted) with `retention_review_items` (review, deal, ended on, status; same rule), `compliance_reports` (one per month, CSV and PDF hashes and keys; immutable), `spa_helper_settings` (C24, S59: helper, scope, version, mode, set by and at; append-only by trigger; CHECK on the seven switchable helpers), `helper_review_holds` (C24: run, deal, approval, status `pending|released|rejected`; one per run; only `status` and `decided_at` change, once), `agreement_reviews` (C25, S60: agreement, flags `{kind, quote, note, in, source}`, dropped, model tag, prompt version, instruction found, run; unique per agreement and prompt version; immutable by trigger), `chase_templates` (C25: kind, version, subject, body, status draft|approved|retired, who and when; an approved row never changes except to retired), `chases` (C25: deal, party, item key, fixed reason code, step, template and version, subject, body hash, outbound message; unique per party, item and step; insert-only), `chase_pauses` (C25: one open pause per deal; only `resumed_at` and `resumed_by` change, once), `assistant_threads` (C26, S61: kind party|listing|template, subject, hashed principal), `assistant_messages` (append-only by trigger: role, masked content, tool name, verified, unverified values, scope blocked, model tag), `assistant_proposals` (template assistant: kind remap_blank|rename_placeholder, version, payload, status proposed|applied|dismissed; only status and the apply columns change, once), `listing_enquiries` (listing, name, email, message, consent time NOT NULL, outbound message; kept as written), `assistant_rate_limits` (hashed key, bucket, n; unique per key and bucket), `listing_permits`, `offers`, `deposits`, `spa_kyc_configs` (role, deal type, version, form, rules), `spa_aml_policy` (version, rules, sof evidence, risk scoring, EDD, re-screen points), `risk_assessments`, `company_signatories`, `projects` (C32, S64: unique `code`, name, emirate `dubai`, `anticipated_completion_on` (calendar date), `template_kind` null or a document kind, the company; the escrow account is not a column: it is C22's current `project_escrow_accounts` row for the same `code`, shown masked; trigger: the code can't change once a deal exists on a unit of the project or names the code, never deleted or truncated), `buildings` (unique code per project; trigger: not renamed or moved once a deal exists on the project, never deleted or truncated), `units` (`code`, `state`, and from C32 `building_id`, null only for a unit made before projects; trigger: set once, never moved), `price_lists` (project, `version` unique per project, `published_at`; trigger: a draft publishes once and only with prices, a published list never changes or is deleted, never truncated; the version in use is the project's latest published) and
`price_list_items` (list, unit, `price_fils` > 0; PK list and unit; trigger: none added, changed or deleted once the list is published, the unit must sit in a building of the list's project; a deal created on a unit with no price of its own takes this price, S64), `listings`, `listing_parties`, `parties`, `company_details`, `signatories`,
`beneficial_owners`, `deals` (type, mortgage flags, unit or listing, `target_transfer_on`, resale `unit_no` and `project_code`, S47), `deal_parties`, `documents`
(C15, append-only by trigger: deal, party, kind (C15: `noc|liability_letter|release_letter|pre_approval|valuation|final_offer`; C22 adds `payment_receipt`, uploaded by sales or finance on any deal type, many per deal, none supersedes another; C17 widens the CHECK to the SPA read kinds `passport|emirates_id_front|emirates_id_back|visa|proof_of_address|trade_licence|title_deed|oqood|poa|board_resolution|memorandum`; person kinds are uploaded per party on any deal type, the rest are read in C20), file name, mime, size, sha256, storage key, supersedes, uploaded by and at),
`noc_records` (C15: deal, document, source `manual|reader`, unit, seller names, issued and expiry dates, service charges cleared, `paid_fils` only with `paid_confirmed_by`, `paid_read_fils`, status `matched|review|superseded`, mismatches; one non-superseded per deal; trigger: only `status → superseded` changes),
`bank_letters` (C15: deal, side, kind with a kind-to-side CHECK, document, issue and `valid_until` dates, `amount_fils` only with `confirmed_by` and `confirmed_at`, `amount_read_fils`, status `current|superseded`; one current per deal and kind; trigger: only `current → superseded`; confirming an amount writes a new row),
`document_reads` (C20, S52: document, `profile` (the 13 reader profiles and, from C22, `payment_receipt`), `fields` as `{value, confidence}` exactly as printed, model tag, `prompt_version`, `instruction_found`, link to its `helper_runs` row, `read_at`; one per document and prompt version; immutable by trigger; no confirmation columns: an amount counts only as `bank_letters.amount_fils` with `confirmed_by`),
`company_checks` (C20, S52: deal, company party, status `passed|review|needs_human`, `licence_expires_on`, `signer_ok`, `owners` (name, bps, whether recorded), `layers` (unresolved ownership layers, added to the AML rule), `findings`, `docs_hash`, run; immutable by trigger),
`helper_runs` (C17, S49: one helper's answer about a record, append-only by trigger: helper, deal, entity, status `ok|needs_human`, `result` without ID numbers, reasons, model tag, prompt version, `rules_version`, `kyc_config_version`, `aml_policy_version`, visibility `staff|compliance`; later helpers reuse it),
`kyc_runs` (C17, S49: deal, party, role `buyer_person|seller_person|beneficial_owner`, `config_scope` and `config_version` of the published KYC config used, status `passed|review|blocked|needs_human`, flags, `identity` (holds ID numbers: never logged or copied to events), answers, `valid_until` = earliest document expiry, `docs_hash`, link to its `helper_runs` row; immutable by trigger),
`document_requests` (C17: one row per deal and party with the role and the config version that applied; recording only, emailing links is C28/C35),
`screenings` (C18, S50: one row per screened party, company, owner or non-party payer and screening, append-only by trigger: deal, optional `party_id`, `subject_key` (party id or `payer:<name>`), trigger `offer|before_agreement|before_transfer|party_change|periodic|manual`, `list_version`, sanctions and PEP scores (null = not screened), `exact`, `matches` (list entries found and the hits code evaluated); compliance roles only),
`aml_cases` (C18: deal, status `open|info_requested|cleared|stopped|reported`, the `aml_flag` approval, the compliance-only `summary` with its model and `instruction_like`; trigger: only status, approval and closing time change, a closed case stays closed, never deleted; moves only through `decideApproval`, except that a new screening reopens an `info_requested` case with a new approval), `aml_hits` (C18: case, party or payer, one of nine rule codes, severity `flag|warning`, detail, `list_version`; append-only; compliance roles only; a cleared hit covers the same party, rule and list version later),
`template_uploads` (C34, S66: template, `doc_hash` (unique per template: a repeat upload returns the same row), storage key, file name, status `queued|reading|done|failed|needs_human`, reason, the version it produced, `declared_no_real_data` (CHECK true), who and when; trigger: only status, reason, version and finish time change, status moves forward only, no delete, no truncate),
`spa_templates` (name, `document_kind`, `project_codes`), `spa_template_versions` (version, doc hash, sections, blanks, look,
party_blocks, signature_roles, checks, rules_version, status `in_review|approved|rejected|retired`, approval; trigger: decided versions immutable, S45), `agreements` (C19, S51: deal, `kind` `spa|mou|assignment|listing_agreement`, `version` unique per deal and kind, template version, status `prepared|in_review|approved|superseded`, `doc_hash` of the PDF, storage key, `values_hash` of the deal's inputs, `field_sources` (where every printed value came from, never the value), rules and policy versions, the `agreement_approval`; trigger: content fixed, status only moves forward, approval linked once, never deleted; one live per deal and kind),
`project_escrow_accounts` (C22, S55: `project_code`, account holder, `iban` (normalised, CHECK `^AE[0-9]{21}$`, mod-97 checked by code before it is stored), bank, `entered_by` (an admin), `valid_from`, `superseded_at`; one current row per project (partial unique index); append-only by trigger: only `superseded_at` is set, once; never deleted or truncated; events carry a masked IBAN),
`payments` (C22, S55: deal, `seq` (the plan row it pays, FK to `payment_plan_rows`), `document_id` (unique: one payment per receipt) and `read_id` of the reader's copy, status `read|counted|not_counted|needs_review`, `method` `transfer|cheque|cash|card|other`, `amount_read_fils` (what the reader saw, never counts), `amount_fils` (typed by finance), `paid_on`, `payer_name_read`, `payer_party_id` (the buyer the name matched), `account_read_masked` (first and last digits only), `into_escrow`, `payer_is_buyer`, `reason_code`, `confirmed_by` and `confirmed_at`; CHECKs: `counted` needs `amount_fils`, `confirmed_by` and `into_escrow`, an amount needs a confirmer, both amounts above 0; trigger: a row is inserted unconfirmed (never `counted`), then changes once, from `read` or `needs_review` to `counted` (status, amount and confirmation only); never deleted or truncated),
`registry_rejections` (C21, S56: one row per rejected or unavailable `registrations` row (unique): `codes`, `mapped_field` (name fields comma-joined), `mapped_confidence` numeric(3,2), `source` `code|model`, `action` `fixed|retry|task`, `task_id`; append-only by trigger; no registry text, no names),
`collection_reminders` (C21, S56: deal, `plan_seq` (FK to `payment_plan_rows`), `milestone` (`T-<days>` or `T+<days>`, from the policy), the sent `outbound_messages` row; unique per deal, row and milestone; insert-only by trigger; the mail must be `sent` and of the same deal),
`spa_tasks` (C22, S55: general for every chunk: optional deal, `kind` (`payment_not_escrow|payment_review|confirm_amount|default_flagged|milestone_reached|registry_rejected|registry_unavailable|instalment_overdue`; later chunks widen the CHECK), `role`, `title`, `detail` (ids and codes, no personal data), status `open|done|cancelled`, `dedupe_key` (unique while open), created and done at and by; trigger: only `open → done|cancelled`, once; never deleted; titles never carry compliance wording),
`deals.in_default`, `in_default_since`, `in_default_reason` (`overdue|withdrew|no_show`; CHECK: in default needs a date; a flag only, S27),
`payment_plan_rows` (C19: deal, `seq`, label, `due_on` or `milestone`, `amount_fils` > 0, `entered_by`; typed by sales through `setPaymentPlan` and checked by the rulebook's `validatePlan`; trigger: fixed while a live agreement exists),
`settlements` (C16, S48: deal, `version` unique per deal, status `proposed|approved|stale|superseded`, rules and policy versions, the canonical `input` and its `input_hash`, price, buyer pays, seller receives, `approval_id`; one `proposed` or `approved` per deal; trigger: content fixed, only status moves `proposed → approved|stale|superseded`, `approved → stale|superseded`, approval linked once, never deleted; deferred constraint trigger: a proposed or approved statement's `price:*` lines add up exactly to its price, which is the deal's price),
`settlement_lines` (C16: statement, `seq`, code, payer, payee, label, `amount_fils` > 0, source, `source_ref`; insert-only, and only while the statement is `proposed`),
`registrations` (C27, S53: one row per attempt to register a deal with the registry, insert-only by trigger: deal, `kind` `oqood_register|oqood_transfer|trustee_transfer`, `attempt` (unique per deal and kind among answered rows; C21 makes the indexes partial so an `unavailable` try is appended again under the same attempt), `request_id` `<dealId>:<kind>:<attempt>` (unique among answered rows), status `submitted|issued|rejected|unavailable`, `registry_no` and `issued_on` (an `issued` row needs both; one `issued` row per deal and kind), `reasons` (the registry's rejection codes), `approval_id` NOT NULL, `payload_hash` (the payload holds ID numbers and is not stored); trigger: the approval must be an `approved` `oqood_submission` (for `oqood_register`) or `transfer_submission` (for the two transfers) of the same deal, an issued row too; rows are never changed, deleted or truncated),
`signing_envelopes` (C28, S54: deal, agreement, `doc_hash` of the approved PDF, status `open|complete|superseded`, `signed_doc_hash` and storage key of the stamped PDF; one open per agreement; trigger: needs the deal's own `approved` agreement with the same hash, completes only when every signature is signed, content fixed, never deleted),
`signatures` (C28: envelope, `seq` (the signing order), role `purchaser|broker|seller`, party, name on the agreement, email, `link_token_hash` (unique; the raw token is only in the email), `link_expires_at`, `link_used_at`, `signed_at`, typed name, consent, ip, user agent, the C14 `anchor` lines; trigger: signed only in order and only while the envelope is open, a signed row never changes, the signer and line are fixed, a resend may replace an unsigned link, never deleted),
`outbound_messages` (C28: every email as evidence: entity, `purpose` `link|reminder|receipt|notice`, `milestone`, recipient and who it was meant for, template and version, subject, body hash, attachment hashes, status `sending|sent|failed`, message id, mail server answer, preview URL, error, sent time; unique per entity, purpose and milestone so a mail is never sent twice; trigger: only the send result changes and a sent row is final; the body is never stored, so a link in it is not),
`portal_links` (C35, S67: deal, party, `purpose` `documents|view`, `token_hash` (SHA-256, unique; the raw token is only in the email), `expires_at` (documents only, from `documentLinkDays`), `used_at`, `superseded_at`, who and when; a partial unique index allows one live link per deal, party and purpose; trigger: only `used_at` and `superseded_at` change, once each, never deleted or truncated), `portal_handoffs` (C38, S70: `jti` primary key and `used_at`; one row per accepted portal token; append-only trigger, never deleted or truncated),
`payment_plans`, `instalments`, `deposits`,
`spa_approvals`, `deal_events` (append-only), `helper_runs`, `deadlines`,
`spa_rulebooks`, `spa_policy`, `spa_demo_settings`,
`copilot_proposals` and `copilot_drafts` (C36, S68: the staff copilot's stored proposals and drafts; its conversation is an `assistant_threads` row of kind `staff` whose principal is a hash of the user id, with `assistant_messages`).

### Buyer and seller portal (C35, S67)

A token is one deal, one person and one purpose. `documents` links act (upload, "Send my documents") and are used up on send; `view` links only read and last as long as the deal. A new link for the same deal, person and purpose supersedes the old one, and a cancelled or completed deal ends every link. Links reach people only by email (`documents_request`; `transfer_booked`, `registered` and the instalment reminder carry a `view` link); a failed mail is shown to staff and a staff resend (`POST /api/deals/:id/parties/:partyId/documents-link`) issues the next link.

Public routes (no session; the token is the only credential, and an unknown or wrong-purpose token is one identical 404, a used, replaced, expired or closed link is a 410 with a plain code): `GET /public/portal/:token/documents` (the person's own document fields and what needs doing again), `POST /public/portal/:token/documents` (multipart `kind` and `file`; the person comes from the token, the kind must be a document field of that person's effective KYC config, a PDF or image by its first bytes up to 10 MB, 30 an hour per link; actor `party:<id>`, event `PARTY_DOCUMENT_UPLOADED` with the link id), `POST /public/portal/:token/documents/send` (queues the KYC run, or the company check, with its usual job key, then uses the link up; opens no gate), `GET /public/portal/:token/status` (party words for the step, one next-step card, own documents with the party-safe reason, the plan and confirmed payments for a buyer, the transfer day, "you sign 2 of 3"). Every response string passes `partyBanned` and `maskPiiText`. The party assistant accepts a portal token (`resolvePartyToken` kind `portal`).

## 9. Scheduling

pg-boss in `spa`. Registry submission (S53): entering `REGISTRATION` or `TRANSFER` proposes `oqood_submission` or `transfer_submission` for the sales admin (hook `onDealEntered`, dedupe key `<dealId>:<gate>`); approving it (hook `onGateApproved`, after the decision commits) queues `spa.oqood.submit` (primary) or `spa.transfer.submit` (resales), singletonKey `<dealId>:<kind>:<approvalId>`. `submitRegistration` checks the gate again, builds the payload from the deal's records by code (no model), makes one call with request id `<dealId>:<kind>:<attempt>` and stores the answer; a number moves the deal (`REGISTERED` or `TRANSFERRED`) as `system:registry` with that approval, which consumes it. A rejection or an "unavailable" answer is stored with a `needs_human` `helper_runs` row (`spa_registry`), then the `registry` helper (`runRegistry`, S56) decides: a rejection is mapped to a field (code table, else the decision model; below 0.6 or `unknown` is a task) and, only when every reason is a buyer or seller name that differs from the KYC-verified name by case or spacing, the name is corrected and resubmitted once under a new request id (once per deal and kind; a second rejection is a `registry_rejected` task for the sales admin); an "unavailable" answer is tried again with the same request id after 5 minutes, 30 minutes and 2 hours (singletonKey `<dealId>:<kind>:<approvalId>:<attempt>:retry:<n>`) and the fourth failure opens a `registry_unavailable` task; every outcome writes a `registry` `helper_runs` row with the model tag and prompt `spa-registry.v1`; `POST /api/deals/:id/registration/request` raises a new proposal (or queues an approved gate that never ran). `GET /api/deals/:id/registrations` lists the attempts. Jobs: `spa.kyc.run`, `spa.company.check`, `spa.ownership.check`, `spa.aml.screen`, `spa.document.read`, `spa.template.read`, `spa.prepare`,
`spa.signing.invite`, `spa.signing.remind` (48 h), `spa.signing.finish`, `spa.oqood.submit`, `spa.transfer.submit`, `spa.noc.expiry` (warn 7 days before), `spa.instalment.remind` (08:00 Dubai, key `instalments-remind:<date>`; T−14, T−3 and T+1 by policy `instalmentReminders`, S56),
`spa.hold.expire`, `spa.listing.expire`, `spa.permit.expire` (unpublish), `spa.offer.expire`, `spa.aml.rescreen`, `spa.chase.sweep` and `spa.chase` (08:30 Dubai, keys `chase-sweep:<date>` and `<dealId>:chase:<date>`; S23, S60), `spa.agreement.review` (key `<agreementId>:review`, S60), `spa.default.check` (S27), `spa.alerts` (hourly, key `alerts:<UTC hour>`, S30, S62), `spa.retention.review` (1st at 01:00 Dubai, key `retention:<yyyy-mm>`, S29, S62: lists, deletes nothing), `spa.report.monthly` (1st at 02:00 Dubai, key `report:<yyyy-mm>`, S29, S62). `singletonKey = "<dealId>:<milestone>"`.

Payments and default (C22, S55): a buyer's transfer receipt is uploaded as a `payment_receipt` document and read by `spa.document.read` (profile `payment_receipt`: amount, date, payer name, receiving account, reference; the model copies text only). `registerPayment` (`POST /api/deals/:id/payments`, sales roles and finance) reads that stored copy and checks by code: `into_escrow` is the receipt's IBAN (`parseIban`: AE plus 21 digits, mod-97) equal to the project's current escrow account (no project code or no account means nothing counts), `payer_is_buyer` is the payer's name exact or typo-class against a buyer. A payment not into the escrow account is `not_counted` with one `payment_not_escrow` task for finance and can never be counted (422 `not_escrow`, finance included); a payer who is not a buyer is `needs_review` (staff see only "Payer name needs review"; the payer becomes the existing non-party screening subject `payer:<name>`, visible to compliance roles only, and a screening is queued); otherwise it waits as `read` with a `confirm_amount` task. `confirmPayment` (`POST /api/payments/:id/confirm`, finance only) types the amount, which may differ from the read one, and only then does it count; the event records both and whether they differ. `instalmentsPaid` is real: true only for a primary deal or an off-plan resale that took a plan over, when every plan row is covered by counted payments (integer fils); false for a ready resale or a deal with no plan; `handoverRecorded` stays false. A counted cash payment adds to that party's `cashFils` in `dealAmlSubjects`, so the AML cash rule fires on the confirmed cash total. `spa.default.check` (daily 00:20 Dubai, key `default-check:<date>`) flags a deal in `INSTALMENTS` when a dated, unpaid plan row's `due_on` plus the pinned policy's `defaultAfterDays` (placeholder 30, confirm with legal) is before today: `in_default`, event `DEFAULT_FLAGGED` (actor `system:default-check`) and one `default_flagged` task for the sales manager (key `<dealId>:default`); no state changes and nothing is sent (S27). `recordPartyDefault` (sales officer or manager, `POST /api/deals/:id/default`) records a withdrawal or no-show the same way; only a sales manager clears the flag (`POST /api/deals/:id/default/clear`, with a reason). A milestone instalment has no due date: no reminder and never overdue by date; `POST /api/deals/:id/milestones/:seq/reached` gives staff one `milestone_reached` task. When a resale's deposit is recorded after every signature, `recordDeposit` queues `spa.signing.finish` again. Admin routes: `PUT|GET /api/escrow-accounts`; `PUT /api/deals/:id/project` (any deal type); `POST /api/tasks/:id/done` (the task's role or a sales manager).

Signing (S54): entering `SIGNING` (hook `onDealEntered`) calls `openSigning`, in the step's transaction: it prints the approved agreement again with its `preparedAt` and refuses (`agreement_changed`, a `needs_human` `helper_runs` row `spa_signing`, event `SIGNING_STOPPED`) unless the bytes hash to `agreements.doc_hash`; otherwise it writes one `signing_envelopes` row and the `signatures` rows in policy order (buyers, broker, then the seller or the company's signatory; the broker only when the template has a broker line). `spa.signing.invite` (key `<envelopeId>:invite`) issues each signer a fresh single-use link valid `signingLinkDays` (14, policy) and emails it; everyone is invited at once and the order is enforced when signing (409 `not_your_turn`). `spa.signing.remind` (key `<signatureId>:remind:<n>`, every 48 h) mails the signer whose turn it is, without a link, and stops on signed, closed or expired. The last signature queues `spa.signing.finish` (key `<envelopeId>:finish`): it stamps each typed name at its anchor, appends the signature record page, stores the signed PDF and its hash, marks the envelope complete and calls `ALL_SIGNED` as `system:signing` (the guards, including a resale's deposit, still apply; a blocked advance is an event `SIGNING_ADVANCE_BLOCKED` and the job may run again), then emails every signer the copy. `allSigned` is real: the live approved agreement's envelope is complete, every signature signed, the hash matches and `agreementPrepared` still holds. A cancelled or superseded agreement supersedes its open envelope in the same transaction. Routes: `GET /public/sign-links/:token`, `GET …/document`, `POST …/sign`; staff `GET /api/deals/:id/signing` and `POST /api/deals/:id/signing/resend`.

Compliance records and alerts (C23, S62): `requireCompliance` guards `POST /api/compliance/deals/:id/export` (store-only ZIP: `summary.pdf`, documents, `screenings.json`, `decisions.csv`, `manifest.json` with every file's SHA-256; each export an `exports` row and a compliance-only `CASE_EXPORTED` event), `GET /api/compliance/exports`, `GET /api/compliance/reports` and `…/<id>.csv|.pdf` (each download logged), `GET /api/compliance/retention` and `POST …/:id/approve` (the approval deletes nothing; deletion is an open item for compliance). Alerts: `GET`/`PUT /api/settings/alerts` (admin writes; the three compliance gates are one `compliance_review` entry), `GET /api/alerts`, `POST /api/alerts/:id/read`; wording is `alertText` in `@spa/core` and a compliance alert is generic and goes to compliance roles only.

Compliance cases (C33, S65): `GET /api/compliance/cases?status=open|info_requested|edd|reported|closed&cursor&limit` and `GET /api/compliance/cases/:id` (`manager/compliance-cases.ts`), `requireCompliance` first (admin and finance get 403 before the query is read, unknown ids 404 for compliance roles only). The tabs read `aml_cases` (closed is `cleared` and `stopped`) and, for EDD, pending `edd_signoff` approvals; paging is keyset like C29. The case view assembles existing rows only (latest `screenings` with the rulebook's `amlNameMatchThreshold`, `aml_hits`, `risk_assessments`, `document_reads` of profiles `sof_evidence` and `edd`, the approval through `getApproval`, and the deal's events that staff do not see) and masks personal numbers. The summary is sent as `suggestion` with a label and is never mixed with the hits.

## 10. Channels

Outbound only by email (shared mail adapter, SPA templates, SPA `SPA_MAIL_FROM`). Buyers and sellers act through
single-use portal links (`/b/<token>/…`): upload documents, accept the plan, sign, see instalments. Every send goes
through `sendSpaMail`, which claims one `outbound_messages` row per (entity, purpose, milestone), sends, and stores the
evidence (S54). Templates are fixed code in `@spa/helpers/src/mail/` (`offer_answer_link`, `sign_link`, `sign_reminder`,
`signed_copy`); subjects read "{Action} · {Property}"; none names AML. Built so far: `/b/<token>/offer` and `/b/<token>/sign`.

## 11. Environment (`.env.spa.local`, S25)

SPA apps read only `.env.spa.local` (template: `.env.spa.example`, committed). Keys: `SPA_DATABASE_URL`,
`SPA_TEST_DATABASE_URL`, `SPA_ENGINE_PORT=4001`, `SPA_WEB_PORT=3001`, `SPA_DEMO_MODE`, `OLLAMA_URL`,
`SPA_CHAT_MODEL`, `SPA_VISION_MODEL`, `SPA_DECISION_MODEL`, `SPA_COPILOT_MODEL`, `SPA_ASSISTANT_MODEL`,
timeouts, `REGISTRY_MOCK_URL=http://localhost:4101`, `REGISTRY_MOCK_FAILURE_RATE=0` (0..1, share of mock requests answered 503; both keys are optional and have these defaults, S53), `SCREENING_ADAPTER=fake`, `SPA_SESSION_COOKIE=spa_session`,
`MAIL_TRANSPORT` (`ethereal` default or `smtp`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SPA_MAIL_FROM`, `SPA_MAIL_DEMO_RECIPIENT` (required with demo mode and real SMTP), `SPA_WEB_URL` (links in mail; default `http://localhost:<SPA_WEB_PORT>`; all optional with defaults, S54), `SPA_DOCUMENTS_DIR`, `SPA_UPLOADS_DIR`, `SPA_MEDIA_DIR`. Parsed with Zod at start;
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
refusal move from `@leasing/core` `kyc-config.ts` to `@platform/kernel` (domain-free) with the document-kind list
as a parameter; leasing passes its kinds, SPA adds title deed, Oqood, POA, board resolution, MoA, NOC and
bank letters (built in P1: `defineKycForm(readKinds, specs)`, S32). `spa-kyc` and `company-check` read the party's role config version at start and record it.

**Screens (C34, S66).** Settings → KYC forms edits a draft per role and deal-type override through `saveKycDraft` and publishes it with `publishKycDraft`; `effectiveKycConfig` says what is in force; published versions are read-only (`GET`/`PUT /api/settings/kyc`, `POST /api/settings/kyc/publish`: admin edits, sales manager reads). The AML policy has its own page, `/compliance/policy` (`GET`/`PUT /api/compliance/policy`): the compliance officer publishes a new version, the MLRO reads, every other role gets 403 on the route and an admin sees only the neutral card "Compliance rules, managed by compliance". Values that are still the version-0 placeholder carry a "Confirm with compliance" pill. Two first publishes of a policy that clash on the version number answer 409 `version_taken` (policy, AML policy and helper modes). The manager rule in `publishAmlPolicy` (admin or compliance officer, S42) is unchanged. Templates: the upload, the sample check and the preview are described in S66 and §7 (Templates).

## 13. UI rules (S21)

Follow `docs/spa/design.md` (S31): leasing tokens and components from the shared `@platform/ui` package, the
rail · main · copilot dock shell with Portal and Sign out in the avatar menu, the screen templates, link rules and
status words. No other module is named, linked or counted anywhere in the app.

Staff screens (C30, S58): `/` Home, `/work` (Deals and Tasks tabs) and `/work/deals/[id]` read only C29's routes through
`lib/loaders.ts` (zod-parsed in `lib/contracts.ts`); the one write is `POST /api/tasks/:id/done`. Steps per deal type are
`stepsFor` in `@spa/core`. The record shows only the sections the engine sent, so a later chunk adds an engine section and its web
renderer together. Components live in `modules/spa/apps/web/components` (`DealStepper`, `WaitingBanner`, `PartyCard`,
`ActivityLog`, `StateBadge`, `Amount`, `DealTable`, `TaskList`, `HomeView`, `WorkFilters`, `DealRecord`).

Settings → AI helpers (C24, S59): `/settings/helpers` (admin edits, sales manager reads) shows each helper with a three-way mode control
(Auto, Review, Off), its model read-only and the note "A model or prompt change needs its eval to pass". Its one write is
`PUT /api/settings/helpers` (helper, scope, mode). `HelperSettingsView` is the component.
