# SPA M5c: Combined Roles (four demo users) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One staff user can hold several roles, so a small company (and the demo) runs the whole sale with four people:

| Person | Main role | Also holds |
|---|---|---|
| Rania | Agent (sales_officer) | none |
| Karim | Manager (sales_manager) | compliance_officer, mlro |
| Omar | Legal (legal) | finance |
| Adam | Admin (admin) | sales_admin |

The back-office users (Lina, Huda, Sara, Yusuf) are no longer seeded. The sign-in page shows only the four people and no "Back-office roles" section.

**Architecture:**
- `spa_users.extra_roles text[]`, default `{}`, with a check that every value is a known role and differs from `role`.
- The session user carries `roles: SpaRole[]`: the main role first, then the extras.
- Every role check moves from `user.role === X` / `LIST.includes(user.role)` to `hasRole(user, X)` / `hasAnyRole(user, LIST)` from `@spa/core/roles`.
- `user.role` stays the main role, used for labels and the rail's home screen.
- Admin settings (Users page) gain an "Also acts as" multi-select, so a client can combine roles too. Admin only.
- The user's instruction (2026-11-26) overrides the M5b plan's "no change to roles".

**Spec:** the user's message on 2026-11-26: "remove the dependencies of other roles completely … omar for finance and karim can also do aml and MLRO". The rest comes from the M5b plan, the `dubai-sales-spa` skill (gate/approver table, S20, maker-checker) and the M1–M5b review findings (Task 5).

## Global Constraints

- **Gates are unchanged.** Each gate still has exactly one approver role. A user may decide a gate when any of their roles is its approver.
- **`admin` alone approves nothing.** An admin who also holds `sales_admin` may decide sales_admin gates, through that role only.
- **Maker-checker stays.** Nobody decides their own proposal.
- **Compliance officer who is also the MLRO.** When such a user decides an `aml_flag` with "stop and report", the `aml_report` row is still created, for the audit trail and the report record. It is recorded as **decided in the same step by that user**, with the note "The compliance officer is also the MLRO". It is not left pending for a self-approval the rule would refuse.
  - When the roles are held by two different people, the current flow is unchanged.
  - Test both cases.
- **Tipping-off.** AML reasons are shown only through the compliance roles. Karim sees them because he holds compliance_officer. Rania still sees "Under review".
  - The demo hand-off names the person and their **main** role only, e.g. "Under review · Switch to Karim (Manager)". The role's name "Compliance" is never shown to a sales user. This answers the review's S20 note.
- **Every role change is an event.** Changing a user's roles appends an event (entity `settings`) with old and new role sets. The rail and screens recompute from `roles`.
- **Tests.** Every existing role test must still pass with single-role users. Add multi-role tests for each changed check category.
- **Never:** `new Date()` in domain code, running `next build`, or running DB test files in parallel.
- **Leasing is untouched.** Leasing roles are a separate model.

## Review Focus

1. **Karim proposes a cancellation (sales role) and opens his inbox:** he can't decide it ("you can't approve your own proposal"). The demo has no second manager, so the hand-off says "No other demo user can decide this". The demo shows this case on purpose. In the seed, Rania proposes cancellations so Karim can decide them. (Task 2)
2. **Omar (legal + finance) and a settlement:** he decides `settlement_approval` as finance and `agreement_approval` as legal on the same deal. Both are allowed because neither is his own proposal. (Task 2)
3. **Adam opens Work → Inbox:** he sees the sales_admin gates (NOC review, Oqood and transfer submission) with Approve buttons, and no other gates. (Task 2)
4. **A user's extra role is removed while they have the page open:** the next action returns 403 and the page shows the normal not-allowed message. (Task 3)
5. **Karim's compliance screens:** the `/compliance` rail item appears for Karim, and its counts and case reasons show. Rania's rail has no Compliance item. (Task 3)

---

### Task 1: Data model and helpers

**Files:**
- `modules/spa/packages/db/src/schema.ts`
- migration `0069_m5c_extra_roles.sql`
- `modules/spa/packages/core/src/roles.ts`: add `hasRole`, `hasAnyRole`, `rolesOf`; `railItems(roles: SpaRole[], kind)` takes the union
- session code in the engine (`auth`, `/api/me`) and the web (`lib/session.ts`, `ShellUser`)

- [ ] **Step 1: write the tests.** Cover the helpers; `railItems` for Karim (Home, Work, Inventory, Listings, Compliance; settings per the existing rules); the DB check rejecting an unknown or duplicate role; and `/api/me` returning `roles`.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 2: Replace role checks

**Files:** every `user.role` check under `modules/spa/apps/engine/src` and `modules/spa/apps/web` (about 120 files; use grep).

Keep `role` only where the main role is meant: labels, the avatar menu and `DEMO_SHORT_ROLE`. Mechanical, but read each site.

`mayDecide(approval, user: { id; roles })` behaves like this:
- admin-only users are refused;
- otherwise a user may decide when `roles.some(r => canDecideSpaGate(gate, r))`;
- the self-proposal rule is unchanged.

Add the combined compliance+MLRO path in `approvals.ts`, as described in Global Constraints.

- [ ] **Step 1: write the tests.** Cover Review Focus 1–3; the combined AML path; separate-people AML unchanged; and a table test over all gates × the four demo users, with the expected decide/refuse.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the full SPA engine suite file by file. Expect no regressions beyond deliberate expectation updates; list each updated test in the report.

### Task 3: Seed, sign-in, hand-off and the Users settings page

**Seed** (`seed-data.ts`, `seed.ts`):
- Four users with the roles above.
- Anything that used Lina, Huda, Sara or Yusuf as an actor or approver now uses Adam (sales_admin), Omar (finance) or Karim (compliance/mlro).
- Seeded proposals are made by someone other than their decider (Rania proposes, Karim decides, and so on).
- `spa:demo:reset` removes the old four users. Use a reset with an empty database, not a delete with foreign keys.

**Sign-in:** `DEMO_CAST` has four entries with hints:
- Karim: "Verifies sellers, approves price and KYC; also compliance and MLRO"
- Omar: "Approves templates and agreements; also finance"
- Adam: "Settings, inventory, demo clock; also NOC, Oqood and transfer submissions"

Remove the disclosure. The avatar switcher lists the four.

**Hand-off:** pick the user whose `roles` include the needed role (main role first). Label with the person's main role.

**Settings → Users:** add an "Also acts as" checkbox group (admin only). Saving goes through the same route with Zod validation and an event.

- [ ] **Step 1: write the tests.** Sign-in shows exactly four cards; the hand-off for `aml_flag` as Rania reads "Under review · Switch to Karim (Manager)" with no "Compliance" text; the Users page saves extras; Review Focus 4 and 5.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 4: Fixes from the M1–M5b review

Source: `/tmp/claude-1000/-home-tushar-silverFern-leasing-agents/f994dd28-4685-4b62-8997-ea56e93b9987/scratchpad/review-m1-m5b.md`.

Fix all five should-fix items, each with a test:
1. **Permit number:** the PUBLISH and ACTIVATE guard requires a permit number as well as a valid date. The staff "Live" state uses the same `isPublicListing` rule.
2. **Rate limits:**
   - The web server forwards the visitor's address on every public engine call (catalogue, slots, photos, enquiries, viewings), as `x-forwarded-for` from the incoming request.
   - The engine trusts it only from the web server. A shared secret header (`SPA_INTERNAL_KEY`, or the existing trusted-proxy setting) is checked.
   - Document any new env var in `.env.spa.example`. Never read or edit `.env.spa.local`; tell the user what to add.
3. **Viewings on homes no longer for sale:** `freeSlotsForLead`, staff booking and reschedule refuse a home that is no longer public: 409 `home_unavailable`.
4. **Failed viewing mail:** the job throws when `sendSpaMail` returns "failed", so pg-boss retries (keep the idempotency check).
5. **Failed bookings and the limits:** take the per-email and per-home rate tokens only after the slot check succeeds. Or refund them on `slot_taken` / `slot_unavailable`.

Also fix these minor items:
- Use one lock order (agent, then lead) in public and staff booking.
- Apply the Leads property filter before the row limit.
- Make unit public refs collision-free: use a separator that can't appear in codes, or a lookup table.
- The upload/remove race on shared media files: delete the file only when no other row references its sha256, checked inside the transaction.

Leave the 5-minute photo cache and the session-secret cancel tokens as they are, and note them in decisions.

### Task 5: Docs, review and run

**Docs:**
- `docs/spa/decisions.md` S83: "Combined roles: `extra_roles` per user; gates keep one approver role; admin alone approves nothing; a compliance officer who is also the MLRO decides the report in the same step; demo runs with four users."
- Update `design.md` (sign-in, Users page), `architecture.md` and the skill. The skill's gate table gets a line: "a user may hold several roles; checks use `hasRole`".
- In the parent plan, add the M5c row and tick it.

- [ ] **Step 1:** run the `compliance-reviewer` subagent on the diff (maker-checker, AML/MLRO path, tipping-off, role checks) and fix what it finds.
- [ ] **Step 2:** run `spa:demo:reset` and restart the SPA engine (kill only the pid whose cwd is `modules/spa/apps/engine`).
- [ ] **Step 3:** take screenshots into `/tmp/claude-1000/m5c-shots`:
  - the sign-in page (four cards);
  - Karim's rail with Compliance;
  - Karim deciding an AML flag;
  - Omar deciding a settlement;
  - Adam's inbox with NOC/Oqood gates;
  - Rania seeing "Under review · Switch to Karim (Manager)";
  - the Users page with "Also acts as".
- [ ] **Step 4:** run `bun run typecheck`, `bun run lint`, `bun test modules/spa/apps/web` and `bun test modules/spa/packages`, then every SPA engine test file one at a time (script the loop and summarize), then `bun test modules/leasing/apps/web` (expect 132/132). Report the counts.
