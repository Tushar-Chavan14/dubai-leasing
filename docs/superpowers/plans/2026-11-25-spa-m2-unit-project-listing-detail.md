# M2: unit, project and listing detail (S75), implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. One implementer runs every task in order.
> Steps use `- [ ]`. Parent: `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (chunk M2, "User journeys": Admin row).

**Goal:** A developer's admin manages projects and units the way a leasing admin manages units:
- a filterable unit list
- a unit page with gallery, facts, price history and current deal
- New and Edit forms
- photos
- a project page

Listings get the same detail columns and photos. Their screens come in M3.

**Architecture:**
- **Schema.** New columns on `units`, `projects` and `listings`, plus one `spa_media` table for marketing photos of a
  project, unit or listing. Files go to their own `LocalDiskStore` at `data/spa-media`, not the personal-document store.
- **Manager.** New functions sit in `apps/engine/src/manager/inventory.ts` (units and projects) and a new `media.ts`. They
  reuse the `@platform/adapters` storage helpers (`LocalDiskStore`, `sniffImage`, `stripImageMetadata`) exactly as
  leasing's `addUnitPhoto` does.
- **Web.** Screens copy leasing's Units screens (`modules/leasing/apps/web/app/(staff)/units/*`, `components/unit-form.tsx`,
  `components/unit-actions.tsx`) and use the M1 kit: `@platform/ui/media/{cover,gallery,photo-manager}` and
  `@platform/ui/catalogue/property-card`.

**Tech stack:** Hono engine, Drizzle migrations in `modules/spa/packages/db/migrations` (follow the existing generate
pattern; next number 0065), Next 16, Zod, Bun test against `spa_test`.

## Global constraints

- Load the `dubai-sales-spa` skill first.
- `SpaManager` writes. Every write appends a `deal_events` row: entity kind `unit`, `project` or `listing`; the actor; the
  changed fields; `rulesVersion`.
- **Roles.**
  - Inventory writes (project, building, unit, their photos) go through `requireInventory(db, user, "write")`, which
    allows the admin only, as today.
  - Listing photo writes go through `requireListings(db, user, "write")`.
  - Reads keep `CATALOGUE_READERS`.
- **Money and dates.** Money is integer fils; dates are calendar dates. No `new Date()` or `Date.now()` in engine code.
- **Photos** follow leasing's rules:
  - JPEG, PNG or WebP by sniffing, 10 MB max, 24 per owner.
  - Metadata is stripped and the hash is unique per owner (a duplicate returns the existing row).
  - A file is never served from `data/uploads/` or `data/spa-uploads/`.
- **Words.** No screen prints a bare id, enum or column name. Every enum gets a label map in `apps/web/lib/words.ts`
  (extend it if it exists) and a test.
- **Leasing record and UI rules.**
  - Breadcrumbs on every sub-page.
  - Collapsible sections.
  - Reason box on the second click for negative actions. Here that is only "Remove photo", which uses the existing confirm.
- Run DB tests alone (`bun test modules/spa/apps/engine/test/<file>`), never two engine test runs at once.
- Restart the SPA engine after editing packages.
- No `next build`, no commits, no `.env*` reads, no `data/uploads/`.

## Decisions (append S75 to docs/spa/decisions.md in Task 1)

- **Unit columns:**
  - `type`: `apartment` | `villa` | `townhouse` | `penthouse` | `office` | `retail`
  - `bedrooms` smallint 0..10 (0 = studio)
  - `bathrooms` smallint 0..10
  - `internal_sqft` int > 0
  - `balcony_sqft` int ≥ 0
  - `floor` smallint −5..200
  - `view` text ≤ 60
  - `parking_spaces` smallint 0..10
  - `description` text ≤ 2000

  All nullable: old rows stay valid. The unit `code` stays the key.
- **Project columns:** `community` text ≤ 80, `location` text ≤ 120 (free text, no map), `description` text ≤ 2000.
  The handover date is the existing `anticipated_completion_on`.
- **Listing columns:**
  - `unit_type` (same values as unit `type`)
  - `bathrooms`, `floor`, `view`, `parking_spaces` (same ranges as units)
  - `furnished`: `unfurnished` | `semi` | `furnished`

  The existing `bedrooms`, `size_sqft`, `community`, `title` and `description` are kept.
- **`spa_media`:**
  - Columns: `id` uuid pk, `owner_kind` (`project` | `unit` | `listing`), `owner_id` uuid, `sha256`, `path`, `mime`,
    `bytes`, `caption` ≤ 200 nullable, `sort` smallint, `uploaded_by` text, `created_at`.
  - Unique `(owner_kind, owner_id, sha256)`; index `(owner_kind, owner_id, sort)`.
  - The owner's existence is checked in code, since one column can't reference three tables.
  - Media is marketing material, not personal data. It is never mixed with party documents.
- **Price history:** a unit's price per published price-list version, oldest first. The price in use is the latest
  published version's item (the existing `unitListPrice`).

## Review focus

1. **Photo of a unit in another project or of a listing staff can't edit.** Every media route checks the owner exists
   and the role fits its kind. Tested in Task 3.
2. **Concurrent uploads past 24.** The count check runs inside the transaction with the owner row locked (`for update`),
   as leasing does. Tested with two parallel adds at 23.
3. **Edits during a live deal.** Editing a unit's details while it has an open deal is allowed for descriptive fields
   only. `code` and `building_id` changes on a unit with an open deal return 409 `unit_in_deal`. Tested in Task 2.
4. **Filter params from the URL.** Unknown or out-of-range filter values are dropped, not passed to SQL. A `beds=99`
   query returns the unfiltered list, not a 500. Tested in Task 4.
5. **A bare enum leaking into a page.** Component tests assert the label, and that no `AVAILABLE`, `apartment` or uuid
   appears, for each screen in Tasks 6–8.

---

### Task 1: Schema, migration, S75

**Files:**
- Modify: `modules/spa/packages/db/src/schema.ts` (columns above; new `spaMedia` table with exported `MEDIA_OWNER_KINDS`,
  `UNIT_TYPES`, `FURNISHED` const arrays and check constraints using the existing `oneOf` helper)
- Create: migration `0065_*` (generated the same way 0064 was) and `docs/spa/decisions.md` S75
- Test: `modules/spa/packages/db/test/schema-m2.test.ts`

- [ ] **Step 1:** Write the DB test against `freshSpaDatabase`:
  - insert a unit with `type: "villa"`, `bedrooms: 0` → ok
  - `bedrooms: 11` → check violation
  - `type: "castle"` → check violation
  - two `spa_media` rows with the same owner and sha256 → unique violation
- [ ] **Step 2:** Run it. Expect it to fail.
- [ ] **Step 3:** Add the columns, the table and the migration.
- [ ] **Step 4:** Run the test (pass), then `bun run spa:db:migrate` on the dev DB.

### Task 2: Unit and project edits

**Files:**
- Modify: `modules/spa/apps/engine/src/manager/inventory.ts`, `apps/engine/src/app.ts`
- Test: `modules/spa/apps/engine/test/inventory-details.test.ts`

**Interfaces:**
- Produces:
  - `UnitDetails` (Zod: the S75 unit fields, all optional) exported from `@spa/core` (put it beside the existing
    inventory schemas in core).
  - `addUnit(ctx, projectId, input, user)` now also accepts `UnitDetails` fields.
  - `updateUnit(ctx, unitId, input: unknown, user): Promise<{ id: string }>` takes `UnitDetails` plus optional `code` and
    `buildingId`.
  - `updateProject(ctx, projectId, input: unknown, user): Promise<{ id: string }>` takes `name`, `community`, `location`,
    `description` and `anticipatedCompletionOn`.
  - Routes: `PUT /api/units/:id` and `PUT /api/projects/:id`, both 200 `{ id }`.
- Events: `UNIT_UPDATED` / `PROJECT_UPDATED`, with payload `{ changed: string[] }` (field names, not values).

- [ ] **Step 1:** Write tests:
  - admin updates bedrooms, view and description → 200, an event with `changed: ["bedrooms","view","description"]`
  - `sales_manager` → 403
  - `bedrooms: -1` → 422 `invalid_unit`
  - changing `code` on a unit with a deal in a non-final state → 409 `unit_in_deal`, but `description` on it → 200
  - `updateProject` with a new community → 200
  - a brokerage company → 403 (existing rule)
- [ ] **Step 2:** Run them (fail), implement, run them (pass).

### Task 3: Media (photos)

**Files:**
- Create: `modules/spa/apps/engine/src/manager/media.ts`
- Modify:
  - `apps/engine/src/main.ts`: `const media = new LocalDiskStore(resolve(import.meta.dir, "../../../../data/spa-media"))`,
    passed into the app the way `documents` is
  - `apps/engine/src/app.ts`: routes
  - root `.gitignore`: add `data/spa-media/` if `data/` isn't already ignored
- Test: `modules/spa/apps/engine/test/media.test.ts` (use an in-memory or temp-dir `LocalDiskStore` and tiny fictional
  PNG and JPEG bytes built in the test)

**Interfaces:**
- Produces:
  - `addMedia(ctx, store, owner: { kind: MediaOwnerKind; id: string }, bytes: Uint8Array, caption: string | null, user): Promise<{ media: MediaRow; duplicate: boolean }>`
  - `removeMedia(ctx, mediaId, user)`
  - `reorderMedia(ctx, owner, ids: string[], user)`: ids must be exactly the owner's set, else 422
  - `captionMedia(ctx, mediaId, caption, user)`
  - `listMedia(db, owner): Promise<{ id; caption; sort }[]>`
  - `readMedia(ctx, store, mediaId, user): Promise<{ bytes; mime }>`
- Routes (all `auth`):
  - `GET /api/media?kind=&id=` → `{ items }`
  - `POST /api/media` (multipart: `kind`, `id`, `file`, `caption?`) → 201
  - `PATCH /api/media/:id` `{ caption }`
  - `DELETE /api/media/:id`
  - `PUT /api/media/order` `{ kind, id, ids }`
  - `GET /api/media/:id/file` → bytes with `content-type` and `cache-control: private, max-age=300`
- Events: `MEDIA_ADDED`, `MEDIA_REMOVED`, `MEDIA_REORDERED`, `MEDIA_CAPTIONED` on the owner's entity, with sha256 and
  bytes, never the path.

- [ ] **Step 1:** Write tests:
  - Role rules:
    - an admin adds a unit photo → stored and listed
    - `sales_officer` adding to a unit → 403
    - `sales_officer` adding to a listing on a brokerage company → 201
    - a missing owner → 404
  - File rules:
    - the same bytes again → `duplicate: true` with no new row
    - a 10 MB + 1 byte file → 422 `too_large`
    - a text file → 422 `unsupported_type`
    - the 25th photo → 422 `too_many`
    - two parallel adds at 23 → exactly one succeeds
  - Ordering: `reorderMedia` with a missing id → 422.
  - Privacy: the stored file has no EXIF block (build a JPEG with an APP1 segment and assert it's gone).
- [ ] **Step 2:** Run them (fail), implement, run them (pass).

### Task 4: Unit list and unit record reads

**Files:**
- Modify: `apps/engine/src/manager/inventory.ts` (or a new `inventory-reads.ts` if inventory.ts passes ~500 lines),
  `app.ts`
- Test: `modules/spa/apps/engine/test/inventory-reads.test.ts`

**Interfaces:**
- Produces:
  - `listUnits(ctx, user, q: UnitQuery): Promise<{ items: UnitRow[]; next: string | null; facets: { projects: {id; name}[]; types: string[]; beds: number[] } }>`.
    - `UnitQuery` (Zod with `.catch(undefined)` per field, so bad values drop): `project?`, `building?`, `type?`,
      `beds?` 0..10, `state?`, `minPriceFils?`, `maxPriceFils?`, `q?` (code contains, ≤ 40), `cursor?`, `limit` 1..100,
      default 50.
    - `UnitRow`: `{ id, code, state, type, bedrooms, internalSqft, view, floor, project: {id, name}, building: {id, name} | null, priceFils: number | null, coverMediaId: string | null, openDeal: { id; ref; state } | null }`
    - Ordered by project code, then unit code.
  - `getUnit(ctx, user, unitId)`: all detail fields, project and building, `media` (list), `priceHistory: { version: number; publishedAt: string; priceFils: number }[]`,
    `currentPriceFils`, `openDeal`, `pastDeals: { id; ref; state }[]`.
  - Routes: `GET /api/units` and `GET /api/units/:id`.
  - `getProject` gains the new project fields and `media`; `listProjects` gains `community`, `coverMediaId` and unit
    counts by state.

- [ ] **Step 1:** Write tests:
  - Filters: `type=villa` returns only villas; `beds=99` returns the unfiltered list; price band uses the price in use.
  - Pagination: the cursor gives the second page without overlap.
  - `getUnit` price history after publishing v1 and v2 has two entries with the v2 price current.
  - `openDeal` is set only for a non-final deal.
  - A `listing_agent` role (or whichever role is outside `CATALOGUE_READERS`) → 403.
- [ ] **Step 2:** Run them (fail), implement, run them (pass).

### Task 5: Demo seed details

**Files:**
- Modify: `modules/spa/apps/engine/src/seed.ts`
- Test: the existing seed test (or add `seed-details.test.ts`): after seeding, every unit has `type`, `bedrooms`,
  `internal_sqft` and `view`; project MV-01 has community and description.

- [ ] **Step 1:** Fill fictional details for U-101…U-204 (a mix of studios and 1–3 bed apartments, two penthouses, views
  like "Marina", "Community", "Pool"). Give MV-01 a fictional community and description, and give the listing L-0001 its
  new fields. No photos; the Cover placeholder covers that.
- [ ] **Step 2:** Run the seed test, then `bun run spa:demo:reset`.

### Task 6: Inventory: unit list (leasing Units browser)

**Files:**
- Create:
  - `modules/spa/apps/web/app/(staff)/inventory/units-browser.tsx`, modelled on leasing
    `app/(staff)/units/units-browser.tsx`: filter bar (project, type, beds, state, price band, search), a card grid using
    `PropertyCard` with a list/grid toggle, and empty and error states
- Modify:
  - `app/(staff)/inventory/page.tsx`: tabs **Units** (default) and **Projects**; Projects is the existing project table
    with community, cover and counts
  - `apps/web/lib/words.ts`: `UNIT_TYPE_LABEL`, `UNIT_STATE_LABEL`, `FURNISHED_LABEL`, `bedsLabel`
- Test: `modules/spa/apps/web/test/inventory-browser.test.tsx`

**Interfaces:**
- Consumes: `GET /api/units` (Task 4) and `GET /api/media/:id/file` through a Next route
  `app/(staff)/media/[id]/route.ts` that streams it with the session's token. The browser never sees the engine address.

- [ ] **Step 1:** Write tests that render the browser with two fixture rows:
  - "Studio", "Apartment" and "Available" appear
  - no `AVAILABLE`, `apartment` or uuid in the text
  - the price is "AED 1,250,000"
  - a unit with an open deal shows its ref linked to `/work/deals/<id>`
  - for a non-admin, no New unit button
- [ ] **Step 2:** Run them (fail), implement, run them (pass).

### Task 7: Unit page, New and Edit forms (leasing unit page and unit form)

**Files:**
- Create:
  - `app/(staff)/inventory/units/[id]/page.tsx`: breadcrumbs Inventory › Units › code; sections in record order:
    - Overview: facts grid and gallery (`Gallery`)
    - Price: price in use and history table
    - Deals: open and past deals, linked
    - Activity: unit events
  - `app/(staff)/inventory/units/new/page.tsx` and `units/[id]/edit/page.tsx`
  - `components/unit-form.tsx`, modelled on leasing `components/unit-form.tsx`: grouped fields (Where: project, building,
    code; Layout: type, beds, baths, sizes, floor, view, parking; Description), Zod-checked client side with
    `UnitDetails`, server errors mapped per field with `@platform/ui/field-errors`
  - `components/unit-photos.tsx`: a client wrapper around `@platform/ui/media/photo-manager` bound to `kind: "unit"`
  - `app/(staff)/inventory/actions.ts`: `createUnitAction`, `updateUnitAction`, and the media actions (upload goes
    through a route handler, the same way leasing's `uploadPhoto` posts to its API)
- Test: `modules/spa/apps/web/test/unit-pages.test.tsx`

- [ ] **Step 1:** Write tests:
  - The unit page shows the gallery placeholder "No photo yet" when there's no media, history rows oldest first, and the
    open deal link.
  - The form for edit pre-fills its values and maps the server error `{ field: "bedrooms" }` under Bedrooms.
  - A non-admin sees no Edit button.
- [ ] **Step 2:** Run them (fail), implement, run them (pass).

### Task 8: Project page and project form

**Files:**
- Create:
  - `app/(staff)/inventory/projects/[id]/page.tsx`: Overview (community, location, handover date, template in use,
    escrow, masked as today), Photos, Buildings, Units (the Task 6 browser filtered to the project), Price lists (existing
    UI moved here), Activity
  - `projects/new/page.tsx` and `projects/[id]/edit/page.tsx`, with a project form
- Modify: `next.config.ts` redirects `/inventory/:id` (uuid) → `/inventory/projects/:id`. Delete the old
  `inventory/[id]/page.tsx` after moving its content, and fix links in `components/projects.tsx` and `home-view.tsx`.
- Test: `modules/spa/apps/web/test/project-pages.test.tsx`; update `catalogue.test.tsx` and
  `catalogue-integration.test.tsx` for the moved links.

- [ ] **Step 1:** Write tests (project page sections and order; old link redirects), run them (fail), implement, run
  them (pass).

### Task 9: Verify in the browser

- [ ] **Step 1:** Run `bun run typecheck`, `bun run lint`, `bun test modules/spa/apps/web`, `bun test platform/ui`, and
  each new engine test file one at a time.
- [ ] **Step 2:** Restart `dev:spa`. As the demo admin, at 1280 and 390, light and dark:
  - Inventory → Units: filter to 2 bed
  - open a unit
  - edit its view and save
  - add a generated fictional PNG, caption it, reorder it, remove it
  - New unit
  - open project MV-01 and edit its community

  Save PNGs to `/tmp/claude-1000/m2-shots/`, and compare against leasing's `/units` and `/units/[id]` for layout parity.
- [ ] **Step 3:** As `sales_officer`: no Edit, New or photo controls. On a brokerage-kind company the Inventory rail item
  is hidden (existing rule).
- [ ] **Step 4:** Update `docs/spa/design.md` §4.6 (Inventory) and `docs/spa/architecture.md` (tables, routes). Tick M2 in
  the parent plan. Write the summary: files, test counts, screenshots, deviations.
