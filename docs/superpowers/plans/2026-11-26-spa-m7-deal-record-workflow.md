# SPA M7: Deal Record Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deal record (`/work/deals/[id]`) reads like leasing's application/lease record and is driven by one **Next step** card per state and role. The card tells the viewer what to do now, or who it waits on and why. Every stage's button runs the existing engine function, so a deal can be walked from `OFFER_AGREED` to its end by clicking.

**Architecture:**
- The engine computes `nextStep` by code from the deal machine, its facts and the viewer's role (`manager/next-step.ts`). It returns either an action the viewer may run, or a wait (`role`, plain reason, optional `gate`).
- The web renders it in `components/deal-next-step.tsx` with leasing's highlighted `Section` "Next step" (see `modules/leasing/apps/web/components/application-actions.tsx`).
- New HTTP routes expose the manager functions that exist but have no route (advance, cancel, owner, payment-plan edit form). Stage-specific forms that M8/M9 own get a placeholder link to their section, not a duplicate form.
- The record is reordered to the AGENTS.md rule: Next step → Overview → Documents → stage details → Deadlines → Open work → Activity last. Every section and sub-section is collapsible.
- The Home tiles and queue match leasing Home: tiles for Waiting for you, Offers out, Viewings today; a queue with All / Approvals / Tasks; and Agent activity today.

**Tech Stack:** Bun, Hono, Drizzle, Zod, Next 16, `@platform/ui`.

**Spec:**
- The parent plan (M7 row)
- `docs/spa/specs.md` and `architecture.md` (deal machine per type, S13; gates table)
- The `dubai-sales-spa` skill
- M5b (`DemoHandoff`)
- Leasing reference screens: `modules/leasing/apps/web/components/{application-detail,application-actions,lease-detail}.tsx` and `modules/leasing/apps/web/app/(staff)/{page.tsx,home-queue.tsx}`, plus `components/live/home-tiles.tsx`

## Global Constraints

- **Code decides the next step, never a model.** It is computed from the machine's allowed events, guard results and open gates.
- **Waits use role names and plain words.** For AML, any viewer outside compliance/MLRO sees only "Under review" (no tipping-off). The case reason shows only to compliance roles, on the compliance screens.
- **Buttons call the same routes the rest of the app uses.** A refused guard shows the machine's reasons. No client-side state change.
- **Cancel:** sales roles propose cancellation (reason box), which opens the `cancellation` gate for the sales manager. Nobody decides their own proposal.
- **Owner reassignment:** sales_manager or admin only, with an event.
- **Payment plan edit:** `PUT /api/deals/:id/payment-plan` (exists). The web shows the plan form until the agreement is prepared, and read-only after that.
- No `new Date()` in domain code. Don't run `next build`. Run DB test files one at a time. Leasing stays untouched.

## Next-step table (engine)

| State (type) | Viewer can act | Action | Otherwise waits on |
|---|---|---|---|
| OFFER_AGREED | sales roles | "Start party checks" (`CHECKS_STARTED`); needs a plan for primary | sales |
| PARTY_CHECK | sales roles | "Request documents" → Documents section (M8); "Run checks" when docs are in | parties' documents, KYC review (manager) |
| AML_HOLD | compliance_officer / mlro (link to the case) | open the case | others: "Under review" (compliance) |
| AGREEMENT_DRAFT | sales_admin, sales roles | "Prepare the agreement" (`POST /api/deals/:id/prepare`) | template approval (legal) if missing |
| LEGAL_REVIEW | legal | review → Agreement section (M9) | legal |
| SIGNING | sales roles | "Resend a signing link" (exists) | parties signing (shows who hasn't) |
| NOC | sales_admin | "Record the NOC" → NOC section (M8) | developer NOC |
| FINANCE | sales roles | "Add bank letters" → Banks section (M8) | banks / amount confirmation |
| SETTLEMENT | finance | "Review the settlement" (gate) | finance |
| REGISTRATION / TRANSFER | sales_admin | "Submit to the registry" (gate) → Registration section (M9) | registry (simulated) |
| INSTALMENTS | finance, sales | "Record a payment" (exists) | buyer payments |
| terminal | none | "This deal is complete" / "Cancelled: <reason>" | none |

The implementer must check this table against the real `dealMachine` states, events and guards, and fix the table and the docs where they differ. The machine is the source of truth.

## Review Focus

1. **Two open gates at once** (for example `price_out_of_range` and `kyc_review`): the card lists both waits, oldest first, each with its approver and the demo hand-off. (Task 1)
2. **A viewer with no role in the current step** (for example finance at PARTY_CHECK): read-only card "Waiting for Sales: …" with no buttons. (Task 1)
3. **A deal in default (`in_default`):** the card shows the default flag and the "Clear default" action for finance, on top of the stage's step. (Task 1)
4. **Cancel proposed, then the proposer opens the inbox:** they can't decide it ("You proposed this; another manager decides"). The hand-off offers Karim. (Task 2)
5. **A stale page:** clicking a step another user already took returns 409. The card refreshes (live poll from M1) and shows the new state, not an error page. (Task 3)

---

### Task 1: `nextStep` in the engine

**Files:**
- Create `modules/spa/apps/engine/src/manager/next-step.ts`
- Modify `record-reads.ts`, so `getDealRecord` returns `nextStep`
- Test `modules/spa/apps/engine/test/next-step.test.ts` (new, DB)

**Interfaces:**
```ts
export type NextStep =
  | { kind: "act"; label: string; action: { route: string; method: "POST" | "PUT"; body?: unknown } | { section: string }; reasons: string[] }
  | { kind: "wait"; waits: { role: SpaRole; roleLabel: string; text: string; gate?: string; since: string }[] }
  | { kind: "done"; text: string };
nextStepFor(ctx, dealId, viewer: { id: string; role: SpaRole }): Promise<{ primary: NextStep; extra: NextStep[] }>
```

- [ ] **Step 1: write the tests.** Cover one test per table row for each deal type that reaches it (seeded through the manager functions), plus Review Focus 1–3. Assert AML text for a sales officer equals "Under review".
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 2: Routes for advance, cancel and owner

**Files:**
- `app.ts`
- `manager/advance.ts` and `deals.ts`, using the existing functions
- Test `modules/spa/apps/engine/test/deal-actions.test.ts`

**Routes:**
- `POST /api/deals/:id/steps` with `{ event }`. Only events the viewer's role may trigger by hand are allowed. A refusal returns 409 `step_refused` with `reasons`.
- `POST /api/deals/:id/cancel` with `{ reason }`. This proposes the `cancellation` gate.
- `PUT /api/deals/:id/owner` with `{ userId }`.

- [ ] **Step 1: write the tests.** Cover the role matrix for `/steps`, cancel opening a gate (including Review Focus 4), owner reassignment by manager/admin only, and 409 on a stale state.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 3: The record rebuilt

**Files:**
- `components/deal-record.tsx` (reordered)
- Create `components/deal-next-step.tsx` and `components/payment-plan-form.tsx`
- `app/(staff)/work/deals/[id]/actions.ts`
- Test `modules/spa/apps/web/test/deal-record.test.tsx`

**Order:** title row (ref, state pill, type, price) → stage stepper (type-specific steps) → **Next step** (highlighted; act button, wait rows with `DemoHandoff`, extra steps) → Overview → Parties → Documents (sub-cards from the existing sections) → the stage details (Agreement, Signing, NOC, Banks, Settlement, Registration, Payment plan) → Deadlines (target transfer date, offer validity, permit, signing expiry) → Open work (approvals, tasks) → Activity last.

All sections are collapsible. The Payment plan section gets the edit form while editable. The live refresh (`@platform/ui/live`) polls the record every 15 s while the tab is visible.

- [ ] **Step 1: write the tests.**
  - Section order in the HTML.
  - The Next step renders `act` with a button, `wait` with role names, and AML "Under review".
  - Cancel opens a reason box first.
  - No enum text.
  - Read-only roles see no buttons (`noToggles`).
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 4: Home and Work like leasing

**Files:**
- `app/(staff)/page.tsx`
- `components/home-view.tsx` → `components/home-tiles.tsx`, `home-queue.tsx`, `home-activity.tsx`
- Engine `GET /api/home`: add `offersOut`, `viewingsToday`, `agentToday` (helper and system events of today) and `waitingForYou`
- The Work deals table gets columns Next step and Waiting on
- Test: `home.test.tsx`, plus an engine home test

Match leasing Home's markup: tiles row, "Your queue" with segmented All / Approvals / Tasks and an "All tasks" link, and "Agent activity today". Home starters feed the dock as in leasing (`HOME_STARTERS` event, built by code from counts).

- [ ] **Step 1: write the tests.** Tiles show counts from the engine, the queue filters, and activity rows link to records.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 5: Docs, review and browser run

- [ ] **Step 1: docs.** Add S82 to decisions.md: "Deal record driven by a code-computed Next step per state and role; waits name roles only; AML shows 'Under review' outside compliance." Update the design.md record section, architecture.md and the skill (one line). Tick M7 in the parent plan.
- [ ] **Step 2: compliance review.** Run the `compliance-reviewer` subagent (next-step texts, tipping-off, gates, cancel) and fix what it finds.
- [ ] **Step 3: demo reset.** Run `spa:demo:reset` and restart the SPA engine (kill only the pid whose cwd is `modules/spa/apps/engine`).
- [ ] **Step 4: screenshots.** Save to `/tmp/claude-1000/m7-shots`:
  - a deal in each of OFFER_AGREED, PARTY_CHECK, AML_HOLD (as Rania, then as Sara via the hand-off), LEGAL_REVIEW (as Omar), SETTLEMENT (as Huda) and a completed one
  - SPA Home next to leasing Home at 1440
  - one walk: as Rania, Start party checks on a fresh M6 deal, then use the hand-off to the next approver
- [ ] **Step 5: checks.** Run `bun run typecheck`, `bun run lint`, `bun test modules/spa/apps/web`, the new and touched engine DB files one at a time, and leasing web (expect 132/132). Report the counts.
