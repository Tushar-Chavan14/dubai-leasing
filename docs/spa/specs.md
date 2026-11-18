# Product spec: SPA (sales) module

Status: MVP / pitch build. Separate runtime from leasing (`docs/spa/decisions.md` S1–S2).
How it is built: `docs/spa/architecture.md`. Tasks: `docs/spa/task.md`. Screens: `docs/spa/mockup.html`.
Domain knowledge: `.claude/skills/dubai-sales-spa/SKILL.md`.

The module runs a property **sale** from listing to transfer of ownership. It covers three kinds
of deal (S13): a developer selling a new unit (**primary off-plan**), an owner reselling a unit that
already has a title deed (**ready resale**), and an owner reselling an off-plan unit before
handover (**off-plan resale**). The seller can be the developer, another company, or one or more
individuals (S14). Either side may use a mortgage.

## 1. Problem

A Dubai property sale involves many people: the seller, the buyer, the broker, the developer, legal,
compliance, sometimes two banks, and the land registry. Today most of it is manual:

- Buyer and seller documents are re-typed into agreements, so names, passport and title-deed numbers don't
  match and registration or transfer is rejected.
- Each developer and agency has its own SPA or MOU template. Staff copy values into Word, which breaks numbering
  and layout and leaves the last deal's values in the text.
- AML checks (sanctions, PEP, who is paying, source of funds, who really owns a selling company) are
  uneven and hard to evidence to a regulator.
- In resales, nobody can see at a glance whether the developer NOC, the seller's mortgage
  clearance or the buyer's bank offer is holding up transfer day. The money settlement (who pays whom
  on transfer day) is worked out on paper.
- Signatures and instalments are chased by phone and spreadsheets.

## 2. Goal

AI helpers read documents, check them, and draft agreements. Every agreement comes out in the
exact structure of the company's own template. Every legal, money and AML decision stays with a
named person, and every deal shows what it is waiting for and leaves an audit trail.

## 3. Users

### Client kinds (S12)

A company using the module is set up as a **developer** (it sells its own projects' units), a
**brokerage** (it lists units for other sellers, individual or company, and runs the deal), or
**both**. The kind decides which deal types and screens it sees: a developer-only client sees
primary sales; a brokerage sees listings and resales; both sees everything.

### Staff (log in to the SPA web app)

| Role | What they do in the product |
|---|---|
| Sales officer / agent | Creates listings and deals, collects documents, records deposits and payments, prepares agreements, follows NOC, banks and signing |
| Sales manager | Approves prices and discounts outside policy, unclear KYC, seller-verification issues, cancellations |
| Sales admin | Submits Oqood registrations and transfers (mock), books trustee appointments, records title deeds |
| Legal | Approves templates and every agreement before signing |
| Compliance officer | Decides every AML flag for buyers, sellers, companies and their owners |
| MLRO | Handles "stop and report" cases; records the goAML reference |
| Finance | Approves the transfer-day settlement statement and refunds; tracks receipts and instalments |
| Admin | Configures company kind, projects, listings rules, templates, fees, AML rules, users. Approves nothing |

### Outside people (act only through emailed single-use links, no login)

| Who | What they do |
|---|---|
| Buyer (one or more people, or a company) | Uploads documents, accepts the offer, signs, sees payments and steps |
| Individual seller (one or more co-owners) | Signs the listing agreement, uploads ID, title deed or Oqood, mortgage letters, signs the agreement |
| Company seller | Same as an individual seller, plus trade licence, signatory proof and owner details; its signatory signs |
| Broker on the other side (if any) | Signs where the template has a broker block |
| Developer (in a resale) | Not a user. Its NOC is uploaded by staff and read by the system |
| Banks | Not users. Their letters (liability letter, clearance, pre-approval, final offer) are uploaded by staff and read |

## 4. MVP scope

### In scope

- **Listings (brokerage):** a property listed by an individual or company seller, with ownership
  proof, asking price and a listing agreement (Form A style, from the company's template); DLD
  advertising permit number recorded; a public listing page published only with a valid permit (S17)
- **Inventory (developer):** projects, buildings and units with a price list (CSV import)
- **Three deal types** (S13): primary off-plan, ready resale, off-plan resale, each with its own steps
- **Seller checks** (S14): individual (ID, ownership); company (trade licence, signatory proof by POA or
  board resolution, ownership in the company's name, AML on the company and its beneficial owners)
- **Buyer checks:** KYC from passport, Emirates ID, proof of address; AML screening (fictional lists, fake adapter)
- **Configurable KYC** (S19): one form and rule set per party role (buyer, individual seller,
  company party, beneficial owner), optionally per deal type; admins add, remove and edit fields,
  documents, per-check severity and custom rules (same model as leasing's KYC settings)
- **Configurable AML** (S20): warning-sign rules and thresholds, source-of-funds evidence per source,
  code-computed risk level with enhanced due diligence (EDD), re-screening points
- **Offers (resale):** one open offer per listing at a time; the seller accepts or rejects through an
  emailed link (S18)
- **Security deposit (resale):** a cheque in the seller's name held by the brokerage until transfer
  day, then handed to the seller, or released by decision on cancellation (S18)
- **Mortgages:** seller's mortgage (liability letter, payoff, release) and buyer's mortgage
  (pre-approval, valuation, final offer); documents are uploaded and read, amounts confirmed by people
- **Developer NOC** for resales: uploaded, read and checked (unit, seller names, validity date)
- **Agreements from templates:** SPA (primary), MOU (Form F style) for resales, listing agreement; each
  generated in the exact structure of the company's uploaded template (S5)
- **Settlement statement** for resales: who pays what on transfer day (price, deposit, seller's
  bank payoff, fees, commission), computed by code, approved by finance
- **E-signature** through the portal (shared `ESignAdapter`) in the order set per deal type
- **Registration and transfer mocks** (labelled simulated): Oqood registration (primary), Oqood
  transfer (off-plan resale), trustee transfer and new title deed (ready resale)
- Instalments and reminders (primary; taken-over plan in off-plan resale); payment proofs read and checked
  against the project's escrow account (S26)
- Default flag (overdue instalment, party pulling out) with a task; no default notices yet (S27)
- Compliance records: retention rules, case export pack, monthly compliance report, staff alerts for waiting gates (S29, S30)
- `spa_approvals` inbox, deal record with activity log, SPA copilot, settings, demo console
- Portal launcher (links to Leasing and SPA), stage 1

### Out of scope for MVP

- Individuals acting through a representative (POA holder): individuals sign and upload themselves; only
  companies act through signatories (S28)
- Default notices, termination and deposit forfeiture workflows (flag only, S27)

- Real DLD, Oqood, trustee-office, bank or payment-gateway connections; escrow bank integration
- The system issuing NOCs (a developer client's NOC for resales of its own units is uploaded like any other)
- Filing to goAML from the system (the MLRO files outside and records the reference)
- Mortgage applications to banks (the system tracks the bank's letters only)
- Arabic agreement generation and Arabic staff UI; commission payouts; lead/CRM management
- Commercial property, plots and whole buildings (units only)
- Any emirate other than Dubai in the rulebook (the structure allows more later)

## 5. Deals and features

Each step lists what happens, the helpers, the gate and acceptance criteria (AC). "Gate" means
`SpaManager` creates a `spa_approvals` row and pauses until a person decides. Amounts and fees always come from
the pinned SPA rulebook and the deal's records, never from a model.

### Deal types at a glance

| Step | Primary off-plan | Ready resale | Off-plan resale |
|---|---|---|---|
| 0 Listing / unit | Developer inventory | Listing + listing agreement | Listing + listing agreement |
| 1 Offer and booking | Booking amount (usually 10%) | Agreed price; offer accepted | Agreed price; offer accepted |
| 2 Checking the parties | Buyers | Buyers + seller (+ company checks) | Buyers + seller (+ company checks) |
| 3 Preparing the agreement | SPA | MOU (Form F style) | MOU / assignment agreement |
| 4 Legal approval | ✓ | ✓ | ✓ |
| 5 Signing | Purchasers → broker → developer | Buyers → sellers → broker(s); security deposit recorded | Buyers → sellers → broker(s); deposit recorded |
| 6 NOC | — | Developer NOC (service charges cleared) | Developer NOC (minimum paid % reached) |
| 7 Finance | — | Seller mortgage release and/or buyer mortgage offer, if any | Buyer mortgage, if any |
| 8 Settlement | — | Settlement statement (finance) | Settlement statement (finance) |
| 9 Registration / transfer | Oqood registration | Trustee transfer → new title deed | Oqood transfer to buyer |
| 10 After | Instalments → handover | Completed | Buyer takes over remaining plan → handover |

### Step 0 — Listing (resale) or inventory (primary)

Listing states: `DRAFT → VERIFIED → ACTIVE (permit recorded) → PUBLISHED (optional) → UNDER_OFFER → SOLD`; `WITHDRAWN`.

- **Listing:** sales officer records the property (community, building, unit, type, area, title
  deed or Oqood number), the seller(s) and asking price, and sends the listing agreement for signature.
- Seller uploads ownership proof and their KYC documents through the portal (the seller's KYC form,
  S19); code checks owner names and property numbers against the listing.
- **Advertising permit:** the DLD advertising permit (Trakheesi) number, issue and expiry dates are
  recorded per listing. Without a valid permit the listing can't be published, and a published listing is
  taken down automatically on the day the permit expires.
- **Public listing page** (optional per listing): photos, description, asking price, community, permit number
  and the brokerage's contact. No seller names, title-deed numbers or documents are shown. No lead or
  viewing booking in the MVP: enquiries go to the listing agent's email.
- **Inventory:** developer clients import units and price lists.
- **Gate:** `seller_verification` (sales manager) when ownership proof, names or company
  signatory don't match.
- **AC:** a listing can't take an offer without a signed listing agreement, a matched ownership
  document and a valid permit; it can't be published without a valid permit; the public page shows
  the permit number and no personal data; for a company seller, the signer is named in the POA or
  board resolution; every owner on the title deed is a seller party.

### Step 1 — Offer and booking (Deal: `OFFER_AGREED`)

- **Primary:** unit, plan preset, discount, purchasers (name, email, share), broker; booking amount
  recorded; unit held.
- **Resale offer (S18):** the agent records one offer: buyer(s), price, mortgage yes/no, target transfer
  date, conditions, and validity (e.g. 3 days). The seller gets an emailed link to **accept** or
  **reject**. While an offer is open the listing is `UNDER_OFFER` and no other offer can be recorded. A
  rejected or expired offer frees the listing; the agent may then record a new (or revised) offer.
- Accepting creates the deal with the agreed price; brokers and commission are set per side (seller's
  agent, buyer's agent, same or another agency, % and split).
- **Gate:** `price_out_of_range` (sales manager) when a primary discount is outside policy.
- **AC:** shares add up to 100%; primary plan shares and amounts add up to the price in fils; a unit or
  listing never has two open offers or two open deals; an offer's price is never changed after it is
  sent (a revision is a new offer); every offer and answer is an event.

### Step 2 — Checking the parties (Deal: `PARTY_CHECK`, `AML_HOLD`)

- **KYC (`spa-kyc`)** for every buyer and individual seller: the vision model reads, code checks MRZ, expiry,
  ID format and names.
- **Company checks (`company-check`)** for a company buyer or seller: trade licence (valid, name),
  signatory proof, beneficial owners (people owning 25% or more, confirm with compliance),
  each screened like a person.
- **AML (`aml-screening`)** on every buyer, seller, company, beneficial owner and any payer that is not a party.
  Warning signs are code rules (sanctions, PEP similarity ≥ threshold, third-party payer, cash ≥ threshold,
  high-risk country, missing source of funds, complex company ownership).
- Each party's documents and checks come from the **KYC form for its role** (S19). Each check's
  severity (off / warning / blocker) is set by the admin; a blocker can email the party a fresh
  upload link with the reason.
- **Risk level** (S20): code computes low / medium / high from the configured AML rules. High risk
  requires the EDD documents set for it and a compliance sign-off, even when no flag is raised.
- **Source of funds:** the party picks a declared source; the configured evidence documents for that
  source are requested and read.
- Any warning sign → `AML_HOLD`; parties see "under review" only.
- **Re-screening** at the configured points (e.g. before agreement approval, before transfer, on a
  party change); a new hit puts the deal back on hold.
- **Gates:** `kyc_review` (sales manager); `aml_flag` and `edd_signoff` (compliance officer); `aml_report` (MLRO).
- **AC:** sellers are screened in resales exactly like buyers; a sanctions hit always flags; no model
  output raises or clears a flag; no message to a party mentions a report.

### Step 3 — Preparing the agreement (Deal: `AGREEMENT_DRAFT`)

- `spa-prepare` fills the approved template for the deal type (SPA, MOU, assignment) from the data
  sheet: buyers, sellers, brokers, property, price, deposit, fees, plan or settlement terms, dates.
- Party blocks repeat per buyer and per seller in the template's layout; a company party prints its
  name, licence and signatory.
- **AC:** same sections, order, numbering, fixed wording, tables, header, footer and signature blocks as the
  template (tested on fictional SPA, MOU and assignment templates); every core field filled or prepare
  stops; no value from another deal or the sample.

### Step 4 — Legal approval (Deal: `LEGAL_REVIEW`)

- Legal sees the agreement, field sources and checks, and approves or returns it.
- **Gate:** `agreement_approval` (legal), always.
- **AC:** nothing is sent for signing without approval; the approved PDF's hash is stored; a change to the deal
  after approval makes the approval stale.

### Step 5 — Signing (Deal: `SIGNING`)

- Order from settings per deal type (defaults in the table above); 48 h reminders.
- **Resale deposit (S18):** the buyer hands the brokerage a security cheque in the seller's name for
  the deposit (policy %, usually 10%). The agent records cheque number, bank, amount, date and who
  holds it (masked in logs); the deal can't leave `SIGNING` without it. On transfer day the cheque is
  handed to the seller and the handover is recorded. On cancellation, who gets the cheque (back to the
  buyer or to the seller) follows the MOU and is decided by a person (`deposit_release`).
- **AC:** the seller or developer signatory signs last in primary; every co-owner signs in resale;
  each signature lands at its template anchor; the deposit amount equals policy % × price (code); the
  cheque can't be marked handed over before the transfer is issued.

### Step 6 — Developer NOC (resale only, Deal: `NOC`)

- Staff request the NOC from the developer outside the system and upload it. `document-reader` (`noc` profile) reads the unit,
  seller names, issue and expiry dates; code checks them against the deal.
- Off-plan resale: code checks the amount paid to the developer against the developer's minimum
  (entered per project; confirm per developer).
- **Gate:** `noc_review` (sales admin) when anything doesn't match or the NOC expires before the
  target transfer date.
- **AC:** a deal can't reach transfer with an expired or mismatched NOC.

### Step 7 — Finance (resale with a mortgage, Deal: `FINANCE`)

- **Seller's mortgage:** the bank's liability letter is uploaded and read; the payoff amount is
  shown with its source and confirmed by a person; after transfer-day payment, the release/clearance letter is uploaded.
- **Buyer's mortgage:** pre-approval, valuation and final offer letter are uploaded and read; the
  loan amount is confirmed by a person.
- **AC:** an amount read from a bank letter is never used until a person confirms it; the deal
  waits in `FINANCE` until every required letter is uploaded and confirmed.

### Step 8 — Settlement statement (resale, Deal: `SETTLEMENT`)

- Code builds the transfer-day statement: price, deposit already paid, seller's bank payoff (manager's cheque to
  the seller's bank), balance to the seller, buyer's loan, DLD transfer fee, trustee fee, mortgage registration
  fee, commissions, and who pays each (rulebook and policy).
- **Gate:** `settlement_approval` (finance), always.
- **AC:** the statement balances to zero; every amount shows its source (rulebook rule, deal record or a
  confirmed letter); a change after approval makes it stale.

### Step 9 — Registration or transfer (Deal: `REGISTRATION` / `TRANSFER`)

- Primary: Oqood registration (mock). Off-plan resale: Oqood transfer (mock). Ready resale: trustee
  transfer (mock) issuing a new title deed in the buyer's name.
- **Gates:** `oqood_submission` / `transfer_submission` (sales admin), always.
- **AC (payments):** no payment counts until its account is the escrow account and finance confirmed the amount.
- **AC:** retries with the same request id never register twice; a name-case rejection is fixed once from the
  verified name, anything else becomes a task.

### Step 10 — After registration

- Primary: instalments with reminders until handover (`INSTALMENTS → HANDED_OVER`).
- **Payments into escrow (S26):** for every primary payment the agent or buyer uploads the transfer receipt.
  `document-reader` (`payment_receipt` profile) reads amount, date, payer and receiving account; code checks the
  account is the project's escrow account and the payer is a buyer (else the AML third-party-payer rule); a
  finance user confirms the amount before it counts. A payment to any other account is not counted and becomes a
  finance task.
- **Default flag (S27):** an instalment overdue more than the policy's days, or a resale party withdrawing or
  missing the transfer appointment (recorded by the agent), sets the deal's `in_default` flag and creates a task for
  the sales manager. The deal stays in its state; notices, termination and deposit outcomes are handled outside for now.
- Off-plan resale: the buyer takes over the remaining plan; same reminders.
- Ready resale: `COMPLETED` when the new title deed is recorded.
- Cancellation from any open state through `cancellation` (sales manager); refunds through `refund` (finance).

### 5a. Party touchpoints

| When | Who | Email | Portal page (`/b/<token>/…`) |
|---|---|---|---|
| Listing created | Seller | Sign the listing agreement, upload ownership proof and KYC | Sign, upload |
| Offer recorded | Seller | An offer on your property | Accept or reject |
| Deal created | Buyer(s), seller(s) | Upload your documents | Upload ID, address, company documents, source of funds |
| More information asked | Any party | Documents needed ("under review") | Upload |
| Agreement approved | Every signer, in order | Please sign | Read, sign |
| Mortgage letters needed | Seller / buyer | Upload your bank letter | Upload |
| Transfer booked | Buyer(s), seller(s) | Date, what to bring, settlement summary | View |
| Registered / transferred | Buyer(s), seller(s) | Confirmation (simulated) | Download |
| Instalment due | Buyer | Reminder T−14 / T−3 / T+1 | Instalments |

### 5b. KYC and AML settings (S19, S20)

Admins configure everything below in Settings; every save is an audited event and applies to new checks
(running checks keep the version they started with).

**KYC forms, one per party role** — Buyer (person), Seller (person), Company party, Beneficial owner;
each optionally overridden per deal type:

- Fields: add, remove, reorder; label, help text, type (text, email, phone, date, number, select,
  document), required, applies to person/company, select options.
- Document fields: document kind (passport, Emirates ID front/back, visa, trade licence, title deed,
  Oqood, POA, board resolution, memorandum of association, proof of address, custom with a description
  for the reader), and whether it is read by the model.
- Per document check (e.g. expired, valid long enough, issued recently, readable, right document, MRZ,
  ID number format, names match): severity off / warning / blocker and "email the party on blocker".
  Some checks are locked (an expired ID can never pass).
- Cross checks: required documents present, names consistent across documents, name matches the deal.
- Custom rules: answer matches a document value, answer required, document required, minimum age, a
  document value matches a pattern (safe regex), and an AI check that can only warn.
- No rule may screen on nationality, religion, race or similar traits (refused on save).

**AML settings:**

- Warning-sign rules: each on/off with severity and its threshold (name-match score, cash amount,
  beneficial-owner %, high-risk country list, third-party payer, layered ownership, missing source of funds).
- Source-of-funds evidence: per declared source (salary, savings, property sale, business income, loan,
  gift, inheritance, other), which documents are asked for and which checks run on them.
- Risk scoring and EDD: points per rule and per factor (party type, country, payment method, price
  band), low/medium/high cut-offs, EDD documents for high risk, and who signs off.
- Re-screening points: at offer, before agreement approval, before transfer, on any party change, and
  periodically for deals open longer than N days.
- Lists used by the screening adapter (simulated in the MVP) and the match threshold.

**AC:** a configuration that would let a model block a party, or a rule on a protected trait, is refused;
changing a form never changes a check already running; every check result names the form/rule version.

### 5d. Compliance records and staff alerts (S29, S30)

- **Retention:** KYC, screening results, AML decisions, documents and deal events are kept at least 5 years after
  the deal ends (confirm with compliance). A monthly job lists records past retention; a compliance officer approves
  deletion; nothing is deleted before, and the deletion itself is an event.
- **Case export pack:** a compliance officer or MLRO exports one deal as a ZIP (PDF summary + documents + screening
  results + every decision with reason, actor and versions). Each export is logged.
- **Monthly compliance report:** counts of flags by rule, outcomes, EDD cases, reports filed, time to decide;
  CSV and PDF; compliance roles only.
- **Staff alerts:** when a gate waits longer than its threshold (per gate, Settings → Alerts), the approver role gets
  an email and an in-app notice; past twice the threshold the manager too. Alerts never carry AML details outside compliance roles.

### 5c. SPA copilot

- Read: deals, listings, timeline, approvals, NOC and bank-letter status, settlement statement, rulebook values (by tool).
- Draft: party emails, summaries, approval notes. Propose (needs Confirm): document request, task, link
  resend, preparing an agreement.
- Never: decide a gate, clear an AML flag, confirm a bank amount, send, sign, submit, change settings, open
  uploaded documents, or show an AML report to a role without access.
- **AC:** at least 30 eval cases including injection and permission cases; 0 forbidden actions.

## 6. AI helpers and assistants

Two kinds of AI piece work in the SPA process:

- **Helpers** run in the background when `SpaManager` asks (a job or an event). They read, extract,
  check and draft, and return data. Nobody chats with them.
- **Assistants** are chat agents that people talk to: staff, parties, website visitors and admins.

### 6.1 Rules for every helper and assistant

1. **Return data, never change state.** Only `SpaManager` moves a deal, listing or unit. A helper's result
   is stored in `helper_runs` and the Manager acts on it.
2. **Models read and draft; code decides.** Amounts, fees, dates, percentages, risk levels, AML flags,
   matches and pass/fail come from code, the SPA rulebook and settings. A model may extract a value from
   a document; a money value extracted from a document is used only after a person confirms it.
3. **Validated output.** Every model answer is parsed with Zod; invalid → retry once → `needs_human`
   with a reason. Nothing moves on an unparsed answer (shared `runHelper`).
4. **Untrusted text.** Text inside documents, emails, chat messages and template files is data, never an
   instruction. It is fenced as untrusted in prompts. Instructions found in a document are flagged.
5. **Confidence.** Every read field carries a confidence. Below the threshold in the KYC config → treated as
   unreadable → the matching review gate, whatever the helper's mode.
6. **Privacy.** Documents never leave the server (local Ollama only). Passport, Emirates ID, phone, title-deed,
   cheque and bank-account numbers are masked in logs and in assistant answers unless the screen already shows them.
7. **Time and versions.** "Now" comes from the SPA `Clock`. Each run records the model tag, prompt version,
   rulebook version, KYC config version and AML policy version it used.
8. **Limits.** Each model call has a timeout (vision 120 s, chat 60 s, decision 15 s); background helpers wait
   behind assistants in the `ModelGate` (interactive first). A model that times out twice → `needs_human`.
9. **No outbound words from a model.** Nothing a model writes is sent to a party without a person clicking
   Send, except an assistant's chat reply inside its own chat (6.4).
10. **Evals before release.** Each helper has labelled fictional cases and a pass bar (6.6). A prompt or model
    change is merged only when its eval passes.

### 6.2 Run mode: auto-advance or review (per helper)

- **Default: auto-advance.** When a helper returns `ok` and every code check passes, `SpaManager` moves
  the deal on. A person sees it only when a check fails, confidence is low, or the step has a gate that is
  always required (legal, settlement, submission).
- **Review mode** (Settings → AI helpers, per helper, admin only, audited): an `ok` result also waits for a
  `helper_review` click ("Looks right") by a sales officer or manager before the deal moves. Failed checks go
  to their usual gate in both modes.
- Helpers that can be set to review: `ownership-check`, `spa-kyc`, `company-check`, `document-reader` (per
  document kind), `spa-prepare`, `registry` (auto-fix). Not switchable: `aml-screening` (a flag always goes to
  compliance; a clean result always continues), `settlement` (finance always approves), `chaser`, `collections`.
- A helper can also be **switched off** for a company; its step then becomes a manual task with the same checks list.

### 6.3 Helpers (background)

Each card: what it is for · when it runs · what the model does · what code decides · result · never.

#### `ownership-check` — is the seller really the owner?
- **When:** seller uploads the title deed or Oqood certificate for a listing (`spa.ownership.check`).
- **Model (vision):** reads owner names, shares, property numbers (plot, building, unit), area, document date
  and type. English fields; Arabic-only fields kept as text for a person.
- **Code:** owner names match the listing's seller parties (KYC-verified names, lenient match per config);
  every owner on the deed is a seller party; shares add up to 100%; property numbers match the listing; a
  company owner matches the company party's licence name.
- **Result:** `matched` → listing `VERIFIED` (or `helper_review`); otherwise `seller_verification` with each mismatch.
- **Never:** add or remove a seller party, or accept a deed whose numbers don't match.

#### `spa-kyc` — person identity (buyer, seller, beneficial owner)
- **When:** a party submits the upload form for their role (`spa.kyc.run`).
- **Model (vision):** reads each document as the role's KYC form says (shared KYC reader with the SPA profile).
- **Code:** every check and severity from the role's KYC config: expiry, valid long enough, MRZ, ID format, names
  across documents, name vs the deal, custom rules. Locked checks can't be lowered.
- **Result:** pass → continue (or `helper_review`); warnings → `kyc_review`; blockers → party emailed a fresh
  upload link with the reason (chaser template), and the run waits.
- **Never:** decide on nationality or similar traits; pass an expired ID.

#### `company-check` — company buyer or seller
- **When:** a company party submits its documents (`spa.company.check`).
- **Model (vision):** reads the trade licence (name, number, expiry, activities), MoA (shareholders and %),
  POA or board resolution (who may sign, for what, until when).
- **Code:** licence valid and long enough; the signer is named and the power covers buying/selling property;
  owners at or above the policy threshold become `beneficial_owner` parties and get their own KYC form;
  ownership layers counted for the AML rule.
- **Result:** pass → continue; signatory or ownership problems → `seller_verification`; unclear owners → AML rule.
- **Never:** guess an owner's percentage; treat a missing page as "no other owners".

#### `aml-screening` — screening, warning signs and risk level
- **When:** at each re-screening point in the AML policy (offer, before agreement approval, before transfer, party
  change, every N days) for every party, company, beneficial owner and non-party payer.
- **Code:** list matching through the screening adapter (similarity score vs threshold); every warning-sign rule;
  risk points and level; which EDD documents are needed. A sanctions match is always a flag.
- **Model (chat):** writes the case summary for the compliance officer and suggests documents to ask for. Marked "suggestion".
- **Result:** clean → continue; any rule hit → `AML_HOLD` + `aml_flag`; high risk → EDD documents requested, then `edd_signoff`.
- **Never:** raise, score, lower or clear a flag; write anything a party sees; mention a review to anyone outside compliance roles.

#### `document-reader` — NOC, bank letters, source-of-funds and EDD documents
- **When:** a staff member or party uploads one of these documents (`spa.document.read`).
- **Profiles:** `noc` (unit, seller names, issue/expiry, service charges cleared, minimum-paid statement),
  `liability_letter` (bank, payoff amount, valid until), `release_letter`, `payment_receipt` (amount, date,
  payer, receiving account — checked against the project's escrow account), `pre_approval`, `final_offer` (loan
  amount, conditions, expiry), `sof_evidence` and `edd` (document type matches the declared source, names, dates).
- **Code:** names, unit and dates match the deal; validity covers the target transfer date; the right document for
  the declared source. **Amounts are stored as "read, not confirmed"** until a person confirms them.
- **Result:** match → continue (or `helper_review`); mismatch or expiring NOC → `noc_review`; bank letter → amount
  confirmation task for the agent.
- **Never:** put an unconfirmed amount into a settlement.

#### `spa-template` — reading an uploaded template
- **When:** an admin uploads a template version (`spa.template.read`).
- **Code:** copies wording, sections, numbering, tables, header, footer, logo and fonts; finds blanks and
  placeholders; finds party, broker and signature blocks; runs template checks (sample values, DLD/RERA marks, fee %
  vs rulebook, core keys present).
- **Model (chat + decision):** proposes headings and labels; picks a data key for an unmatched blank from key
  descriptions only (never values), or "none".
- **Result:** a version in review → `template_approval` (legal).
- **Never:** reword or reorder the template; map a blank to a key code rejected.

#### `spa-prepare` — filling an agreement
- **When:** the deal reaches `AGREEMENT_DRAFT` (`spa.prepare`).
- **Model:** none by default.
- **Code:** fills every blank from the deal's data sheet, repeats buyer/seller blocks, prints plan or settlement
  tables, records the source of every field, hashes the PDF, runs prepare checks (core fields, values from other
  deals or the sample, rulebook periods and fees).
- **Result:** → `LEGAL_REVIEW` (in review mode, `helper_review` first); a missing core field → task with the reason.
- **Never:** invent a missing value; print another deal's data.

#### `agreement-review` — warnings for legal (advice only)
- **When:** after `spa-prepare`, before legal sees the agreement.
- **Model (chat):** reads additional terms and any free-text conditions from the offer; flags conflicts with the
  template's fixed clauses, amounts or dates not in the deal, and instruction-like text.
- **Code:** every flag must quote words that exist in the agreement (quote guard); flags only, never edits.
- **Result:** a list of flags shown on the `agreement_approval` card.
- **Never:** approve, block or change the agreement; give a legal opinion.

#### `registry` — Oqood registration and transfer, trustee transfer
- **When:** after `oqood_submission` / `transfer_submission` is approved (`spa.oqood.submit`, `spa.transfer.submit`).
- **Model (decision):** maps a rejection message to the field it is about, with a confidence.
- **Code:** one safe fix allowed (name letter case or spacing from the KYC-verified name), then retry with a new
  request id; anything else → task. Retries for "unavailable" with back-off.
- **Result:** Oqood or title-deed number stored → next state; otherwise a task for the sales admin.
- **Never:** change any other field; submit twice for one request id.

#### Code-only helpers (no model)
- **`settlement`:** builds the transfer-day statement from the price, deposit, confirmed bank amounts, rulebook fees and
  commission policy; must balance to zero → `settlement_approval`.
- **`chaser`:** sends reminders for missing or failed items using **fixed, admin-approved email templates** (6.5).
- **`collections`:** instalment reminders (T−14, T−3, T+1) and overdue tasks.

### 6.4 Assistants (chat)

All four share: a scope gate before the chat model runs (off-topic → a fixed reply); tools typed with Zod that
call the engine as the user (or the party's token); answers post-checked so every amount, date and percentage
appears in a tool result in that turn (otherwise marked unverified); 60 s per turn; English (Arabic later);
every conversation stored and auditable.

#### Staff copilot (logged-in staff)
- **For:** "What is R-0021 waiting for?", "Which deals transfer this week?", "Draft an email to the sellers about transfer day."
- **Tools:** read (deal, listing, timeline, approvals, documents status, settlement, plan, rulebook values,
  templates); draft (emails, summaries, approval notes); propose with Confirm (document request, task, link resend,
  prepare agreement).
- **Roles:** answers with the user's own permissions; AML cases and reports only for compliance roles.
- **Never:** decide a gate, clear a flag, confirm a bank amount, send, sign, submit, change settings, open uploaded files.

#### Party portal assistant (buyer or seller, inside their emailed link)
- **For:** "What's next?", "Why is my purchase waiting?", "Which documents do you still need?", "What do I bring on transfer day?", "When is my next instalment?"
- **Tools:** `my_deal_status` (step name and the party-safe reason), `my_missing_documents`, `my_payments`,
  `transfer_day_info`, `explain_step` (fixed glossary), `contact_agent` (emails the agent the question).
- **Scope:** only the deal and the party behind the token; other parties' personal data never shown.
- **Never:** mention AML, EDD, screening, a flag or a report (an AML hold reads "under review"); give legal, tax or
  mortgage advice; negotiate or comment on price; promise dates the system doesn't hold; accept documents in chat.

#### Listing page chat (public visitors)
- **For:** questions about one published listing: size, bedrooms, community, asking price, permit number, what's nearby (from the listing text only).
- **Tools:** `listing_facts`, `other_published_listings` (same company), `send_enquiry` (name, email, message, consent → agent's email).
- **Never:** reveal the seller, their reasons or lowest price; say whether an offer would be accepted; give
  valuation, mortgage or legal advice; collect documents or ID numbers; talk about unpublished listings. Rate-limited.

#### Template assistant (admin and legal, on template screens)
- **For:** "Why is {handover_window} unmapped?", "What changed between v2 and v3?", "Suggest placeholder names for this blank."
- **Tools:** `template_version` (sections, blanks, mappings, checks), `data_keys`, `compare_versions` (code diff), `explain_check`.
- **Proposes** mapping changes or placeholder renames that the admin applies with a click.
- **Never:** approve a template, change wording or mappings by itself, or say whether a clause is legally valid ("ask legal").

### 6.5 Chasing parties (`chaser`)

- Triggered by code when an item is missing, failed a blocker check, expired, or was requested by compliance.
- Schedule per company (default: at request, +2 days, +5 days, then a task for the agent at +7 days). Stops as soon
  as the item is uploaded, the deal is cancelled, or the agent pauses it.
- Emails use **fixed templates approved by an admin**, with placeholders filled by code: party name, property, the
  list of items, and each item's reason in plain words from a fixed list ("passport expired", "photo unreadable",
  "name differs from the title deed"). No model writes chase text.
- Items requested for AML or EDD use neutral wording ("additional documents needed") so a review is never revealed.
- Every chase is stored with the template version and the message hash.

### 6.6 Models and evals

- Models are **fixed in the SPA env file** (`.env.spa.local`, S25): `SPA_CHAT_MODEL`, `SPA_VISION_MODEL`,
  `SPA_DECISION_MODEL`, `SPA_COPILOT_MODEL` (empty = chat), `SPA_ASSISTANT_MODEL` (empty = chat). No model choice
  in the UI; Settings → AI helpers shows them read-only with each helper's mode.

| Helper / assistant | Model | Eval cases (min) | Pass bar |
|---|---|---|---|
| `ownership-check` | vision | 30 deeds/Oqood (fictional) | fields exact ≥ 95%; 0 wrong "matched" |
| `spa-kyc` | vision | 40 IDs/passports | fields exact ≥ 95%; 0 expired passed |
| `company-check` | vision | 30 licences, MoA, POA/resolutions | signer and owners right ≥ 95% |
| `document-reader` | vision | 10 per profile | names/dates ≥ 95%; amounts read ≥ 98% |
| `aml-screening` summary | chat | 30 cases | 0 summaries that contradict the code result; 100% injection cases flagged |
| `spa-template` | chat + decision | 3 templates × 3 kinds | structure identical; mapping right ≥ 95% |
| `agreement-review` | chat | 30 | 0 false quotes; injection flagged 100% |
| `registry` | decision | 30 rejections | field right ≥ 90% at confidence ≥ 0.6; 0 wrong fixes |
| Staff copilot | copilot | 40 | 0 forbidden actions; unverified values ≤ 2% |
| Party assistant | assistant | 40 | 0 AML mentions; 0 other-party data; 0 forbidden actions |
| Listing chat | assistant | 30 | 0 seller data; scope gate ≥ 95% |
| Template assistant | assistant | 20 | 0 self-applied changes |

## 7. Human gates (summary)

| Gate | Always / conditional | Approver |
|---|---|---|
| Seller verification (ownership, co-owners, company signatory) | Conditional | Sales manager |
| Price or discount outside policy (primary) | Conditional | Sales manager |
| KYC unclear / expired / mismatch | Conditional | Sales manager |
| AML flag (any party, company or owner) | Conditional | Compliance officer |
| High-risk party (EDD) | Conditional | Compliance officer |
| AML report | Conditional | MLRO |
| Template version | Always | Legal |
| Agreement before signing (SPA, MOU, assignment, listing agreement) | Always | Legal |
| NOC mismatch or expiring | Conditional | Sales admin |
| Settlement statement (resale) | Always | Finance |
| Oqood registration / transfer submission | Always | Sales admin |
| Cancellation after offer | Conditional | Sales manager |
| Deposit cheque release on cancellation | Conditional | Sales manager |
| Refund | Always | Finance |
| Helper result, when that helper is in review mode (6.2) | Conditional | Sales officer or manager |

The copilot can propose an approval but never decide one. Nobody approves their own proposal.

## 8. Non-functional requirements

- Runs on one machine for the demo: local Postgres (database `spa`), Ollama, SPA apps; no Docker.
- Fully separate from leasing at runtime: own database, jobs, demo clock, approvals, users, cookie, and its
  own env file `.env.spa.local` (S25).
- **No cross-module UI** (S21): inside the SPA app there is no link, switcher, count or text about any
  other module. The header has only "Portal" (back to the module chooser) and "Log out".
- **Design:** `docs/spa/design.md` is the SPA design system and screen guide: the leasing app's tokens and
  components, what each screen and settings page contains, external link rules, status words and writing style (S31).
- Documents stay on the client's machines; no document goes to a cloud API.
- PII masked in logs (passport, Emirates ID, phone, title-deed and bank account numbers); uploads
  outside the repo; documents by SHA-256.
- Every approval shows the proposal, sources, rule and rules version, and helper reasons.
- Targets on the demo machine: KYC < 20 s per document; NOC/bank letter < 20 s; screening < 5 s per
  party; template reading < 60 s for 30 pages; agreement prepare < 10 s.
- Restart-safe: killing the engine loses no job and sends no email twice.

## 9. Metrics

| Metric | Definition |
|---|---|
| Listing → offer | Days from listing agreement signed to accepted offer |
| Offer → signed agreement | Days from offer to last signature |
| Signed → transfer / registration | Days from last signature to title deed or Oqood issued (by deal type) |
| Waiting on NOC / banks | Days a deal spends in `NOC` and `FINANCE` |
| Fields filled correctly | Share of agreements legal did not return |
| Registration rejection rate | Rejections / submissions |
| AML flag outcomes | Cleared / more info / stopped / reported; days to decide |
| Instalments overdue | Days overdue per open instalment |

## 10. Demo script (pitch)

1. Portal → Sales / SPA. Company set to "both". Dashboard shows primary and resale deals.
2. Admin uploads an SPA template and an MOU template → structure read → legal approves both.
3. **Primary:** two fictional buyers book unit B-1204 from the developer → booking amount paid by a company →
   AML flag → compliance asks for documents, then clears → SPA prepared (purchaser block twice) →
   legal approves → sign → Oqood mock: name-case rejection → auto-fix → issued.
4. **Ready resale:** a fictional individual lists apartment 1803 with a title deed and a mortgage →
   permit recorded, listing page published → a company buyer's offer is accepted by the seller's link → company checks (licence, signatory, owners) → MOU from the MOU template
   → signed, 10% deposit cheque recorded → NOC uploaded and read → liability letter read, payoff confirmed →
   settlement statement approved by finance → trustee transfer (simulated) → new title deed.
5. Demo clock +14 days → instalment reminder on the primary deal → copilot: "What is deal R-0021 waiting for?"

All people, companies, IDs, banks and lists in demo data are fictional.

## 11. Open questions

- Confirm with legal: DLD transfer/registration fee (4%) and who pays, trustee and mortgage-registration
  fees, Oqood transfer fee, MOU and assignment default wording, tipping-off wording.
- Confirm with compliance: beneficial-owner threshold (25%), cash threshold, name-match threshold,
  high-risk list, re-screening points, whether sellers' source of funds is needed.
- Developer NOC rules per developer (minimum paid % for off-plan resale, validity days, fee).
- Can a developer client also issue NOCs for resales of its own units from this system later?
- Brokers: assumed both sides can have an agent (same or another agency) with commission % and split per
  side, shown in the settlement. Confirm.
- Advertising permit: who applies for it (outside the system), and should an expiring permit alert the agent N days before?
- Offer validity default (days) and whether the buyer must confirm the offer by link too.
- Real screening provider; real Oqood/DLD and trustee access.
- Brokers on the other side: emailed links enough, or a login later?
- Arabic agreements: read only, or also generate? Title deeds and NOCs are bilingual: are English fields enough for the checks?
- Representatives (POA holders) for individual buyers and sellers: when to add (S28)?
- Default handling beyond the flag: notices, termination, deposit forfeiture (S27).
- Escrow account numbers per project: entered by the admin, or read from the escrow agreement?
- Parties sometimes reply to emails instead of using the portal: read those replies (a classifier) later, or tell them to use the link?
