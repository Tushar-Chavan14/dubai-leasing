# SPA design system and screen guide

The single source for how the SPA (sales) app looks, what each screen contains, how external links work
and how things are worded. Every SPA screen, and every SPA mockup made from now on, follows this file.
Where an older mockup (`docs/spa/mockup.html`, or any artifact) differs from this file, this file wins
(decision S31). Change it through a new S-decision.

Read with `docs/spa/specs.md` (what each step does) and `docs/spa/decisions.md`.

---

## 1. Foundations: same as the leasing app

SPA uses the leasing staff app's design tokens and components unchanged, so both products feel like one
family. Source of truth (since P2): the shared, domain-free package `@platform/ui` (§11): `tokens.ts`, `theme.css`
(palette variables, dark variant, Tailwind `@theme`) and `base.css` (root variables and element rules), which both
web apps import. SPA never copies and edits them.

### 1.1 Colour tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `page` | `#ffffff` | `#0b0b0b` | Page and card background |
| `raised` | `#f4f6f1` | `#151714` | Fact cells, quiet panels, segmented controls |
| `ink` | `#0b0b0b` | `#f4f6f1` | Text, finished stepper bars |
| `muted` | `#5b6157` | `#a1a89b` | Second lines, labels, hints |
| `line` | `#e2e6dc` | `#2a2d27` | Borders, dividers, empty stepper bars |
| `accent` | `#dbe6cf` | `#dbe6cf` | Current nav item, current step, "good" alerts, gate panels |
| `on-accent` | `#0b0b0b` | `#0b0b0b` | Text on accent |
| `primary` | `#0b0b0b` | `#dbe6cf` | Primary buttons, current filter pill, count badges |
| `on-primary` | `#ffffff` | `#0b0b0b` | Text on primary |
| `danger` | `#b42318` | `#f97066` | Errors, blockers, destructive actions |
| `warning` | `#8a5200` | `#f5b942` | Waiting on you, deadlines, on hold |

Rules:
- One accent (sage). Green, amber and red are **states**, not decoration.
- A colour never carries meaning alone: every pill and alert has words (`Pill` enforces this).
- Every text/background pair passes WCAG AA; the leasing contrast test (`contrast.ts`) covers new pairs too.
- Light, dark and system themes, from the user's theme setting, same as leasing.

### 1.2 Type, spacing, shape, motion

- **Fonts:** Geist Sans for everything; Geist Mono for references (`R-0031`), keys and numbers in tables.
  Numbers that line up use `tabular-nums`.
- **Scale:** page title 26 px semibold · section title 15 px semibold · body 14–15 px · second lines 12.5 px · labels 12 px · rail labels 11 px.
- **Radius:** cards 16 px (`rounded-card`), inputs 10 px, rows and fact cells 12 px, pills and buttons fully round.
- **Spacing:** 4 px grid; sections 24–32 px apart; page padding 24 px (16 px on phones).
- **Shadow:** only `shadow-lift` for menus, sheets and modals. Cards use a border, not a shadow.
- **Motion:** 160 ms for hovers, 260 ms for sheets; nothing moves when reduced motion is on.
- **Icons:** Phosphor icons at 16 or 20 px, always with a text label or an `aria-label`. No emoji.
- **Focus:** a 2 px ink outline with 2 px offset on every interactive element.

---

## 2. App shell (staff)

The SPA staff shell is the shared leasing shell (`@platform/ui/shell`, S76): **rail · main · agent dock**.

| Part | Content |
|---|---|
| Rail (76 px, left, navy) | Brand mark "S" (aria label "Sales, home"), one icon-over-label item per screen (§3), the alerts bell, ⌘K (ask the agent), then the avatar menu |
| Avatar menu | Name and role; today's date ("UAE time") and the demo clock when on; **Switch demo user** (demo mode only, S80: the four cast people, then Back-office, you marked); theme; **Portal** (back to the module chooser); **Sign out** |
| Main | The screen, on the canvas colour, no width cap on the shell; a page sets its own reading width |
| Agent dock (right, 380 px) | "Agent" header with context pill and New chat; starter chips and the legal footnote when empty; rounded composer with a round send button. Docked at 1200 px and wider (closed by default on Inventory), a sheet overlay below that, opened with Ctrl/Cmd+K, closed with Escape; the choice per screen is kept in `localStorage` (`dock:<screen>`). Voice and thread history come in F5 |

Rules (S21):
- The SPA app never names, links, counts or switches to another module. "Portal" in the avatar menu is the only way out besides Sign out.
- Count badges on rail items mean "waiting for you" only (your role's open gates and tasks).
- Screens a role can't use are hidden from its rail; the engine still refuses the action if called.
- Demo mode only (S80): a waiting card (deal banner, Work inbox row, listing Next step) names the person it waits on with a "Switch to Omar" button. A compliance review outside compliance says "Under review" and the role only. Demo sign-in shows four cards with a one-line hint and a closed back-office disclosure.

---

## 3. Screens (rail items)

| Rail item | For | Contains |
|---|---|---|
| **Home** | everyone | What needs you today, by role (§4.1) |
| **Work** | sales, legal, finance, managers | Inbox of gates for your role, deals, listings, tasks, with the record view (§4.2–4.5) |
| **Inventory** | developer and both | Projects, buildings, units, price lists (§4.6) |
| **Listings** | brokerage and both | Listings with permit and offer state (§4.7) |
| **Compliance** | compliance officer, MLRO only | AML cases, EDD, reports, exports, monthly report (§4.8) |
| **Settings** | admin (others read-only where allowed) | All configuration (§5) |

A company of kind `developer` has no Listings item; `brokerage` has no Inventory item (S12).

---

## 4. Screen templates

Each template lists what **must** be on the screen. Order is top to bottom.

### 4.1 Home

1. Page title "Good morning, {first name}" with today's date and role.
2. **Waiting for you**: your open gates and tasks, oldest first, each with ref, one-line title, how long it has waited (amber after its alert threshold, S30) and one action ("Review", "Confirm amount").
3. **Your deals at a glance**: count per stage for deals you own (or all, for managers), each count links to Work filtered.
4. **Today**: transfers, signing deadlines, permit expiries, offers expiring, instalments due.
5. **Helper activity** (last 10): helper name, what it did in one sentence, source, outcome, "How this was handled" expandable.
- Empty state: "Nothing is waiting for you." plus one sentence on what will appear here.
- No big KPI tiles unless they are the point; numbers live in Work filters.

### 4.2 Work: list

- Title "Work", lede "Everything open for your role."
- `TabLinks` filters with counts: **Inbox** (gates for your role) · Deals · Listings · Tasks · Done.
- Second filter row on Deals: deal type (Primary off-plan · Ready resale · Off-plan resale), stage, owner, "on hold", "in default".
- Table in `TableFrame`: Ref (mono, links to the record) · Property · Parties ("Sellers → Buyers") · Type · Stage · **Waiting for** (pill, words) · Owner · Age.
- One row = one thing. Row second line in `Sub` (12.5 px muted).
- Search by ref, party, unit. Results never show ID or passport numbers.

### 4.3 Deal record (the main screen)

Header
- Back link "Work". Title "{Ref} · {Property}". Second line: type · "Sellers → Buyers" · price.
- State pill (words, tone by §6) and, if set, `In default` (danger) and `On hold` (warning) pills.
- Actions on the right: at most two buttons for the current step; everything else in a "More" menu.

Body (left column, sections with `Section`, no boxes around sections)
1. `RecordStepper` with the deal type's steps (specs §5 table), user-facing names from §6.2.
2. **Waiting for** banner: one sentence, who it waits for, since when. If it waits for you, the action button sits in the banner.
3. **Parties**: one fact cell per party (role, share, KYC result, screening result: "no hits" / "review open" for sales roles, details only for compliance roles). Company parties show licence validity, signatory and owners ≥ threshold.
4. **Documents and checks**: per party, each document with the reader, the checks run (from the form version) and the result; low confidence and blockers first. Images open in a viewer that logs each view.
5. **Agreement**: template name and version, prepared at, legal decision, link to the PDF; field-with-source list on demand.
6. **Signing**: ordered signer list (§7.4) with status; deposit cheque (resale) with holder and status.
7. **Developer NOC** and **Banks** (resale): each letter, values read, "read, not confirmed" amounts with a **Confirm amount** action.
8. **Settlement** (resale): sources, uses and fees tables; "Balances to zero" pill; approval state.
9. **Registration / transfer**: attempts with request ids, rejection reasons in plain words, the issued number.
10. **Payments** (primary and taken-over plans): instalments, receipts, "into escrow" check, finance confirmation.
- Sections that don't apply to the deal type are not shown (never shown empty).

Right column: **Activity** (append-only events: time, actor, what, source; helper runs with "How this was handled"). On narrow screens it moves under the body.

### 4.4 Decision card (every gate)

Used in the Inbox detail and on the record. Must show, in this order:
1. Gate name and ref, who decides (role), how long it has waited.
2. **The proposal** in one sentence, and who proposed it.
3. **Facts with sources**: each value with where it came from (rulebook rule + version, form version, document, record). Untrusted text (party notes, free-text conditions) in the `TENANT_TEXT` style, labelled as written by the party.
4. **Helper reasons and flags** (e.g. agreement review flags), labelled "suggestion" when written by a model.
5. **Decision controls** for the gate (specs §7): buttons with the exact outcome ("Approve and send for signing", "Return with comment"). A reason field when required (AML, EDD, returns). Destructive outcomes use the danger button and say what happens next.
6. If the user proposed it: the controls are replaced by "You proposed this. Someone else with the {role} role decides."
- After deciding: the card shows the outcome, who, when and the reason; it can't be decided again.

### 4.5 Listing record

Header: ref · property · state pill · asking price. Stepper: Draft → Verified → Active → Published → Under offer → Sold.
Sections: Sellers (individual, co-owners or company with checks) · Ownership document check · Advertising permit (number, dates, expiry warning) · Public page (published switch, preview link; disabled without a valid permit) · Offer (the one open offer: buyer, price, conditions, valid until, seller-link status, Resend/Withdraw) · Enquiries · Activity.

**M3 (S77).** The Listings screen is built like Units: status chips with counts, filters (community, type, bedrooms, agent, price band) kept in the address, a photo card grid with a list view, a permit chip ("Permit ends 12 Dec", warning from 7 days, danger once ended) and an offer chip. Only the sales roles see **New listing**.
The record reads, top to bottom: gallery, title with state pill and **Edit listing**, the stepper (a withdrawn listing shows a danger pill instead), then collapsible cards: **Next step** (the engine's next step as one button, disabled with the reasons and a link to the fixing section; a published listing shows "The page is live", the public link and **Unpublish**; **Withdraw listing** on every open state; both open a reason box with Confirm and Cancel), **Overview**, **Documents** (sub-cards Ownership, Listing agreement, Permit), **Sellers** (sales roles only), **Photos**, **Offers and deals**, **Activity**. The new-listing form has Property, Price, Sellers (person or company rows, optional shares), Permit and Agent. Photos are added on Edit listing, as for units.

### 4.6 Inventory (developer)

Projects → buildings → units, each unit with status (Available · Held · Sold · Registered · Handed over), price-list price, and the deal link. Price lists by version. Project page shows escrow account (masked), anticipated completion and the SPA template in use.

**M2 (S75).** Inventory has two tabs, **Units** (default) and **Projects**, built like leasing's Units screen.

- **Units tab:** search by unit code; filters for project, type, bedrooms, status and a price band (kept in the address, so a filtered view can be shared); a photo card grid with a list view; Next page. Only an admin sees **New unit**.
- **Unit page:** breadcrumbs, gallery, name and status, then Overview (facts), Price (price in use and its history by version, oldest first), Deals (open and past, linked) and Activity, with a Price in use card and a Project card beside. Only an admin sees **Edit unit** (details, photos and the unit's code; the project and building are fixed once placed).
- **Project page:** Overview (community, location, handover, template, escrow masked), Photos, Buildings, Units (the Units browser filtered to the project), Price lists, Activity. `/inventory/<id>` redirects to `/inventory/projects/<id>`.
- Photos come through `/media/<id>` only; a unit or project without one shows the calm tile "No photo yet". No screen prints an id, an enum or a column name.

### 4.7 Listings

Same table pattern as §4.2: Ref · Property · Seller (kind) · Asking · State · Permit (valid to / none, warning when ≤ 7 days) · Page · Offer.

### 4.8 Compliance (compliance roles only)

- Tabs: Open cases · More info asked · EDD · Reported · Closed; "Export case pack" and "Monthly report" actions.
- Case view: screening results per party (rule, score vs threshold, list and date), source-of-funds evidence, risk level with points, model summary labelled "suggestion", decision card (§4.4), case trail.
- Nothing from this screen appears anywhere for non-compliance roles except "review open".

### 4.9 Copilot dock

- Chat with the copilot; each answer shows the tools used as small chips and "How this was handled".
- Proposals appear as a card with **Confirm** and **Edit**; drafts as a card with "Open in form". Nothing is sent from the chat.
- Values the copilot states without a tool result behind them are highlighted as unverified (same as leasing).

---

## 5. Settings

Settings index: grouped cards, each with a title, one plain sentence and the last change ("Saved 12 Nov by Omar").

| Group | Pages |
|---|---|
| Company | Company and kind · Signatories · Projects and inventory (developer) · Escrow accounts |
| Selling | Listings and permits · Offers and deposit · Pricing and discounts · Payment plans · Commission |
| Rules | Fees and rulebook · Signing order and reminders · Chasing and email templates · Alerts and records |
| Checks | KYC forms (per role) · AML policy · AI helpers |
| Documents | Templates (SPA, MOU, assignment, listing agreement) |
| People | Users and roles |
| Demo | Demo clock and data (demo mode only) |

Every settings page uses the leasing `SetPage` pattern:
1. Back link "Settings", title, one plain sentence of what it controls.
2. Form on the left; a **live preview** on the right where it helps (an email template, a KYC form as the party sees it, a fee on a sample price).
3. Fields with a label, help text under it, and an inline error that says how to fix it.
4. A sticky save bar: "Save" (primary) and "Discard"; "Saved, version 7" after save.
5. Footer note: who can change it, that every save is audited and versioned, and that running checks keep the version they started with.
6. Values marked "confirm with legal/compliance" show a small warning pill until confirmed.
- Read-only values (models from `.env.spa.local`) show as facts with "Set in the server's SPA settings file".

---

## 6. Status vocabulary

### 6.1 Pill tones

| Tone | Meaning | Examples |
|---|---|---|
| `accent` | done, passed, approved | Passed · Approved · Signed · Matched · Registered |
| `waiting` | waits for you | Waiting for you · Confirm amount |
| `warning` | on hold or at risk | On hold · Review open · Permit expires in 5 days · Read, not confirmed |
| `danger` | blocked, failed, in default | Blocked · Expired · In default · Not counted |
| `neutral` | everything else | Draft · Not started · Simulated |

### 6.2 Words people see

| Internal | Staff see | Buyer / seller see |
|---|---|---|
| `OFFER_AGREED` | Offer accepted / Booking | Offer accepted |
| `PARTY_CHECK` | Checking parties | We're checking your documents |
| `AML_HOLD` | On hold · review open (details: compliance only) | **Under review** |
| `AGREEMENT_DRAFT`, `LEGAL_REVIEW` | Preparing the agreement · Legal approval | Your agreement is being prepared |
| `SIGNING` | Signing | Sign your agreement / Waiting for {other side} |
| `NOC` | Developer NOC | Waiting for the developer's NOC |
| `FINANCE` | Banks | Waiting for the bank letters |
| `SETTLEMENT` | Settlement | Checking the transfer-day amounts |
| `TRANSFER`, `REGISTRATION` | Transfer · Oqood | Transfer day / Registration |
| `COMPLETED`, `HANDED_OVER` | Completed · Handed over | Completed |
| `CANCELLED` | Cancelled | Closed. Your agent will contact you |

Staff screens say "Deal"; parties see "your purchase" (buyer) or "your sale" (seller). Never "booking" to a reseller.

---

## 7. External links (no login)

### 7.1 Who gets links

| Person | Gets links for |
|---|---|
| Buyer (each, or a company's signatory) | Documents, offer confirmation (if set), signing, payments, transfer day |
| Seller (each co-owner, or a company's signatory) | Listing agreement, ownership and KYC documents, offer answer, signing, bank letter upload, transfer day |
| Broker from another agency | Signing their block; viewing their own commission line |
| Website visitor | Public listing page (no token) |

### 7.2 Link rules

- Path: `/b/<token>/<page>` for parties and brokers; `/properties/<ref>` for the public page.
- A token is signed and scoped to **one deal (or listing), one person, one purpose**. It never grants anything else.
- Expiry per purpose (Settings → Signing and reminders; defaults: documents 14 days (`documentLinkDays`, S67), offer answer = offer validity, signing 14 days, payments and transfer info for the life of the deal).
- Resending a link invalidates the old one. An expired or used link shows "This link has expired" and "Ask {agent} for a new link" with the agent's email as text.
- Every open, upload, answer and signature is an event with the token id (never the token).
- Links arrive only by email (shared mail adapter, S23 templates). No link is ever sent in chat or SMS in the MVP.

### 7.3 Party page template (mobile first)

1. Company name and logo; "Your purchase" / "Your sale"; the property; **no** internal refs other than the deal ref.
2. Status card from §6.2 in one sentence.
3. The one thing to do now (upload, accept or reject, sign) as the main card with one primary button.
4. Then: documents list, "you sign 2 of 3" (the person's place in the order; **no names** of other signers, S67), payments or transfer-day card.
5. "Ask a question" (party assistant, S24) and "Contact {agent}".
- Never shown: AML, screening, risk, flags, other parties' ID numbers or documents, internal notes, staff names beyond the agent.
- Uploads: one document per field, with what we need in plain words, accepted file types, size limit, and the reason when a blocker check fails ("Passport expired. Please upload a valid one.").
- Signing: the full PDF to read first, typed name, consent tick, Sign. After signing: "Signed. {Next person} signs next."

### 7.4 Signing order shown to everyone

Every deal type: buyers → broker → the seller (a company signs through its signatory), in the order of the policy's `signingOrder` (S54). The page shows the order and where the person is in it.

### 7.5 Public site (S78)

`/properties`: the leasing property screen with this module's words: hero with the finder (Community, Type, Bedrooms, Price), source chips (All, Resale, New from developer), sort chips, a grid of cards (photo or plan tile, title, community and project, beds, type and size, price in AED; resale cards print "Permit 123456", developer cards carry a "New · developer" chip). Filters live in the address. Empty: "No homes match these filters" with "Clear filters"; engine down: "Homes couldn't be loaded. Try again in a moment."

`/properties/[ref]`: back link "All homes", title, community and project, gallery, facts list, description, and an aside with the price, the **advertising permit number** (resale only), the listing agent's name and the listing chat (resale only). Never: owner names, title-deed or Oqood numbers, floor prices, documents, any email or phone.

### 7.6 Emails

- Subject: "{Action} · {Property}" ("Please sign your MOU · Apt 1803, Marina Vista").
- Body: greeting with first name; one sentence of what happened; one sentence of what to do; one button with the action verb; expiry line; agent's name and email as text; company footer.
- Written by admins as templates (S23); code fills names, property, items, reasons and dates. No model-written text.
- AML-related requests say "Additional documents needed".

---

## 8. Writing

- Plain words, short sentences, active voice. Say what happens: "Approve and send for signing", not "Submit".
- Buttons start with a verb; links name their destination.
- Errors say what went wrong and how to fix it. Empty states say what will appear and how to make it appear.
- **Money:** `AED 1,234,567` (no decimals unless fils matter), tabular digits; percentages with the base when it matters ("4% = AED 128,000").
- **Dates:** "4 Dec 2026"; times "10:00" in Asia/Dubai, labelled "UAE time" where it could be misread. Relative times ("2 h ago") only for activity.
- **Names:** as on the passport for parties; first name in greetings.
- **Refs:** monospace (`R-0031`, `L-0031`, `AP-311`).
- **Placeholders** in demo data: `[PERMIT NO.]`, `[BANK]`, never invented real-looking numbers.
- **Simulated services** are labelled "Simulated" everywhere they appear. No DLD logos or colours.
- **Model-written text** shown to staff is labelled "suggestion"; to parties, only the assistant's own chat replies are model-written.
- Glossary terms follow `.claude/skills/dubai-sales-spa/SKILL.md` (Deal, Listing, MOU, NOC, Settlement, Deposit cheque).

---

## 9. Accessibility and responsiveness

- WCAG 2.2 AA: contrast, focus visible, every control labelled, form errors tied to their field, status changes announced (`aria-live`).
- Real buttons and links; no click handlers on divs. Tables have headers; wide tables scroll inside their frame.
- Staff app works from 360 px: the rail becomes a bottom bar, the dock a full-screen sheet, two columns stack.
- Party pages are designed for phones first and keep tap targets at 44 px.
- Reduced motion respected; no information only in colour or only on hover.

---

## 10. Mockups

- New SPA mockups use these tokens, components and screen templates, and the words in §6 and §8.
- A mockup shows realistic fictional data and marks samples; it never shows a cross-module switcher.
- When a mockup needs something this file doesn't cover, add it here first (new S-decision), then build the mockup.

---

## 11. Implementation notes

- **Shared UI package (P2):** move the domain-free tokens and components from `modules/leasing/apps/web` (`lib/design/tokens.ts`,
  `contrast.ts`, `components/ui/*`: Button, Pill, PageTitle, TabLinks, TableFrame, Section, FactGrid/Fact/FactList,
  RecordStepper, EmptyState, Modal, Sheet, settings blocks, form fields) into `platform/ui` (`@platform/ui`). Leasing
  re-imports them unchanged; SPA imports them (allowed by the S1 boundary). Shell pieces (rail, avatar menu, dock)
  are composed per app from these parts.
- New SPA-only components live in `modules/spa/apps/web/components`: DecisionCard, FieldWithSource, SettlementTables,
  SignerList, PartyCard, LinkStatus, AgentTrace.
- Tailwind v4 with the same `@theme` tokens as leasing; no hard-coded colours in SPA components.
- **C24 (S59):** Settings → AI helpers (`/settings/helpers`) is a list of helper rows, each with a Auto / Review / Off segmented control (submit buttons, no JavaScript needed), the model as plain text and "No model: code does this step" where none; the document reader has one row per document kind. A sales manager sees the same rows with no controls. Held results appear as ordinary `helper_review` cards in the inbox ("Check the result: ..."); an off helper's step is an ordinary task.
- **C31 (S63):** the Inbox is the first tab of Work (a count of the gates the role decides) and, for the compliance roles who have no Work, the section "Waiting for your decision" on Compliance. Each gate is a decision card (§4.4) with a Note field and its own buttons; a button is drawn only where the engine says the user may decide.
- **C30 (S58):** the Work list shows the Deals and Tasks tabs only (Inbox, Listings and Done arrive with their screens; the Inbox tab came with C31); "Read, not confirmed"
  shows once the engine marks an amount unconfirmed. `RecordStepper` takes an optional `states` map so a finished or cancelled deal draws
  correctly. A record shows only the sections the engine sent; `SignerList` waits for a signing section.
- **M5 (S79):** Work gains **Leads** and **Viewings** tabs for the sales roles (counts: new leads, today's viewings). Viewings has Today / Upcoming / Past and Mine / All (managers); times are Dubai time; a started viewing with no outcome shows "Needs an outcome" and **Record the outcome** (Attended / No-show with a note); Reschedule opens a free-time picker grouped by day; Cancel opens the reason box first. Leads has filters (status, source, home), Mine / All, and the columns ref, name, home, source, status, last message, agent, created. A lead is a record at `/leads/<id>` (Next step, Overview, Messages, Viewings, Activity); the Next step follows the status, and **Start deal** opens the deal form (M6). The public property page's aside holds one form with two tabs, **Book a viewing** (times grouped by day, Dubai time) and **Ask a question**, with name, email, phone, message and the consent tick, laid out like leasing's enquiry form; the listing chat sits below it on a listing. `/v/<token>/cancel` asks before it cancels. Settings gains **Viewings**.
- **M6 (S81):** **Start deal** (unit page when the unit is Available, and the lead record) opens `/deals/new`: breadcrumbs Inventory, the unit, Start deal; sections Home, Buyers (person or company rows, shared with the listing form), Price and booking (a quote panel of engine figures: list price, discount, the policy limit, booking minimum, DLD fee and who pays; "A sales manager must approve this price" when outside), Payment plan (Booking and Handover to start, a running total that errors until 100%), Broker (optional) and Mortgage. After it starts, a banner names any approval the manager must give. A listing's **Make an offer** (`/listings/<id>/offer`) has Buyers, Offer (price, days to answer, conditions; the deposit % is shown read-only from policy) and Mortgage. The listing's Offers and deals section shows the current offer with each seller's answer (Waiting / Accepted / Declined), **Withdraw offer** (reason box on the second click), past offers, the deal link and, once accepted, a deposit cheque form. Read-only roles see offers without buyer details or buttons.
