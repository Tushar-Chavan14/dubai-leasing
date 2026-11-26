# M1: shared UI lift, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. One implementer runs every task in order.
> Steps use `- [ ]`. Parent plan: `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (chunk M1).

**Goal:** Move leasing's generic web pieces into `@platform/ui`, so the SPA screens in M2–M9 reuse them. Leasing imports
them back and renders identically.

**Architecture:**
- Each lifted component loses its `@leasing/*` and `../../lib/*` imports.
- Domain data arrives as plain props (strings, numbers, `src` URLs, label objects).
- Engine calls arrive as server-action props or `href`s.
- Leasing keeps a thin wrapper, or changes its import path, at each call site.
- Pure helpers get unit tests in `platform/ui/test`; components get `renderToStaticMarkup` tests.

**Tech stack:** React 19, Next 16 client components, Tailwind tokens from `platform/ui/src/theme.css`, Bun test.

## Global constraints

- `platform/` imports no module: `scripts/check-domain-rules.ts` must pass.
- No behaviour change in leasing:
  - Its unit tests must pass unchanged, especially `modules/leasing/apps/web/test/{grid-filters,live-poll,stages,decision-card-helpers}.test.ts`.
  - Its pages must look the same in before/after screenshots.
- New exports go under `platform/ui/src/<area>/<name>.tsx`. `package.json` `exports` maps them as `"./<area>/*": "./src/<area>/*.tsx"`,
  plus `.ts` entries for non-JSX files.
- No new runtime dependency.
  - If tests need `react-dom/server`, add `react-dom` to `platform/ui` `devDependencies` at the exact version
    `modules/leasing/apps/web/package.json` pins.
  - Say so in the summary.
- Copy stays the same: lifted components take labels as props, with today's leasing English as the default only where
  the text is not leasing-specific ("No photo yet", "Photos", "Remove"). Leasing-specific words ("Rent", "Check my
  application") are always passed in.
- Don't run `next build`. Don't commit. Don't touch `data/uploads/`.

## Review focus

1. **Server actions passed as props to client components.** They must still be server actions: import them in a server
   file and pass them down; never wrap them in an inline client closure. Covered by the PhotoManager screenshot check
   (upload, caption, reorder, delete still work in the browser).
2. **The `/api/live` URL and photo URL rewrites.** Leasing's `photoSrc` rewrites `/units/...` to `/api/units/...`. The
   lifted `Cover` and `Gallery` take a ready `src` and must not rewrite again. Leasing passes `photoSrc(...)` itself.
3. **Hue placeholder stability.** `hueOf` moves to `platform/ui/src/media/hue.ts`. Leasing's placeholder colours must not
   change, so test the same inputs give the same numbers.
4. **Finder query keys.** Leasing's URLs (`toQuery` keys) must stay identical. The generic Finder must not invent its own
   param names: leasing keeps building the href.

---

### Task 0: Baseline screenshots (before any edit)

- [ ] **Step 1:** Make sure the leasing dev stack is running (`bun run dev:leasing` in the background if ports 3000 and 4000 are
  closed). Seed only if empty: `bun run demo:seed`.
- [ ] **Step 2:** Use the chrome-devtools MCP tools to save PNGs, light theme at 1280×800 and 390×844, into
  `/tmp/claude-1000/m1-shots/before/`:
  - `/customer/properties`
  - one `/customer/properties/[id]`
  - `/units`
  - one `/units/[id]`
  - `/units/[id]/edit` (photo manager)
  - Home with the copilot open on a record or unit card if one shows, otherwise skip it
  - one application record (activity list)
- [ ] **Step 3:** Run `bun test modules/leasing/apps/web` and record the pass count.

### Task 1: Media kit: `Cover`, `Gallery`, `hueOf`, photo checks

**Files:**
- Create:
  - `platform/ui/src/media/hue.ts` (`hue`, `hueOf`, `placeholderStyle`, moved from `modules/leasing/apps/web/lib/listings.ts`)
  - `platform/ui/src/media/cover.tsx`
  - `platform/ui/src/media/gallery.tsx`
  - `platform/ui/src/media/photo-check.ts` (`MAX_SOURCE_BYTES`, `checkPhotoFile`, moved from `lib/images.ts`)
- Modify:
  - `modules/leasing/apps/web/lib/listings.ts` and `lib/images.ts` re-export from platform (keep their export names)
  - `components/public/cover.tsx` becomes a wrapper or is deleted with call sites updated
  - `components/unit-gallery.tsx` wraps `Gallery`
- Test: `platform/ui/test/media.test.tsx`

**Interfaces:**
- Produces:
  - `hueOf(s: string): number`
  - `placeholderStyle(seed: string): CSSProperties`
  - `checkPhotoFile(file: File): string | null`
  - `Cover({ name, src, className?, alt?, label?, emptyLabel? = "No photo yet" })`. `name` seeds the hue and the alt text; `src` is
    a ready URL or `undefined`.
  - `Gallery({ title, photos: {id: string; src: string; caption: string}[], emptyLabel?, placeholder?: ReactNode })`
    keeps unit-gallery's markup.

- [ ] **Step 1:** Write tests:
  - `hueOf("Marina Heights")` equals the value the old leasing function returns (compute it once from the old code and pin the number).
  - `Cover` with `src` renders `<img src=…>`; without it renders `role="img"` with the name and "No photo yet".
  - `label={false}` hides the caption.
  - `checkPhotoFile` rejects a 26 MB file and a `text/plain` file and accepts a small `image/jpeg`.
- [ ] **Step 2:** Run `bun test platform/ui/test/media.test.tsx`. Expect it to fail (missing modules).
- [ ] **Step 3:** Move the code and switch the leasing call sites to pass `src={photoSrc(photo)}` and `name={building}`.
- [ ] **Step 4:** Run the media test and `bun test modules/leasing/apps/web`. Both pass with the same leasing count.

### Task 2: Photo picker and manager

**Files:**
- Create:
  - `platform/ui/src/media/photo-picker.tsx` (`PhotoItem`, `PhotoPicker`, `moveItem`, moved as is, importing `checkPhotoFile` from Task 1)
  - `platform/ui/src/media/photo-manager.tsx`
- Modify:
  - `modules/leasing/apps/web/components/photo-picker.tsx` re-exports
  - `components/photo-manager.tsx` becomes a wrapper passing leasing's server actions
- Test: add to `platform/ui/test/media.test.tsx`

**Interfaces:**
- Produces: `PhotoManager({ photos: {id; src; caption}[], upload: (file: File, caption: string) => Promise<{ photo: { id: string } }>, caption: (id: string, caption: string) => Promise<unknown>, remove: (id: string) => Promise<unknown>, reorder: (ids: string[]) => Promise<unknown>, max? })`.
- Leasing's wrapper passes `uploadPhoto.bind(null, unitId)` (a client helper) and the three server actions bound to `unitId`.
  Bind on the server side or with `.bind`; never use an inline closure over a server action.

- [ ] **Step 1:** Write the test `moveItem([a,b,c], 0, 2)` gives `[b,c,a]` (moved from leasing if it already has one, and keep that one too).
- [ ] **Step 2:** Move the code and run the tests.
- [ ] **Step 3:** In the browser, on `/units/[id]/edit`: add a photo, caption it, reorder it, delete it. Each works as before.
  Use a fictional image generated on the fly (e.g. a 200×200 PNG written to the scratchpad), never `data/uploads/`.

### Task 3: Catalogue kit: `HeroPanel`, `Skyline`, `PropertyCard`, `PublicNav`, `ThemeMenu`, `Finder`

**Files:**
- Create: `platform/ui/src/catalogue/{hero-panel,property-card,public-nav,theme-menu,finder}.tsx`
- Modify: leasing `components/public/{hero-panel,customer-nav,theme-menu,finder,property-grid}.tsx` become wrappers or import
  from platform. `property-grid.tsx` keeps leasing's filters and chips and renders `PropertyCard` for each unit.
- Test: `platform/ui/test/catalogue.test.tsx`

**Interfaces:**
- Produces:
  - `HeroPanel({ count, from, areas, labels: { homes: string; from: string; areas: string } })` and `Skyline({ className? })`.
    Read the current leasing copy and keep it as the leasing labels.
  - `PropertyCard({ href, name, src?, title, subtitle?, price, priceNote?, facts: string[], badge?: string })`: the card markup
    from leasing's grid, with `Cover` inside.
  - `PublicNav({ links: { href: string; label: string; match?: "path" | "query:<key>" }[] })`. This is `CustomerNav`
    generalised: the `?check=1` rule becomes `match: "query:check"`. Leasing passes today's three links.
  - `ThemeMenu({ current, buttons: ReactNode })`, where leasing passes its `ThemeButtons`. If `ThemeButtons` has no leasing
    imports, lift it to `platform/ui/src/catalogue/theme-buttons.tsx` instead and let SPA's `components/theme-buttons.tsx`
    use it too, if identical.
  - `Finder({ fields: { name: string; label: string; anyLabel: string; value: string; options: {value: string; label: string}[] }[], searchLabel: string, onSearch: (values: Record<string, string>) => string })`
    is not serialisable from a server parent. So Finder stays a client component, and leasing wraps it in a client
    `LeasingFinder` that supplies `onSearch` from `applyChip`/`toQuery` and pushes the returned href. Pure piece to
    test: `finderValues(form: FormData, names: string[]): Record<string, string>`.

- [ ] **Step 1:** Write tests:
  - `PropertyCard` renders the link, title, price and facts list.
  - `PublicNav` marks `aria-current="page"` for the path link, and for the query link only when the query key is present
    (use `renderToStaticMarkup` with a mocked `next/navigation`, or test the pure `isCurrent(link, pathname, params)` helper
    that you export).
  - `finderValues` returns empty strings for missing fields.
- [ ] **Step 2:** Move the code and run the catalogue tests plus `bun test modules/leasing/apps/web` (grid-filters unchanged).

### Task 4: Chat cards and record card

**Files:**
- Create: `platform/ui/src/chat/{card-shell,record-card,unit-card}.tsx`
- Modify: leasing `components/chat-ui/{card-shell,record-card,unit-card}.tsx` wrap or re-export
- Test: `platform/ui/test/chat-cards.test.tsx`

**Interfaces:**
- Produces:
  - `CardShell`, `Facts`, `CardNote`, `CardError`, moved as is (no leasing imports today).
  - `RecordCard({ card: { ref; name; unit; stageLabel; stages: readonly string[]; current: string; stageLabels?: Record<string,string>; nextStep; href; actions?: {label: string; send: string}[]; extra?: ReactNode }, disabled?, onSend? })`,
    using the existing `RecordStepper` from `@platform/ui/stepper`. The leasing wrapper maps `RecordCardData` with
    `stagesForStaffStage` and `stageLabel`. Check how the current leasing card renders its stepper and match it; if
    leasing's chat stepper (`chat-ui/stage-stepper.tsx`) differs visually from `RecordStepper`, lift it as
    `platform/ui/src/chat/stage-stepper.tsx` instead of swapping.
  - `UnitCard({ name, src?, title, price, facts: string[], detailsHref?, onBook?, onApply?, bookLabel, applyLabel, disabled })`
    plus `CARD_RAIL`.
- [ ] **Step 1:** Write tests: `RecordCard` shows the next step and one button per action; `UnitCard` hides Book and Apply
  when no handler is given.
- [ ] **Step 2:** Move the code and run the tests and the leasing web tests.

### Task 5: Live refresh and row action

**Files:**
- Create:
  - `platform/ui/src/live/poll.ts` (moved as is)
  - `platform/ui/src/live/use-live.ts`
  - `platform/ui/src/live/live-refresh.tsx`
  - `platform/ui/src/row-action.tsx`
- Modify:
  - leasing `components/live/{poll,use-live,live-refresh}` re-export or wrap
  - leasing `test/live-poll.test.ts` keeps passing (point it at platform if the file moves; keep the assertions)
  - leasing `components/row-action.tsx` re-exports
- Test: `platform/ui/test/live.test.ts` (the `nextDelay` and poller cases, copied from leasing's test)

**Interfaces:**
- Produces:
  - `useLiveVersion(url: string, onChange)`, which now takes the full URL. Leasing passes `` `/api/live?${query}` ``.
  - `LiveRefresh({ url })`. Leasing's wrapper keeps `LiveRefresh({ record })` and builds the URL.
  - `RowAction<R extends { ok?: boolean; error?: string; reasons?: string[] }>({ action, fields, label, danger?, confirmText?, icon? })`.
    It is generic over the result type, so leasing's `RuleResult` fits unchanged.
- [ ] **Step 1:** Copy the poll tests to platform and run them; they fail until the move.
- [ ] **Step 2:** Move the code and run the platform and leasing tests.

### Task 6: First SPA use, and docs

**Files:**
- Modify:
  - `modules/spa/apps/web/app/(public)/properties/[ref]/page.tsx` uses `PublicNav` (one link: "Properties" → `/properties`)
    and `Cover` (`name` = listing title, no photo yet)
  - `docs/platform/README.md` lists the new areas (`media`, `catalogue`, `chat`, `live`, `row-action`), one line each
- Test: the existing SPA web tests still pass (`bun test modules/spa/apps/web`)

- [ ] **Step 1:** Make the change and run the SPA web tests.
- [ ] **Step 2:** In the browser, `/properties/<ref>` on :3001 renders the nav and the placeholder cover. Publish a listing
  first if needed: set a demo listing to PUBLISHED with a future permit date in the `spa` DB. That is demo data only; say so.

### Task 7: Verify

- [ ] **Step 1:** Run `bun run typecheck`, `bun run lint`, `bun test platform/ui`, `bun test modules/leasing/apps/web` and
  `bun test modules/spa/apps/web`. All green; the leasing pass count is at least the Task 0 count.
- [ ] **Step 2:** Take the after screenshots of the same pages into `/tmp/claude-1000/m1-shots/after/` and compare them by eye
  with the before set. List any difference and fix it unless it is dynamic data.
- [ ] **Step 3:** Write the summary:
  - each file moved (from → to)
  - wrappers left in leasing
  - any dependency added
  - screenshot result
  - anything not lifted and why
