# SPA M1b: Staff Shell Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SPA staff pages sit in the same frame as leasing: navy rail, the docked "Agent" panel (header, starter chips, rounded composer, bubble messages, docked/overlay/collapsed behaviour), the Home greeting, and demo data without bracket markers.

**Architecture:** Lift the presentational shell pieces from leasing into `@platform/ui/shell/*` (rail, avatar menu, dock frame, composer card, chip class), exactly as M1 lifted the catalogue pieces. Leasing keeps thin wrappers that pass its icons, nav and chat in; its rendered HTML must not change. SPA swaps its own rail, avatar menu and dock frame for the shared ones and keeps its own transport (`/copilot/chat`, `/copilot/thread`), proposal cards and draft cards.

**Tech Stack:** Bun, TypeScript strict, React 19 / Next 16, Tailwind (tokens from `@platform/ui/theme.css`), `@phosphor-icons/react`.

**Spec:** `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` ("User journeys" and Global constraints), `docs/spa/design.md` §2.

## Global Constraints

- `platform/` imports no module; SPA never imports `@leasing/*`, leasing never imports `@spa/*`. `bun run lint` must print `domain rules: ok`.
- Leasing behaviour and markup are unchanged: leasing web tests stay 132/132 with no test edits. A leasing file may only change its imports or become a thin wrapper.
- No new colours: use `bg-rail`, `text-rail-ink`, `bg-rail-active`, `bg-accent`, `bg-cta` and the other existing tokens.
- The SPA app never names, links or counts another module (S21). The rail brand mark reads "Sales" (aria label "Sales, home"), never "Leasing".
- The SPA copilot still only reads, drafts and proposes; its legal footnote ("never approves, sends, signs or changes anything… do not type passport or ID numbers") stays visible in the empty state.
- Voice (mic, read aloud), thread history and page-context threads are **not** in this chunk (they are F5). Their slots in the shared components are optional props.
- No `new Date()`/`Date.now()` in domain code (UI ids are fine). Don't run `next build`. Restart the SPA and leasing web dev servers only if they crash; don't run DB tests in parallel.

## Review Focus

1. **Narrow viewport (<1200px):** the SPA dock must be an overlay sheet that starts closed, opens with Ctrl/Cmd+K and closes with Escape, as in leasing. Test in Task 3 (`dock frame starts closed in overlay mode`).
2. **Dock closed state survives navigation:** closing it on one screen keeps it closed on that screen after reload (`localStorage` key `dock:<screen>`), the default is open except on Inventory (SPA's Units). Test in Task 3.
3. **Alerts bell placement:** moving the bell out of `<main>` must keep its unread count and its link; it now sits in the rail above ⌘K. Test in Task 4.
4. **Read-only rail items** (`RailItem.readOnly`) keep the "(view only)" title. Test in Task 2.
5. **A long copilot answer with a proposal card** must scroll inside the dock and never push the composer off screen. Checked by screenshot in Task 6.

---

### Task 1: Lift the rail and avatar menu into `@platform/ui/shell`

**Files:**
- Create: `platform/ui/src/shell/rail.tsx`, `platform/ui/src/shell/avatar-menu.tsx`, `platform/ui/test/shell-rail.test.tsx`
- Modify: `platform/ui/package.json` (exports `./shell/rail`, `./shell/avatar-menu`)
- Modify: `modules/leasing/apps/web/components/shell/rail.tsx`, `modules/leasing/apps/web/components/shell/avatar-menu.tsx` (thin wrappers)

**Interfaces:**
- Produces:
  ```ts
  export interface ShellRailItem { href: string; label: string; key: string; count?: number; title?: string }
  export function Rail(props: {
    items: ShellRailItem[];
    current: string;                         // key of the active item
    icons: Record<string, ComponentType<{ size?: number; "aria-hidden"?: boolean }>>;
    brand: { mark: string; label: string; title: string };   // leasing: "DL", "UAE Leasing, overview", "UAE Leasing Contract AI"
    extra?: ReactNode;                       // rendered between the nav and the ⌘K button (SPA: alert bell)
    agentHint?: string;                      // ⌘K title; leasing default "Search or ask the agent (Ctrl+K)"
    footer: ReactNode;
  }): JSX.Element
  export function AvatarMenu(props: { initials: string; name: string; children: ReactNode }): JSX.Element
  ```
  The ⌘K button dispatches the Ctrl+K keydown event (leasing's `openAgent`), so any dock listening for Ctrl+K opens.
- The leasing wrapper `Rail({ items, footer })` maps `NavItem` → `ShellRailItem` (`key = screen`), passes `ICONS`, `screenOf(usePathname())` and the leasing brand. Same for `AvatarMenu` (straight re-export if identical markup).

- [ ] **Step 1:** Write `platform/ui/test/shell-rail.test.tsx`: render with two items, `current` = second → second link has `aria-current="page"` and class `bg-rail-active`; an item with `count: 3` renders `aria-label="3 waiting for you"`; `title` overrides `label` in the link's `title`; `extra` node renders before the ⌘K button. Run `bun test platform/ui/test/shell-rail.test.tsx` → FAIL (module missing).
- [ ] **Step 2:** Move the markup from leasing `components/shell/rail.tsx` and `avatar-menu.tsx` verbatim into the platform files, parameterised as above. Add the package exports.
- [ ] **Step 3:** Turn the leasing files into wrappers. Run `bun test platform/ui` and `bun test modules/leasing/apps/web` → all pass, leasing still 132/132.

### Task 2: SPA uses the shared rail

**Files:**
- Modify: `modules/spa/apps/web/components/rail.tsx` (wrapper over `@platform/ui/shell/rail`), `components/avatar-menu.tsx` (re-export the shared one), `components/alert-bell.tsx` (rail variant)
- Test: `modules/spa/apps/web/test/shell.test.tsx` (create if missing; else extend)

**Interfaces:**
- Consumes: Task 1 `Rail`, `ShellRailItem`.
- SPA wrapper keeps its signature `Rail({ items: RailItem[], footer, badges, alerts })`: `key = screen`, `count = badges[screen]` when > 0, `title = readOnly ? "<label> (view only)" : undefined`, icons map as today, brand `{ mark: "S", label: "Sales, home", title: "Sales" }`, `extra = <AlertBell unread={alerts} variant="rail" />`, `agentHint = "Ask the agent (Ctrl+K)"`.
- `AlertBell` gets `variant?: "page" | "rail"`; `rail` draws the leasing rail button style (60px wide, icon over label "Alerts", white count badge like the rail count) linking to `/alerts`.

- [ ] **Step 1:** Tests: rail HTML contains `bg-rail`, "Sales, home", a read-only item's title "Listings (view only)", Work badge "2 waiting for you", the Alerts link with "4 unread" text when `alerts=4`, and no "Leasing" text. Run → FAIL.
- [ ] **Step 2:** Implement. Run `bun test modules/spa/apps/web/test/shell.test.tsx` → PASS.

### Task 3: Lift the dock frame and composer card

**Files:**
- Create: `platform/ui/src/shell/dock-frame.tsx`, `platform/ui/src/shell/composer.tsx`, `platform/ui/test/dock-frame.test.tsx`
- Modify: `platform/ui/package.json`; leasing `components/copilot/dock.tsx` and `components/chat-ui/composer.tsx` to use them (leasing output unchanged)

**Interfaces:**
- Produces:
  ```ts
  export const DOCK_MIN_WIDTH = 1200;
  export function useDockState(opts: { screen: string; defaultOpen: (screen: string, width: number) => boolean }):
    { ready: boolean; overlay: boolean; open: boolean; show(v: boolean): void; focusComposer(): void };
    // localStorage key `dock:<screen>` (docked mode only); overlay starts closed; Ctrl/Cmd+K opens+focuses,
    // Ctrl/Cmd+J toggles, Escape closes the overlay. Logic moved verbatim from leasing dock.tsx.
  export function DockFrame(props: {
    state: ReturnType<typeof useDockState>;
    title: string;                 // "Agent"
    contextLabel: string;          // the pill in the header ("Anything", "About lease")
    headerActions?: ReactNode;     // leasing: new chat + HistoryMenu; SPA: new chat only
    banner?: ReactNode;            // leasing "You're on a lease" bar
    children: ReactNode;           // the chat body (must contain `.cp-chat textarea` for focus)
  }): JSX.Element | null           // renders the scrim, the collapsed 48px tab, and the 380px aside id="agent-dock"
  export const TOOL_BTN: string; export const SEND_BTN: string; export const FIELD_BARE: string; export const CHIP: string;
  export function ComposerCard(props: { onSubmit; field; tools?: ReactNode; send; below?: ReactNode }): JSX.Element
  ```
  Leasing `StaffComposer` becomes `ComposerCard` + its `QuickActions` pills passed as `below`. `CHIP` is leasing's chip class from `copilot/chat.tsx`.

- [ ] **Step 1:** Tests (render with a stub state object): `open=false, overlay=false` renders the "Open the agent" tab and an aside with `inert`; `open=true, overlay=false` renders the aside with `w-[380px]` and `title` "Agent"; `overlay=true, open=true` renders the scrim. Unit-test the pure part of `useDockState` by exporting `initialOpen({ stored, overlay, screen, defaultOpen, width })`: overlay → false; stored "0" → false; no stored → `defaultOpen`. Run → FAIL.
- [ ] **Step 2:** Move the code. Leasing `dock.tsx` keeps its thread, page-context, ask/prefill and deep-link logic and renders `<DockFrame>` around `<CopilotChat>`.
- [ ] **Step 3:** `bun test platform/ui` and `bun test modules/leasing/apps/web` → pass, leasing 132/132 unchanged.

### Task 4: SPA shell uses leasing's layout

**Files:**
- Modify: `modules/spa/apps/web/components/shell.tsx`, `app/(staff)/layout.tsx`
- Test: `modules/spa/apps/web/test/shell.test.tsx`

- [ ] **Step 1:** Tests: `Shell` renders `bg-canvas` on the root, `<main id="main">` without `max-w-[1240px]` and without the alert bell, and the bell inside the rail. Run → FAIL.
- [ ] **Step 2:** Match leasing's `StaffShell`: root `flex min-h-screen bg-canvas text-ink`; main `min-w-0 flex-1 px-6 pt-9 pb-24 max-sm:px-4 max-sm:pt-6 max-sm:pb-[72px] has-[[data-wk]]:p-0`; avatar menu content and the demo-clock line as leasing (a link to `/settings/demo` when that page exists in SPA, else text). Pages that relied on the 1240px cap get it from their own wrapper only if a screenshot shows a page stretched past leasing's equivalent.
- [ ] **Step 3:** Run SPA web tests → pass.

### Task 5: SPA agent panel inside the shared frame

**Files:**
- Modify: `modules/spa/apps/web/components/copilot-dock.tsx`
- Create: `modules/spa/apps/web/lib/copilot-starters.ts`
- Test: `modules/spa/apps/web/test/copilot-dock.test.tsx` (extend; existing tests keep passing)

**Interfaces:**
- Consumes: Task 3 `DockFrame`, `useDockState`, `ComposerCard`, `CHIP`, `SEND_BTN`, `FIELD_BARE`.
- Keeps exports `DockView`, `ProposalCard`, `DraftCard`, `markUnverified`, `DockLine`, `ProposalLite`, `DraftLite`, `CopilotDock({ role })`.
- Produces `startersFor(role: SpaRole, path: string): string[]` (≤ 4): deal pages (`/work?…deal`, `/deals/…`) "What is this deal waiting for?", "Draft a summary of this deal"; listings "Which listings are published?"; settings "Which templates are waiting for approval?"; default "What is waiting for me?", "Which deals are in party check?", "Which units are available?", "What can you help me with?". Compliance roles get "Which cases are open?" first. Text only; chips send the text.

- [ ] **Step 1:** Tests: empty dock renders heading "What would you like to know?", ≤ 4 chips with the `CHIP` class, the footnote text, the textarea `placeholder="Ask the agent"` inside `.cp-chat`; a `you` line renders with `rounded-[16px_16px_4px_16px]` bubble; a copilot line renders without a border box and still shows "How this was handled" and proposal cards; `startersFor("compliance_officer","/")[0] === "Which cases are open?"`. Run → FAIL.
- [ ] **Step 2:** Implement: `CopilotDock` uses `useDockState({ screen: screenOf(pathname), defaultOpen: (s, w) => s !== "inventory" && w >= DOCK_MIN_WIDTH })`, `DockFrame title="Agent" contextLabel="Anything"`, header action "New chat" (clears lines; server thread stays as today), body `.cp-chat` with the log and `ComposerCard` (round send button, Stop not needed: the SPA call is not streamed, show the busy spinner on the send button). Lines restyled like leasing `Message` (user bubble right-aligned; assistant plain text, tool chips, proposals, drafts, How this was handled). Remove the old `xl:flex` / `w-[340px]` aside and the old `focus()` Ctrl+K listener (the frame owns it).
- [ ] **Step 3:** Run `bun test modules/spa/apps/web` → all pass.

### Task 6: Home greeting, demo names, docs, screenshots

**Files:**
- Modify: `modules/spa/apps/web/app/(staff)/page.tsx` (header only), `modules/spa/apps/engine/src/demo/seed.ts` (or wherever the bracket values live: grep `\[COMMUNITY\]`, `\[BANK\]`, escrow holder), `docs/spa/design.md` §2, `docs/spa/decisions.md` (S76), `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (add M1b ✅ row)
- Test: the seed/demo test that asserts names, if any; `modules/spa/apps/web/test/home*.test.tsx` if the header is asserted

- [ ] **Step 1:** Home header as leasing: `<h1 className="m-0 text-[26px] font-semibold tracking-[-0.025em]">Hello, {first}</h1>` and `<p className="m-0 mt-1 text-sm text-muted">{weekdayDate(today)} UAE time</p>`, inside `mx-auto max-w-[820px]` like leasing Home; keep `HomeView` below unchanged (M7/F6 redo the body).
- [ ] **Step 2:** Replace every remaining bracket marker in seed data with "Demo …" names: community "Demo Marina District", bank "Demo National Bank", escrow holder "Demo Escrow Bank". `grep -rn "\[[A-Z_]\+\]" modules/spa/apps/engine/src/demo modules/spa/packages/db/src` must find no seed value (template placeholders like `[unit_no]` stay).
- [ ] **Step 3:** Docs: design.md §2 now says the SPA shell is the shared leasing shell (navy rail, Agent dock 380px, overlay below 1200px, bell in the rail); decisions.md S76 records "SPA uses the shared staff shell from `@platform/ui/shell`; voice and history come in F5". Tick M1b in the parent plan.
- [ ] **Step 4:** `bun run spa:demo:reset`, restart the SPA engine, then screenshots with the chrome-devtools MCP into `/tmp/claude-1000/m1b-shots`: SPA Home and Inventory at 1440 light and dark, SPA Home at 1024 (overlay closed, then opened with Ctrl+K), leasing Home at 1440 for comparison, and SPA dock with a long answer (Review Focus 5). Rail, dock header, chips and composer must match leasing.
- [ ] **Step 5:** `bun run typecheck` (0 errors), `bun run lint` (`domain rules: ok`), `bun test platform/ui`, `bun test modules/leasing/apps/web` (132/132), `bun test modules/spa/apps/web` (all pass). Report counts.
