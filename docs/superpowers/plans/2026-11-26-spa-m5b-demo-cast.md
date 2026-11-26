# SPA M5b: Demo Cast and Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A presenter can demo the whole sale with four people instead of eight. When a step needs someone else, the card says who, and one click in demo mode switches to that person on the same page.

**Architecture:** The role model and gates stay exactly as they are: separation of duties is the product's safety model, and the demo must show it truthfully. M5b changes only how the demo is presented:
1. a short **demo cast** on the sign-in page;
2. a **"Switch to …" hand-off** on every waiting card, demo mode only;
3. a **quick switcher** in the avatar menu, demo mode only.

All three reuse the existing `POST /api/auth/demo-sign-in`, which returns 404 when demo mode is off.

**Tech Stack:** Bun, Hono, Next 16 server actions, `@platform/ui`.

**Spec:** the user's request on 2026-11-26: "the demo users are so many the flow is confusing". Also S33 (demo sign-in picker) and the gate/approver table in the `dubai-sales-spa` skill.

## Global Constraints

- No change to roles, `mayDecide`, gates or approvers. Nobody approves their own proposal. Only the compliance officer clears AML, and only the MLRO files a report.
- Everything here exists only when `SPA_DEMO_MODE=true`. With demo mode off, no switch button, switcher or cast renders, and the engine route keeps returning 404 (test it).
- **The hand-off names a role, never a case reason.** An AML hold card shown to a non-compliance user keeps saying "Under review" and offers "Switch to Sara (Compliance)" without naming the flag (no tipping-off; S20).
- **Switching is a fresh demo sign-in as that user.** The page reloads at the same URL. If the new user can't see that page, the app's normal redirect or "not allowed" screen applies; nothing is bypassed.
- Leasing untouched. Don't run `next build`.

## Demo cast

The sign-in page shows four cards, in this order. Each has a one-line "what you'll show".

| Person | Role | What you'll show |
|---|---|---|
| Rania (Agent) | sales_officer | Listings, leads, viewings, deals, documents |
| Karim (Manager) | sales_manager | Verifies sellers, approves price, KYC and cancellations |
| Omar (Legal) | legal | Approves templates and agreements |
| Adam (Admin) | admin | Settings, inventory, demo clock |

Below the cards, a collapsed "Back-office roles (only when a step needs them)" disclosure lists:
- Lina (Sales admin): NOC, Oqood and transfer submissions
- Huda (Finance): settlement and refunds
- Sara (Compliance): AML review
- Yusuf (MLRO): reports

Their seeded data is unchanged. The cast list is a constant `DEMO_CAST` in `@spa/core/demo` (role order plus hint text). The engine's `GET /api/auth/demo-users` adds `cast: boolean` and `hint`.

## Review Focus

1. **Demo mode off:** no cast disclosure, switch button or avatar switcher appears, and demo sign-in returns 404. (Tasks 1–3)
2. **AML hold card for a sales officer:** it shows "Under review" and "Switch to Sara (Compliance)" with no flag, match or reason text. (Task 2)
3. **Switching to a user who can't see the current page** (for example Omar on `/inventory`) lands on the normal not-allowed or redirect screen, not a crash. (Task 3)
4. **The approver role has two seeded users:** the hand-off picks the cast member first, else the first active user of that role. If there is none, the card says "No demo user has this role" and shows no button. (Task 2)
5. **The proposer is also the only user with the approver role:** the hand-off still offers that user, and the engine refuses the decision with its normal message. The demo shows the rule rather than hiding it. (Task 2)

---

### Task 1: Cast on the sign-in page

**Files:**
- `modules/spa/packages/core/src/demo.ts`: new; exports `DEMO_CAST`, `castHint(role)`.
- Engine `app.ts`: the demo-users route.
- `modules/spa/apps/web/app/sign-in/page.tsx`
- Test: `modules/spa/apps/web/test/demo-cast.test.tsx` (new), plus the engine route test.

- [ ] **Step 1: write the tests.**
  - The demo picker renders 4 cards in cast order, each with its hint.
  - The disclosure holds the other 4.
  - Demo mode off renders the password form only.
  - The engine route returns `cast` and `hint`, and 404 with demo mode off.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 2: "Switch to …" hand-off on waiting cards

**Files:**
- `modules/spa/apps/web/components/demo-handoff.tsx`: new; server component plus a client button.
- `app/demo-switch/actions.ts`: new server action `switchDemoUser(email, returnTo)`.
- Wherever a card says something waits on another role: the Work inbox rows, the deal record's waiting banner (`waiting-banner.tsx`), the listing Next-step card (M3, the `seller_verification` pending state) and Home's "Waiting for you".
- Engine: `GET /api/demo/handoff?role=<role>` returns `{ name, email, roleLabel } | null`, in demo mode only.

**Interfaces:**
```ts
export function DemoHandoff({ role, demo }: { role: SpaRole; demo: boolean }): JSX.Element | null
// renders "Waiting for Omar (Legal) · Switch to Omar" when demo, else null (the card keeps its normal "Waiting for Legal")
switchDemoUser(email: string, returnTo: string): Promise<void>
// calls demo sign-in, sets the session cookie, then redirect(returnTo); returnTo must be a same-site path (starts with "/", not "//")
```

- [ ] **Step 1: write the tests.**
  - A waiting `agreement_approval` card offers "Switch to Omar".
  - An AML hold card for a sales officer contains "Under review" and "Switch to Sara". It does not contain the words flag, sanction, PEP, match or the case reason (Review Focus 2).
  - Demo mode off renders no button.
  - A `returnTo` of `//evil.test` or `https://…` falls back to `/`.
  - Review Focus 4 and 5.
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 3: Quick switcher in the avatar menu

**Files:**
- `modules/spa/apps/web/components/shell.tsx`: avatar menu children.
- `components/demo-switcher.tsx`: new.
- Test: `test/demo-cast.test.tsx`.

The switcher sits in demo mode only, under the user's name. It is a "Switch demo user" list: the cast first, then "Back-office", and the current user is marked. It uses `switchDemoUser(email, currentPath)`.

- [ ] **Step 1: write the tests.**
  - The switcher renders in demo mode with the current user marked.
  - It is absent with demo mode off.
  - Switching to a user without access lands on the not-allowed screen (Review Focus 3).
- [ ] **Step 2:** run the tests and confirm they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run the tests and confirm they pass.

### Task 4: Docs and browser run

**Docs:**
- `docs/spa/decisions.md` S80: "Demo cast: 4 people up front, back-office roles on demand; demo-only hand-off and switcher sign in as the next approver. Roles and gates unchanged."
- `docs/spa/design.md`: sign-in and shell sections.
- The parent plan: add the M5b row and tick it.
- The M10 row: note that the demo console's guided script builds on the cast.

**Browser run:**
- [ ] **Step 1:** restart the SPA engine. Kill only the pid whose cwd is `modules/spa/apps/engine`.
- [ ] **Step 2:** take screenshots into `/tmp/claude-1000/m5b-shots`:
  - the sign-in page with the disclosure closed and open;
  - Rania on a deal waiting for Legal, then click "Switch to Omar" and land on the same deal as Omar with the decision card;
  - the avatar switcher open.
- [ ] **Step 3:** run `bun run typecheck`, `bun run lint`, `bun test modules/spa/apps/web` and the touched engine test file on its own. Report the counts.
