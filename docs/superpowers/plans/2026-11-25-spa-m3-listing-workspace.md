# SPA M3: Listing Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brokerage agent creates a listing in the browser with its sellers, ownership document, permit, price, agent and photos, then takes it DRAFT → VERIFIED → ACTIVE → PUBLISHED through one Next-step card, and can unpublish or withdraw it, all on screens built like leasing's Units.

**Architecture:** The listing domain (machine, `createListing`, `recordOwnership`, `recordListingSignature`, `listingStep`, `expirePermits`) already exists and is not changed in behaviour. M3 adds: inline seller-party creation inside the listing draft, a `listing_documents` table for the ownership document / signed listing agreement / permit file, write routes for each existing manager function, and the staff screens (list, new, edit, record). Photos reuse M2's `spa_media` (`ownerKind = "listing"`).

**Tech Stack:** Bun, Hono, Drizzle (Postgres `spa`, tests on `spa_test`), Zod, Next 16, `@platform/ui`, `@platform/adapters` `LocalDiskStore`.

**Spec:** `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (M3 row, S74, S75), `docs/spa/specs.md` (listings, S14, S17), `docs/spa/design.md` §4.5.

## Global Constraints

- Only `SpaManager` writes `listings`, `listing_parties`, `listing_owners`, `listing_signatures`, `listing_documents`; every write appends a `deal_events` row with the actor.
- Write roles: `requireListings(db, user, "write")` (the three sales roles, not a developer-only company). Reads: `requireListings(..., "read")`. Sellers' names and documents go to sales roles only (as `getListing` does today).
- Every co-owner is a seller party and signs (S14). Only companies act through a signatory; an individual seller has no POA in the MVP (S28).
- No permit → can't activate or publish; expired permit → the daily sweep unpublishes (S17). These are the machine's guards; the UI only shows their reasons.
- Ownership names are matched by code (`matchOwners`); a mismatch opens `seller_verification` for the sales manager. The UI never offers to skip it.
- Money is integer fils; the form takes AED and converts with the kernel money helper. Dates are calendar dates (`YYYY-MM-DD`, Asia/Dubai).
- Uploaded files: PDF/JPEG/PNG only, sniffed, ≤ 10 MB, stored in the existing `data/spa-uploads` store by sha256. Never open real files in `data/spa-uploads/` while working.
- UI rules (AGENTS.md): record reads Next step → Overview → Documents (sub-cards) → stage details → Activity last; collapsible section cards; breadcrumbs on every sub-page; a negative action (withdraw, unpublish) opens a reason box with Confirm and Cancel; no screen prints a bare id or an enum.
- Leasing untouched. No `new Date()` in domain code. Don't run `next build`. DB test files run one at a time.

## Review Focus

1. **Seller typed twice or two sellers with the same email:** refused with a field error, nothing written. Test in Task 1 (`createListingDraft refuses duplicate sellers`).
2. **Shares that don't add to 100% when shares are given:** refused (`shares must add up to 100%`); all shares empty is allowed (equal owners). Test in Task 1.
3. **Uploading the ownership document twice (same file):** idempotent by sha256, one row, no second event. Test in Task 2.
4. **Publishing with a permit that expires today:** allowed (last valid day is inclusive); the day after, the sweep unpublishes and the record shows "Unpublished: permit expired". Test in Task 3.
5. **A seller-verification gate already open when ownership is re-entered and now matches:** the open approval is withdrawn (`withdrawn` status, reason "ownership now matches") so the inbox doesn't keep a stale card. Test in Task 2.

---

### Task 1: Listing draft with new sellers

**Files:**
- Modify: `modules/spa/packages/core/src/schemas.ts` (add `ListingDraftInput`, `ListingEdit`), `modules/spa/apps/engine/src/manager/listings.ts`, `modules/spa/apps/engine/src/app.ts`
- Test: `modules/spa/apps/engine/test/listing-workspace.test.ts` (new, DB)

**Interfaces:**
- Produces:
  ```ts
  export const SellerInput = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("person"), fullNameEn: text(200), email: z.email(), phone: text(30).optional(),
               nationality: text(60).optional(), shareBps: z.number().int().min(1).max(10000).optional() }),
    z.object({ kind: z.literal("company"), tradeName: text(200), email: z.email(), licenceNo: text(60),
               licenceExpiresOn: calDate, issuingAuthority: text(120),
               signatory: z.object({ fullNameEn: text(200), email: z.email(), authority: z.enum(["poa", "board_resolution"]) }),
               shareBps: z.number().int().min(1).max(10000).optional() }),
  ]);
  export const ListingDraftInput = ListingInput.omit({ sellers: true }).extend({
    sellers: z.array(z.union([SellerInput, z.object({ partyId: uuid, shareBps: ... optional })])).min(1).max(10),
  }); // superRefine: each email once, each partyId once, shares all-or-none and sum to 10000
  export const ListingEdit = ListingInput.omit({ sellers: true, ref: true }).partial();
  createListingDraft(ctx, input: unknown, user): Promise<{ id: string; ref: string }>   // now takes ListingDraftInput
  updateListing(ctx, listingId, input: unknown, user): Promise<void>
  ```
  `createListingDraft` inserts new `parties` (+ `company_details` and `signatories` for a company) inside the same transaction, then calls the existing insert path of `createListing` (refactor its body into `insertListing(tx, ctx, l, actor)` so both share it). `updateListing` is allowed in DRAFT, VERIFIED, ACTIVE and PUBLISHED; changing `permitExpiresOn` to a past date on a PUBLISHED listing unpublishes it in the same transaction (event `UNPUBLISH`, payload reason "permit expired"). Event `LISTING_UPDATED` with the changed field names only (no values for sellers).
- Routes: `POST /api/listings` (now `ListingDraftInput`), `PUT /api/listings/:id`, `GET /api/listings/agents` → `{ id, name }[]` of active users with a sales role in the company (write roles only).

- [x] **Step 1:** DB tests (run alone with `bun test modules/spa/apps/engine/test/listing-workspace.test.ts`): person + company seller creates 2 parties, company details, signatory, 2 `listing_parties`, `LISTING_CREATED` event; duplicate email → 422 `invalid_listing`, no rows; shares 6000+3000 → 422 "shares must add up to 100%"; empty shares → ok; developer-only company user → 403; `updateListing` on SOLD → 409 `listing_not_editable`; editing a PUBLISHED listing's permit to yesterday → state ACTIVE and an `UNPUBLISH` event. `GET /api/listings/agents` lists only sales roles. Run → FAIL.
- [x] **Step 2:** Implement. Run → PASS. Run the existing listing tests (`bun test modules/spa/apps/engine/test/listings*.test.ts`, one file at a time) → still pass.

### Task 2: Listing documents, ownership and signatures

**Files:**
- Modify: `modules/spa/packages/db/src/schema.ts`; Create: `modules/spa/packages/db/migrations/0066_m3_listing_documents.sql` (+ drizzle meta)
- Modify: `modules/spa/apps/engine/src/manager/listings.ts`, `app.ts`
- Test: `modules/spa/apps/engine/test/listing-workspace.test.ts`

**Interfaces:**
- Table `listing_documents`: `id uuid pk`, `listing_id → listings`, `kind text check in ('title_deed','oqood','listing_agreement','permit')`, `file_name`, `mime`, `size_bytes > 0`, `sha256 ~ '^[0-9a-f]{64}$'`, `storage_key`, `uploaded_by`, `uploaded_at`; unique `(listing_id, kind, sha256)`; append-only trigger like `documents`.
- Produces:
  ```ts
  uploadListingDocument(ctx, store, listingId, kind, file: { name: string; bytes: Uint8Array }, user): Promise<{ id: string; duplicate: boolean }>
  readListingDocument(ctx, store, listingId, docId, user): Promise<{ bytes: Uint8Array; mime: string; fileName: string }>
  ```
  `recordOwnership` gains: when the result matches and an open `seller_verification` approval exists for this listing, withdraw it (use the existing approval-withdraw helper in the manager if there is one; otherwise set status `withdrawn` with reason "ownership now matches" through the same code path decisions use, and append an event).
- Routes (all `requireListings` write except the file read): `POST /api/listings/:id/documents` (multipart: `kind`, `file`), `GET /api/listings/:id/documents/:docId/file`, `POST /api/listings/:id/ownership` (existing `Ownership` body), `POST /api/listings/:id/signatures` `{ partyId }`. `getListing` now returns `documents: { id, kind, kindLabel, fileName, uploadedAt }[]` (sales roles only) and each seller's `partyId`.

- [x] **Step 1:** Tests: upload a fixture PDF (`modules/spa/apps/engine/test/fixtures/` — create a tiny fictional PDF if none) → row + `LISTING_DOCUMENT_UPLOADED` event; same bytes again → `duplicate: true`, one row; a `.txt` renamed `.pdf` → 422 `unsupported_file`; ownership mismatch → approval open; re-record matching → that approval `withdrawn`; signature for a non-seller → 422 `not_a_seller`; all sellers signed + matched → `VERIFY` succeeds via Task 3 route. Run → FAIL.
- [x] **Step 2:** Migration + implementation. `bun run spa:db:migrate`, then run the test → PASS.

### Task 3: Listing steps route

**Files:** Modify `app.ts`, `manager/listings.ts`; Test `listing-workspace.test.ts`

**Interfaces:**
- `POST /api/listings/:id/steps` body `{ event: "VERIFY" | "ACTIVATE" | "PUBLISH" | "UNPUBLISH" | "WITHDRAW", reason?: string }`; `reason` required (3–500 chars) for `UNPUBLISH` and `WITHDRAW`, stored in the event payload. Guard refusals return 409 `{ code: "step_refused", reasons: string[] }` with the machine's own sentences.
- `getListing` returns `next: { event, label, reasons: string[] } | null` computed by code from the machine for the viewer: DRAFT → VERIFY ("Verify the listing", reasons = guard denials), VERIFIED → ACTIVATE ("Activate"), ACTIVE → PUBLISH ("Publish the page"), PUBLISHED → none (actions only). And `actions: ("UNPUBLISH" | "WITHDRAW")[]` allowed now. And `lastUnpublish: { on: string; reason: string } | null`.

- [x] **Step 1:** Tests: DRAFT VERIFY refused with both reasons; full happy path DRAFT→VERIFIED→ACTIVE→PUBLISHED; ACTIVATE without permit → 409 "No advertising permit is recorded."; publish with `permitExpiresOn = today` → ok; advance clock one day, run `expirePermits` → ACTIVE and `lastUnpublish.reason = "permit expired"`; WITHDRAW without reason → 422; `OFFER_OPENED` via this route → 422 (not in the enum). Run → FAIL, implement, PASS.

### Task 4: Staff screens — list, new, edit

**Files:**
- Create: `modules/spa/apps/web/app/(staff)/listings/new/page.tsx`, `listings/[id]/edit/page.tsx`, `listings/actions.ts` (server actions), `components/listing-form.tsx`, `components/listings-browser.tsx`
- Modify: `app/(staff)/listings/page.tsx`, `lib/loaders.ts`, `lib/words.ts`
- Test: `modules/spa/apps/web/test/listing-workspace.test.tsx`

**Interfaces:**
- `ListingsBrowser` mirrors M2's `units-browser.tsx`: status chips with counts (Draft, Verified, Active, Published, Under offer, Sold, Withdrawn), filters (community, type, beds, price band, agent), `StaffUnitCard` cards with cover photo, state pill, asking price, permit chip ("Permit ends 12 Dec" in warning tone when ≤ 7 days, danger when expired), offer chip. **New listing** button for write roles only.
- `ListingForm({ mode: "new" | "edit", initial?, agents })`: sections Property (title, community, type, beds, baths, size, floor, view, parking, furnished, description), Price (asking price AED), Sellers (repeatable rows; Person / Company toggle; company shows licence fields and signatory; share % optional), Permit (no., issued, last valid day), Agent (select from `/api/listings/agents`). Zod validation client-side with `ListingDraftInput`/`ListingEdit` (same schema as engine), field errors under fields, the engine's 422 issues mapped back. Sellers are not editable in edit mode (show them read-only with "Sellers can't change after the listing is created").
- After create → redirect to `/listings/<id>`; photos are added on the record (Task 5) as in M2's unit flow.

- [x] **Step 1:** Tests (render): browser shows chips with counts and a "Permit ends" chip; no New listing button for `sales_admin` on a developer company; form renders all sections with breadcrumbs "Listings › New listing"; validation shows "Add at least one seller" and "shares must add up to 100%"; edit mode shows sellers read-only. Run → FAIL, implement, PASS.

### Task 5: Listing record

**Files:**
- Modify: `app/(staff)/listings/[id]/page.tsx`, `components/listings.tsx` (`ListingView` rebuilt), Create: `components/listing-next-step.tsx`, `components/listing-documents.tsx`, `app/(staff)/listings/[id]/actions.ts`, route handler `app/(staff)/listings/[id]/documents/[docId]/route.ts` (proxies the file)
- Test: `modules/spa/apps/web/test/listing-workspace.test.tsx`

**Layout (AGENTS.md order, leasing look):** cover gallery (`@platform/ui` gallery from `spa_media`), title + state pill + Edit button, stage stepper Draft → Verified → Active → Published → Under offer → Sold (Withdrawn shown as a danger pill instead of the stepper's end), then:
1. **Next step** card (`listing-next-step.tsx`) from `listing.next`: the step's label as a primary button; when `reasons` is non-empty the button is disabled and the reasons are listed with a link to the section that fixes each (Documents › Ownership, Sellers › signatures, Permit). PUBLISHED shows "The page is live" with a link to `/properties/<ref>` (M4 builds that page; link it anyway) and **Unpublish**. **Withdraw** sits on every non-terminal state. Unpublish and Withdraw follow the reason-box rule.
2. **Overview**: price, community, type, beds/baths, size, floor, view, parking, furnished, agent, permit (no., last valid day, status).
3. **Documents** with sub-cards: **Ownership** (kind, ref, owners as on the document, matched / "Waiting for the sales manager" when a `seller_verification` gate is open; upload title deed or Oqood file; a form to enter kind, ref and owners), **Listing agreement** (upload signed file; per seller "Signed" or a **Record signature** button), **Permit** (upload permit file; dates edited in Edit).
4. **Sellers** (sales roles only): name, kind, share, signed.
5. **Photos** (`inventory-photos.tsx` with `ownerKind="listing"`).
6. **Offers and deals**: the open offer chip and the deal link if any (read only; M6 adds actions).
7. **Activity** last (`activity-log.tsx` for the listing's events).

- [x] **Step 1:** Tests: DRAFT record shows "Verify the listing" disabled with both reasons; read-only role sees no buttons (`noToggles` check) and no sellers; WITHDRAW button opens a reason box before submitting; PUBLISHED shows Unpublish and the public link; no enum text (`DRAFT`, `title_deed`) in HTML. Run → FAIL, implement, PASS.

### Task 6: Demo, docs, browser run

**Files:** `modules/spa/apps/engine/src/seed.ts`, `docs/spa/decisions.md` (S77), `docs/spa/design.md` §4.5, `docs/spa/architecture.md` (listing documents + routes), `.claude/skills/dubai-sales-spa/SKILL.md` (one line: listing workspace routes), parent plan (tick M3)

- [x] **Step 1:** Seed: one listing in each of DRAFT (missing signature), VERIFIED, ACTIVE, PUBLISHED (permit ending in 5 days), WITHDRAWN, plus the existing UNDER_OFFER one; fictional "Demo …" names and a small generated placeholder PDF for documents.
- [x] **Step 2:** S77 in decisions.md: "Listing workspace: sellers are created inside the listing draft; listing files live in `listing_documents` (append-only, sha256-unique); unpublish and withdraw need a reason; editing a permit to a past date unpublishes at once."
- [x] **Step 3:** Compliance review: run the `compliance-reviewer` subagent on the diff (listing machine use, gates, PII in events/logs) and fix what it finds.
- [x] **Step 4:** `bun run spa:demo:reset`, restart the SPA engine, then in the browser as a sales agent (chrome-devtools MCP, screenshots to `/tmp/claude-1000/m3-shots`): create a listing with a person and a company seller, upload ownership + agreement, enter owners, record both signatures, verify, activate, publish, unpublish with a reason; open the PUBLISHED seed listing; set the demo clock past its permit end and run the sweep (demo console or job route) and show it unpublished. Compare the record screenshot with leasing's unit page at 1440.
- [x] **Step 5:** `bun run typecheck`, `bun run lint` (`domain rules: ok`), `bun test platform/ui`, `bun test modules/spa/apps/web`, the new and touched SPA engine DB test files one at a time, `bun test modules/leasing/apps/web` (132/132). Report counts.
