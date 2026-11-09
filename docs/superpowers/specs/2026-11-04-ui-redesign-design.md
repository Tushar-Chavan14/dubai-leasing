# UI redesign v3: inbox with a docked agent

Date: 2026-11-04. Branch: `redesign-v3`. Mockup: `.superpowers/brainstorm/505893-1793784106/content/redesign-v2.html`
(the choices below override anything the mockup shows differently).

## Why

Feedback on the current web app: "the UX does not feel easy to use or navigate around things". Staff have too
many top-level places (Home, Workspace, Units, Settings, plus Applications, Leases, Tasks, Metrics and
Conversations pages reached from links), the copilot sits in a slide-over that is easy to forget, and Settings is
a row of nine tabs with no explanation of what each changes. The goal is a modern agentic app: one place to see
what needs you, the agent always beside you, and every page offering "Ask AI" about the thing on screen.

Success: a new staff member can find any application, lease or unit, act on anything waiting for them, and
change a setting without being shown around. Every feature that exists today still works.

## Choices made by the user

- **Layout C: inbox plus docked agent.** Home is an inbox ("Your queue") with the agent docked on the right of
  every staff screen.
- **Thinking style T1: timeline.** While the agent works, its reply shows a collapsible "Working, 4s" block with
  steps appearing one by one (each with its source, such as "rulebook 2026.2" or "Smart Rental Index"), then
  collapses to "Worked for 6s, 4 steps" with a "Show steps" toggle, and the answer streams in below.
- **Settings S1: hub.** Settings opens on a searchable hub of grouped cards, not tabs.
- **Units is its own area**, not a kind inside Workspace, because it is a list of properties.
- **The docked agent can be hidden.** On Units it must be hideable (the photo grid needs the width). Hiding is
  available on every screen.
- **"Ask AI" calls to action everywhere a record, value or setting is shown** (they were missing from the mockup).
- **Tailwind** for the new styling.
- **Scope is today's features only**: enquiry through contract, Ejari registration and move-in. Maintenance and
  the tenancy operations pages stay behind `TENANCY_OPS` exactly as today (restyled, not redesigned).
- Style: minimalist, black, white and `#dbe6cf`.

## Goals

1. Three rail items for everyone: **Home**, **Workspace**, **Settings**; a fourth, **Units**, for the roles that
   manage units (`admin`, `leasing_manager`, `leasing_officer`).
2. The agent docked on the right of every staff screen, collapsible, remembering its open or closed state per
   screen; context-aware ("Looking at Rania Haddad" when a record is open).
3. Ask AI on every record, gate, unit, list, empty state and settings page (list below).
4. Settings that explain themselves: each card says what it controls and who can change it.
5. Phone-first tenant links (`/t/...`) and a cleaner public site (`/customer/...`).
6. Light and dark themes, WCAG AA contrast, keyboard navigation, `prefers-reduced-motion` respected.

## Non-goals

- No new engine features, states, gates, rules or copilot tools. This is a front-end change in `apps/web`.
- No new copilot powers. The copilot's limits in AGENTS.md rule 11 are unchanged.
- No redesign of maintenance, rent collection, renewal, move-out or disputes beyond applying the new styles.

## Anti-goals (a failure even if it works)

- Any feature, page or URL that worked before and no longer does.
- The agent appearing to approve, send or change state on its own. Ask AI only types a request into the
  composer; the user still presses Send, and proposals still need Confirm.
- `#dbe6cf` used for text or as the only signal of meaning (it is about 1.2:1 on white).
- The Ejari mock looking like DLD (no DLD logos, colours or screen copies; "Simulated" label stays).
- Showing unmasked Emirates ID, passport or phone numbers anywhere new.

## Visual system

- **Colours.** Light: white page, `#0b0b0b` ink, `#f4f6f1` raised surface, `#dbe6cf` for selection, the active
  rail item, "AI" chips, the gate panel background and the docked agent's header. Primary button is black with
  white text. Dark: `#0b0b0b` page, `#151714` raised surface, primary button `#dbe6cf` with `#0b0b0b` text.
  Status colours (danger red, warning amber) only on small badges, always with an icon or word.
- **Type.** Geist and Geist Mono through `next/font`, replacing Instrument, Bricolage and the current mono.
  Tabular figures for money and dates.
- **Icons.** `@phosphor-icons/react`, one weight (regular, bold for checks), replacing `lib/icons`. Keep
  `BrandMark` as it is.
- **Shape.** Cards and panels 16px radius, inputs 10px, buttons and chips full pill. Hairline borders, almost no
  shadows.
- **Motion.** `motion/react` for the thinking timeline, the dock open and close, sheet and toast entry, and list
  stagger. 150 to 300 ms, ease-out in, faster out. Everything has a reduced-motion fallback (no movement, instant
  state).
- No em-dashes in UI copy.

## Shell

- **Left rail** (icons with labels, 220px, collapsible to icons on small laptops): brand, Home (with the waiting
  count), Workspace, Units (role-gated), Settings; at the bottom the Dubai date chip with the demo clock link,
  theme switch, user chip with role and sign out. Maintenance appears in the rail only when `TENANCY_OPS` is on,
  as today.
- **Top of each screen:** page title, short subtitle, the screen's one primary action, and the screen's Ask AI.
- **Docked agent** (380px, right): header with "Agent", context pill and a hide button; the thread; the composer
  with voice input. Hidden state leaves a slim tab on the right edge ("Agent") and `⌘K` / `Ctrl+K` opens it and
  focuses the composer. Open or closed is stored per screen in `localStorage`; default open everywhere except
  Units, where it defaults closed. Below 1200px wide the dock becomes an overlay sheet, closed by default.
- **New chat and history** (user's request). The dock header has a **New chat** button that starts a fresh
  thread (the next message creates it, as today), and a **History** menu listing recent threads from
  `GET /api/copilot/threads` (title, context, date) to reopen one through `GET /api/copilot/threads/:id`. The
  current thread follows you across screens until you start a new one or pick another.
- The dock is the existing copilot (`components/copilot/*`, `chat-ui/*`) moved from the slide-over into the dock;
  `COPILOT_PREFILL_EVENT` stays the way Ask AI talks to it. The full-page copilot on Home today is replaced by the
  dock; the thread is shared between them, so nothing is lost when navigating.

## Thinking timeline (T1)

Built on the copilot's existing streaming events. While running: a pulsing spark, "Working", a seconds counter,
and an ordered list where each tool call becomes a step ("Reading Rania's application", "Checking rent against
the Smart Rental Index") with its source in small mono text; the current step has a spinner, finished steps a
check. When the answer starts: the block collapses to "Worked for Ns, K steps", the answer streams word by word,
then cards (record, decision, proposal, choice) appear under it. The block can be reopened. Errors show inline in
the block with "Try again". Step labels come from tool names mapped to plain phrases in `apps/web`; if the
engine does not stream tool-step events today, the builder adds the mapping from whatever events exist and
falls back to a single "Working" step (no engine change).

## Screens

### Home (inbox)

"Good morning, {name}", today's Dubai date. Sections:

1. **Your queue**: everything waiting for this user (approvals at gates: price out of range, offer out of
   limits, KYC review, final contract, Ejari submission, Ejari rejected twice; tasks assigned to them), sorted by
   due date. Each row: who, what, due, and two buttons: open, and Ask AI. Clicking opens the record in
   Workspace with the gate panel at the top.
2. **Agent activity today**: today's home tiles and the live feed (`components/live/*`), unchanged in content.
3. **Numbers**: a compact strip from today's Metrics page with a link to the full page (`/metrics` stays).

Empty queue: "Nothing waiting for you" plus Ask AI "What should I look at today?".

### Workspace

Two kinds, tabbed: **Applications** and **Leases**. Left: list grouped by stage, search, filters (stage, unit,
assigned to me, waiting for me). Right: the record (application detail or lease detail as today: stepper,
documents, identity check, offer, from the applicant, contract and Ejari panel, deadlines, open work, activity
log with actor and rules version). When a gate is waiting, the gate panel (the existing approval detail and
decision form) is pinned at the top of the record. Primary action: **New application** (today's
`/applications/new`, for walk-in or phone enquiries), opening as a sheet over Workspace. Conversations
(`/conversations/[id]`) open as a record view linked from the application.

### Units (separate area)

Header "Units", primary **Add unit**, state filter (All, Prep, Ready, Listed, Occupied, with counts), search,
photo card grid. Unit page: photos (gallery and manager), stepper Prep to Occupied, ready-to-list checklist,
Publish listing when Ready, description, Smart Rental Index band (labelled as coming from the published index),
applications and leases on the unit, landlord and company split, activity. Edit and new unit use the existing
unit form restyled. The dock defaults to hidden here.

### Settings (S1 hub)

A search box and grouped cards. Each card: name, one line on what it controls, who can change it, last changed.

- **Your company**: Companies (legal details, signatory, logo), Documents & KYC.
- **Money and rules**: Rent rules, Smart Rental Index, Rulebook (versions and history).
- **Contracts**: templates and clauses.
- **Agent**: what the agent may do on its own, with the locked "always a person" rows.
- **Data**: Import; Demo (only when `DEMO_MODE`).

Each settings page: back to Settings, title, plain explanation, the existing form, live preview where one exists
today (contract template preview, rent rule sample), and the page's Ask AI menu (the existing `AskAiMenu`
prompts, kept). The settings tab bar is removed; the hub is the navigation.

### Tenant and landlord links (`/t/[token]/...`)

Phone-first, one column, max 480px on desktop. Top: brand, the unit, and a stepper of the applicant's stages.
Each page is one task with one primary button at the bottom: documents upload, offer, sign, acknowledge,
property, plus the `TENANCY_OPS` pages (move-in, payment, deposit, report, inspection, vacate) restyled the same
way. PDFs and file routes unchanged. No agent and no Ask AI on these pages.

### Public site (`/customer/...`)

Properties grid with filters, property page with gallery and Enquire or book a site visit, public chat with Apply
now, status check after the email code, and the chat launcher. Same tokens; photo-led; left-aligned hero.
Redirects from `/properties` and `/chat` stay. The public chat reuses the thinking timeline in a lighter form.

### Login

Split layout: sign-in form left, short product line right.

## Ask AI placements

Ask AI is the existing `AskAi` / `AskAiMenu` component: it opens the dock (if hidden), types a prompt and focuses
the composer. Nothing is sent. Prompts name the record so the agent's context is right.

| Place | Label | Prompts (examples) |
|---|---|---|
| Home queue row | Ask AI | "Explain what is waiting on {name} and what I should check before approving" |
| Home empty state | Ask AI | "What should I look at today?" |
| Workspace list header | Ask AI menu | "Which applications are stuck?", "What is due this week?" |
| Application record header | Ask AI menu | "Summarise {name}'s application", "What is missing before the offer?", "Draft an email asking for the missing documents" |
| Lease record header | Ask AI menu | "Summarise this lease", "What are the next deadlines?", "Where is the Ejari registration?" |
| Gate panel | Ask AI | "Explain this {gate} for {name} and the rules behind it" |
| Activity log | Ask AI | "Explain this event" on each helper event |
| Documents / identity check | Ask AI | "Why did the identity check flag this?" |
| Offer panel | Ask AI | "Is this rent within the Smart Rental Index band?" |
| Contract and Ejari panel | Ask AI | "What does Ejari still need?" |
| Units header | Ask AI menu | "Which units are ready to list?", "Which listed units have no applications?" |
| Unit page | Ask AI menu | "Is this unit ready to list?", "Suggest an asking rent from the index", "Draft a listing description" |
| Settings hub | Ask AI | "Which setting changes {X}?" |
| Each settings page | Ask AI menu | existing prompts, plus "Explain this page" |
| New application sheet | Ask AI | "Fill this in from the enquiry I paste" |

Rulebook and money values in answers still come from rulebook tools; the CTA changes nothing about that.

## Route map (every current URL keeps working)

| Today | After |
|---|---|
| `/` | Home inbox |
| `/work` | Workspace |
| `/applications`, `/leases` | Kept as table pages (restyled) with their own filters (`show`), reached from Workspace's "Table view" link on each tab. Not redirected: their filters differ from Workspace's. (My call, after reading the pages.) |
| `/tasks` | Kept as its own page (restyled), linked from Home's queue as "All tasks"; `for` still works |
| `/work?kind=&id=&approval=&view=waiting` and the existing redirects (`/inbox`, `/applications/:id`, `/leases/:id`, `/conversations`) | Unchanged: these stay the record URLs (`app/(staff)/work/url.ts`) |
| `/applications/new` | New application sheet; the URL still opens it directly |
| `/conversations/[id]` | Record view in Workspace |
| `/metrics` | Kept, restyled; summary on Home |
| `/units`, `/units/new`, `/units/[id]`, `/units/[id]/edit` | Units area |
| `/maintenance` | Unchanged behind `TENANCY_OPS` |
| `/settings` and all `/settings/*` | Hub and its pages, same URLs |
| `/t/[token]/*`, `/customer/*`, `/login` | Same URLs, new layouts |
| API, document, media and PDF routes | Unchanged |

## Build approach

- Add Tailwind v4 with `@tailwindcss/postcss`; tokens defined once with `@theme` in CSS, driven by the existing
  `data-theme` attribute and theme cookie. `globals.css` stays during the migration and each area's old CSS is
  deleted when that area is done. New dependencies: `tailwindcss`, `@tailwindcss/postcss`,
  `@phosphor-icons/react`, `motion`, `geist` (or `next/font/google` Geist). Versions are pinned and named in the
  summary.
- Migrate in this order: tokens and shell (rail, dock, Ask AI) → Home → Workspace → Units → Settings → tenant
  links → public site → login and leftovers. Each step leaves the app working.
- Reuse existing components and their data fetching; change markup and classes, not behaviour. Server
  components stay server components; Motion and dock state live in small client leaves.
- `apps/web` only. No engine, core or copilot package changes (unless Open question 1 is answered "new role").
- Do not run `next build` while the dev server runs (it breaks dev). Verify with `bun run typecheck`, `bun run
  lint`, the web tests that exist, and the running app in a browser, both themes, at 1440px, 1024px and 390px.

## Left to the builder

Exact spacing scale, component breakdown, how the dock state is stored, tool-name to step-label wording, the
filter controls, the skeleton loaders, the Numbers strip contents, and the order of tasks inside each step.

## Settled after the builder check

- **Thread.** Copilot threads are already stored on the server (`components/copilot/thread.ts`). The dock lives
  in the staff layout, which does not remount on navigation, so the thread and an in-flight stream survive moving
  between screens. Reloading reopens the latest thread from the server.
- **Thread context.** The engine binds a record to a thread with its first message (`context` is only sent when
  there is no thread yet). So the dock keeps the current thread across screens, its pill shows the thread's
  record ("About Rania Haddad") rather than the page's, and when the page shows a different record the dock
  offers "New chat about {record}". Ask AI on a record whose record differs from the current thread's starts a
  new thread with that record before typing the prompt; elsewhere it types into the current thread. (My call.)
- **Record URLs.** Workspace keeps today's query scheme in `app/(staff)/work/url.ts` (`kind`, `id`,
  `approval`, `view=waiting`, `pane`, `stage`, `q`). New application opens as a sheet from a `new=1` query on
  `/work`; `/applications/new` keeps rendering the same form as a full page. (My call.)
- **Tasks.** Home's queue has "Approvals" and "Tasks" filters; `/tasks` stays as a page. (My call.)
- **Waiting count.** From `/api/home` (`waitingForYou`), already fetched in the staff layout; the live poll
  (`components/live`) refreshes it as today.
- **Settings cards.** "Who can change it" is static text matching the engine's role checks. "Last changed" is
  shown only where the page's data already has it (rulebook versions, KYC drafts); otherwise omitted. (My call.)
- **Timeline steps.** The copilot stream already sends `tool` and `tool_result` events with the tool name, so
  every tool call becomes a real step. A tool-name to plain-label map lives in `apps/web`, with a generic label
  for unknown names. The public chat uses its own stream's events the same way.
- **Tests.** No Playwright. Existing `apps/web/test/*` (pure logic) must keep passing; new pure logic (step
  labels, dock state, Ask AI prompt builders, any new redirects) gets Bun tests. Visual check by hand in the
  browser. (My call.)

## Open questions

None. Units visibility was decided by the user (option A): the Units rail item and pages are shown to `admin`,
`leasing_manager` and `leasing_officer`, the roles the engine already lets edit units, and hidden from `finance`
(direct URLs show a "not available for your role" page). Front end only. A dedicated `unit_manager` role may come
later as its own plan.
