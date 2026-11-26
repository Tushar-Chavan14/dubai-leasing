# SPA M4: Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A visitor with no sign-in browses `/properties` (published resale listings and developer units on sale) through leasing's finder, filters and grid, opens `/properties/[ref]` (gallery, facts, price, permit, agent card, listing chat) and never sees a seller, deed, floor price or document.

**Architecture:** Two new public engine reads (`GET /public/catalogue`, `GET /public/catalogue/:ref`) build one `PublicProperty` shape from both sources by code with an allow-list of fields, plus a public photo route that serves only photos of things currently public. The web gets a `(site)` route group with leasing's public header, nav, theme menu and footer from `@platform/ui/catalogue/*`, and pages built from M1's lifted `HeroPanel`, `Finder`, `PropertyCard`, `Cover`/gallery. The `/b/[token]` party pages keep the plain `(public)` layout.

**Tech Stack:** Bun, Hono, Drizzle, Zod, Next 16, `@platform/ui`.

**Spec:** `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (M4 row, Visitor journey), `docs/spa/specs.md` (public listing page, S17), `docs/spa/design.md` §7.5. Leasing reference screens: `modules/leasing/apps/web/app/customer/{layout.tsx,properties/page.tsx,properties/[id]/page.tsx}`.

## Global Constraints

- Public responses are built from an explicit allow-list (`PublicProperty`). Never: seller or party names, emails, phones, ownership kind/ref/owners, documents, listing-agreement state, offer terms, deal state, floor or minimum price, discount, price-list internals, staff emails except the listing agent's name and the brokerage contact email already public today.
- A listing is public only when `state = PUBLISHED` and `permitExpiresOn >= today` (reuse `findPublicListing`'s rule; one function `isPublicListing(l, today)` used by catalogue, detail, photos and the listing chat).
- A developer unit is public only when it is `AVAILABLE`, its project is public, and it has a price in the project's **published** price list; the shown price is that list price. A held/sold unit drops off the catalogue.
- The permit number is printed on every public listing card and page (S17). Units show the project name and the developer's name, never a permit field.
- Public routes are rate limited like the existing `/public/listings/:ref/chat`. No cookies or session needed.
- SPA never names leasing. Brand on the site header: "Sales" (BrandMark from `@platform/ui`), nav items: Properties, Chat (chat link only on a property page until F4).
- Enquire and Book viewing forms need the M5 tables; in M4 the property page shows the agent card and the existing listing chat ("Ask about this property"). M5 adds the forms to the same aside slot (`PropertyAside` `actions` prop).
- No `new Date()` in domain code. Don't run `next build`. DB test files one at a time. Leasing untouched (132/132).

## Review Focus

1. **Seller-name leak through free text:** a seller name typed into a listing's title or description is shown as typed (staff wrote it) — but no field outside the allow-list ever appears. Leak test: seed a listing whose sellers are "Hidden Seller Name" / "Hidden Holdings LLC" with deed ref "SECRET-DEED-1"; the catalogue JSON, the detail JSON and both pages' HTML contain none of them. (Task 1, Task 4.)
2. **Permit ending today vs yesterday:** today → shown; yesterday (sweep not yet run) → 404 on detail and absent from catalogue. (Task 1.)
3. **Photo URL of a withdrawn listing or a sold unit:** `/public/media/:id/file` → 404 once the owner stops being public; a photo of a project/unit/listing that never was public → 404. (Task 2.)
4. **Empty catalogue / engine down:** the page shows leasing's empty and "couldn't load" states, not a crash. (Task 4.)
5. **Old link `/listings/L-0007` from M1-era emails:** redirects to `/properties/L-0007`. (Task 3.)

---

### Task 1: Public catalogue reads

**Files:**
- Create: `modules/spa/apps/engine/src/manager/public-catalogue.ts`
- Modify: `modules/spa/apps/engine/src/manager/listings.ts` (export `isPublicListing`; `findPublicListing` uses it), `app.ts`
- Modify: `modules/spa/packages/core/src/schemas.ts` (add `PublicProperty`, `PublicPropertyDetail`, `CatalogueQuery` Zod schemas — the engine parses its own output with them)
- Test: `modules/spa/apps/engine/test/public-catalogue.test.ts` (new, DB)

**Interfaces:**
```ts
export const PublicProperty = z.object({
  ref: z.string(),                    // listing ref "L-0007" or unit public ref "U-<project code>-<unit code>"
  source: z.enum(["listing", "developer"]),
  title: z.string(), community: z.string().nullable(), projectName: z.string().nullable(),
  developerName: z.string().nullable(),            // company trade name for developer units only
  unitType: z.string().nullable(), unitTypeLabel: z.string().nullable(),
  bedrooms: z.number().nullable(), bathrooms: z.number().nullable(), sizeSqft: z.number().nullable(),
  priceFils: z.number().int(), permitNo: z.string().nullable(),
  coverPhotoId: z.string().nullable(), photoCount: z.number().int(),
  handover: z.string().nullable(),                 // project's expected handover (developer units), as a label
}).strict();
export const PublicPropertyDetail = PublicProperty.extend({
  description: z.string().nullable(), floor: z.number().nullable(), view: z.string().nullable(),
  parkingSpaces: z.number().nullable(), furnishedLabel: z.string().nullable(),
  photoIds: z.array(z.string()), agent: z.object({ name: z.string() }).nullable(), chat: z.boolean(),
}).strict();
export const CatalogueQuery = z.object({ source: z.enum(["all","listing","developer"]).default("all"),
  community: z.string().max(120).optional(), type: z.enum(UNIT_TYPES).optional(),
  beds: z.coerce.number().int().min(0).max(10).optional(), min: z.coerce.number().int().optional(),
  max: z.coerce.number().int().optional(), sort: z.enum(["newest","price_asc","price_desc"]).default("newest") });
listCatalogue(ctx, q: CatalogueQuery): Promise<{ items: PublicProperty[]; facets: { communities: string[]; types: string[] } }>
getCatalogueItem(ctx, ref: string): Promise<PublicPropertyDetail | null>
```
- Unit public ref: add nothing to the schema if units already have a unique human code per project; build `U-<projectCode>-<unitCode>` and parse it back. If no project code exists, use the project's existing ref/slug column; ask in the report rather than adding a column if neither exists (then fall back to the unit uuid in the URL).
- Routes: `GET /public/catalogue`, `GET /public/catalogue/:ref` (404 `not_found` when not public). Keep `GET /public/listings/:ref` working (the listing chat page uses it) but have it return `PublicPropertyDetail` fields only.

- [ ] **Step 1:** DB tests (run alone): published listing with valid permit and an available unit with a published price both listed; DRAFT/ACTIVE/WITHDRAWN listings and HELD/SOLD units and units without a published price absent; permit expiring today listed, yesterday absent and detail 404; filters (`source`, `community`, `beds`, `min`/`max`, `sort=price_asc`) each narrow correctly; leak test from Review Focus 1 on both endpoints (`JSON.stringify` contains none of the secrets, and `PublicProperty.strict()` parse passes); unknown ref → 404. Run → FAIL.
- [ ] **Step 2:** Implement. Run → PASS. Re-run `listing-chat.test.ts` and `permit.test.ts` alone → still pass.

### Task 2: Public photos

**Files:** `modules/spa/apps/engine/src/manager/media.ts` (add `readPublicMedia`), `app.ts`; Test: `public-catalogue.test.ts`

**Interfaces:** `readPublicMedia(ctx, store, mediaId): Promise<{ bytes; mime } | null>` — returns the file only when its owner is a public listing, a public unit, or the project of a public unit. Route `GET /public/media/:id/file` with `cache-control: public, max-age=300`, `x-content-type-options: nosniff`; 404 otherwise.

- [ ] **Step 1:** Tests per Review Focus 3 plus a happy path for each owner kind. FAIL → implement → PASS.

### Task 3: Site layout and routes

**Files:**
- Create: `modules/spa/apps/web/app/(site)/layout.tsx`, `lib/public-catalogue.ts` (fetchers + label helpers), `app/(site)/media/[id]/route.ts` (proxies `/public/media/:id/file`)
- Move: `app/(public)/properties/**` → `app/(site)/properties/**` (keep the `chat/route.ts` and its test path)
- Modify: `next.config.ts` redirects: `/listings/:ref(L-\\d+)` → `/properties/:ref` only for the public pattern (staff `/listings/<uuid>` must keep working), `/customer/properties/:path*` → `/properties/:path*`
- Test: `modules/spa/apps/web/test/public-site.test.tsx` (new)

- Layout = leasing `customer/layout.tsx` structure: sticky header (BrandMark + "Sales", `PublicNav`, `ThemeMenu`, primary button "Browse homes" → `/properties#homes`), `main`, footer ("Sales · Listings are shown with their advertising permit number."). Uses `@platform/ui/catalogue/{public-nav,theme-menu}`; the theme cookie works as on staff pages.

- [ ] **Step 1:** Tests: layout HTML has the brand "Sales", nav, theme menu, footer, no "Leasing"; `/b/...` pages still use the plain `(public)` layout (render a `(public)` page and assert no site header). FAIL → implement → PASS.

### Task 4: Catalogue page `/properties`

**Files:** Create `app/(site)/properties/page.tsx`, `components/public/catalogue-grid.tsx`; Test `public-site.test.tsx`

- Mirrors leasing `PropertyGrid`: `HeroPanel` ("Homes for sale in Dubai", lede, search), `Finder` with chips Source (All, Resale, New from developer), Community, Type, Bedrooms, Price band, sort; grid of `PropertyCard`s (cover via `/media/<coverPhotoId>`, else plan placeholder; title; community · project; beds · type · size; price "AED 1,750,000"; a small "Permit 123456" line for listings; "New · <developer>" chip for developer units); filters live in the URL query; empty state "No homes match these filters" with "Clear filters"; load failure state "Homes couldn't be loaded. Try again in a moment."
- [ ] **Step 1:** Tests: cards render for both sources with the permit line only on listings; chips reflect the URL; empty and failure states; leak test on the rendered HTML (Review Focus 1); no enum text (`PUBLISHED`, `apartment` raw) in HTML. FAIL → implement → PASS.

### Task 5: Property page `/properties/[ref]`

**Files:** Rewrite `app/(site)/properties/[ref]/page.tsx`; Create `components/public/property-aside.tsx`; keep `components/listing-chat.tsx`; Test `public-site.test.tsx`, existing `listing-chat.test.tsx`

- Layout as leasing `customer/properties/[id]/page.tsx`: back link "All homes", gallery (`@platform/ui/media/gallery` with `/media/<id>` URLs), title, community · project, facts list (type, beds, baths, size, floor, view, parking, furnishing, handover), description, then the aside: price card, permit card ("Advertising permit 123456", listings only), agent card (name only), and `PropertyAside actions` slot holding "Ask about this property" which opens the existing listing chat (listings only; developer units show "Contact the sales team" with the company's public email from settings, if one exists, else nothing). `generateMetadata` title = property title.
- [ ] **Step 1:** Tests: listing page shows permit and chat; unit page shows developer and handover, no permit and no chat; 404 for a non-public ref; leak test on HTML; existing listing-chat tests still pass. FAIL → implement → PASS.

### Task 6: Seed, docs, browser run

**Files:** `modules/spa/apps/engine/src/seed.ts`, `docs/spa/decisions.md` (S78), `docs/spa/design.md` §7.5, `docs/spa/architecture.md`, `.claude/skills/dubai-sales-spa/SKILL.md` (one line), parent plan (tick M4, note that Enquire/Book viewing moved to M5)

- [ ] **Step 1:** Seed: ensure at least 3 published listings with valid permits and a published price list making ≥ 4 units public across 2 projects; give each 2–3 fictional placeholder photos (generate simple SVG→PNG or solid-colour PNGs in code; no stock photos, no real people or logos).
- [ ] **Step 2:** S78: "Public catalogue: one allow-listed `PublicProperty` shape for resale listings and developer units; a unit is public when available with a published price; public photos only for public owners; the site uses leasing's public layout under the `(site)` group."
- [ ] **Step 3:** Run the `compliance-reviewer` subagent on the diff (public data exposure, permit rule) and fix findings.
- [ ] **Step 4:** `bun run spa:demo:reset`, restart the SPA engine (kill only the process whose cwd is `modules/spa/apps/engine`; don't `pkill -f` broad patterns), then chrome-devtools screenshots into `/tmp/claude-1000/m4-shots`: `/properties` at 1440 light and dark and at 390 mobile, filtered by Resale and by 2 bedrooms, a listing page, a developer unit page, and leasing `/customer/properties` + one leasing property page at 1440 for comparison. Fix visible mismatches.
- [ ] **Step 5:** `bun run typecheck`, `bun run lint` (`domain rules: ok`), `bun test platform/ui`, `bun test modules/spa/apps/web`, new/touched SPA engine DB files one at a time, `bun test modules/leasing/apps/web` (132/132). Report counts.
