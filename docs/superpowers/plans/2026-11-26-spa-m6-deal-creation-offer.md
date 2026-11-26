# SPA M6: Deal Creation and Offer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the browser, an agent starts a primary deal from an available unit, or makes an offer on a resale listing that the seller answers by email link and that becomes a deal when accepted. Every value outside the rulebook or policy opens its gate. Both kinds reach `PARTY_CHECK` without a script.

**Architecture:** The domain functions already exist and keep their behaviour:
- `createDeal` (manager/deals.ts)
- `sendOffer`, `answerOffer`, `expireOffers` (offers.ts)
- `recordDeposit` (deposits.ts)
- `setBroker` (brokers.ts)
- the payment-plan route
- `discountCheck` (`@spa/rulebook`), with `price_out_of_range` raised in approvals/sheet

M6 adds the missing staff routes, buyer-party creation inside the deal or offer input (the same pattern as M3's sellers), and the screens: a **New deal** page (primary), a **Make an offer** page (resale), and an **Offer** panel on the listing record. It also flips M5's `dealFormReady` so a lead's **Start deal** prefills the form.

**Tech Stack:** Bun, Hono, Drizzle, Zod, Next 16, `@platform/ui`, `@spa/rulebook`.

**Spec:**
- `docs/superpowers/plans/2026-11-25-spa-mvp-two-phases.md` (M6 row, S74)
- `docs/spa/specs.md` (deal types S13, offers S18, payment plans, booking minimum, discounts)
- M3 (listing record) and M5 (leads, `lib/features.ts`)
- The `dubai-sales-spa` skill

## Global Constraints

- Prices, discounts, booking minimum, DLD fee and plan validation come only from `@spa/rulebook` (pinned `rulesVersion`) and `spa_policy`. The web shows the engine's computed values and never computes a fee or limit itself.
- **Price below the allowed discount, or a booking below the minimum:** the deal is still created, and a `price_out_of_range` gate opens for the sales manager. The deal can't pass the gate's guard until approved. Nothing is auto-approved.
- **One open offer per listing.** A sent offer's price never changes; a revision is a new offer after the old one is withdrawn, rejected or expired (S18).
- **Every seller on the listing answers through their own single-use link.** One reject rejects the offer; all accept creates the deal (existing `answerOffer`).
- **Buyers.** A buyer person needs name, email and nationality. A company buyer needs licence details plus a signatory (M3 pattern). There are 1–4 buyers, and shares are all-or-none and must sum to 100%.
- **Broker is optional.** Commission comes from policy; an override opens its existing gate.
- `SpaManager` is the only writer, with `deal_events` for everything. No `new Date()` in domain code. Money is integer fils; the forms take AED.
- AGENTS.md UI rules apply: breadcrumbs, the reason box for withdraw or cancel, no bare ids or enums.
- Don't run `next build`. Run DB test files one at a time. Leasing stays untouched.

## Review Focus

1. **Two agents start a deal on the same unit at once:** one deal is created, and the other gets 409 `open_deal_exists` with the existing deal's ref linked. (Task 1)
2. **Unit priced in AED with fils rounding:** AED 1,234,567.89 entered gives exactly 123,456,789 fils; a negative or zero price is refused. (Task 3)
3. **Offer expires while the seller has the link open:** answering returns the "This offer has expired" page, and no deal is created. (Task 2)
4. **The listing is withdrawn while an offer is out:** the offer is withdrawn by code, the links stop working, and the buyer lead is not converted. (Task 2)
5. **A lead whose property is no longer available:** Start deal shows "This home is no longer available" instead of a prefilled form. (Task 4)

---

### Task 1: Staff routes for deals, buyers and broker

**Files:**
- Modify: `modules/spa/packages/core/src/schemas.ts`
  - Add `BuyerInput`: same shape as M3's `SellerInput` plus a required `nationality` for persons.
  - Add `NewDealInput = DealInput` with `parties` replaced by `buyers: (BuyerInput | { partyId })[]`. Sellers are derived: the developer company for a primary deal, the listing sellers for a resale. Add optional `broker`, optional `bookingFils`, optional `leadId`.
- Modify: `modules/spa/apps/engine/src/manager/deals.ts`
  - Add `startDeal(ctx, input, user)`. It creates the buyer parties, resolves the sellers, calls `createDeal`, runs the price and booking checks and opens `price_out_of_range` when outside limits. It then sets the broker, links and converts the lead (status `converted`, `deal_id`) and returns `{ id, ref, gates: string[] }`.
- Modify: `app.ts` to add these routes:
  - `POST /api/deals` (primary only; a resale goes through offers)
  - `GET /api/deals/quote?unitId=…&priceFils=…&bookingFils=…` returns `{ listPriceFils, discountBps, withinPolicy, bookingMinFils, dldFeeFils, reasons[] }`, computed by rulebook and policy.
  - `PUT /api/deals/:id/broker`
- Test: `modules/spa/apps/engine/test/deal-start.test.ts` (new, DB)

- [x] **Step 1: write the tests.**
  - **Happy path:** a primary deal with a person and a company buyer reaches `OFFER_AGREED`, with the unit HELD and events written.
  - **Price below the discount limit:** the deal is created and `price_out_of_range` opens. After the manager approves it, `advance` passes the guard.
  - **Booking below the minimum:** a gate opens.
  - Review Focus 1 (concurrency).
  - **Lead:** the lead becomes `converted` with `deal_id`.
  - **Roles:** a developer-only company refuses a resale; a non-sales role gets 403.
  - **Quote:** it matches the rulebook functions for 3 inputs.
- [x] **Step 2:** run the tests and confirm they fail.
- [x] **Step 3:** implement.
- [x] **Step 4:** run the tests and confirm they pass.

### Task 2: Offer routes

**Files:**
- `manager/offers.ts`: add `makeOffer(ctx, input, user)`, which creates the buyer parties and calls `sendOffer`, plus `withdrawOffer(ctx, offerId, reason, user)`. A listing that leaves PUBLISHED/ACTIVE through WITHDRAW calls `withdrawOffer` for any SENT offer.
- `app.ts`: `POST /api/listings/:id/offers`, `POST /api/offers/:id/withdraw`, `GET /api/listings/:id/offers` (history).
- Web: the existing `app/(public)/b/[token]/offer` page shows expired, withdrawn and answered states.
- Test: `modules/spa/apps/engine/test/offer-flow.test.ts` (new, DB). The existing `offers.test.ts` must still pass.

`OfferInput` stays as it is. The new `MakeOfferInput` takes `buyers` (as Task 1), `priceFils`, `depositBps` (policy default 10%), `buyerMortgage`, `sellerMortgage`, `targetTransferOn?`, `conditions?`, `validDays` (policy bounds), `leadId?` and `broker?`.

- [x] **Step 1: write the tests.**
  - Make an offer, the seller links are emailed, and all sellers accept. The deal is created in `OFFER_AGREED` with the listing UNDER_OFFER and the lead converted.
  - One reject: the offer is REJECTED, the listing goes back to its prior state and the lead stays `interested`.
  - A second offer while one is SENT returns 409.
  - Review Focus 3 and 4.
  - Revising after a withdraw gives a new offer with a new price.
- [x] **Step 2:** run the tests and confirm they fail.
- [x] **Step 3:** implement.
- [x] **Step 4:** run the tests and confirm they pass.

### Task 3: New deal page (primary)

**Files:**
- `app/(staff)/deals/new/page.tsx`
- `components/deal-form.tsx`
- `app/(staff)/deals/new/actions.ts`
- `lib/features.ts`: set `dealFormReady = true`
- Entry points: a **Start deal** button on the unit page (M2) when the unit is AVAILABLE and the user is a sales role, and on the lead record (M5).
- Test: `modules/spa/apps/web/test/deal-form.test.tsx`

The form has these sections:
1. **Home:** read-only unit card, price-list price.
2. **Buyers:** repeatable person/company rows (M3 component pattern; extract a shared `PartyRows` component used by both the listing and deal forms).
3. **Price and booking:** price in AED and booking amount, with a live **quote** panel from `GET /api/deals/quote` showing the list price, discount %, the policy limit, the booking minimum and the DLD fee with "who pays" (rulebook). Outside limits shows a warning: "A sales manager must approve this price".
4. **Payment plan:** start from the project's default plan if one exists (else one row, 100% on handover). Rows show label, share % and due date or milestone, with a running total and an error until it is 100%.
5. **Broker (optional):** agency, ORN, broker name, BRN, commission % from policy.
6. **Mortgage:** buyer mortgage flag.

Submit creates the deal, then redirects to `/work/deals/<id>` (the existing deal record, rebuilt in M7). If gates opened, a banner says which.

- [x] **Step 1: write the tests.**
  - The form renders all sections with breadcrumbs "Inventory › <unit> › Start deal".
  - It prefills from `?lead=` (buyer name and email, property).
  - Review Focus 2 and 5.
  - The plan total error shows until 100%.
  - Quote warnings render from the engine's values (no client math beyond AED→fils).
- [x] **Step 2:** run the tests and confirm they fail.
- [x] **Step 3:** implement.
- [x] **Step 4:** run the tests and confirm they pass.

### Task 4: Make-an-offer page and the listing Offer panel

**Files:**
- `app/(staff)/listings/[id]/offer/page.tsx`
- `components/offer-form.tsx`
- `components/listing-offers.tsx` (the listing record's "Offers and deals" section from M3 becomes live)
- The lead record's **Start deal** for a resale lead links here.
- Test: `modules/spa/apps/web/test/offer-form.test.tsx`

**The offer panel** shows:
- the current offer: price, deposit %, valid until, each seller's answer (Waiting/Accepted/Rejected), **Withdraw** (reason box) and **Resend link** (existing resend if present, else hidden);
- the history of past offers;
- once accepted, the deal link.

**The deposit cheque** is recorded after acceptance with `recordDeposit` (cheque no., bank, amount, date), as a small form on the panel. This needs a `POST /api/deals/:id/deposit` route if it's missing.

- [x] **Step 1: write the tests.**
  - The offer form validates buyers, price, deposit % within policy and validity days.
  - The panel shows each seller's state.
  - Withdraw needs a reason.
  - Read-only roles see no actions and no buyer contact details.
  - No enum text in the HTML.
- [x] **Step 2:** run the tests and confirm they fail.
- [x] **Step 3:** implement.
- [x] **Step 4:** run the tests and confirm they pass.

### Task 5: Docs, review and browser run

**Docs:**
- `docs/spa/decisions.md` S81: "Deals start from the unit page or lead (primary) or as an offer on a listing (resale); buyers are created inside the deal/offer; out-of-limit values create the deal and open `price_out_of_range`; withdrawing a listing withdraws its open offer."
- `design.md`, `architecture.md`, the skill (one line), and tick M6 in the parent plan.

- [x] **Step 1:** run the `compliance-reviewer` subagent on the diff (rulebook use, gates, offers, PII) and fix what it finds.
- [x] **Step 2:** run `bun run spa:demo:reset` and restart the SPA engine (kill only the pid whose cwd is `modules/spa/apps/engine`).
- [x] **Step 3: browser run as Rania** (screenshots to `/tmp/claude-1000/m6-shots`):
  - Start a primary deal from an available unit with a discount over the limit. See the gate banner.
  - Use the M5b "Switch to Karim" hand-off if M5b is done; otherwise sign in as Karim. Approve the gate.
  - Make an offer on a published listing.
  - Accept it through the emailed seller links. Read the link tokens from the stored outbound mail rows with a bun script that uses the SPA db package's env loader, never `.env` files. Real SMTP sends to the demo recipient, so keep it to one offer.
  - See the deal created and the listing Under offer.
  - Record the deposit.
  - Both deals reach `PARTY_CHECK` by advancing as the app allows.
- [x] **Step 4:** run `bun run typecheck`, `bun run lint`, `bun test modules/spa/apps/web`, the new and touched engine DB files one at a time, and `bun test modules/leasing/apps/web` (expect 132/132). Report the counts.
