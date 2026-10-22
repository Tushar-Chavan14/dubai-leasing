# Product spec: Dubai leasing agents

Status: MVP / pitch build. Source: `docs/source/leasing-guide.txt`.

## 1. Problem

Leasing a Dubai unit runs through 11 steps over a year or more, with fixed legal deadlines
(90-day rent-increase notice, 12-month repossession notice, 30-day late-rent clock) and strict
data matching (Ejari rejects any mismatch between contract, ID and property records). Today
this is done by hand across spreadsheets, WhatsApp and portals. Missed deadlines cost a year of
rent increase; data mismatches cost days of re-registration.

## 2. Goal

Automate the work of each step with AI helpers, keep every legal and money decision with a
person, and never miss a deadline.

## 3. Users

| Role | What they do in the product |
|---|---|
| Leasing officer | Handles applications, reviews KYC, approves contracts, submits to Ejari (mock), runs move-in/out |
| Leasing manager | Approves rent-increase and vacate notices, offers outside limits, formal reminders |
| Finance | Approves refunds above threshold, tracks cheques |
| Admin | Configures company limits, rulebook versions (draft → publish), users, units, channels |
| Applicant / tenant | Enquires and books viewings on Telegram; receives everything else by email and acts through the links in it (uploads, complaints, renewal reply) |
| Landlord | Answers the T−13-month "sell or own use?" question (email or inbox task) |

## 4. MVP scope

### In scope

- Telegram bot for incoming enquiries and viewing booking (Arabic and English)
- Email over SMTP (Nodemailer) for all outbound communication: viewing confirmations, offers,
  contract and upload links, rent reminders, formal reminders, renewal and other notices, receipts
- Tenant self-service pages linked from emails: document upload, complaint form, renewal reply
  (Renew / Vacate / Discuss buttons), notice acknowledgement
- Unit records with readiness checklist and asking rent suggestion
- Applicant KYC from uploaded Emirates ID / passport / visa / trade licence images
- Offer within company limits; reservation payment recorded manually
- Contract generation from verified fields (demo PDF with the standard tenancy contract fields), addendum, mock e-signature
- Ejari registration, renewal and cancellation against the **Ejari mock**
- Move-in checklist with condition photos
- Rent schedule, PDC tracking, bounced-cheque handling, formal reminders
- Complaint triage and maintenance routing
- Renewal: SRI value (from a seeded mock SRI table or manual entry), legal cap, notice drafting, delivery proof
- Move-out: inspection photos vs move-in photos, deduction list, deposit refund, Ejari cancellation
- Dispute case pack (export of the lease's events, documents and notices)
- Approval inbox for every gate
- Staff copilot: a chat panel in the staff app that answers questions about leases, units and
  deadlines, drafts messages and summaries, and proposes tasks and approvals (§5b)
- Demo console: fast-forward the clock, trigger events (bounced cheque, Ejari rejection), reset demo data
- Metrics page for the five KPIs in section 8

### Out of scope for MVP

- Real DLD Ejari API, DEWA, payment gateways, bank cheque clearing
- WhatsApp (channel adapter is ready; added when API keys are available)
- Abu Dhabi rules (rulebook is per emirate so it can be added)
- Multi-company SaaS tenancy, billing, SSO
- Arabic web UI (bot handles Arabic; staff UI is English)
- Commercial leases beyond flagging them for a person

## 5. Lifecycle and features

Each step lists the helper, what it does, the human gate and acceptance criteria (AC).
"Gate" means the Manager creates an approval and pauses until a person decides.

### Step 1 — Get the unit ready (Unit: `PREP → READY`)

- Readiness checklist: title deed / DLD property number, unit number, makani number, area,
  bedrooms, furnished flag, DEWA premise number.
- **Pricing helper** suggests asking rent from SRI average and company range.
- Gate: price outside company range.
- AC: a unit can't be `LISTED` until every checklist field is filled and a price is approved or within range.

### Step 2 — Find a tenant (Application: `ENQUIRY → VIEWING`)

- **Leasing Assistant** on Telegram answers questions about listed units, shares details and photos, books viewings from available slots.
- Decision model classifies each message: intent, language, commercial/VIP flag.
- Gate (handoff, not approval): commercial enquiry, VIP flag, complaint, low-confidence intent → conversation assigned to an officer.
- The bot first asks for an email address (required) and a phone number (optional), so every enquiry can be followed up even without a booking.
- AC: a new Telegram user can ask about a 1-bed, get matching units, and book a slot; the booking appears in the web app; handoff cases show in the inbox within one message.

### Step 3 — Check the applicant (Application: `SCREENING`)

- Applicant uploads ID documents through a one-time secure upload link (not in the Telegram chat, so IDs don't sit on Telegram's servers).
- **KYC helper** extracts fields with the vision model, then deterministic checks: Emirates ID format `784-YYYY-NNNNNNN-C`, passport MRZ check digits, expiry dates vs lease start, name consistency across documents.
- Gate: unclear field, expired document, mismatch.
- AC: on the fixture set, every extracted field is either correct or flagged; no expired document passes.

### Step 4 — Agree the offer (Application: `OFFER → RESERVED`)

- **Offer helper** proposes rent, number of cheques, deposit, rent-free days, move-in date within company limits.
- Decision model classifies the applicant's reply: accept / counter / reject / question.
- Reservation payment recorded by an officer.
- Gate: any term outside limits.
- AC: an in-limits offer goes out without approval; an out-of-limits counter always creates an approval.

### Step 5 — Contract (Lease: `CONTRACT`)

- **Contract helper** fills the tenancy contract only from verified KYC fields, unit record and accepted offer; renders PDF; drafts addendum from selected clauses.
- Chat model reviews addendum free text for conflicts with the standard terms (flags only).
- Mock e-signature: each party gets a link, signs, signed PDF stored with hash.
- Gate: **always** — officer approves before sending for signature.
- AC: contract names, ID numbers and unit numbers match source records character for character (tested).

### Step 6 — Register in Ejari (Lease: `REGISTRATION`)

- **Registration helper** builds the Ejari payload. Officer clicks Submit (gate). Mock Ejari returns issued or rejected with reasons.
- On rejection: decision model maps the reason to a field; code fixes typo-class fields only (whitespace, casing, transliteration from verified source) and resubmits once.
- Gate: submission (always); second rejection → person.
- AC: demo rejection for a name typo is auto-fixed and issued on the second try; contract terms never change automatically.

### Step 7 — Move in (Lease: `MOVE_IN`)

- Checklist: Ejari number, DEWA activation (manual tick), keys and access cards handed over, condition photos per room uploaded.
- No AI. Manager moves the lease to `ACTIVE` when the checklist is complete and schedules all future jobs.
- AC: on `ACTIVE`, jobs exist for each rent due date and every renewal milestone.
- The tenant gets the move-in report with a link to confirm it or add their own photos within 7 days (policy); disagreeing creates a task for an officer.

### Step 8 — Active tenancy (Lease: `ACTIVE`)

**Collections (Payment Reminder)**
- Rent schedule from the cheque plan. Friendly reminders before due dates by email. Finance confirms every payment (paid or bounced); nothing is marked paid automatically, except instalments of an imported lease that were already due, which are flagged for finance to check (D27).
- Bounced cheque event (demo console or officer) → friendly reminder sequence.
- Formal reminder: drafted, **gate**, then sent; its send date starts the 30-day clock from the rulebook.
- Reminder emails carry reply buttons (paid / will pay by date / dispute / need time) plus an optional comment; the decision model classifies free-text comments.
- AC: no formal reminder is sent without approval; the eviction-eligible date equals send date (Dubai date of SMTP acceptance) + rulebook days; when it passes, a manager decides, nothing is automatic.

**Complaint Triage**
- Complaints come from the "Report an issue" form in the tenant portal (§5a) or are logged by an officer.
- Decision model: category, urgency (0–3), safety risk, legal threat.
- Safety risk or legal threat → immediate escalation. Otherwise a maintenance ticket (due by policy hours per urgency) and an acknowledgement written by the chat model from the category and urgency only, checked for times, amounts and promises, with a fixed template as fallback (D28).
- AC: every fixture with a safety keyword escalates; urgency within ±1 of label on ≥ 85% of fixtures; no acknowledgement with a time, amount or promise reaches a tenant.

### Step 9 — Renewal (Lease: `RENEWAL`)

Milestones (T = lease end date, Asia/Dubai), scheduled when the lease becomes active:

| When | Action | Gate |
|---|---|---|
| T − 13 months | Ask landlord: sell, own use, major works or demolition? If yes, a person handles the 12-month notice (notary or registered mail) | Person-led |
| T − 5 months | **Renewal helper**: get SRI average, compute max legal rent via rulebook | — |
| T − 4 months | Draft notice (template) to inbox | Always |
| T − 100 days | Email approved notice (PDF attached) via SMTP; store message, PDF hash and SMTP response; tenant acknowledgement link tracked | — |
| T − 90 days | Legal deadline. If no approved notice was sent: offer renewal at same rent and alert manager | — |

- Tenant replies with buttons in the notice email (Renew / Vacate / Discuss); an optional comment is classified by the decision model.
- SMTP acceptance is not proof the tenant read the notice. Unacknowledged notices after 5 days create a follow-up task for an officer (call, courier).
- Renewed → new Ejari renewal (mock), lease back to `ACTIVE` with new term and new jobs.
- AC: the rulebook cap is used in every notice; a notice can't be sent after T−90; fast-forwarding the demo clock fires each milestone exactly once.

### Step 10 — Move out (Lease: `MOVE_OUT → CLOSED`)

- Triggered by tenant notice or lease end.
- Inspection photos per room; vision model suggests differences against move-in photos (suggestions only).
- Officer confirms damage items; **Exit & Deposit helper** computes deductions from a price list and the refund.
- Gate: refund above threshold, or tenant disputes.
- Ejari cancellation (mock). Unit goes back to `PREP`.
- AC: deduction math is deterministic and tested; the unit can't be re-listed while Ejari is still active.

### Step 11 — Dispute (Lease: `DISPUTE`)

- Person-led. Product exports a case pack: timeline of `lease_events`, contract, notices with delivery proof, payments, photos, messages.
- AC: case pack contains every event and document for the lease, in order, with rules versions.

## 5a. Tenant touchpoints

After the Telegram enquiry, tenants use the **tenant portal**: pages in the web app opened from
a link in every email, no password. Officers can submit the same forms on a tenant's behalf.
Each submission is saved, then the Manager processes it in the background and emails a
confirmation.

| Step | Tenant can |
|---|---|
| 3 | Upload ID documents |
| 4 | Accept, counter or decline the offer |
| 5 | Review and sign the contract (mock e-sign) |
| 7 | Confirm the move-in condition report, add own photos |
| 8 | Report an issue with photos; reply to a payment reminder |
| 9 | Acknowledge a notice; reply Renew / Vacate / Discuss |
| 10 | Give notice to vacate; book the inspection; accept or dispute the deposit statement |

AC: every form submission appears in the lease timeline within 5 seconds of submit, the tenant
gets a reference number, and resubmitting the same single-use form creates no second event.

## 5b. Staff copilot

A chat assistant for leasing officers, managers and finance. It sits alongside the engine and
is not part of the lifecycle flow (decision D15, design in `docs/architecture.md` §8b).
Tenants never use it.

**What staff can do with it**
- Ask about any lease, unit or application: current state, why it is waiting, what is due
  next, what a helper decided and why.
- Ask about rules, e.g. "what is the maximum renewal rent for this unit?". The answer quotes
  the rulebook value and `rulesVersion`.
- Get drafts: replies to tenants, approval notes, case summaries for the RDC. Drafts are saved
  for a person to edit and send through the normal UI.
- Propose actions: create a task or put a proposal in the approval inbox. Each one needs a
  Confirm click in the chat. The approval itself still happens in the inbox.

**What it can never do:** approve or reject a gate, send email or Telegram messages, change
state, submit to Ejari, change rules or company limits, or open uploaded documents.

**Acceptance criteria**
- Every AED amount, date and percentage in an answer comes from a tool result in the same turn,
  or is shown as "unverified".
- Asked "what's available?", it lists bookable units with rent and free viewing slots. Asked to
  book one for a named applicant with an email, it shows a card; the application is created,
  and the invitation emailed, only when the user clicks Confirm (decision D25).
- A user can't do more through the copilot than through the staff UI with the same role
  (tested for each role).
- On the eval set, no prompt-injection or permission case leads to a forbidden action
  (0 forbidden actions).
- Every copilot write appears in the lease timeline with actor `copilot:<userId>`.
- Answers to read-only questions come back in under 10 s on the demo machine.

## 6. Human gates (summary)

| Gate | Always / conditional | Approver |
|---|---|---|
| Price outside range | Conditional | Leasing manager |
| Offer term outside limits | Conditional | Leasing manager |
| Final contract | Always | Leasing officer |
| Ejari submission (until real API) | Always | Leasing officer |
| Formal late-payment reminder | Always | Leasing manager |
| Rent-increase or vacate notice | Always | Leasing manager |
| Refund above threshold / disputed | Conditional | Finance |
| KYC unclear / expired / mismatch | Conditional | Leasing officer |
| Ejari rejected twice | Conditional | Leasing officer |
| Safety or legal-threat complaint | Conditional | Leasing officer |

The staff copilot (§5b) can **propose** an approval for any of these gates but can never
decide one. Its proposals use the same gate and approver as above.

## 7. Non-functional requirements

- Runs fully on one machine for the demo: locally installed Postgres, Ollama, all apps. No Docker required. No cloud calls except Telegram and the SMTP server.
- All legal dates in `Asia/Dubai`; demo clock offset applies everywhere.
- Every approval shows: proposal, source documents, rule and rules version used, helper reasons.
- Helper latency target: classification < 2 s, extraction < 20 s on the demo machine.
- PII masked in logs; uploads stored on local disk outside the repo; documents referenced by SHA-256.
- Restart-safe: killing the engine mid-run loses no scheduled job and sends nothing twice.

## 8. Metrics (from the guide)

| Metric | Definition |
|---|---|
| Enquiry → registered lease | Days from first message to Ejari issued |
| Ejari rejection rate | Rejections / submissions, per lease and overall |
| Notices on time | Share of expiring leases with approved notice sent by T−100 |
| Rent overdue | Days overdue per open payment |
| Deposit return time | Days from move-out inspection to refund |

## 9. Demo script (pitch)

1. Telegram enquiry → intent tagged → units suggested → viewing booked.
2. Upload sample Emirates ID → KYC fields extracted and checked.
3. Offer accepted → contract generated → officer approves → mock e-sign.
4. Submit to mock Ejari → name-typo rejection → auto-fix → issued.
5. Move-in checklist → lease active → future jobs listed.
6. Fast-forward 9 months → renewal notice with rulebook cap waits in inbox → approve → emailed; tenant clicks Renew.
7. Complaint "AC leaking near the socket" from the tenant portal → safety escalation with probabilities shown.
8. Fast-forward to lease end → move-out photos → deductions → refund approval → Ejari cancelled → unit back to PREP.
9. Staff copilot: "Which leases need attention this week?" → list with links → "Why is lease 88 waiting?" → explanation from the timeline → "Prepare the formal reminder" → proposal appears in the inbox for the manager.

All people and IDs in demo data are fictional.

## 10. Open questions

- Which company limits (deposit %, max cheques, max rent-free days, refund threshold) to ship as defaults?
- Rulebook values and notice templates need sign-off from a Dubai property lawyer before any real use.
- tev1 weights licence must be confirmed before shipping to clients (kev is Apache-2.0 but its published tags target Apple Silicon).
- Source of SRI values for production (manual entry vs DLD data).
- Viewing slot policy (days, hours, slot length, lead time, horizon) and the enquiry handoff thresholds are placeholders; set them with the client and from the `leasing-assistant` evals.
- Arabic bot copy (`packages/helpers/src/leasing-assistant/copy.ts`) needs a native speaker's review.
