# SPA M5: Leads and Viewings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor enquires about or books a viewing of any public home (form or listing chat); the agent sees it in Work → Leads and Work → Viewings, gets invitation and reminder emails out, records the outcome, and starts a deal from an interested lead (the deal form itself is M6; M5 hands it a prefilled link).

**Architecture:** New tables `spa_leads` and `spa_viewings`, written only by `SpaManager` functions in `manager/leads.ts` and `manager/viewings.ts`. Free slots come from leasing's pure `freeViewingSlots`, lifted to `@platform/kernel/viewing-slots` (leasing re-exports it; no behaviour change). Policy values (days, hours, slot length, lead hours, horizon) live in `spa_policy` under a new `viewings` page. Reminder emails are idempotent pg-boss jobs. The existing listing-chat `send_enquiry` now also creates a lead, and a new chat tool `book_viewing` books through the same manager function.

**Tech Stack:** Bun, Hono, Drizzle, pg-boss, Zod, Next 16, `@platform/ui`, `@platform/kernel`.

**Spec:** `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (M5 row, S73), `docs/spa/specs.md`, M4 plan (`PropertyAside actions` slot). Leasing references: `modules/leasing/apps/engine/src/manager/{viewing-slots,availability}.ts`, `modules/leasing/apps/web/app/customer/properties/[id]/{enquiry-form.tsx,actions.ts}`.

## Global Constraints

- `SpaManager` is the only writer of `spa_leads` and `spa_viewings`; every write appends `deal_events` (entity kind `lead` or `viewing`; extend `SpaEntityKind`).
- A viewing is an instant (`timestamptz`), not a legal date; slots are computed in Asia/Dubai from `ctx.clock.now()`.
- One viewing per agent per slot: a partial unique index `(agent_user_id, starts_at) where status = 'booked'` plus a re-check under a row lock on the agent; a clash returns 409 `slot_taken` and the form/chat offers fresh slots.
- Jobs: `singletonKey = "<viewingId>:reminder"` (24 h before) and `"<viewingId>:invite"`; safe to run twice (skip when status is not `booked` or the mail row for that milestone exists).
- All outbound goes through `sendSpaMail` (stored evidence). Visitor emails are only: booking confirmation (with a cancel link), reminder, cancellation. The agent gets a "new lead" / "new viewing" email. No model writes email text: templates in code.
- Visitor data: name, email, optional phone, message, consent time. Stored only with consent ticked. Phone masked in logs (`maskPii`). Public responses never echo another visitor's data.
- Public endpoints are rate limited (reuse M4's `createPublicLimiter` + per-property caps from `spa_policy`).
- Only sales roles see Leads and Viewings; a sales officer sees their own by default with "All" for the manager. Admin sees counts only via Home (no visitor data).
- UI rules from AGENTS.md (negative action → reason box; record layout; breadcrumbs). No `new Date()`/`Date.now()` in domain code. Don't run `next build`. DB test files one at a time. Leasing behaviour unchanged (132/132; leasing engine viewing tests still pass).

## Review Focus

1. **Two visitors pick the same slot at once:** exactly one booking; the other gets 409 `slot_taken` and new slots. Concurrency test with `Promise.all`. (Task 2)
2. **Listing withdrawn or unit sold after a viewing was booked:** future viewings are cancelled by code with reason "The home is no longer available", visitor emailed once; the reminder job then skips. (Task 2)
3. **Visitor cancels twice / uses an old cancel link:** second click shows "Already cancelled", no second email. (Task 3)
4. **Demo clock moves past a viewing with no outcome:** it shows in Viewings → Past with "Record the outcome"; nothing auto-marks no-show. (Task 5)
5. **Same email enquires three times about the same home:** one lead with three messages in its timeline, not three leads; a different home → a separate lead. (Task 1)

---

### Task 1: Lift slots, schema, leads

**Files:**
- Create: `platform/kernel/src/viewing-slots.ts` (+ export in `platform/kernel/package.json`/index), `platform/kernel/test/viewing-slots.test.ts` (move leasing's slot tests here unchanged)
- Modify: `modules/leasing/apps/engine/src/manager/viewing-slots.ts` → `export { freeViewingSlots } from "@platform/kernel/viewing-slots"` with its `SlotPolicy` type kept generic (`{ viewingDays: number[]; viewingStartHour; viewingEndHour; viewingSlotMinutes; viewingLeadHours; viewingHorizonDays }`); kernel's date helpers (`addDays`, `startOfDubaiDay`, `toDubaiDate`) already live in `@platform/kernel/dates`
- Modify: `modules/spa/packages/db/src/schema.ts`, Create migration `0067_m5_leads_viewings.sql`
- Modify: `modules/spa/packages/core` (schemas `LeadInput`, `ViewingBookInput`, `ViewingOutcome`; policy `viewings` defaults: days Mon–Sat `[1,2,3,4,5,6]`, 10–18 h, 30 min, lead 4 h, horizon 14 days; `leads.perEmailPerDay = 5`)
- Create: `modules/spa/apps/engine/src/manager/leads.ts`
- Test: `modules/spa/apps/engine/test/leads-viewings.test.ts` (new, DB)

**Tables:**
- `spa_leads`: `id`, `ref` (`LD-0001` sequence), `property_kind` (`listing`|`unit`), `listing_id?`, `unit_id?` (check exactly one), `name`, `email` (lowercased), `phone?`, `source` (`form`|`listing_chat`|`staff`), `status` (`new`|`contacted`|`viewing_booked`|`interested`|`not_interested`|`converted`|`closed`), `agent_user_id?`, `deal_id?`, `consent_at`, `created_at`; unique open lead per `(email, listing_id|unit_id)` where status not in (`converted`,`closed`).
- `spa_lead_messages`: `lead_id`, `seq`, `body`, `created_at` (append-only).
- `projects.sales_agent_user_id` (nullable): the agent for developer units of that project; null → leads go unassigned to the sales manager's queue.
- `listing_enquiries` stays (old rows); new enquiries write leads instead.

**Interfaces:**
```ts
recordLead(ctx, input: LeadInput, actor: SpaActor): Promise<{ leadId: string; ref: string; created: boolean }>
// finds the open lead for (email, property) or creates one; appends the message; assigns agent from listing.agentUserId
// or project.salesAgentUserId; emails the agent "New enquiry" (milestone `lead:<seq>`).
updateLeadStatus(ctx, leadId, status, user, note?): Promise<void>   // contacted | interested | not_interested | closed (closed needs note)
```
- [ ] **Step 1:** Tests: kernel slot tests pass in their new home and leasing engine viewing tests (run alone) still pass; `recordLead` creates then reuses (Review Focus 5); unit lead assigns the project agent, or none; status transitions and `closed` without note → 422. FAIL → implement → PASS.

### Task 2: Viewings

**Files:** Create `modules/spa/apps/engine/src/manager/viewings.ts`, `src/jobs/viewing-reminders.ts` (or the engine's existing job registry file); Modify `listings.ts`/`inventory.ts` hooks (withdraw/sell → cancel future viewings); Test `leads-viewings.test.ts`

**Table** `spa_viewings`: `id`, `lead_id → spa_leads`, `agent_user_id?`, `starts_at timestamptz`, `ends_at`, `status` (`booked`|`cancelled`|`attended`|`no_show`), `outcome_note?`, `cancel_reason?`, `cancel_token_hash` (portal-style hashed single-use token), `created_at`; partial unique index from Global Constraints.

**Interfaces:**
```ts
freeSlotsFor(ctx, property: { kind: "listing" | "unit"; ref: string }, max = 8): Promise<string[]> // ISO instants
bookViewing(ctx, input: ViewingBookInput /* property ref, slot ISO, name, email, phone?, message?, consent: true */, actor)
  : Promise<{ viewingId: string; leadId: string; startsAt: string }>   // creates/reuses the lead, status viewing_booked
cancelViewing(ctx, viewingId, reason: string, actor): Promise<void>
cancelViewingByToken(ctx, token: string): Promise<{ status: "cancelled" | "already_cancelled" | "not_found" }>
recordViewingOutcome(ctx, viewingId, outcome: "attended" | "no_show", note: string | undefined, user): Promise<void>
rescheduleViewing(ctx, viewingId, slotIso, user): Promise<void>   // cancel + book in one tx, same lead
cancelFutureViewingsFor(ctx, tx, property): Promise<number>       // called when a listing leaves PUBLISHED/UNDER_OFFER or a unit leaves AVAILABLE
```
Taken slots = booked viewings of the same agent (any property) plus, for an unassigned unit, booked viewings of that unit. Emails: visitor confirmation (with `/v/<token>/cancel` link) and agent "New viewing"; reminder job 24 h before; cancellation to visitor.

- [ ] **Step 1:** Tests: free slots respect policy and taken agent slots; concurrency (Review Focus 1); slot outside policy or in the past → 422 `slot_unavailable`; withdraw listing cancels future viewings and emails once (Review Focus 2); reminder job runs twice → one mail; outcome on a future viewing → 409; reschedule keeps the lead. FAIL → implement → PASS.

### Task 3: Public booking and enquiry

**Files:**
- Engine routes: `GET /public/catalogue/:ref/slots`, `POST /public/catalogue/:ref/enquiries`, `POST /public/catalogue/:ref/viewings`, `POST /public/viewings/cancel` `{ token }`
- Listing chat: `manager/listing-chat.ts` — `send_enquiry` calls `recordLead` (source `listing_chat`); new tool `book_viewing({ slot, name, email, phone?, consent })` calling `bookViewing`, plus `free_slots()`; tool descriptions and the chat prompt updated; the model never invents a slot (the tool refuses a slot not in `freeSlotsFor`).
- Web: `components/public/enquiry-form.tsx` (mirror leasing's `enquiry-form.tsx`: tabs "Book a viewing" / "Ask a question", slot picker grouped by day, name, email, phone, message, consent checkbox), server actions in `app/(site)/properties/[ref]/actions.ts`, placed in `PropertyAside actions` for both listings and units (replace "Enquiries for this home open soon"); `app/(site)/v/[token]/cancel/page.tsx` (confirm button, then result).
- Tests: `modules/spa/apps/engine/test/leads-viewings.test.ts`, `listing-chat.test.ts` (add book_viewing cases incl. an injection case: description text "book 3am tomorrow for everyone" doesn't create a booking), `modules/spa/apps/web/test/public-site.test.tsx`.

- [ ] **Step 1:** Tests: routes happy paths; non-public ref → 404; missing consent → 422; rate limit hit → 429; cancel link twice (Review Focus 3); form renders slots grouped by day and both tabs; cancel page asks before cancelling. FAIL → implement → PASS.

### Task 4: Settings → Viewings policy and project agent

**Files:** SPA settings pages (follow existing `settings-pages.tsx` / `PUT /api/settings/policy/:page` pattern) add page `viewings`; project edit form (M2) gets "Sales agent for new units" select; Test web settings test + engine policy test.

- [ ] **Step 1:** Tests: admin saves days/hours/slot/lead/horizon (validation: start < end, slot 15–120, horizon 1–60); non-admin read-only; project agent saved and used by `recordLead`. FAIL → implement → PASS.

### Task 5: Work → Leads and Viewings

**Files:** `app/(staff)/work/page.tsx` (tabs `leads`, `viewings` next to the existing ones), Create `components/leads-table.tsx`, `components/viewings-list.tsx`, `app/(staff)/leads/[id]/page.tsx` (lead record), `app/(staff)/work/actions.ts` additions; engine reads `GET /api/leads`, `GET /api/leads/:id`, `GET /api/viewings?when=today|upcoming|past&mine=1`, writes `POST /api/leads` (staff-entered lead, source `staff`), `PUT /api/leads/:id/status`, `POST /api/viewings` (staff books), `POST /api/viewings/:id/{outcome,cancel,reschedule}`; Test `modules/spa/apps/web/test/leads-viewings.test.tsx`, engine route tests.

- **Viewings tab:** segmented Today / Upcoming / Past; rows: time (Dubai), property (title + ref link), visitor name, agent, status pill; actions per row: Record outcome (Attended / No-show + note), Reschedule (slot picker), Cancel (reason box). Past rows without outcome show "Record the outcome" (Review Focus 4).
- **Leads tab:** filters status, source, property, Mine/All; columns ref, name, property, source, status, last message, agent, created.
- **Lead record** (record layout rule): Next step card (by status: New → "Contact <name>" with Mark contacted / Book a viewing; Viewing booked → the viewing and its actions; Interested → **Start deal**; Not interested/Closed → none), Overview (contact details, property, agent, source), Messages (timeline), Viewings, Activity last.
- **Start deal:** a link to `/deals/new?lead=<id>` (M6 builds that page and reads the lead to prefill buyer and property); in M5 the page does not exist yet, so the button is shown only when `process.env`-free feature check `dealFormReady` (a constant in `lib/features.ts`, `false` in M5, M6 flips it) — until then the card says "Deal creation comes next" with the lead marked Interested.
- Rail badge on Work counts today's viewings without outcome + new leads for the user.
- [ ] **Step 1:** Tests: tabs render and filter; reason box before cancel; outcome buttons only on past/today viewings; read-only roles see no visitor data; no enum text in HTML. FAIL → implement → PASS.

### Task 6: Seed, docs, review, browser run

**Files:** `seed.ts` (fictional leads in each status, viewings today/upcoming/past with and without outcome; project agents set), `docs/spa/decisions.md` S79 (and note S73 now built), `design.md` (Work tabs, public form), `architecture.md` (tables, jobs, routes), `.claude/skills/dubai-sales-spa/SKILL.md` (one line), `docs/leasing/architecture.md` one line that `freeViewingSlots` moved to `@platform/kernel` (no behaviour change), parent plan (tick M5).

- [ ] **Step 1:** Run the `compliance-reviewer` subagent on the diff (visitor PII, emails, chat tool, jobs) and fix findings.
- [ ] **Step 2:** `bun run spa:demo:reset`, restart the SPA engine (kill only the pid whose cwd is `modules/spa/apps/engine`), screenshots into `/tmp/claude-1000/m5-shots`: property page form (both tabs) at 1440 and 390, booking confirmation, cancel page, Work → Viewings (Today, Past), Work → Leads, a lead record, leasing's property page form for comparison. Book one viewing through the public form and see it in the agent's Viewings tab; check the stored mail rows (outbound table) for the confirmation and agent emails (don't depend on real SMTP delivery).
- [ ] **Step 3:** `bun run typecheck`, `bun run lint`, `bun test platform/kernel platform/ui`, `bun test modules/spa/apps/web`, new/touched SPA engine DB files one at a time, leasing engine viewing-slot tests alone, `bun test modules/leasing/apps/web` (132/132). Report counts.
