# Slice 2: Agentic staff shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff work from four places (Home, Workspace, Units, Settings) instead of 13 nav items.
Home pairs the copilot with live quick actions. Workspace shows one record's activity log with
inline actions and a detail pane. Admins toggle the agent's soft steps in Settings → Agent.
Move-in → move-out hides behind `TENANCY_OPS=false`.

**Architecture:** Agent toggles live in a new `autopilot` object on the versioned
`CompanyPolicy`, so each change is a new policy version with author and date; engine code reads
them at the six step points. `TENANCY_OPS` goes into `EngineContext` and the web env and gates
scheduling, routes, inbound types and copilot tools. The Workspace reads one merged log endpoint.
Existing application and lease page bodies are extracted into components and reused in the
Workspace detail pane.

**Tech Stack:** Bun, TypeScript strict, Hono, Drizzle, pg-boss, Next.js 16 (D18 vanilla CSS tokens).

**Spec:** `docs/superpowers/specs/2026-10-27-contract-ai-redesign-design.md` §5, §6 (Staff Home,
Workspace, Settings), §7, §8 (seed applications), §9 slice 2.

## Global Constraints

- AGENTS.md rule 3: no toggle may skip `final_contract`, `ejari_submission`,
  `price_out_of_range`, `offer_out_of_limits`, flagged `kyc_review` or recording a reservation
  payment. Toggles can only make a soft step manual (or, for "apply without viewing", allow a
  step the state machine already has).
- AGENTS.md rule 11: the copilot never approves, sends or changes state. Home only reuses the
  existing copilot.
- Defaults keep today's behaviour: viewing booking from chat **on**, apply without viewing
  **off**, auto-verify clean KYC **on**, auto-send offer revision 1 **on**, auto-send in-limit
  counters **on**, auto-prepare contract **on**.
- `TENANCY_OPS` defaults to `false` in `.env.example` and env parsing. Test harness contexts set
  `tenancyOps: true` so existing tenancy tests keep running; new tests cover `false`.
- Every state change appends `lease_events` with actor and `rulesVersion`. Held steps record an
  event too (`OFFER_HELD`, `CONTRACT_PREP_HELD`, …) so the log shows why nothing happened.
- UI: D18 tokens; staff dials variance 4, motion 3, density 5; no em or en dashes in copy;
  labels above inputs; no new UI libraries; reuse `apps/web/lib/icons.tsx`.
- **Do not commit** (user preference). Don't run `next build` while dev runs. Restart the
  engine after `packages/*` edits. Agents can't read `.env`.

## Review Focus

1. **Toggle off mid-flight**: an application already in OFFER when "auto-send offer" is
   switched off must not lose its sent offer; a held offer must send exactly once when the
   officer confirms, even on a double click (idempotent outbound key). Test in Task 2.
2. **Toggle read at the right time**: the policy version in force *today* (Clock) decides, and
   the event payload records `policyVersion`. Test in Task 1.
3. **TENANCY_OPS off with existing ACTIVE leases**: no rent reminders, renewal milestones or
   move-out jobs are created, and existing deadlines of those kinds are skipped by the sweep,
   not failed. Test in Task 4.
4. **Workspace inline approve**: a user who can't decide a gate sees no Approve button, and the
   route still refuses (403) if called. Test in Task 5 (route) and Task 8 (UI hides it).
5. **Redirects**: old bookmarks `/inbox`, `/applications/<id>`, `/leases/<id>`,
   `/conversations/<id>`, `/copilot` land on the right Workspace record or Home. Test by
   route list in Task 7.

---

### Task 1: Autopilot policy and KYC / contract toggles

**Files:**
- Modify: `packages/core/src/policy.ts`, `apps/engine/src/manager/applications.ts` (KYC path
  ~line 644–721; contract prepare queue ~line 300), `apps/engine/src/manager/events.ts`
  (`getCompanyPolicyVersion` if needed), `apps/engine/src/api/app.ts` (policy routes)
- Test: `packages/core/test/policy.test.ts` (or nearest), `apps/engine/test/applications.test.ts`,
  `apps/engine/test/api.test.ts`

**Interfaces:**
- Produces in core:
  - `AutopilotStep = z.enum(["chat_viewing_booking","apply_without_viewing","auto_kyc_verify","auto_send_offer","auto_send_counter","auto_prepare_contract"])`
  - `CompanyPolicy.autopilot: Record<AutopilotStep, boolean>` with `.default(...)` = the
    defaults in Global Constraints (so stored older policy versions parse).
  - `AUTOPILOT_STEPS: { id: AutopilotStep; label: string; offMeans: string }[]` (labels/copy
    from spec §5 table, verbatim).
  - `LOCKED_STEPS: { label: string; reason: string }[]`: final contract, Ejari submission,
    offer or price outside limits, flagged KYC, recording a reservation payment; reason copy:
    "Required by law or company money rules. A person always decides."
- Produces in engine:
  - `PUT /api/policy/autopilot` (admin only): body `Partial<Record<AutopilotStep, boolean>>` →
    inserts a new `company_policy` row (next version, `effectiveFrom` = today, values = current
    values with the merged autopilot, `createdBy` = `user:<id>`); returns the new version.
  - `GET /api/policy` unchanged shape plus `autopilot`.

- [ ] **Step 1: Failing tests**:
  - old stored policy JSON without `autopilot` parses with the defaults;
  - `PUT /policy/autopilot` as officer → 403; as admin → new version, `GET /policy` shows it;
  - `auto_kyc_verify=false`: a clean KYC run opens a `kyc_review` approval (reason "Automatic
    KYC verification is switched off.") instead of `KYC_VERIFIED`; payload has `policyVersion`;
  - `auto_prepare_contract=false`: `OFFER_ACCEPTED` → lease created, **no** `contract.prepare`
    job, a `CONTRACT_PREP_HELD` lease event and an officer task "Prepare the contract"; the
    existing `POST /leases/:id/contract/prepare` still works.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** focused tests → PASS.

### Task 2: Offer and counter-offer hold

**Files:**
- Modify: `apps/engine/src/manager/applications.ts` (`proposeFirstOffer` ~line 850–902,
  counter path ~line 1030–1087), `apps/engine/src/api/applications.ts`
- Test: `apps/engine/test/applications.test.ts`

**Interfaces:**
- When `auto_send_offer=false`: entering OFFER stores revision 1 as today but does **not**
  `queueMail(..., "offer", 1)` and does not schedule the expiry deadline; appends
  `OFFER_HELD {revision, policyVersion}` and an officer task "Send offer revision 1".
- When `auto_send_counter=false`: an in-limits counter becomes the new revision but is held the
  same way (`OFFER_HELD`).
- New `POST /api/applications/:id/offer/send` (leasing officer or manager): sends the current
  held revision (`queueMail` with the same idempotency key as the automatic path), schedules its
  expiry (expiry counts from the send date: `expiresOn = today + offerValidDays`, recomputed),
  appends `OFFER_SENT {revision}`, closes the task. 409 `offer_not_held` when nothing is held.

- [ ] **Step 1: Failing tests**: hold on enter; send once (second call → 409, one outbound row);
  counter hold and send; toggling off while an offer is already sent changes nothing for it.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.

### Task 3: Chat booking and apply-without-viewing toggles

**Files:**
- Modify: `apps/engine/src/manager/enquiries.ts` (~line 886–960, booking from Telegram/web
  chat), `apps/engine/src/manager/applications.ts` (ENQUIRY → SCREENING), web-chat fixed replies
- Test: `apps/engine/test/enquiries.test.ts`, `apps/engine/test/web-chat.test.ts`,
  `apps/engine/test/applications.test.ts`

**Interfaces:**
- `chat_viewing_booking=false`: the chat still collects contact and the wanted slot but creates
  the application in ENQUIRY with `requested slot` in the event payload and an officer task
  "Confirm a viewing time"; reply (EN): "Thanks. A leasing officer will confirm your viewing
  time by email." (AR: reuse the existing translation style in the enquiry replies file; add the
  Arabic string next to the English one).
- `apply_without_viewing=true`: staff can apply `APPLIED` from ENQUIRY (the existing machine
  transition) via `POST /api/applications/:id/events` with `APPLIED`; with the toggle off that
  call is 409 `viewing_required`. (The chat "Apply now" button is slice 3.)

- [ ] **Step 1: Failing tests** for both toggles in both states.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.

### Task 4: `TENANCY_OPS` flag

**Files:**
- Modify: `packages/core/src/env.ts`, `.env.example` (add `TENANCY_OPS=false` with a comment),
  `apps/engine/src/context.ts`, `apps/engine/src/main.ts`, `apps/engine/test/harness.ts`,
  `apps/engine/src/manager/milestones.ts` (`scheduleLeaseMilestones`, sweep),
  `apps/engine/src/manager/collections.ts` (`scheduleTermPayments`), `apps/engine/src/api/app.ts`
  (route registration), `apps/engine/src/api/portal.ts` + inbound handling,
  `packages/copilot/src/tools/index.ts` (`toolsFor`), `apps/web/lib/env` or wherever the web
  reads env, tenant portal pages under `apps/web/app/t/[token]/`
- Test: `apps/engine/test/tenancy-ops.test.ts` (new), `packages/copilot` tool tests

**Interfaces:**
- `EngineContext.tenancyOps: boolean` (from env `TENANCY_OPS`, default false).
- Off means:
  - `scheduleLeaseMilestones` and `scheduleTermPayments` do nothing (lease activation and import
    still succeed); the sweep skips (marks `skipped`, not failed) existing deadlines whose
    milestone is a renewal, collections, move-out or notice milestone;
  - `registerTenancyRoutes`, `registerRenewalRoutes` and `registerTenancyDemoRoutes` are not
    registered (404); `GET /sri` must stay available, so move it out of `renewals.ts` into a
    small always-registered spot first;
  - `POST /api/inbound` rejects `MOVE_IN_ACKNOWLEDGED`, `PAYMENT_REPLY`, `COMPLAINT_SUBMITTED`,
    `VACATE_NOTICE`, `INSPECTION_BOOKED`, `DEPOSIT_RESPONSE`, `RENEWAL_REPLY`,
    `NOTICE_ACKNOWLEDGED` with 404 `not_available`;
  - `toolsFor(role, { tenancyOps: false })` drops `compute-renewal-cap`, `list-payments`,
    `list-tickets`, `get-case-pack`, `summarise-case`;
  - web: the tenant portal pages `move-in`, `payment`, `report`, `vacate`, `inspection`,
    `deposit`, `acknowledge` call `notFound()`; the lease portal home hides those forms.
- Copilot `propose-approval` keeps `formal_reminder` and `vacate_notice` only when on.

- [ ] **Step 1: Failing tests**: activation with flag off creates no payments/deadlines; sweep
  skips an existing renewal deadline; tenancy routes 404; inbound type rejected; tool list.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS; full `bun test packages apps/engine`.

### Task 5: Workspace and Home API

**Files:**
- Create: `apps/engine/src/api/workspace.ts`, `apps/engine/src/manager/workspace.ts`,
  `packages/db/migrations/0019_*.sql`
- Modify: `packages/db/src/schema.ts` (`savedViews`), `apps/engine/src/api/app.ts`
- Test: `apps/engine/test/workspace-api.test.ts`

**Interfaces:**
- `GET /api/records?view=<id>|&q=&stage=&mine=1` → applications and leases as rows
  `{ kind: "application"|"lease", id, ref, title (applicant or tenant name), unitCode, stage,
  nextStep: string, owner: StaffRole|"agent"|"applicant"|"tenant", waitingForMe: boolean, updatedAt }`,
  grouped client-side by `stage`. Stages in order: Enquiry, Viewing, Documents, Offer, Reserved,
  Contract, Ejari, Registered. A lease replaces its application (the application row is not
  listed again once CONVERTED). `nextStep` copy comes from a pure function
  `nextStepFor(record)` in `manager/workspace.ts` with one test per stage.
- `GET /api/records/:kind/:id/log` → entries merged by time (newest first), each
  `{ at, source: "event"|"approval"|"email"|"task", actor: { kind: "agent"|"user"|"applicant"|"tenant"|"system", name }, text: string, refId, pending: boolean, actions: ("approve"|"reject"|"edit"|"send_offer"|"prepare_contract"|"record_viewing_outcome"|"record_reservation"|"done")[] }`.
  Sources: `lease_events` for the application, its lease and its contract/Ejari rows;
  `approvals` on those entities; `outbound_messages` on those entities; `tasks` on them.
  Pending items (open approvals the user can decide, open tasks, held offers) come first with
  `pending: true`. `actions` only lists what this user may do (`canDecideGate`, roles). Text is
  one plain sentence from a pure `describeEntry()` (e.g. "Agent drafted offer revision 1, within
  limits." / "You approved the final contract." / "Email sent: offer link."). Actor mapping:
  actor `helper:*` or `system` → agent/system; `user:<id>` → that staff name ("You" for self);
  `applicant:*`/`tenant:*`/`enquirer:*` → applicant/tenant.
- `GET /api/home` → `{ viewingsToday, offersOut, awaitingSignature, ejariPending,
  waitingForYou, agentToday: LogEntry[8] }` (Dubai calendar day from Clock; `waitingForYou` =
  pending approvals this user can decide + open tasks for their role).
- Saved views: `savedViews` table `id, staffUserId → staff_users, name (1–40), filter jsonb
  ({stage?, q?, mine?}), createdAt`; unique `(staffUserId, name)`; routes `GET/POST
  /api/views`, `DELETE /api/views/:id` (own views only, else 404).

- [ ] **Step 1: Failing tests**: list grouping/`nextStepFor` per stage; log merges four sources
  in order with pending first; an officer sees no `approve` on a manager gate and
  `POST /approvals/:id/decide` still 403s; home counts on a fixture; saved views CRUD + other
  user's view 404.
- [ ] **Step 2–4:** run → FAIL, implement (generate migration with
  `bun run --cwd packages/db generate`), run → PASS.

### Task 6: Seed applications at every stage

**Files:** `apps/engine/src/demo/seed.ts`, `packages/core/src/demo-units.ts`,
`apps/engine/test/demo-seed.test.ts`

- After the units are listed, walk fictional applicants (new fictional names and emails at
  `@demo.example`, EIDs from the existing `fictionalEid`) through the Manager to reach: VIEWING
  (booked tomorrow), SCREENING with an open upload link, OFFER sent, OFFER held (needs
  `auto_send_offer` off for that one call: pass an explicit policy override only inside the
  seed, or insert the held state through the same Manager function with a policy argument),
  RESERVED → lease in CONTRACT awaiting signature, lease in REGISTRATION with an Ejari
  submission pending approval, and one registered lease (ACTIVE with an Ejari certificate).
  Use the seed's existing fake helpers pattern (canned clean KYC run, the Ejari mock contract)
  rather than a model; if a stage can only be reached by importing a lease row
  (`importedLeaseState`), use that.
- [ ] **Step 1:** test asserts one record per stage exists and `GET /api/records` returns
  every stage group non-empty. **Step 2–4:** FAIL → implement → PASS; demo seed console lines
  describe each new record like the existing ones.

### Task 7: Shell, nav and redirects; Settings → Agent

**Files:**
- Modify: `apps/web/components/nav.tsx`, `apps/web/app/(staff)/layout.tsx`,
  `apps/web/next.config.ts` (redirects), `apps/web/components/settings-tabs.tsx`
- Create: `apps/web/app/(staff)/settings/agent/{page.tsx,actions.ts,agent-form.tsx}`
- Move: `rules`, `sri`, `import`, `demo` routes under `apps/web/app/(staff)/settings/`
  (`settings/rulebook`, `settings/rent-index`, `settings/import`, `settings/demo`) with
  redirects from the old paths.

- Nav: **Home** (`/`), **Workspace** (`/work`, badge = waiting-for-you count), **Units**,
  **Settings**. Maintenance, Metrics, Tasks and Enquiries leave the nav (Metrics stays reachable
  at `/metrics`; Maintenance only when `TENANCY_OPS`).
- Redirects (permanent false): `/inbox` → `/work?view=waiting`; `/inbox/:id` →
  `/work?approval=:id`; `/applications/:id` → `/work?kind=application&id=:id`; `/leases/:id` →
  `/work?kind=lease&id=:id`; `/conversations` → `/work?stage=Enquiry`; `/copilot` → `/`;
  `/rules*`, `/sri`, `/import`, `/demo` → their Settings paths.
- Agent tab: one row per `AUTOPILOT_STEPS` item (label, "Off means: …", switch); below,
  "Always a person" list from `LOCKED_STEPS` with a lock icon and the reason; admin can toggle,
  others read-only; saving calls `PUT /api/policy/autopilot` and shows "Saved as policy version N."

- [ ] **Step 1:** implement; `bun run typecheck` and `bun run lint` PASS.
- [ ] **Step 2:** list every redirect in the report with the target it resolves to.

### Task 8: Home and Workspace screens

**Files:**
- Create: `apps/web/app/(staff)/work/{page.tsx,record-list.tsx,activity-log.tsx,detail-pane.tsx,actions.ts,views.tsx}`,
  `apps/web/components/application-detail.tsx`, `apps/web/components/lease-detail.tsx`
- Modify: `apps/web/app/(staff)/page.tsx` (Home), `apps/web/components/copilot/*` (embed the
  chat in Home; drop the header panel when on Home), `apps/web/app/globals.css`
- Extract the body of the current application and lease detail pages into
  `application-detail.tsx` / `lease-detail.tsx` (no behaviour change) and render them in the
  detail pane; the old pages are now redirects (Task 7).

Layout and copy:
- **Home:** five tiles in one row (wrap to 2 columns under 1024px): "Viewings today",
  "Offers out", "Awaiting signature", "Ejari pending", "Waiting for you"; each shows the count and
  links to `/work?...` pre-filtered. Below: the copilot, full width, heading
  "What should we move forward today?", suggestion chips built from non-zero counts (e.g.
  "Show the 3 offers waiting on applicants"). Below: "Agent did today", up to 8 log entries.
- **Workspace:** three panes. Left (280px): search, saved views (+ "Save view"), records grouped
  by stage with count, each row: ref (mono), name, unit, next step, owner. Centre: record header
  (ref, name, unit, stage) then the activity log; pending entries pinned at top on
  `--accent-soft` with their action buttons; each entry: actor chip (Agent / You / name /
  Applicant), one sentence, relative time; clicking selects it. Right (360px, collapsible):
  details of the selected entry (proposal and sources for approvals, email evidence, event
  payload rendered as label/value) or, with nothing selected, the full record detail component.
  Under 1024px the right pane becomes an overlay sheet.
- Inline actions call the existing routes (`/approvals/:id/decide`, the new offer send,
  `/leases/:id/contract/prepare`, viewing outcome, reservation) through server actions and
  revalidate; errors show inline under the entry.
- Empty states: "No records match this view." / "Pick a record to see its activity."

- [ ] **Step 1:** implement; typecheck + lint PASS.
- [ ] **Step 2:** with the `run` skill (if the engine and DB are available), walk: Home tile →
  Workspace filter → approve a final contract inline as officer → log updates; check an officer
  sees no Approve on a manager gate; light and dark. If the app can't be run, list what remains
  for the user to check.

### Task 9: Docs, compliance review, full verification

- D33 in `docs/decisions.md` (autopilot toggles and the locked list; held-step events; the
  `TENANCY_OPS` flag and what it hides; nav change and redirects; saved views); architecture §3
  (held steps on the application diagram notes), §7 (flag and scheduling), §8b (copilot tools
  filtered); `docs/specs.md` scope note (product ends at Ejari registration by default);
  `.claude/skills/dubai-leasing/SKILL.md`; `docs/roadmap.md` tick slice 2.
- Run the `compliance-reviewer` subagent on the slice diff (toggles vs rule 3, copilot registry
  vs rule 11, held steps auditable) and fix findings.
- `bun run typecheck && bun run lint && bun test` PASS. Report; remind the user to add
  `TENANCY_OPS=false` to `.env` (agents can't edit it) and restart.
