# Decisions

Short records of choices already made. Add new ones at the bottom; supersede rather than edit.

## D1 — The Manager is deterministic TypeScript, not an LLM or a LangGraph graph
Leasing has fixed legal deadlines and needs a traceable order of steps for the RDC. LangGraph
has no durable months-long timers. LangGraph is used inside helpers only.

## D2 — Durable timers with pg-boss on the same Postgres
Jobs survive restarts and live next to the data. Every job has a `singletonKey`. A `deadlines`
table mirrors milestones for UI and idempotency.

## D3 — Time behind a `Clock` interface
Needed for correct Asia/Dubai dates and for the demo fast-forward. No `Date.now()` in domain code.

## D4 — Versioned rulebook; models never compute legal or money values
Rules change (SRI replaced the rent calculator in Jan 2025). Each lease and decision records
`rulesVersion`.

## D5 — Local models through Ollama, behind an `Llm` adapter
Tenant IDs stay on the client's machines. The adapter allows a client API key later.
Models: a Qwen chat model, a Qwen vision model, `tev1` for decisions (tags in env).

## D6 — Decision model via `ollama.systemone()` (`ollama` npm ≥ 0.6.4)
Typed `choice` / `noul` / `score` answers with probabilities. Called inside LangGraph nodes so
routing stays deterministic. `kev` optional; its tags target Apple Silicon (MLX).

## D7 — Telegram for enquiries only; email (Nodemailer SMTP) for everything outbound
No WhatsApp API keys yet and it is paid; the Telegram Bot API is free. Telegram handles step 2
(enquiries, viewing booking). All notices, reminders and links go by email with stored evidence.
Tenant actions use signed links to `apps/web`. WhatsApp can later replace or join Telegram via the
same `EnquiryChannel` interface. The 12-month repossession notice goes by notary or registered mail.

## D8 — Unit, Application and Lease are separate state machines
Steps 1–2 happen before a lease exists; one unit has many applications over time.

## D9 — Ejari is mocked behind `EjariAdapter` for the MVP and pitches
Mock rejects realistic errors so the auto-fix path can be shown. Labelled "Simulated Ejari (demo)".
The real DLD integration needs a registered property management company.

## D10 — Bun workspaces monorepo, Drizzle, Hono, Next.js, Biome (lint part superseded by D16)
One language and runtime across engine, bot, mock and web.

## D11 — Product packaging: engine first, AI tools as front doors
Sold self-hosted or hosted from one codebase. MCP server in phase 5; optional Claude plugin wraps
it. No feature depends on a client's chat subscription.

## D12 — Money as integer fils; legal dates as `date`
Avoid float errors and timezone drift.

## D13 — Postgres installed locally; no Docker in development
Simpler on the dev machine. Containers stay optional for hosted deployments later; the code
must not depend on them.

## D14 — Tenant portal + inbound events instead of email replies
Tenants act through forms in `apps/web` (`/t/<token>`, magic-link access). Each submit is stored
in `inbound_events` and processed by the Manager through a pg-boss job, so forms return
instantly and model calls retry safely. Staff can submit the same forms on a tenant's behalf.

## D15 — Staff copilot alongside the deterministic engine
We considered letting one LLM agent run the whole lifecycle with tools. We rejected that for
the core: it is not repeatable or traceable enough for legal deadlines, Ejari matching or RDC
cases. Instead, a **staff-facing copilot** sits beside the Manager. It helps leasing staff
with the long tail of exceptions: why a lease is stuck, what is due, drafting replies,
summarising a case and preparing approval notes.

The copilot is a front door, like the web UI, not a helper in the pipeline. It reaches the
system only through engine API tools and acts with the logged-in user's permissions. It can
read, draft and propose. It can never approve a gate, send outbound messages, change state or
produce a legal or money value itself; those values come from rulebook tools. The MCP server
(phase 5) exposes the same tool registry, so there is one set of tools and one set of
safeguards. See `docs/architecture.md` §8b.

## D16 — oxlint + oxfmt instead of Biome (supersedes the lint part of D10)
Chosen at the start of Phase 0. oxlint (lint) and oxfmt (Prettier-compatible formatter) are
fast and cover TypeScript, React and Next.js rules. `bun run lint` runs both plus
`scripts/check-domain-rules.ts`, a repo guard that fails on `Date.now()` / `new Date()` in
domain code and on code that references `data/uploads`. TypeScript stays on 5.x.

## D17 — Phase 0 engine conventions
- **Milestone keys carry the term:** `deadlines.milestone = "<id>@<leaseEnd>"`, e.g.
  `notice_send@2027-03-29`, so a renewed lease gets fresh milestones without breaking
  `unique(entity_id, milestone)`. pg-boss `singletonKey = "<leaseId>:<milestone>"`.
- **Firing is one transaction:** `pending → done` and the milestone's work commit together; a
  retry re-runs all or nothing. Due deadlines are swept oldest first.
- **Gated transitions consume an approval:** a transition with a `gate` needs an approved,
  unused approval of that gate for the entity; using it stamps `consumed_by_event_id`.
  Approvals may carry `on_approve_event`, applied as the approver when a person approves.
- **No self-approval:** the person (or their copilot) who proposed an approval can't decide it.
- **Edits are re-checked:** each gate declares its editable fields and a rulebook check
  (`apps/engine/src/manager/gate-rules.ts`); without an SRI value only same-rent renewal passes.
- **Parties:** `parties.kind` is `individual | company`; a party's role comes from
  `lease_parties.role` (tenant, landlord, occupant).
- **Staff auth:** Phase 0 has demo login only (HMAC session token, 12 h). Real staff login is
  required before any client pilot.
- `lease_events` is append-only (no UPDATE, DELETE or TRUNCATE), enforced by database triggers.
- **Landlord-side endings only via repossession:** no ungated "not renewed" event; `TERMINATED`
  needs an approved 12-month repossession notice and takes effect at lease end.

## D18 — Staff app design and unit media
- The staff app ("Dubai Leasing") uses vanilla CSS design tokens in `apps/web/app/globals.css`
  (light and dark), Instrument Sans for the interface, Bricolage Grotesque for display and Geist Mono
  only for reference numbers. One accent (leaf green); saffron only for deadlines, brick only
  for errors. No component library.
- Unit photos are not tenant documents: stored under `MEDIA_DIR`, content-addressed, served to
  signed-in staff only. Uploads go browser → web route handler → engine (not server actions),
  so photo size isn't limited by the action body limit.

## D19 — Renewal notices: sent counts, demo mail is redirected
- **A rent increase stands only if its notice was sent in time:** the notice email must be
  accepted by SMTP on or before T−90 (Asia/Dubai date). Approval is not notice. The T−90 check
  runs on T−89 because T−90 is still a legal send day. CONFIRM WITH LEGAL that SMTP acceptance
  counts as written notice; the acknowledgement link and follow-up task are the backstop.
- **Demo mail never reaches demo addresses:** in `DEMO_MODE`, every email goes to
  `MAIL_DEMO_RECIPIENT`; the intended recipient is kept in the subject, a header and
  `outbound_messages.intended_to`. Demo wording on notices and emails appears only in demo mode.
- **Ethereal previews are public URLs.** Fine for fictional demo data, never for real tenants.
- **The renewal helper is pure code** (rulebook cap + SRI lookup). The decision model only
  classifies tenant comments; flagged comments go to a person and hold a move-out.
- **SRI values are per term and four-eyes:** a lease override applies to one term, and the
  person who entered it can't approve the notice it caps. The SRI table is edited by admins and
  managers; an audit history of table edits is a follow-up.

## D20 — Copilot v1: in-process, read-only by construction
- **The engine hosts the copilot and its tools call the engine's own API in-process**, with the
  user's session token (`app.request`). Every tool call goes through the same auth middleware,
  routes and role checks as the staff UI, without an extra network hop. The MCP server will use
  the same tools with an HTTP client.
- **v1 can't write, by construction:** the `EngineClient` has only `get`. Draft and propose
  tools (phase 2) will add a separate, explicit method together with the Confirm step.
- **Unverified values are found by a text post-check**, not by trusting the model: AED amounts,
  percentages and dates in the answer must match a value in that turn's tool results (or the
  user's question). It checks values, not reasoning; a value from the wrong field still matches.
- **Conversations are private to their author** and stored with tool arguments and result
  hashes, not the results themselves (they can be regenerated and may contain personal data).

## D21 — Applicant KYC: the model reads, code decides
- **The vision model only reads documents** (one call per image, JSON schema, temperature 0); the
  verdict is pure code (`packages/helpers/src/kyc/checks.ts`): Emirates ID format and Luhn,
  passport MRZ check digits, expiry against the planned lease start, and names across documents.
  "Verified" only when nothing is flagged; everything else goes to a leasing officer.
- **The MRZ wins over the printed page.** Fields read from a valid MRZ are used; a printed value
  that differs is a flag. Miscounted `<` fillers are repaired, but the check digits still decide.
- **No expired document passes**, ever: it is a blocking flag that the gate rule refuses to approve.
- **Identity is copied, never typed:** `KYC_VERIFIED` copies the verified fields onto the party
  (the name exactly as on the ID), which is what Ejari will match in phase 2b.
- **Fictional specimens only** for tests, evals and the demo (`packages/helpers/src/kyc/evals/specimens/`,
  generated, plain layouts marked SPECIMEN). Real documents live only in `UPLOADS_DIR`.
- **Documents are private:** served to leasing officers and managers only, never cached, each view
  recorded (`DOCUMENT_VIEWED`); the copilot can't reach them. ID numbers are masked in every view.
- **Conditional gates live in the Manager** (`advanceApplication`), not in the state machine: the
  same event (`KYC_VERIFIED`, `OFFER_REVISED`) is gated or not depending on the evidence.
- **Offers come from policy:** rent = approved asking rent, deposit and reservation as policy
  percentages, 12-month term from the move-in date. An applicant's counter becomes a new revision;
  nothing is agreed until the applicant accepts and the reservation is recorded by a person.


## D22 — Contract, signing and Ejari: copy, approve, sign, register, fix once
- **The contract is copied, not written.** Pure code copies every field from its record and
  keeps a source per field; tests check the fields against their sources character for
  character. The chat model only flags the staff-written free-text addendum (conflict, unclear,
  illegal term) for the approver and never edits text. The PDF is a demo template written for
  this product, not the DLD form.
- **Approval before signature, consumed by the signature.** `final_contract` is approved before
  any link goes out and consumed only by `CONTRACT_SIGNED` once everyone signed. Approving
  re-checks that the records and the stored PDF are exactly what was prepared. A new version
  supersedes the old one, cancelling its approval and its links.
- **E-signature is built in for the MVP.** Each party (the landlord too) gets a single-use portal
  link, types their name and consents; the engine stores the evidence and appends a signature
  record page to the approved PDF. `ESignAdapter` stays for a real provider later.
- **Register what was signed.** The Ejari payload is built only from the signed contract, and
  `ejari_submission` is always approved by a person while there is no live DLD access.
- **One typo-class fix, then a person.** After a rejection, tev1 maps it to a field; pure code may
  correct only the tenant's name (the landlord's is not KYC-checked), only by case, spacing,
  punctuation or accents, only from the KYC-verified name, and only once per approval (resubmitted under the same approval: the
  officer approved this data, and a case change of it is still that data). Everything else goes
  to `ejari_rejected_twice`. The signed contract is never edited (CONFIRM WITH LEGAL whether a
  case-only difference needs re-signing).
- **The simulated registry is a separate service with its own schema** (`ejari_mock` in the same
  local Postgres, as chosen for phase 2). The engine talks to it only over HTTP through
  `EjariAdapter`, as it will with the real registry; the submission id is the request id, so
  retries never register twice.

## D23 — Rulebook versions stored in the database; drafts published by admin
Supersedes the storage part of D4 (versioning and "models never compute legal or money values"
stay as they are).
- **The code version is the base.** `packages/rulebook` still defines `dubai-2025-01`. At startup
  the engine stores it as a published row in `rulebooks` (`created_by = system`) and refuses to
  start if a stored base row differs from code.
- **Drafts, then publish.** An admin copies a published version into a draft
  (`dubai-YYYY-MM-NN`), edits values, rent-cap bands, sources and free-text reference notes,
  reviews the changes against the active version and publishes it with an effective-from date
  (today or later, Dubai calendar). Only admins write; every staff role reads published versions.
- **Published versions are immutable** (DB trigger refuses UPDATE and DELETE). A lease term is pinned
  to the version **in force on the day the term starts** (`rulesVersionForTerm`: latest
  `effective_from` ≤ start date; the code base if none), for new, imported and renewed terms
  alike. An imported running lease keeps the rules it started under. `RENEWED` is checked under
  the lease's pinned version, then re-pins the new term (`nextTermRulesVersion` in the event).
  Every published row is loaded into the in-memory registry, so rule lookups stay synchronous
  and by version. Confirm the start-date rule with legal before real use.
- **Loosened protection needs legal review.** If a draft gives tenants less protection than the
  base (shorter notices or locks, fewer late-rent days, a higher cap for any gap), publishing
  needs `confirmLegalReview: true` ("a Dubai property lawyer reviewed these changes"), recorded
  in the `RULEBOOK_PUBLISHED` event.
- **Structural checks keep the engine safe** for any valid version: bands strictly ascending,
  values in range, send day ≥ legal notice, milestones in order.
- **Reference notes are data.** Company-authored notes are shown to staff and returned by the
  copilot's `explain_rule` as untrusted text. No code reads them to decide anything.
- **One engine process per database for now.** A version published in one process is registered
  there; another process loads it at its next start.

## D24 — Telegram enquiries: the engine owns the conversation; code drives, models read
Phase 3. Refines D7 and the Leasing Assistant row of architecture §5.
- **The bot is a stateless relay.** `apps/telegram-bot` posts each private-chat update to the
  engine (`POST /channel/telegram/updates`, shared `CHANNEL_SECRET`) and sends the reply back to
  the chat that update came from. Conversations, flow state, helper runs and bookings live in the
  engine, so the Manager stays the only writer and one customer's state can't reach another.
  Officers' replies go out from the engine through `TelegramSender`.
- **Code drives the flow; the chat model only answers.** On the demo GPU `qwen3.5:9b` takes about
  20 s per answer, and a tool-calling assistant could quote prices. So commands, buttons, search,
  slots, name and email are code, with fixed English/Arabic replies. tev1 classifies free text and
  decides nothing by itself: routing is code. The chat model answers only questions: about the
  unit the customer picked (its listing facts) or general ones (`general_question`: the listed
  units without prices, plus a fixed note on how renting works). It never sees a price; an
  answer that talks about money, or has a number or percentage not in its facts, is replaced
  by a fixed line.
- **Contact first.** Each enquiry starts with an email (required) and a phone (optional), so
  every enquirer can be identified and followed up even if they never book. Free text isn't read
  by a model until the email is given. A matching existing party is linked for staff only.
- **No lock during model calls.** A free-text message is stored under a row lock, the model runs
  unlocked, and the result applies only if the customer's `flow_version` is unchanged.
- **Viewing slots come from company policy** (days, hours, slot length, lead time, horizon;
  placeholders until the client sets them). **One viewing per slot per unit, for staff and
  Telegram alike:** every booking locks the unit row and is refused if it falls within
  `viewingSlotMinutes` of another booked viewing; a partial unique index is the backstop. Staff
  may still book outside the bot's viewing hours.
- **Handoff is not an approval gate.** Commercial, VIP, complaint, injection, low confidence,
  "talk to a person" and existing tenants go to a leasing officer as an `enquiry_handoff` task;
  the bot then stays quiet on free text until an officer hands the conversation back.
- **New entity kind `conversation`** for events, helper runs and tasks before an application
  exists; it has no state machine.
- The Arabic copy needs a native speaker's review before a client pitch.

## D25 — The copilot can create an application, only on the user's Confirm click
Amends D15/D20 and AGENTS.md rule 11 for exactly one action. Phase 3, at the product owner's
request: the copilot is a second entry point for new applications, next to Telegram. It is not
a messaging channel (rule 10 is unchanged): it talks only to staff, and on Confirm the
application's own email path sends the viewing invitation.
- **Read, then propose.** `find_available_units` (read, every staff role) lists bookable units
  (listed, settled price, no lease being signed; the same rule as the bot, `availability.ts`)
  with the approved asking rent and the next free viewing slots. `propose_application`
  (leasing officer and manager, as for `POST /api/applications`) validates the unit, time, slot
  clash and duplicate application, then stores a row in `copilot_proposals`. Proposing creates
  no application and sends no email; Confirm does both. The applicant's email and name must
  appear in the user's own messages in the thread, so tenant text can't put someone on the card.
  The tool returns no name or email to the model; the card shows them.
- **Audit:** `copilot_proposals` is the record of every proposal (pending, cancelled, failed,
  expired) and `copilot_messages` stores the tool call; a confirmed proposal adds
  `APPLICATION_CREATED` (actor `copilot:<userId>`) and `COPILOT_PROPOSAL_CONFIRMED` (actor
  `user:<userId>`, with the proposal id) on the application.
- **Only the user's click creates.** The chat shows a card with Confirm and Cancel. Confirm
  (`POST /api/copilot/proposals/:id/confirm`, staff UI only) works for the user who made the
  proposal, once (row lock), within 30 minutes, and re-runs every check through
  `createApplication` (source `copilot`, actor `copilot:<userId>`, plus a
  `COPILOT_PROPOSAL_CONFIRMED` event by `user:<userId>`). A check that fails now marks the
  proposal `failed` and nothing is kept.
- **The client can't confirm.** `EngineClient.propose` posts only to
  `/api/copilot/proposals` (with the thread id); confirm, cancel and every other write route are
  refused before a request is made. Phone numbers are masked before the model sees them, so the
  copilot doesn't take them; staff add them in the application.
- `create_task` and `propose_approval` (copilot v2) reuse the same proposal and Confirm step
  (D26).

## D26 — Copilot v2: tasks and approval requests on Confirm; drafts the user sends
Extends D25 and AGENTS.md rule 11. Phase 3.
- **Two more proposal kinds.** `create_task` (leasing roles, as `POST /api/tasks`) and
  `propose_approval` (`formal_reminder` for a payment: leasing roles and finance, as the
  Payments panel; `vacate_notice` for a lease: leasing roles) store a `copilot_proposals` row with
  `kind` `create_task` or `request_approval`. Proposing creates nothing. Confirm (owner, once,
  30 minutes) runs the same engine function as the UI (`createStaffTaskTx`, `requestApproval`
  after the gate's own checks) as the user, with `copilot:<userId>` as creator or proposer and a
  `COPILOT_PROPOSAL_CONFIRMED` event. A confirmed approval request is only a pending approval:
  approving stays in the inbox, and the person who proposed it can't approve it.
- **Drafts are never sent.** `draft_email` (leasing roles, finance) and `draft_approval_note`
  (any staff) save a `copilot_drafts` row in the user's thread. The chat card opens the normal
  form, prefilled; the person edits and clicks Send (mail adapter, evidence, template
  `staff_message`) or Post. A draft is used once, by its owner. The 12-month notice is never an
  email draft.
- **Client limits.** `EngineClient.propose` may POST only `/api/copilot/proposals` and
  `/api/copilot/drafts`. Payments and complaints are readable (`list_payments`,
  `list_tickets`); photos and proofs are not.
- **Why:** staff asked the copilot to do the follow-up work it already explains. Each action
  still needs a person's click on a card that shows exactly what will happen.

## D27 — Collections: finance confirms every payment; only a sent formal reminder starts the clock
Phase 3, product owner's choice.
- The instalment schedule is pure code (`paymentSchedule`); nothing is marked paid by the system
  or a model. Finance (or a leasing manager) records paid or bounced. Imported running leases
  assume earlier instalments paid, flagged, with a finance check task; finance can still record
  one of them as bounced, which reopens it (audited).
- Reminders are fixed templates (no model wording). After `friendlyRemindersBeforeFormal`
  friendly reminders, a `formal_reminder` approval (leasing manager, always) is drafted; the
  proposal's late-rent days must equal the lease's rulebook.
- The eviction-eligible date is the SMTP-accepted send date (Dubai) plus
  `lateRentDaysAfterFormalReminder` from the rulebook pinned on the lease. When it passes, a
  manager gets a task. The system never starts RDC action. CONFIRM WITH LEGAL that an emailed
  formal reminder counts as notice; a reminder served by notary or courier is recorded by a
  person outside the system for now.
- Payment replies from the portal never change amounts or dates; "paid" goes to finance to
  verify.

## D28 — Complaint acknowledgement: Qwen writes it, code checks it, a template backs it
Phase 3, product owner's choice.
- Complaint Triage classifies with tev1 and routes in code (escalate, review, ticket). The
  acknowledgement is written by the chat model from the category and urgency band only; the
  tenant's text never reaches it, so it can't be steered by the complaint.
- `checkAck` drops any text with a number, time word, money word, promise or commitment
  ("will fix", "we'll", "shortly", "free", "refund", "rent reduction", URLs and emails; Arabic
  equivalents). Then, or when the model or the helper fails, the fixed EN/AR template is sent.
  The tenant always gets an acknowledgement from the portal; it is sent automatically because
  it promises nothing.
- Safety and legal-threat reports go to an officer at once (`safety_complaint` approval + task);
  approving opens an emergency ticket.


## D29 — Move-out and deposit: the model points, code prices, finance acts on every refund
Phase 4, product owner's choice.
- **The local vision model may compare condition photos** (amends D21, which limited it to
  reading ID documents). Per room, the latest move-in and move-out staff photos go to the local
  Ollama vision model in one call; never to a cloud API. Its options are the price-list item ids
  plus `none`; it never gives an amount. Below `exitVisionMinConfidence`, `none` or an unknown id
  is dropped. Results are suggestions: nothing is a deduction until an officer confirms it.
- **Amounts are code.** A deduction is a `companyPolicy.deductionPriceList` item × quantity at the
  list price (policy, not law), or an "other" amount an officer types, which always needs
  finance's approval. Deductions are capped at the deposit; anything beyond is a manager task,
  never claimed automatically. Normal wear and tear is not deductible. Unpaid rent is not
  deducted (CONFIRM WITH LEGAL).
- **Finance acts on every refund.** The `refund` approval (finance) is required when the refund is
  above `refundApprovalThresholdFils`, the tenant disputes the statement, or an amount isn't on
  the price list; nothing in it is editable (reject → the officer corrects the findings and
  issues a new revision). In every case finance records the payout (date, bank reference),
  which settles the deposit. A zero deposit is recorded the same way. Approving a disputed
  statement pays the stated refund and lets the lease close; the tenant's recourse is the RDC
  (CONFIRM WITH LEGAL). Finance alone reads the tenant's refund account (kept only in the
  submission), each view recorded without the details; dispute text is stored masked.
- **Notice to vacate** opens `vacateNoticeOpensDays` (policy, 150) before the lease end, so a
  lease isn't put in MOVE_OUT months ahead; it offers only the lease end. Another date is an
  early-termination request for a manager (contractual); a comment that needs a person holds it,
  as with the renewal reply. Whether a tenant owes a minimum notice period is CONFIRM WITH LEGAL.
- **Ejari is cancelled automatically** once the inspection is done and the move-out date is
  reached (job, idempotent, retried while the registry is down; a person is told). Not on the
  human-gate list; CONFIRM WITH LEGAL that no person needs to approve it. Settled
  deposit + cancelled Ejari → `SETTLED` → `CLOSED` → unit `PREP`.

## D30 — Customer web chat: logged-in customers, same enquiry engine
Superseded in part by D31: the accounts, login codes, records and upload parts were removed; the web chat is public.
Slices 1 (accounts, login, enquiries, viewings) and 2 (records, KYC uploads) are built.
Product owner's choice.
- **Customer accounts.** Table `customer_accounts`: id, email (unique, lowercased), full_name,
  phone (+E.164, nullable), role (`customer`), session_version, created_at, last_login_at.
- **Login codes.** Table `customer_login_codes`: hashed (sha256 + server pepper), valid 10 min,
  5 wrong tries kill the code, at most 5 codes per email per hour. A new code voids older ones.
  The answer is always "if the address is valid we've sent a code". Clock-based expiry. Sent
  through the mail adapter (template `login_code`, entity kind `customer_account`). The adapter
  already stores only a body hash; the email subject never contains the code, so staff reading
  `outbound_messages` can't see a live code. Code requests are also limited per IP (20 an hour,
  in memory, from `x-real-ip`, else the rightmost `x-forwarded-for` hop (the one our proxy adds), forwarded by `apps/web` server actions:
  the engine must not be exposed directly, or the per-IP limit can be spoofed; the per-email
  limit still holds). Deployment requirement: the web app must sit behind a reverse proxy that
  overwrites `X-Forwarded-For`, and the engine must not be publicly reachable. Documented, not
  redesigned.
- **Masked history.** Chat text is stored PII-masked (rule 8), so customers see masked IDs and
  phone numbers in their own history after a reload.
- **Session.** HMAC token `{aid, aud:"customer", sv, exp}` signed with `SESSION_SECRET`.
  `requireUser` rejects any token with `aud` and `requireCustomer` requires it. 30 days.
  httpOnly cookie `leasing_customer`, separate from the staff `leasing_session`. Logout bumps
  `session_version`: signed out on every device.
- **Records.** An account sees the applications and leases of every party whose `email` equals
  the account email (lowercased), matched at query time. Applications match
  `applications.party_id`. Leases match `lease_parties` with role `tenant`. If nothing matches,
  the chat behaves as for a prospect and never says "no records for this email" (it asks the
  area question). Shown: applications not CONVERTED, REJECTED or WITHDRAWN; leases not CLOSED
  (MOVE_OUT and DISPUTE stay listed). A lease card carries start, end and the next unpaid
  payment (scheduled, overdue or bounced; date and `formatAed` amount). Stage names, dates and
  amounts come from stored fields and fixed code maps, never a model. An application in
  SCREENING with an unused, unexpired `kyc_upload` link shows "needs documents". The reply lists
  at most 8 records as buttons (plus the two menu buttons); one record is shown directly.
  On web, intent `existing_tenant` as the only handoff reason shows the records; any other
  reason alongside it (complaint, injection, low confidence) still gets the fixed decline.
- **Conversations.** `conversations.channel` gains `web`. One web conversation per account:
  `external_chat_id` = account id, new nullable `customer_account_id` FK. Status is always
  `bot`. The flow goes back to `idle` after each booking. The web chat never hands over: no
  `enquiry_handoff` task, no `handoff` status; where Telegram would hand off, the customer gets
  a fixed autopilot reply. Staff can't reply into a web conversation (`staffReply` refuses it).
  The Telegram route rejects any update whose channel isn't `telegram`.
- **Search questions.** Code asks area, then bedrooms, then furnished (buttons), before showing
  unit cards. Rent on a card is the approved asking rent, formatted by code.
- **Actor.** `customer:<accountId>` (actors are plain strings, as with
  `enquirer:<conversationId>`).
- **Applications** from the chat use `source: "web_chat"` and reuse or create the party the way
  `createApplication` already does.
- **Uploads.** The engine finds the application's open `kyc_upload` link and calls the existing
  `addApplicationDocument`, `removeApplicationDocument` and `receiveInbound` (`DOCS_UPLOADED`)
  with it. This is one code path with the portal. `inbound_events.channel` gains
  `customer_chat`. Routes `GET`/`POST /api/customer/applications/:id/documents`,
  `DELETE …/documents/:docId`, `POST …/documents/submit`. Order of checks: ownership (404 for
  anyone else's application), then an open link and state SCREENING (409), before any body is
  read. A second submit is 409 (link used), as in the portal. The web route streams the body
  to the engine, requires a same-origin request and a `content-length` (411 without, 413 over
  10 MB).
- **Demo sign-in.** In `DEMO_MODE` only, the `login_code` outbound row keeps `previewUrl` and
  `GET /api/demo/customer-sign-in-emails` (staff roles) lists the latest 10 (address, sent time,
  Ethereal preview link) on the demo console, as nobody can otherwise read the code. Outside
  demo mode `previewUrl` stays null and the route doesn't exist.
- **Prompt.** The `existing_tenant` intent criterion also covers applicants and documents
  (my lease, my application, "my passport", "عقدي"). Eval 37/46 → 39/46; on Telegram this
  intent may hand off slightly more often (la27).
- **Rule 10 amendment (AGENTS.md):** the customer chat (logged-in customers, autopilot) may
  take enquiries and book viewings, show customers their own applications and leases, and take
  KYC document uploads. Everything outbound still goes by email.

## D31 — Public customer chat and property pages
Amends D30. Product owner's choice. Customer accounts, login, records and uploads are gone; the
web chat is public and works like the Telegram bot.
- **No accounts.** Migration 0017 drops `customer_accounts`, `customer_login_codes` and
  `conversations.customer_account_id`. The `/account/*` pages, the customer session and
  `leasing_customer` cookie, the `/api/customer/*` routes, the chat records and upload code and
  the demo sign-in list are removed. D30's "Rule 10 amendment" is replaced by the one below.
- **Chat = Telegram flow.** Contact first (email required, phone optional with Skip), a Change
  email button always available, the name asked at booking, then enquiries, viewings and general
  questions, with the autopilot and no handoff (fixed reply, no task, no `handoff` status; staff
  can't reply into web chats). Search keeps D30's area, bedrooms, furnished questions. No lease
  or application records, no document uploads, no email verification. Intent `existing_tenant`
  (as the only handoff reason) gets a fixed reply (EN and AR) pointing to the "My tenancy" link
  in the customer's latest email. Documents go only through emailed portal links.
- **Relay.** The browser never calls the engine. The web server sets an httpOnly random
  `leasing_visitor` cookie (UUIDv4, 180 days) and relays to `POST /channel/web/updates` and
  `POST /channel/web/history` with `CHANNEL_SECRET`, as the Telegram bot does. Conversation:
  `channel "web"`, `external_chat_id` = visitor id. Limits per forwarded client IP (in memory,
  per hour): 200 updates, 3000 history reads.
- **Public pages.** `/properties` (bookable units only: the same rule as the chat) and
  `/properties/[id]` in `apps/web`, with a floating chat launcher and `/chat` as a full page.
  Engine routes `GET /public/units`, `/public/units/:id`, `/public/units/:id/photos/:photoId`,
  `/public/units/:id/slots` and `POST /public/enquiries`, all secret-gated. Rent is formatted by
  code from the asking rent.
- **Enquiry form.** Name, email, optional phone and a viewing slot. It calls `createApplication`
  with source `web_form` and actor `enquirer:web-form:<id>` (the visitor id, or a fresh one). The
  slot must be one of the unit's free grid slots (else 409 `viewing_slot_taken`); a unit that is
  no longer bookable is 409; the same email can't hold two open requests for a unit. Limits: 10
  enquiries per IP per hour (POST) and 3 open `web_form` applications per email (429). The
  invitation email goes out as for staff bookings.
- **Photos.** The seed has none; cards without a photo show a generated placeholder (gradient and
  building name). No stock images.
- **Deployment requirement** (as D30): the web app sits behind a reverse proxy that overwrites
  `X-Forwarded-For`, and the engine is not publicly reachable; otherwise per-IP limits can be
  spoofed. A call with no forwarded address is counted under one shared "unknown" key, so a
  misconfigured proxy is still limited. The per-IP limiter uses wall-clock `Date.now()`: an
  in-memory rate limiter, not domain time (the `Clock` rule covers domain code only).
- **Known limits.** Plus-address aliases (`name+1@...`) bypass the per-email cap. All caps are
  per process and in memory: they reset on restart and aren't shared between engine instances.
- **Ejari mock.** Its registry derives from the shared demo unit list in
  `packages/core/src/demo-units.ts` (`DEMO_PROPERTIES`), which the seed also builds its units
  from, so every seeded unit registers (including MRN-1502). The name-case rejection stays.
- **Rule 10 amendment (AGENTS.md):** the public web chat, like Telegram, takes enquiries and
  books viewings only. Tenants act through emailed portal links. Everything outbound still goes
  by email.
