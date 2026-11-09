# UI redesign v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `apps/web` staff app, tenant links and public site as an inbox with a docked agent
(layout C), with a timeline thinking view (T1), a settings hub (S1), a separate Units area and Ask AI on every
record, keeping every current feature and URL.

**Architecture:** Tailwind v4 is added next to `globals.css`; tokens live once in `app/tailwind.css` via
`@theme`, switched by the existing `data-theme` attribute. A new staff shell (rail + docked agent) replaces the
top bar; the docked agent is today's `CopilotChat` moved out of the slide-over. Pages keep their data fetching
and engine calls; only markup, classes and placement change. Pure logic (nav items, dock defaults, thread
context, step labels, Ask AI prompts, settings hub search, contrast) lives in small `lib/` files with Bun tests.

**Tech Stack:** Next.js 16.4.2, React 19.3.1, Tailwind v4 (`tailwindcss`, `@tailwindcss/postcss`),
`@phosphor-icons/react`, `motion` (`motion/react`), `geist` fonts, Bun test.

**Spec:** `docs/superpowers/specs/2026-11-04-ui-redesign-design.md` (read it first; it wins over this plan where
they differ). Mockup: `.superpowers/brainstorm/505893-1793784106/content/redesign-v2.html` (layout C, think =
timeline, settings = hub; open it in a browser to see the target look).

## Global Constraints

- `apps/web` only. No changes to `packages/*`, `apps/engine`, the copilot tools or prompt.
- Every current URL keeps working (spec "Route map"). Existing redirects in `apps/web/next.config.ts` stay.
- Colours: light page `#ffffff`, ink `#0b0b0b`, raised `#f4f6f1`, accent `#dbe6cf`; dark page `#0b0b0b`, raised
  `#151714`, primary button `#dbe6cf` with `#0b0b0b` text. `#dbe6cf` is never text colour on white and never the
  only signal of meaning.
- Radius: cards and panels 16px, inputs 10px, buttons and chips full pill.
- Motion 150 to 300 ms, ease-out in; every animation has a `prefers-reduced-motion` fallback (no movement).
- No em-dashes or en-dashes in UI copy.
- Ask AI never sends: it opens the dock and types a prompt. Proposals still need Confirm; decision cards still
  run the inbox's own routes.
- The Ejari mock keeps its "Simulated" label; no DLD logos or colours.
- No unmasked Emirates ID, passport or phone numbers in new UI or Ask AI prompts (use `maskPii` from
  `@leasing/core` if one is ever shown).
- Units rail item and pages: roles `admin`, `leasing_manager`, `leasing_officer` only.
- Maintenance and tenancy-ops pages stay behind `TENANCY_OPS`.
- New dependencies are pinned to exact versions (no `^`), like `next` is. Name them and their versions in the
  final summary.
- Never run `next build` while `bun run dev` is running (it breaks the dev server). Verify with
  `bun run typecheck`, `bun run lint`, `bun test apps/web` and the running app.
- Do not commit unless the user asks; never add Co-Authored-By trailers. (The "Commit" steps below mean: stop
  and leave the change staged-ready; commit only if the user has said to.)
- Never open files in `data/uploads/`.

## Review Focus

- A user on a lease opens the dock, then moves to another lease and presses Ask AI: the prompt must land in a
  new thread about the second lease, not the first (Task 3 test `nextThreadFor` "different record").
- A `finance` user types `/units` directly: they get the "not available for your role" page, not the list and
  not a crash (Task 2 test `canSeeUnits`, Task 8 step).
- An unknown or future copilot tool name in the stream: the timeline shows a generic step, never a blank row
  or a thrown error (Task 4 test "unknown tool").
- Settings hub search with no match, odd casing or extra spaces: shows "No setting matches" and an Ask AI
  button, never an empty white area (Task 9 test `filterHub`).
- Old links such as `/applications/new`, `/inbox/:id`, `/tasks?for=me` still land on the right screen
  (Task 7 redirect test additions, Task 12 manual route sweep).

---

## File structure

```
apps/web/
  postcss.config.mjs                 new: @tailwindcss/postcss
  app/tailwind.css                   new: @import "tailwindcss"; @theme tokens; dark overrides
  app/layout.tsx                     modify: Geist fonts, import tailwind.css before globals.css
  lib/design/contrast.ts             new: contrastRatio()
  lib/design/tokens.ts               new: TOKENS (hex values, single source for tests)
  lib/shell/nav.ts                   new: navItems(), canSeeUnits(), screenOf()
  lib/shell/dock.ts                  new: dockDefault(), dock storage key
  lib/copilot/thread-context.ts      new: nextThreadFor()
  lib/copilot/step-labels.ts         new: stepLabel()
  lib/ask-ai/prompts.ts              new: askPrompts.* builders
  lib/settings/hub.ts                new: HUB groups, filterHub()
  components/shell/rail.tsx          new (replaces components/nav.tsx)
  components/shell/staff-shell.tsx   new: rail + main + dock grid
  components/copilot/dock.tsx        new (replaces components/copilot/panel.tsx)
  components/copilot/history-menu.tsx new
  components/chat-ui/thinking.tsx    new: T1 timeline
  components/ask-ai.tsx              modify: new look, page-aware event
  components/ui/*.tsx                new small primitives: button, card, pill, sheet, segmented, empty-state
  app/(staff)/layout.tsx             modify: StaffShell
  app/(staff)/page.tsx               modify: inbox
  app/(staff)/work/*                 modify: tabs, gate panel, Ask AI, new-application sheet
  app/(staff)/units/*                modify: grid, detail, role gate
  app/(staff)/settings/page.tsx      modify: hub; settings-tabs.tsx removed from pages
  app/t/[token]/*                    modify: phone-first layout
  app/customer/*, components/public/*, components/customer-chat/* modify
  app/login/page.tsx                 modify
apps/web/test/*.test.ts              new tests per task
```

---

### Task 1: Tailwind, tokens, fonts, icons

**Files:**
- Create: `apps/web/postcss.config.mjs`, `apps/web/app/tailwind.css`, `apps/web/lib/design/tokens.ts`,
  `apps/web/lib/design/contrast.ts`
- Modify: `apps/web/package.json`, `apps/web/app/layout.tsx`
- Test: `apps/web/test/design-contrast.test.ts`

**Interfaces:**
- Produces: `TOKENS: { light: Palette; dark: Palette }` where `Palette = { page, raised, ink, muted, line,
  accent, onAccent, primary, onPrimary, danger, warning }` (hex strings); `contrastRatio(a: string, b: string):
  number` (WCAG 2.x relative luminance). Tailwind theme names: `bg-page`, `bg-raised`, `text-ink`, `text-muted`,
  `border-line`, `bg-accent`, `text-on-accent`, `bg-primary`, `text-on-primary`, `text-danger`, `text-warning`;
  fonts `font-sans` (Geist), `font-mono` (Geist Mono); radii `rounded-card` 16px, `rounded-input` 10px.

- [ ] **Step 1: Install** in `apps/web`: `bun add -E tailwindcss @tailwindcss/postcss @phosphor-icons/react motion geist`.
- [ ] **Step 2: Write the failing test** `design-contrast.test.ts`:
  - `contrastRatio("#ffffff", "#000000")` is 21 (to 1 decimal); `contrastRatio("#dbe6cf", "#ffffff") < 1.5`.
  - For both palettes: `ink` on `page`, `ink` on `raised`, `muted` on `page`, `onPrimary` on `primary`,
    `onAccent` on `accent` are each `>= 4.5`.
  - `TOKENS.light.accent === "#dbe6cf"` and `TOKENS.dark.primary === "#dbe6cf"`.
- [ ] **Step 3: Run** `bun test apps/web/test/design-contrast.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `tokens.ts` with the Global Constraints colours (pick `muted`, `line`, `danger`,
  `warning` that pass the test) and `contrast.ts`. Write `tailwind.css` with `@import "tailwindcss";`, a
  `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`, `@theme` vars from the light palette
  and `[data-theme=dark]` overrides, plus a `@media (prefers-color-scheme: dark)` block for `data-theme=system`
  (match how `globals.css` resolves `system` today). Add `postcss.config.mjs` with `@tailwindcss/postcss`. In
  `app/layout.tsx` load `GeistSans` / `GeistMono` from `geist/font/*`, put their variables on `<html>`, import
  `tailwind.css` before `globals.css`.
- [ ] **Step 5: Run** the test (PASS), then `bun run typecheck`, then load `http://localhost:3000` in the running
  dev server and confirm pages still render (old styles intact, Geist applied).
- [ ] **Step 6: Commit** `feat(web): add Tailwind v4 tokens, Geist, Phosphor, Motion`.

### Task 2: Navigation rules and the rail

**Files:**
- Create: `apps/web/lib/shell/nav.ts`, `apps/web/lib/shell/dock.ts`, `apps/web/components/shell/rail.tsx`,
  `apps/web/components/shell/staff-shell.tsx`
- Modify: `apps/web/app/(staff)/layout.tsx`; delete `apps/web/components/nav.tsx` once unused
- Test: `apps/web/test/shell-nav.test.ts`

**Interfaces:**
- Produces:
  - `type Screen = "home" | "work" | "units" | "settings" | "maintenance" | "other"`
  - `screenOf(pathname: string): Screen` (`/` → home; `/work`, `/applications*`, `/leases*`, `/tasks`,
    `/conversations*`, `/metrics` → work except `/metrics` → home; `/units*` → units; `/settings*` → settings;
    `/maintenance*` → maintenance)
  - `canSeeUnits(role: StaffRole): boolean`
  - `navItems(role: StaffRole, opts: { tenancyOps: boolean; waiting: number }): { href: string; label: string;
    screen: Screen; count?: number }[]`
  - `dockDefault(screen: Screen, viewportWidth: number): boolean` and `DOCK_KEY = (s: Screen) => \`dock:${s}\``
  - `<StaffShell me={Me} waiting={number} clock={...} theme={Theme} tenancyOps={boolean}>{children}</StaffShell>`

- [ ] **Step 1: Write the failing test** `shell-nav.test.ts`:
  - `navItems("finance", …)` labels are `["Home","Workspace","Settings"]`; for `leasing_officer`,
    `leasing_manager`, `admin` they are `["Home","Workspace","Units","Settings"]`.
  - With `tenancyOps: true`, "Maintenance" is inserted before "Settings".
  - Home item carries `count` equal to `waiting`; `count` is absent when `waiting` is 0.
  - `screenOf("/units/abc/edit") === "units"`, `screenOf("/settings/kyc") === "settings"`,
    `screenOf("/work?kind=lease") === "work"` (query ignored), `screenOf("/metrics") === "home"`.
  - `dockDefault("units", 1440) === false`, `dockDefault("work", 1440) === true`, `dockDefault("work", 1100) === false`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `nav.ts` and `dock.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Build the shell.** `rail.tsx` (client): brand (`BrandMark` kept from `lib/icons`), items from
  `navItems` with Phosphor icons (`House`, `Tray`, `Buildings`, `Wrench`, `GearSix`), active item `bg-accent`,
  count badge with `aria-label="{n} waiting for you"`; footer: Dubai date chip with the demo clock link (today's
  text from `(staff)/layout.tsx`), `ThemeSwitch`, user chip (initials, name, `roleLabel`), sign out (the existing
  `logout` action). Collapses to icons below 1280px (labels via `aria-label` and a tooltip). `staff-shell.tsx`
  is a CSS grid `rail | main | dock`; it renders the dock slot from Task 3 (render nothing there until Task 3).
  Keep the skip link. Replace the top bar in `(staff)/layout.tsx` with `StaffShell`.
- [ ] **Step 6: Verify** in the browser at 1440 and 1024: every rail link works, active state is right, the demo
  clock link opens `/settings/demo`, sign out works, a `finance` user (demo seed user) sees no Units item.
- [ ] **Step 7: Commit** `feat(web): staff rail with role-gated Units`.

### Task 3: Docked agent with New chat and History

**Files:**
- Create: `apps/web/components/copilot/dock.tsx`, `apps/web/components/copilot/history-menu.tsx`,
  `apps/web/lib/copilot/thread-context.ts`
- Modify: `apps/web/components/shell/staff-shell.tsx`, `apps/web/components/copilot/chat.tsx` (accept a
  `layout="dock"` prop for spacing only), `apps/web/components/ask-ai.tsx`
- Delete when unused: `apps/web/components/copilot/panel.tsx` (move `COPILOT_ASK_EVENT`,
  `COPILOT_PREFILL_EVENT`, `pageRefFor` into `dock.tsx` and update imports)
- Test: `apps/web/test/thread-context.test.ts`

**Interfaces:**
- Consumes: `PageRef`, `CopilotChat`, `ThreadRow`, `ThreadDetail`, `toChat` (existing); `dockDefault`, `DOCK_KEY`,
  `screenOf` (Task 2).
- Produces:
  - `type DockThread = { id: string | null; context: PageRef | null }` (`id: null` = new chat not yet sent)
  - `nextThreadFor(current: DockThread, page: PageRef | undefined, reason: "navigate" | "ask" | "new"): { action:
    "keep" | "new"; context: PageRef | null }`
    - `new` → always `{ action: "new", context: page ?? null }`
    - `navigate` → always `keep` (the dock offers "New chat about …" instead)
    - `ask` → `keep` when `page` is undefined or same `kind`+`id` as `current.context`, or when `current.id` is
      null and `current.context` equals `page`; otherwise `{ action: "new", context: page }`
  - Event detail for `COPILOT_PREFILL_EVENT` becomes `{ text: string; page?: PageRef }` (old `{ text }` still works).

- [ ] **Step 1: Write the failing test** `thread-context.test.ts` covering each rule above, including: thread
  about lease A, ask on lease B → `new` with lease B; ask with no page → `keep`; navigate to lease B → `keep`;
  `new` on Settings → `new` with `context: null`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `thread-context.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Build the dock.** `dock.tsx` (client), 380px column, mounted once in `StaffShell` so it survives
  navigation. Header: spark mark, "Agent", context pill ("About {kind}" from the thread's context, or "Anything"),
  **New chat** button (`PlusCircle`), **History** (`history-menu.tsx`: fetches `/api/copilot/threads` through
  the same server path Home uses today — add a small route handler `app/api/copilot/threads/route.ts` that
  proxies `get<ThreadRow[]>("/api/copilot/threads")` if no client path exists; list title, context kind,
  relative date; picking one loads `/api/copilot/threads/:id` and passes `threadId` + `toChat(detail)` to
  `CopilotChat`), hide button (`SidebarSimple`). When the page's record differs from the thread's, show a slim
  bar "You're on {kind}. New chat about it" that applies `nextThreadFor(…, "new")`. `CopilotChat` is keyed by a
  local dock-thread key so New chat remounts it; `onThread` records the id. Open state per screen in
  `localStorage[DOCK_KEY(screen)]`, default `dockDefault`. Hidden: a vertical "Agent" tab on the right edge.
  `Ctrl+K`/`⌘K` and the existing `Ctrl+J` toggle and focus the composer; `Escape` closes only in overlay mode.
  Below 1200px the dock is an overlay sheet with a scrim (reuse today's panel behaviour: portal to body,
  `inert` when closed). Settings starters: pass `starters` exactly as `panel.tsx` does today. Prefill/ask events:
  open the dock, apply `nextThreadFor(…, "ask")`, then hand the text to `CopilotChat` (`prefill` / `ask`).
- [ ] **Step 6: Update** `AskAi` / `AskAiMenu` to accept an optional `page?: PageRef` and send it in the event
  detail; restyle as a pill with the Phosphor `Sparkle` icon and `bg-accent text-on-accent`.
- [ ] **Step 7: Verify** in the browser: open a lease, ask something, go to Units, come back: the same thread is
  still there; New chat empties it; History reopens the earlier thread; Ask AI on another lease starts a new
  thread about it; voice input, read-aloud, proposals with Confirm, decision cards and drafts all still work in
  the dock; dock hide state is remembered per screen; Units starts hidden.
- [ ] **Step 8: Commit** `feat(web): docked agent with new chat and history`.

### Task 4: Thinking timeline (T1)

**Files:**
- Create: `apps/web/lib/copilot/step-labels.ts`, `apps/web/components/chat-ui/thinking.tsx`
- Modify: `apps/web/components/copilot/chat.tsx` (render `Thinking` for each assistant message's `tools`)
- Test: `apps/web/test/step-labels.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (`tools: ToolStep[]` with `name`, `args`, `status: "running" | "ok" | "failed"`;
  message `status: "streaming" | "done" | …`) from `use-chat.ts`.
- Produces: `stepLabel(name: string, args: Record<string, unknown>): { label: string; source: string | null }`;
  `<Thinking tools={ToolStep[]} streaming={boolean} startedAt={number} answerStarted={boolean} />`.

- [ ] **Step 1: List the tool names** from `packages/copilot/src/tools/` (read only) and write the label map: a plain
  present-tense phrase per tool ("Reading the application", "Checking the Smart Rental Index", "Looking up the
  rulebook") and a `source` for rulebook / SRI / Ejari tools ("rulebook", "Smart Rental Index", "Ejari (simulated)").
- [ ] **Step 2: Write the failing test** `step-labels.test.ts`: every tool `name` in
  `packages/copilot/src/tools/*.ts` (read each file with `fs`, take the `name: "..."` literal of its tool
  definition by regex; skip `index.ts` and `shared.ts`) has a label that is not the generic one; an unknown name such as `"future_tool"` returns `{ label: "Working on it",
  source: null }`; no label contains "—" or "–"; args are never echoed into the label (pass
  `{ emiratesId: "784-1990-1234567-1" }` and assert the label does not contain `784`).
- [ ] **Step 3: Run** it. Expected: FAIL.
- [ ] **Step 4: Implement** `step-labels.ts`.
- [ ] **Step 5: Run** it. Expected: PASS.
- [ ] **Step 6: Build `thinking.tsx`** per spec "Thinking timeline": while streaming and before the first answer
  token: header with pulsing spark, "Working", seconds counter (client timer from `startedAt`, not engine time),
  ordered steps (running: spinner; ok: check; failed: warning icon and "didn't work"), each step entering with
  Motion (opacity + 4px y, 180 ms, 40 ms stagger). When the answer starts: collapse to "Worked for Ns, K steps"
  with a "Show steps" toggle (`aria-expanded`). A message with zero tools shows only "Working" until tokens
  arrive, then nothing. Reduced motion: no pulse, no stagger. Replace the current tool-step rendering in
  `chat.tsx` with `Thinking`; keep the `unverified` notice and all cards as they are.
- [ ] **Step 7: Verify** in the browser with Ollama running: ask "Which contracts are waiting for approval?":
  steps appear one by one, collapse when the answer streams, reopen on click; an engine error shows inline.
- [ ] **Step 8: Commit** `feat(web): thinking timeline in the agent`.

### Task 5: Ask AI prompt builders and UI primitives

**Files:**
- Create: `apps/web/lib/ask-ai/prompts.ts`, `apps/web/components/ui/{button,card,pill,sheet,segmented,empty-state}.tsx`
- Test: `apps/web/test/ask-ai-prompts.test.ts`

**Interfaces:**
- Produces `askPrompts` with one function per row of the spec's "Ask AI placements" table, each returning
  `{ label: string; prompt: string }[]`: `queueRow(name, gateOrTask)`, `homeEmpty()`, `workList(kind)`,
  `application(name)`, `lease(ref)`, `gate(gateLabel, name)`, `logEntry(text)`, `identity(name)`, `offer(name)`,
  `contractEjari(ref)`, `unitsList()`, `unit(code)`, `settingsHub()`, `settingsPage(title)`, `newApplication()`.
  Primitives: `Button({ variant: "primary" | "ghost" | "quiet"; size?: "sm" | "md" })`, `Card`, `Pill({ tone:
  "neutral" | "accent" | "danger" | "warning" })`, `Sheet({ open, onClose, title, children })` (Motion slide-in,
  focus trap, Escape closes), `Segmented({ options, value, onChange })`, `EmptyState({ title, body, action })`.

- [ ] **Step 1: Write the failing test**: each builder returns at least one item; every prompt that takes a name
  or ref contains it; `homeEmpty()[0].prompt === "What should I look at today?"`; no prompt contains "—" or "–";
  passing a phone-like string as a name (`"+971501234567"`) does not echo the digits: builders run every
  argument through `maskPii` from `@leasing/core`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `prompts.ts` using the spec table's example wording, and the primitives (Tailwind
  classes from Task 1 tokens; `:active` `scale-[0.98]`; visible focus ring `outline-2 outline-ink`).
- [ ] **Step 4: Run** it. Expected: PASS. Run `bun run typecheck`.
- [ ] **Step 5: Commit** `feat(web): Ask AI prompts and UI primitives`.

### Task 6: Home inbox

**Files:**
- Modify: `apps/web/app/(staff)/page.tsx`, `apps/web/components/live/home-tiles.tsx` (restyle only)
- Create: `apps/web/app/(staff)/home-queue.tsx`

**Interfaces:**
- Consumes: `get<HomeView>("/api/home")`, `get<RecordRow[]>("/api/records?mine=1")`, `get<TaskRow[]>("/api/tasks")`,
  `get<Me>("/api/me")`; `askPrompts.queueRow`, `askPrompts.homeEmpty`; `workHref` from `work/url.ts`.

- [ ] **Step 1: Build** per spec "Home": greeting with first name and Dubai date (`/health` `today`, as now);
  "Your queue" with `Segmented` All / Approvals / Tasks; approval rows from records with `waitingForMe`, task
  rows from `/api/tasks` with `status` open (same filter the Tasks page uses), sorted by `dueOn` then
  `updatedAt`; each row: who, what (`nextStep` or task title), due, an open link (`workHref({}, { kind, id })`
  or the task's entity link as `/tasks` builds it) and `AskAi` with `page` for leases. "All tasks" links to
  `/tasks`. Empty: `EmptyState` with `askPrompts.homeEmpty()`. Then "Agent activity today" (`HomeTiles` and
  `agentToday`, content unchanged) and a "Numbers" strip (viewings today, offers out, awaiting signature, Ejari
  pending) linking to `/metrics`. Remove the full-page `CopilotWorkspace` and thread list from Home (the dock has
  them); keep the starter suggestions by passing them to the dock as its Home starters.
- [ ] **Step 2: Verify** with demo data (`bun run demo:seed` if empty): queue matches Workspace's "waiting" view,
  tasks match `/tasks`, live tiles refresh, Ask AI on a row prefills the dock.
- [ ] **Step 3: Commit** `feat(web): Home inbox`.

### Task 7: Workspace

**Files:**
- Modify: `apps/web/app/(staff)/work/{page,record-list,detail-pane,activity-log,views,entry-actions}.tsx`,
  `apps/web/app/(staff)/work/url.ts`, `apps/web/components/{application-detail,lease-detail,approval-detail,decision-form,contract-panel,application-actions}.tsx`,
  `apps/web/app/(staff)/applications/new/page.tsx`, `apps/web/app/(staff)/applications/page.tsx`,
  `apps/web/app/(staff)/leases/page.tsx`, `apps/web/app/(staff)/conversations/[id]/page.tsx`, `apps/web/app/(staff)/tasks/page.tsx`
- Test: `apps/web/test/work-url.test.ts`, `apps/web/test/redirects.test.ts` (add cases)

**Interfaces:**
- Consumes: `parseQuery`, `workHref` (existing), `askPrompts.*`, `Sheet`, `AskAiMenu`.
- Produces: `WorkQuery` gains `new?: true` parsed from `new=1`; `workHref` writes it.

- [ ] **Step 1: Write the failing tests**: `parseQuery({ new: "1" }).new === true`; `parseQuery({ new: "yes" }).new
  === undefined`; `workHref({}, { new: true })` contains `new=1`; existing keys round-trip. In `redirects.test.ts`
  add: `/inbox/:id` → `/work?approval=:id` and `/applications/new` not redirected (already present: keep green).
- [ ] **Step 2: Run** them. Expected: the `new` cases FAIL.
- [ ] **Step 3: Implement** the `new` key in `url.ts`.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Restyle** per spec "Workspace": tabs Applications / Leases (from `kind`; default the current
  behaviour), list grouped by stage with search and the existing filters and saved views, each tab with a
  "Table view" link to `/applications` or `/leases`. Record pane keeps every section of
  `application-detail.tsx` and `lease-detail.tsx`; when an approval is waiting, the approval detail and decision
  form are pinned at the top in a `bg-accent/40` gate panel with `AskAi` (`askPrompts.gate`). Add the Ask AI
  menus from the spec table to the list header, record header, documents and identity check, offer, contract
  and Ejari, and per helper entry in the activity log. Header primary button "New application" sets `new=1`;
  the sheet renders the same form component `/applications/new` uses (extract it to
  `app/(staff)/applications/new/new-application-form.tsx` if it is inline) with an `AskAi` for
  `askPrompts.newApplication()`. Restyle `/applications`, `/leases`, `/tasks`, `/conversations/[id]` with the
  same primitives inside the shell; no behaviour change.
- [ ] **Step 6: Verify**: approve and send back at a gate from Workspace; record a site visit; open
  `/work?approval=<id>`, `/applications/new`, `/leases?show=<each filter>`, `/tasks?for=me`; Ejari panel shows
  "Simulated"; drafts open in the normal form; keyboard: Tab order list → record → gate buttons.
- [ ] **Step 7: Commit** `feat(web): Workspace with gate panel and Ask AI`.

### Task 8: Units area

**Files:**
- Modify: `apps/web/app/(staff)/units/{page,[id]/page,[id]/edit/page,new/page}.tsx`, `apps/web/components/{unit-form,unit-gallery,photo-manager,photo-picker,unit-actions,company-split}.tsx`
- Create: `apps/web/app/(staff)/units/not-allowed.tsx`

**Interfaces:**
- Consumes: `canSeeUnits` (Task 2), `askPrompts.unitsList`, `askPrompts.unit`, `Segmented`, `Card`.

- [ ] **Step 1: Role gate**: each units page fetches `/api/me` (the list page already does) and renders
  `NotAllowed` ("Units are managed by leasing staff. Ask an admin if you need access.") when `!canSeeUnits(role)`.
- [ ] **Step 2: Build** per spec "Units": header with "Add unit" (only when the page's existing `canEdit`) and
  Ask AI menu; `Segmented` state filter with counts (Prep, Ready, Listed, Occupied, All); search; photo card grid
  (`grid-cols-[repeat(auto-fill,minmax(260px,1fr))]`, image 190px, `loading="lazy"`, width/height set). Unit page:
  gallery, stepper Prep → Occupied, ready-to-list checklist and Publish listing as `unit-actions.tsx` does now,
  description, SRI band labelled "From the published Smart Rental Index", leases and applications on the unit,
  company split, activity, Ask AI menu. Import stays where it is today (`canImport`). Edit and new use the
  existing form restyled.
- [ ] **Step 3: Verify** as `leasing_officer`: filter, search, add, edit, photos upload and reorder, publish;
  as `finance`: `/units` and `/units/<id>` show `NotAllowed`; the dock starts hidden here and can be opened.
- [ ] **Step 4: Commit** `feat(web): Units area`.

### Task 9: Settings hub

**Files:**
- Create: `apps/web/lib/settings/hub.ts`, `apps/web/app/(staff)/settings/hub-search.tsx`
- Modify: `apps/web/app/(staff)/settings/page.tsx`, every `apps/web/app/(staff)/settings/*/page.tsx` (header and
  back link), `apps/web/components/settings-tabs.tsx` (keep only the category `Segmented` if a page uses it;
  remove the tab bar from pages), `apps/web/components/settings-bar.tsx`
- Test: `apps/web/test/settings-hub.test.ts`

**Interfaces:**
- Produces: `HUB: { group: string; items: { href: string; title: string; blurb: string; who: string; demoOnly?:
  boolean; keywords: string[] }[] }[]` with groups and items exactly as spec "Settings (S1 hub)";
  `filterHub(q: string, opts: { demo: boolean }): typeof HUB` (case-insensitive, trims, matches title, blurb and
  keywords; drops empty groups; drops `demoOnly` items unless `demo`).

- [ ] **Step 1: Write the failing test**: `HUB` hrefs equal the current `TABS` hrefs in `settings-tabs.tsx` (nine,
  incl. `/settings/demo`); `filterHub("  SRI ", …)` returns only Smart Rental Index; `filterHub("ejari", …)` →
  whatever item lists that keyword (Contracts or Rulebook, as you set keywords); `filterHub("zzz", …)` is `[]`;
  `filterHub("", { demo: false })` has no Demo item. `who` strings match engine role checks for each page (read
  the page's role constants, e.g. `EDITORS`).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `hub.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Build** the hub page: search (`hub-search.tsx`, client, filters cards live), grouped cards with
  title, blurb, who, "last changed" only where the page data has it (rulebook latest version date, KYC draft
  date), Ask AI (`askPrompts.settingsHub`). No match: `EmptyState` "No setting matches" with Ask AI. Each settings
  page: "Settings" back link, title, one-paragraph explanation, existing form and previews unchanged, its
  existing `AskAiMenu` prompts plus `askPrompts.settingsPage(title)`.
- [ ] **Step 6: Verify** every settings page saves as before (companies, rent rules, contracts with preview,
  SRI, KYC publish, rulebook versions, agent permissions with locked rows, import, demo clock jump and rewind).
- [ ] **Step 7: Commit** `feat(web): Settings hub`.

### Task 10: Tenant and landlord links

**Files:**
- Modify: `apps/web/app/t/[token]/**/page.tsx`, `apps/web/app/t/[token]/application-status.tsx`,
  `apps/web/app/t/[token]/layout.tsx` (create if missing)

- [ ] **Step 1: Build** per spec "Tenant and landlord links": layout with brand, unit and stage stepper (reuse
  `components/chat-ui/stage-stepper.tsx` data from `components/chat-ui/stages.ts`), one column `max-w-[480px]`,
  one primary button per page pinned at the bottom on phones (`pb-[env(safe-area-inset-bottom)]`), inputs 44px
  tall, `type`/`autocomplete` attributes on fields. Same for the `TENANCY_OPS` pages. No dock, no Ask AI.
  PDF and file routes untouched.
- [ ] **Step 2: Verify** at 390px using demo tokens (from the demo console or seed output): upload documents,
  accept an offer, sign, acknowledge, property page; both themes.
- [ ] **Step 3: Commit** `feat(web): phone-first tenant links`.

### Task 11: Public site and public chat

**Files:**
- Modify: `apps/web/app/customer/**`, `apps/web/components/public/*`, `apps/web/components/customer-chat/*`
- Test: existing `grid-filters.test.ts` stays green

- [ ] **Step 1: Build** per spec "Public site": photo-led properties grid with the existing filters, property
  page with gallery and enquiry or site-visit form, left-aligned hero; public chat with Apply now, status check
  after the email code and the launcher, using a light `Thinking` (Task 4 component with `stepLabel` fallbacks
  for the public chat's own tool events in `customer-chat/use-chat.ts`).
- [ ] **Step 2: Verify**: `/properties`, `/chat` still redirect; book a site visit; Apply now; status check with
  an email code from the dev mail log; voice input works.
- [ ] **Step 3: Commit** `feat(web): public site and chat`.

### Task 12: Login, leftovers, CSS clean-up, final check

**Files:**
- Modify: `apps/web/app/login/page.tsx`, `apps/web/app/not-found.tsx`, `apps/web/app/(staff)/error.tsx`,
  `apps/web/app/(staff)/metrics/page.tsx`, `apps/web/app/(staff)/maintenance/page.tsx`, tenancy panels
  (`tenancy-panels.tsx`, `renewal-*.tsx`, `move-out-panel.tsx`, `case-panel.tsx`), `apps/web/app/globals.css`,
  `apps/web/lib/icons.tsx`

- [ ] **Step 1: Restyle** login (split layout), not-found, error, metrics, and the `TENANCY_OPS` pages with the
  primitives (no behaviour change).
- [ ] **Step 2: Remove dead CSS**: for each selector block in `globals.css`, `grep -r` its class names in
  `apps/web/app apps/web/components`; delete blocks with no users. Replace remaining `lib/icons` uses with
  Phosphor; keep `BrandMark`.
- [ ] **Step 3: Route sweep** in the browser, both themes, at 1440, 1024 and 390: every URL in the spec route
  map, plus `/inbox`, `/inbox/<id>`, `/copilot`, `/rules`, `/sri`, `/import`, `/demo`, `/properties`, `/chat`.
  Keyboard-only pass on Home, Workspace gate and Settings. Reduced motion on (OS setting): no movement.
- [ ] **Step 4: Run** `bun run typecheck`, `bun run lint`, `bun test apps/web`. Expected: all pass.
- [ ] **Step 5: Run the `compliance-reviewer` subagent** on the branch diff (the copilot UI and Ejari panel
  changed) and fix what it finds.
- [ ] **Step 6: Commit** `chore(web): redesign clean-up`. Summary to the user lists the new dependencies and
  their exact versions.
