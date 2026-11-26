# SPA to a usable MVP and a finished product: two phases

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development, one implementer per chunk,
> one review per phase (memory: lean review loop). Each chunk gets its own task-level plan
> (`docs/superpowers/plans/2026-11-25-spa-<chunk>.md`) written and approved before it is built, the same way as C1–C40.

**Goal:** Make staff run a sale from the public property page to registration and transfer in the browser, as they run
a lease today. No curl, no seed-only steps, nothing in the UI that is just a database row.

**Why:** C1–C40 built the engine: rules, gates, Manager functions and tests. The web app mostly reads. Today:
- Staff screens only decide approvals, change settings and close tasks.
- No screen creates a deal, a listing, a unit, an offer or a viewing.
- Seventeen engine routes have no button.
- Units hold only `code`, `state` and `building`.
- Inventory and templates show raw rows.
- SPA web is about 7.3k lines of TSX; leasing web is about 26k.

**Architecture:**
- Engine logic mostly exists (`createDeal`, `createParty`, `sendOffer`, `recordDeposit`, `setBroker`, `createListing`,
  `recordOwnership`, `requestDocuments`, `prepareAgreement`, `registerPayment`, `requestRegistration`, …). Phase 1 adds the
  missing routes and builds screens on them, plus three new areas: unit and listing detail, viewings, deal creation.
- Leasing screens are reused by lifting them into `@platform/ui` with props, not by copying (S34). Leasing keeps its
  behaviour: its golden tests and unit tests are the proof (memory: no leasing evals for SPA).

**Tech stack:** Bun, Hono engine `@spa/engine`, Next 16 `@spa/web`, Drizzle (`spa` DB), pg-boss, `@platform/ui`, Zod.

**Spec:** `docs/spa/specs.md`, `docs/spa/design.md`, `docs/spa/decisions.md` (S1–S72). Specs and design are updated in the chunk
that changes them.

## Global constraints

- AGENTS.md rules 1–11 apply with SPA names:
  - `SpaManager` is the only writer of `deals`, `listings`, units and viewings.
  - Gates live in `spa_approvals`.
  - Events go to `deal_events` with the actor, the inputs and `rulesVersion`.
  - Values come from `@spa/rulebook` or `spa_policy`.
- Leasing never imports `@spa/*` and SPA never imports `@leasing/*`. Shared code lives in `platform/` (checked by
  `scripts/check-domain-rules.ts`).
- No `new Date()` or `Date.now()` in domain code. Legal dates are `date` in `Asia/Dubai`. Money is integer fils.
- Everything outbound goes by email through `sendSpaMail`. Party links are emailed only. Buyers and sellers see "Under review" for
  any compliance hold (no tipping-off).
- UI rules from AGENTS.md:
  - Reason boxes open on the second click.
  - A record reads in this order: what waits on you, Overview, Documents, stage details, Deadlines, Open work, Activity.
  - Every section and sub-section can be collapsed.
  - Every page below a top-level section has breadcrumbs.
- No DLD, RERA or Oqood logos, colours or screen copies. The registry and trustee mocks are labelled "Simulated".
- Every screen is checked in the browser, light and dark, at 1280 px and 390 px, before its chunk is called done
  (memory: redesign must match mockup).
- Don't run `next build` against the running dev server. Restart the engine after editing packages. Run DB-test agents
  one at a time.

## User journeys: leasing's UI, SPA's steps (user ruling 2026-11-25)

The screens look and behave like leasing's; only the steps differ. Each chunk starts from the matching leasing screen, not from a blank page.

| Journey | Leasing screen to copy | SPA steps on it |
|---|---|---|
| Visitor | `/customer/properties`, `/customer/properties/[id]`, `/customer/chat` | browse units for sale and listings, enquire, book a viewing, check deal status |
| Agent: viewing | Work → viewings, application record "Record site visit" card | viewing booked, attended, interested → Start deal |
| Agent: deal record | application record (`application-detail.tsx`, `application-actions.tsx`, decision cards) | Overview, parties, documents and KYC/AML, offer, agreement, signing, registration or transfer, payments, activity |
| Agent: docs verification | application Documents section, KYC review card | per-party documents, accept or reject with reason, `kyc_review`, AML case (compliance only) |
| Agent: offer and agreement | offer step and contract panel (`contract-panel.tsx`, `contract-forms.tsx`) | offer and answer, deposit, Prepare SPA/MOU, legal approval, signing links |
| Agent: registration | Ejari section and `manual-registration.tsx` | Oqood (primary) or trustee transfer (resale), "Simulated" label, certificate |
| Admin | Settings hub, units, unit form, contract templates, KYC, rulebook, import, demo | company, users, projects and units, price lists, plans, fees, templates, KYC, AML, rulebook, import, demo |
| Party | tenant portal `/t/[token]/*` | buyer and seller portal `/b/[token]/*`: offer, documents, sign, payments, status |

## Decisions to record first (docs/spa/decisions.md)

- **S73 Viewings and leads in SPA.** This reverses "no lead or viewing management in MVP" (S17 and specs "Public listing page"):
  - Public visitors and the listing chat may book a viewing in an agent's free slot.
  - Staff record the outcome.
  - A lead can become a deal.
  - Slots and invitations work like leasing `viewing-slots.ts`, rebuilt on `@platform/kernel` time helpers.
- **S74 Deals and listings are created in the UI.** New routes:
  - `POST /api/deals` (from a unit or a listing)
  - `POST /api/listings` (already exists, gets a screen)
  - `POST /api/deals/:id/offers`, `/deposit`, `/broker`, `/parties`, `/cancel`

  Same roles as the Manager functions.
- **S75 Unit and listing detail.**
  - Unit columns: type, bedrooms, bathrooms, internal and balcony size, floor, view, parking spaces, status note.
  - Listing columns: the same, plus furnished state.
  - Photos for units, listings and projects on local disk, as leasing `unit_photos` does (`MEDIA_DIR`, sha256-unique).
  - Project columns: community, location text, description, handover quarter.

## Phase 1: usable MVP (every step clickable)

Exit for the phase: a person signs in at :3001 and runs both demo flows end to end. Screenshots of every step are saved
under `docs/spa/walkthrough/`.
- **Primary:** public page → viewing → deal → booking → KYC → agreement → signing → Oqood → instalments.
- **Resale:** listing → viewing → offer → deposit → KYC and AML → MOU → NOC and bank letters → settlement → transfer.

| # | Chunk | Scope | Needs | Exit |
|---|---|---|---|---|
| M1 ✅ | Shared UI lift | Move leasing's reusable pieces into `platform/ui`: `public/{property-grid,finder,cover,hero-panel,customer-nav,chat-launcher}`, `unit-gallery`, `photo-manager`, `photo-picker`, `chat-ui/{stage-stepper,record-card,unit-card,decision-card shell}`, `decision-form`, `row-action`, `activity-item`, `live/*`. They take data and labels as props; leasing imports them back | – | leasing unit and golden tests unchanged; leasing pages screenshot-identical; `check-domain-rules` passes |
| M1b ✅ | Staff shell parity (S76) | SPA staff pages sit in the same frame as leasing: shared navy rail, avatar menu, Agent dock (chips, composer, bubbles), Home greeting, "Demo ..." seed names | M1 | leasing web tests unchanged; shell screenshots match leasing |
| M2 ✅ | Unit, project and listing detail (S75) | Migration for the new columns and `spa_media` (photos for project, unit or listing). Inventory rebuilt the way leasing Units is: filterable unit list (project, building, type, beds, status, price band), unit page (gallery, facts, price history from price lists, current deal), **New unit** and **Edit unit** forms, project page with buildings, price lists and photos. Routes: `PUT /api/units/:id`, `POST/DELETE /api/media` | M1 | no screen prints a bare id or enum; forms validate with Zod on both ends; role tests |
| M3 ✅ | Listing workspace (S77) | **New listing** form: sellers and co-owners, company seller, ownership document upload, permit no. and dates, asking price, agent, photos. Listing record with a stage stepper (DRAFT → VERIFIED → PUBLISHED → UNDER_OFFER → SOLD) and one next-step card: verify ownership, sign listing agreement, publish or unpublish, withdraw with a reason box | M2 | a listing is created, verified and published in the browser; permit expiry still unpublishes |
| M4 ✅ | Public site (S78) | `/properties`: catalogue of published listings and developer units on sale, with finder, filters and grid as in leasing `/customer/properties`. `/properties/[ref]`: gallery, facts, price, permit no., agent card, listing chat. **Enquire** and **Book a viewing** moved to M5 (they need its tables). Public nav and theme. Never shows seller names, deed numbers, floor prices or documents | M2, M3 | public pages pass the existing listing-chat and permit tests; a leak test asserts no seller or deed fields in the HTML |
| M5 ✅ | Leads and viewings (S73, S79) | Tables `spa_leads` and `spa_viewings`, plus agent availability. Booking from the public page and from the listing chat tool `book_viewing`; invitation and reminder emails; staff Work → **Viewings** tab (today, upcoming, past) and **Leads** tab. Viewing record: attended, no-show or interested, with notes. **Start deal** from a lead | M4 | double-booking refused; jobs idempotent (`<viewingId>:reminder`); a lead becomes a deal with its buyer pre-filled |
| M5b ✅ | Demo cast and hand-off (S80) | Four-person demo cast on the sign-in page with a back-office disclosure; demo-only "Switch to …" hand-off on waiting cards and a quick switcher in the avatar menu. Roles and gates unchanged | M5 | plan `2026-11-26-spa-m5b-demo-cast.md`; tests in `demo-cast.test.tsx` and `engine.test.ts` |
| M6 ✅ | Deal creation and offer (S74, S81) | **New deal** wizard. From a unit (primary): buyers with order and share, optional broker, price from the price list, discount checked by `discountCheck` (outside limits → `price_out_of_range`), payment plan, booking amount. From a listing (resale): buyer, offer price, deposit %, buyer mortgage flag, seller mortgage flag. Offer screen: send, see the answer, revise or expire; deposit cheque recorded; broker and commission | M5 | primary and resale deals reach PARTY_CHECK from the browser; every value outside the rulebook opens a gate |
| M7 | Deal record workflow | The deal record rebuilt to the record order. Stage stepper over the deal machine. One **Next step** card per state and role that calls the existing routes: request or resend documents, run KYC, company check or ownership check, AML screen, prepare agreement, resend signing link, upload and confirm NOC, bank letters and amount, record and confirm payment, milestone reached, mark or clear default, request registration or transfer, hand over or release deposit, cancel (reason box). Decision cards inline for gates the user can decide | M6 | each state has a component test showing the right action for each role and none for others; browser screenshots for both flows |
| M8 | Documents and verification | Documents section per party: requested, uploaded, read, accepted or rejected, with the source file linked. Staff accept, or reject with a fixed reason code that feeds the chase. KYC result view with the extracted fields beside the file (masked IDs) and the `kyc_review` decision card. Company check and ownership check views | M7 | a rejected document re-requests through the party's link; IDs masked everywhere; compliance-only fields hidden from other roles (S57) |
| M9 | Agreement, signing and registration screens | Agreement section: rendered PDF preview, review findings, legal decision card, version history. Signing section: order, who signed when, resend. Registration (primary): `oqood_submission` card, submission status, certificate download, "Simulated" label. Settlement and transfer (resale): statement table, finance decision, `transfer_submission`, trustee result, deposit release | M7, M8 | both flows reach REGISTERED and TRANSFERRED from the browser |
| M10 | Demo data and console | (the console's guided script builds on the M5b demo cast) Seed one deal at every stage (both kinds, through TRANSFERRED_COMPLETE and INSTALMENTS), listings in every state, viewings and leads, unit photos (fictional, generated or stock-free placeholders). `/settings/demo` like leasing: reset, rewind, clock, "advance this deal one step" for demo only | M2–M9 | `spa:demo:reset` then every Work tab has rows; each seeded deal opens without errors |
| M11 | Phase 1 acceptance | Walk both flows in the browser, fix what breaks, save screenshots, run `compliance-reviewer` on the phase diff and fix findings; update specs, design, task.md and roadmap | M1–M10 | typecheck, lint and tests green; walkthrough folder complete |

## Phase 2: finished product (leasing parity)

Exit for the phase: a side-by-side check of leasing and SPA, area by area, shows no area where SPA is a plain table or a missing
screen. Each area is listed with its screenshot pair in `docs/spa/walkthrough/parity.md`.

| # | Chunk | Scope | Needs | Exit |
|---|---|---|---|---|
| F1 | Settings hub parity | Settings home with sections, icons and search as leasing `settings-nav` and `hub-search` provide. Company profile and brokerage details (ORN, escrow accounts); users and roles with invite and deactivate; rulebook versions (read, with pending values marked); policy pages as forms with history and publish; fees; payment-plan templates editor (shares sum to 100%); signing order; KYC per role; AML policy; helpers; models; integrations; alerts | M11 | every settings page has a form, validation, version history where versioned, and a role test |
| F2 | Templates workspace | Leasing `contract-templates` parity: template list with kind, scope, version and status pills; upload wizard (sample → read → mapping); mapping editor with the document preview beside the blanks list, remap and relabel, check results inline; version compare; template assistant panel; legal approval card; retire | F1 | a template is uploaded, mapped, approved and used by **Prepare** without leaving the browser |
| F3 | Buyer and seller portal | `/b/[token]` home: status tracker, next step, offer, documents, signing, payment schedule and receipts, transfer day, "Under review" hold. Mobile-first party page from design §7.3 | M11 | party-safety tests: no other party's data, no AML wording; screenshots at 390 px |
| F4 | Public chat agent | `/chat` and launcher like leasing customer chat: browse units and listings, enquire, book viewing (S73), status check after email code (read-only next step). Same guard and rate limits as the listing chat | M5, F3 | eval cases with an injection case; no seller or AML data |
| F5 | Copilot parity | Propose tools for the new actions (book viewing, start deal draft, request documents, prepare agreement) and decision cards for gates, as leasing D48/D53 do; Home live tiles | M7 | role tests and eval cases per tool, one injection each |
| F6 | Work hub and metrics | Work tabs (Inbox, Deals, Viewings, Leads, Listings, Tasks) with filters, search, saved views, pagination. Metrics page: pipeline by stage, viewing → deal conversion, collections due and overdue, days per stage | M11 | numbers reconcile with SQL in tests |
| F7 | Import | CSV import for projects, buildings, units, price lists and listings, with preview, row errors and dry run, as leasing `settings/import` does | F1 | bad rows reported and nothing written; good file imports idempotently |
| F8 | Phase 2 acceptance | Parity walkthrough, accessibility pass (keyboard, contrast, screen-reader names), compliance review, docs and roadmap | F1–F7 | parity.md complete; all checks green |

## Review focus

1. **A visitor or party sees seller or compliance data:** public pages, chat, portal and emails leak no seller name, deed
   number, floor price or AML state. Leak tests in M4, F3 and F4.
2. **A button that shows but fails:** each Next-step card shows only actions the role and state allow. A matrix test in M7
   covers every state against every role.
3. **Double clicks and retries:** creating a deal or viewing, sending an offer, recording a payment and requesting registration are
   safe twice. Idempotency tests in M5, M6, M7 and M9.
4. **Values typed by staff bypassing rules:** price, discount, deposit % and plan shares are validated by the rulebook and policy
   on the engine. The form only mirrors them. Tests in M6.
5. **Leasing broken by the UI lift:** M1 must leave leasing screenshots and tests identical.

## Execution

- One chunk at a time. For each chunk:
  1. Write the chunk plan and get it approved.
  2. An implementer subagent builds it.
  3. I verify in the browser and with targeted tests.
- Run `compliance-reviewer` once per phase (M11, F8).
- A DB migration is in M2, M5 and M6; they run sequentially.
- No commits unless asked.
