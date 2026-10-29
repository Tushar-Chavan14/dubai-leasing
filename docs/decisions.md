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

## D32 — Companies, property types and rent bands
Product owner's choice (slice 1 of the contract AI redesign). A portfolio can hold several
companies, each with its own units and its own pricing and contract limits.
- **Companies.** New `companies` table (`name`, unique `slug`, `kind` developer, realty or owner,
  trade licence no, email, `active`). Every unit belongs to one company (`units.company_id`, not
  null). (Superseded by D44: the company is the landlord.)
- **Category and subtype.** `units.kind` is now `units.category` (`residential`, `commercial`,
  `retail`) plus an optional `subtype`. Units also carry `emirate` (default `dubai`) and `country`
  (default `AE`). Retail counts as commercial usage for the Ejari payload, the contract and the
  rulebook own-use lock (`propertyUsageFor`). The readiness checklist skips bedrooms for
  commercial and retail units. Category is locked with the other identity fields.
- **Rent rules replace the per-bedroom range.** `rent_rules` hold a band in basis points around the
  Smart Rental Index average (for example -500 to +1000) and optional AED floor and ceiling.
  `allowedAskingRange` in `packages/core` returns the intersection of the band and the AED bounds.
  This is company policy, not law, so it is not in the rulebook.
- **Choosing a rule.** The most specific active rule for the unit's company, category, emirate and
  usage wins: community, then subtype, then category. No rule, or a rule that gives no bounds,
  means no range, and then setting a price always opens `price_out_of_range` for a leasing manager
  (fail closed). No SRI row means the AED bounds alone apply. Money is integer fils; rounding goes
  toward the narrower range (minimum rounded up, maximum rounded down). The gate's reason cites
  the rule, the SRI row and the computed band.
- **Commercial and retail SRI.** `sri_averages` gain `category` and a per-sqft rate
  (`avg_annual_rent_per_sqft_fils`); `bedrooms` is null for them. The base is the rate times the
  unit's `areaSqft` (rounded). Exactly one of the per-unit and per-sqft averages is set. Without
  an area, only the AED bounds apply. The SRI unique key is now
  `(community, category, bedrooms, effective_from)`.
- **Contract rules.** `contract_rules` (company, category, optional subtype) set the offer's
  minimum and maximum cheques (1 to 12) through `applyContractRule`; with no matching rule the
  `CompanyPolicy` limits apply as before. They also store `tenures` and `clause_ids`, but in slice
  1 only the cheque limits are enforced: tenures are stored but not enforced, and units without a
  contract rule use the company policy limits (the offer's out-of-limits reason says so).
- **Rules are immutable.** A change inserts a new row with `supersedesId` and deactivates the old
  one; a delete deactivates. Rows keep `created_by`, and the superseded chain is the history. Every company and rule write also appends a `lease_events`
  row on a `company` entity (`COMPANY_CREATED`, `COMPANY_UPDATED`, `RENT_RULE_CREATED`,
  `RENT_RULE_REPLACED`, `RENT_RULE_DEACTIVATED` and the `CONTRACT_RULE_*` equivalents) with the actor
  and `rulesVersion`. Reads are open to staff; writes (companies,
  rent rules, contract rules) are admin only.
- **Import.** Unit and lease CSV imports need `?company=<slug>`; imported rows belong to that company.
- **Deprecated.** `askingRentRangeFils` stays in the `CompanyPolicy` schema so stored policies still
  parse, but nothing reads it. Use rent rules.
- **Migration 0018.** Renames `units.kind` to `category`, adds the new tables and columns, and on an
  install that already has units creates a "Default company" (fixed id
  `00000000-0000-7000-8000-00000000c001`, slug `default`) and attaches every existing unit to it.
  Installs with existing units therefore have no rent rules until an admin adds them, and every
  price change opens the gate until then.
- **Known limits.** A company's `active=false` does not affect pricing or listings yet. Dubai only:
  `emirate` is stored, but only Dubai has a rulebook.

## D33 — Agentic staff shell, agent permissions and the tenancy flag
Product owner's choice (slice 2 of the contract AI redesign). Staff work from a Home and a
Workspace; admins decide how much the agent does alone; the product ends at Ejari registration
unless tenancy operations are switched on.
- **Agent permissions.** `CompanyPolicy.autopilot` holds six booleans, defaults in
  `DEFAULT_AUTOPILOT`: `chat_viewing_booking` on, `apply_without_viewing` off, `auto_kyc_verify`
  on, `auto_send_offer` on, `auto_send_counter` on, `auto_prepare_contract` on. Admins change them
  with `PUT /api/policy/autopilot` (Settings, Agent). Each save inserts a new `company_policy`
  version (`createdBy` `user:<id>`). Saves are serialized with a transaction advisory lock so two
  parallel saves give consecutive versions and keep both changes. A save that changes nothing
  returns the current version and inserts nothing. Events cite the `policyVersion` they ran under.
  Each change also appends `AUTOPILOT_CHANGED` (entity kind `company`, id = the new policy row) with
  the user and, per toggle, `from` and `to`.
- **Locked list (rule 3 unchanged).** Not toggles, shown read-only in Settings: final contract,
  Ejari submission, an offer or price outside limits, flagged KYC, recording a reservation
  payment. A toggle only decides whether a step inside the limits waits for a person; it never
  removes a gate.
- **Held steps.** With a toggle off the step stops and an officer task appears. Offer:
  `OFFER_HELD {revision, policyVersion}` plus task `send_offer` (dedupe key per revision), for the
  first offer (`auto_send_offer`) and for an in-limits counter (`auto_send_counter`). Whether an
  offer is held is derived from the events (a held revision without `OFFER_SENT`). A manager-approved
  out-of-limits revision still sends, because a person already decided. Contract:
  `CONTRACT_PREP_HELD` plus the task "Prepare the contract"; `prepareContract` closes it. Chat
  booking: `VIEWING_REQUESTED` plus the task "Confirm a viewing time", no invitation email.
- **Send-offer route.** `POST /api/applications/:id/offer/send` (leasing officer or manager)
  sends the held offer: `OFFER_SENT {revision, expiresOn, policyVersion}`, expiry = today plus
  `offerValidDays`, the same mail key as an automatic send, task closed. `409 offer_not_held`
  otherwise. The company limits are checked again at send (policy or asking rent may have changed
  while held): outside them it answers `422 offer_out_of_limits` and opens an `offer_out_of_limits`
  approval, as the counter path does. `completeTask` refuses `send_offer` and `prepare_contract`
  (`409 use_the_action`); "Mark done" is not offered for them.
- **KYC.** With `auto_kyc_verify` off, a clean run still opens a `kyc_review` approval, with a
  non-blocking `manual_review` flag ("Automatic KYC verification is switched off."). Approving
  carries `policyVersion` into `KYC_VERIFIED`.
- **Apply without a viewing.** Enforced in `advanceApplication`: `APPLIED` from ENQUIRY is
  refused with `409 viewing_required` unless `apply_without_viewing` is on, in which case the event
  records `viewingSkipped` and `policyVersion`. VIEWING to SCREENING is unaffected. New route
  `POST /api/applications/:id/events` (body `{event: "APPLIED"}` only, leasing roles; `409
  wrong_state` unless the application is in ENQUIRY).
- **Tenancy flag.** Env `TENANCY_OPS`, default `false`. Off hides everything from move-in to
  disputes: the renewal, tenancy and tenancy demo routes are not registered; `scheduleLeaseMilestones`
  and `scheduleTermPayments` do nothing; MOVE_IN is the end state of the product with the flag off
  (nothing after it is scheduled or driven). Tenancy deadlines are **held, not skipped**: when the
  sweep finds a due deadline that `isTenancyMilestone` matches (an allowlist: renewal ids, the
  payment milestones and `move_out_date`; a new pre-move-in lease deadline must not match) it
  releases it, leaving it `pending`, and returns `fired:false`, so turning the flag on later fires it.
  For the legal renewal milestones (`notice_draft`, `notice_send`, `notice_deadline`,
  `landlord_intent`) and `lease_end` it also creates one officer task per lease and milestone ("Tenancy
  operations are off: <milestone> for lease <ref> is due", dedupe key `<leaseId>:tenancy_off:<milestone>`)
  and appends `MILESTONE_HELD` the first time only. On startup with the flag **on**,
  `backfillTenancySchedules` runs `scheduleLeaseMilestones` and `scheduleTermPayments` for ACTIVE
  leases that have no lease deadlines (idempotent: unique keys, a term with payments is left alone).
  `POST /api/inbound` with one of the eight tenancy types does not 404: the submission is stored
  through `storeInboundWhileTenancyOff` as `stored_only` with `result.needsHuman`, an `INBOUND_RECEIVED`
  event, no processing job, and an officer task "Tenant reply received while tenancy operations are
  off". match); copilot tools `compute_renewal_cap`, `list_payments`, `list_tickets`, `get_case_pack`,
  `summarise_case` and `propose_approval` (both its gates are tenancy gates) are dropped by
  `toolsFor`, and `request_approval` proposals are refused; the tenant portal move-in, payment,
  report, vacate, inspection, deposit and acknowledge pages return 404 and the lease portal home
  shows a "nothing to do" panel; the Maintenance nav item is hidden. Application, contract, signing and Ejari
  flows are unaffected. Generic staff routes (`POST /tasks`, `/tasks/:id/done`, approval notes,
  copilot drafts, `POST /leases/:id/email`) moved out of the tenancy router into `api/staff-work.ts`,
  and SRI and generated-document routes into `api/sri.ts` and `api/lease-documents.ts`, so they stay on.
- **Navigation.** Home, Workspace (with a waiting badge), Units, Settings. Old URLs redirect
  (temporary): `/inbox` to `/work?view=waiting`, `/inbox/:id` to `/work?approval=:id`,
  `/applications/:id` to `/work?kind=application&id=:id`, `/leases/:id` to
  `/work?kind=lease&id=:id`, `/conversations` to `/work?stage=Enquiry`, `/copilot` to `/`,
  `/rules` to `/settings/rulebook`, `/sri` to `/settings/rent-index`, `/import` to
  `/settings/import`, `/demo` to `/settings/demo`. Metrics has no nav item (`/metrics`).
- **Home and Workspace.** Home: five tiles (viewings today, offers out, awaiting signature, Ejari
  pending, waiting for you), the copilot, earlier conversations and "Agent did today"
  (`GET /api/home`, at most 8 agent or system entries from today in Dubai). Workspace lists live
  records by stage (`GET /api/records`, filters `view`, `q`, `stage`, `mine`) with a log per record
  (`GET /api/records/:kind/:id/log`). The log merges four sources: events, approvals, emails and
  tasks. One entry per approval and per task; the matching events are suppressed. Buttons come only
  from the entry's `actions`, filtered per user with the same rules as the routes (an officer never
  sees Approve on a manager gate; Edit only when the gate has editable fields). `waitingForYou`
  on Home sums the same per-row item counts as `waitingForMe` on the list.
- **Saved views.** `saved_views` table (migration 0019): per staff user, name 1 to 40 characters
  unique per user, filter `{stage, q, mine}`. Routes `GET/POST /api/views`, `DELETE /api/views/:id`.
- **Theme.** Light, dark or system switch in the staff top bar. A `leasing_theme` cookie sets
  `data-theme` on `<html>` on the server, so there is no flash. Tokens are plain values on `:root`
  with `light-dark()` versions inside `@supports`, so older browsers get light.
- **Seeded stages.** The demo seed has applications at Enquiry, Viewing, Documents, Offer (sent
  and held), Contract (prep held, awaiting signatures), Ejari pending and Registered. Reserved is
  transient (the application converts in the same transaction), so that group is always empty and
  the Workspace hides empty groups.
- **Viewing outcome and next step.** A VIEWING application whose `viewingAt` has passed shows a
  pending log entry with `record_viewing_outcome` (leasing roles only). In the Contract stage with the
  contract sent, `nextStepFor` says "Waiting for the signers." Task kinds `send_offer`,
  `prepare_contract`, `record_reservation` and `landlord_intent` never get "Mark done".
- **Demo companies.** The seed has five companies; Sobha Realty and Modon Properties were added with
  two or three fictional units each, rent and contract rules and SRI rows. Company names may be real
  for pitch realism; all units, people, numbers and rules in the demo are fictional and do not
  represent those companies.
- **Known limits.** Registered demo leases have no Ejari certificate document. `getCompanyPolicyVersion`
  orders by version, so a future-dated version would shadow a current one. A held `send_offer` task is
  not closed if the application leaves OFFER another way. The in-limits counter is recognised by actor
  `helper:offer`. Workspace and Home load unbounded sets (fine for a demo portfolio, not at scale).
  The detail pane reuses the full-page components (their heading is an h2 when embedded); Edit opens the full form rather than
  editing inline. The theme switch is in the staff app only (portal and public pages follow the cookie).
  Inline approve, send offer and prepare contract were not click-tested in a browser.

## D34 — Public customer section, chat search, Apply now and chat status check
Amends D31. Product owner's choice (slice 3 of the contract AI redesign). The public chat grows
from "enquiries and viewings" to search, applying and a read-only status check, still without
accounts.
- **Customer section.** The public pages live under `/customer`: `/customer/properties`
  (server-rendered grid, chips are links that change the URL query), `/customer/properties/[id]`
  and `/customer/chat` (full page), with a shared layout and nav. `/properties`,
  `/properties/:id` and `/chat` redirect (307) to the new URLs. Cards link to the detail page and
  to `/customer/chat?unit=<id>` ("Ask about this in chat"). The floating launcher is a link to
  the chat page.
- **Search steps and `filters`.** Web search asks emirate (Dubai open; Abu Dhabi and Sharjah are
  disabled "Coming soon" buttons), area, category, then bedrooms (residential) or a size band
  (commercial and retail), then an optional budget (chips built by code from the matching units'
  asking rents, skipped when there is nothing to choose). Every web reply carries `filters`
  (`ChatFilters`) beside `reply`, so the grid can follow the chat. Telegram stays residential-only
  and sends no `filters`. `GET /public/units` takes `category`, `community`, `bedrooms`, `size`
  and `budget` (Zod-validated).
- **Apply now.** A unit card shows "Apply now" only when the `apply_without_viewing` toggle is on
  (a forged `apply:<unitId>` is refused when it is off). The chat asks the name, then calls
  `createApplication` (source `web_chat`) and `applyWithoutViewing`; the upload-link email goes
  out as for a viewing booking. The unit must still be bookable, and the same email can't hold
  two open applications on a unit.
- **Company applicants.** For a commercial or retail unit the applicant is a `company` party:
  the chat asks the company name (it becomes the party name, so KYC compares it with the trade
  licence) and then a contact person, recorded in the `APPLIED_FROM_CHAT` event.
- **One cap of 3.** Open applications per email are capped at 3 across the web form (`web_form`)
  and the chat (`web_chat`), through one shared helper in `manager/applications.ts`. Telegram is
  unchanged.
- **Status check.** The visitor taps "Check my applications" (or asks in free text; D36). The
  chat emails a 6-digit code (`crypto.randomInt`), valid 15 minutes, 5 attempts. Only
  `HMAC(key, id + code)` is stored in `visitor_verifications`; the key derives from
  `SESSION_SECRET`. The email job (`chat.code`) carries the code sealed with AES-256-GCM (key also
  derived from `SESSION_SECRET`), and the queue deletes completed jobs after an hour, so no
  plaintext code sits in the database or the queue. A typed code is stored as "(code entered)".
  Limits: 3 codes per email per hour (advisory lock, so parallel chats can't race it) and 20 per
  IP per hour. The reply before verification is always neutral ("If that email has applications,
  we sent a code") whether or not the email has records; mail goes out only when the email has an
  open application or a lease in the pipeline.
- **Session.** A verified session is bound to the conversation and the email it holds, lasts 24
  hours, and ends on "Change email". Another visitor cookie has no session.
- **What is shown** (the product owner's decision): the five stages (Viewing, Documents, Offer,
  Contract, Ejari) with done, current and todo, a next-step sentence, and for an offer or a
  lease the annual rent and the number of cheques (formatted by code from stored values). At
  most five items. Status details are returned in the response only; the stored message says
  "Your applications are shown here".
- **Re-send buttons.** In a verified session a record belonging to the session email can offer
  "Send the upload link again", the offer link, the signing link or the Ejari certificate. Each
  emails the existing link or document to the address on the record, never to one typed in the
  chat, at most once per Dubai day (audit event plus a day-specific outbound milestone).
- **Enumeration.** Without a verified status session, Apply now and booking never say whether an
  email already has an open application or viewing, or when: one neutral reply ("If you
  already asked about this property, check your email for the details we sent.", also in Arabic;
  it promises no new email), on the code and agent paths
  alike. Inside a verified session the specific replies stay. Nothing is re-sent in the neutral
  case. A held offer (an `OFFER_HELD` revision with no `OFFER_SENT`) is not re-sent from the chat:
  the reply is "Your offer is being prepared. We'll email it soon."
- **Known limits.** The per-email limit can be used to exhaust a victim's codes: anyone who types
  a victim's email can use up its 3 codes per hour, so the victim cannot get a code for the rest of
  the hour (inherent to an unauthenticated start; the reply stays neutral). The per-IP limiter is
  in memory: it resets on restart and is per process, so a multi-instance deployment needs a shared
  limiter. `outbound_messages` keeps a `previewUrl` on dev SMTP (the Ethereal-style preview link),
  which can show a code in clear: use dev SMTP only on a developer machine, never in hosted use. The demo falls back to a fixed `SESSION_SECRET`, so hosted
  deployments must set it; rotating it invalidates codes in flight. Arabic copy needs native review.
- **Rule 10 amendment (AGENTS.md):** the public web chat may also create applications (Apply now)
  and show a verified visitor's stages read-only after an email code; with D36 it acts through an
  AI agent with tools. Documents still go only through emailed links, and everything outbound
  still goes by email.

## D35 — Company clauses from sample contracts (Contract AI)
Product owner's choice (slice 3). A company uploads a sample contract, a helper proposes clauses, an
admin approves them, and a contract can include the approved wording.
Slice 3 (Task 5 and 6) completes the decision.
- **Helper `contract_template`** (`packages/helpers/src/contract-template`) reads a sample contract
  (PDF or pasted text) and proposes clauses (title, text, category, verbatim quote). It touches no
  disk (the engine passes `readFile`) and writes nothing. PDF text comes from `unpdf@1.9.1` (MIT,
  new dependency; `pdf-lib@1.17.1` is a dev dependency for the test fixture). Caps: 10 MB, 60
  pages, 120k characters, a 30 s parse timeout, page-by-page reading that stops at the character
  cap, and `loadingTask.destroy()` afterwards. The document sits between per-call random nonce
  delimiters (`<<<DOC_<nonce>_START/END>>>`) and delimiter-like text inside it is stripped.
  Limit: the timeout does not cancel pdf.js work already running; a worker with a memory limit is
  deferred.
- **Quote guard.** A clause is kept only if its quote is found in the document (NFKC, soft
  hyphen, zero-width and curly-quote normalisation, whitespace collapsed), is at least 20
  characters and 4 words, and covers at least `min(40% of the clause text, 250)` characters.
  Failures are dropped and counted in `droppedCount`, not failed through Zod, so one bad clause
  doesn't turn the whole answer into `needs_human`. A clause is also dropped when its `text` has a
  figure, period or date token (digits, number words up to twelve, day/week/month/year words,
  month names, money words, `%`) that its `quote` does not contain: the model may not add a value.
  The review screen and the approval detail label clauses in the `termination`, `payment` and
  `subletting` categories "Confirm with legal".
- **`hasValues` is code, not model.** A clause "has values" when code finds an amount (AED, dirham,
  fils, `د.إ`), digits (also Arabic-Indic, Persian and fullwidth, `%`), a spelled-out number or
  percentage, or a period or date word, in English or Arabic (Arabic-aware boundaries with the
  common prefixes). A model-supplied flag is ignored.
- **Review.** Proposals are stored as `company_clauses` (`proposed`) tied to the contract rule.
  An admin approves, edits or rejects each one. A clause with `hasValues` (recomputed on edited
  text) needs `confirmValues: true` (else 422 `confirm_values`). Every decision appends
  `COMPANY_CLAUSE_APPROVED` or `COMPANY_CLAUSE_REJECTED` with the user as actor.
- **Retry and stuck reads.** Reading runs in the `contract.template` job (singletonKey
  `<documentId>:<attempt>`). Re-uploading the same file after `failed` or `needs_human`, or the
  "Try again" route, re-queues it. A sample queued for more than 15 minutes is shown as `failed`.
- **Scans go to a person.** Image-only PDFs are `needs_human` ("upload a text PDF or the clauses
  as text"). No page renderer is wired (it needs a native canvas dependency), so the vision
  fallback is not used.
- **In the contract.** Rule `clauseIds` may hold standard ids and `cc:<uuid>` ids; the Manager
  validates them (422 `bad_clause` for an unapproved, rejected, unknown or other-company id) and
  copies the approved wording into `addendum.companyClauses`, overwriting anything the client
  sent. The PDF prints it under "Additional terms (company)". The prepare form preselects from
  the matching rule. The `final_contract` gate is unchanged. `Addendum.clauses` allows 20 entries.
- **Not done:** company clause text is not run through the free-text conflict review (an admin
  already approved it), so a conflict with a contract field is only caught by the approver.
- **Evals.** Six fixtures: expected clauses found 12/18, quotes not in the document 0/16, clauses
  from the injected line 0.

- **Approved company clauses are immutable.** `decideClause` only touches `proposed` rows; an approved or
  rejected clause is never edited again (a change means a new proposal). That is why a contract's
  `inputHash` covers the records it is copied from but not the text of `cc:` clauses: the wording behind a
  `cc:<uuid>` can't change between preparing a contract and approving it. The Manager copies the approved
  wording into `addendum.companyClauses`, and the renderer throws if a `cc:` ref has none.
- Company clause text appears only in the contract PDF ("Additional terms (company)"), never in the Ejari
  payload. No amount, date or period in a clause is ever used as a contract value.

## D36 — AI customer agent for the public web chat
Amends D24 and D31 for the web channel only. Product owner's choice: free text in the web chat
goes to an agent that can search, book, apply and check status, instead of a classifier with
fixed replies. Telegram is unchanged (D24).
- **Routing.** Buttons, callbacks, contact steps, a typed code, and a short typed answer at a
  step that expects one (name, company, email) stay in code. Any other free text goes to a
  LangGraph tool loop (`packages/helpers/src/customer-agent`, engine side in
  `manager/customer-agent.ts`). With no model configured the old assistant path runs. Fixed
  classifier replies remain only as the agent's error fallback and the `handoff` tool text.
- **Tools.** `search_units`, `unit_details`, `viewing_slots`, `book_viewing`, `apply_now`
  (offered only when the toggle is on), `my_status` (only when verified),
  `start_status_check` (only when an email is known and not verified), `offer_choices` and
  `handoff`. Zod in, code out. No tool takes an email, party, application or lease id. At most 6
  tool calls per message, and the per-hour message cap applies before the model.
- **Full actions with choice cards** (the product owner's decision). The agent may book a viewing
  and apply, but a tool that commits or asks ends the turn with text written by code. Options
  (slots, areas, units) are offered as a choice card: `offer_choices` values are validated, labels
  are built by code, and the visitor's tap is `pick:<id>:<n>`.
- **Identity only from the conversation.** The booking and application use the chat's contact
  email and name. An email the visitor or the model supplies is ignored.
- **Single-use picks.** Options live in `flow.choiceSet`; a pick resolves from stored state, and
  the set is cleared as soon as one option is taken, so a forged, stale, foreign or repeated pick
  says "no longer available". A slot must come from `viewing_slots` in the same message and is
  re-checked under the unit lock.
- **Value post-check (rule 1).** Every AED amount, date, time, weekday, phone, email or link in
  the reply must appear in this turn's tool output (EN and AR, Arabic digits and separators,
  Dhs/Dh/`د.إ`, bare yearly figures). It also covers percentages (`%`, `٪`, "percent",
  "بالمئة"), bare figures of 1,000 or more, and "N days/weeks/months/years" phrases in English and
  Arabic (digits, or spelled-out numbers up to twelve), each of which must appear in a tool result.
  Claims or promises of an action that no tool did also fail.
  A failure retries once, then sends a fixed reply.
- **Deadline and cancel.** Each turn races a 60 s deadline (`customerAgentLimits.deadlineMs`) with
  an `AbortSignal` to the model; tools that haven't started refuse once cancelled, and a tool
  that needs the conversation lock re-checks `cancelled` inside its transaction before writing.
  On timeout the run is recorded `needs_human` and the visitor gets the fixed error reply. Known
  limit: a write already running when the deadline passes still commits, so the visitor can see
  the error and still get the booking email.
- **Concurrency.** An in-memory semaphore (`CUSTOMER_AGENT_MAX_CONCURRENT`, default 2) answers
  "one moment, I'm busy" at once when full, recording nothing.
- **Untrusted text.** Visitor text and unit descriptions are wrapped in `<untrusted>`. A name or
  company typed at a step is saved only if it looks like a name (`plausibleName`,
  `plausibleCompany`); otherwise the text goes to the agent and nothing is saved.
- **`helper_runs`.** One row per turn with masked arguments and a result hash. `redacted()`
  strips `nameEn` and `companyName` from the stored flow, masks emails (`a***@domain`) and never
  stores status details. Unverified spans kept in the row are masked too (`maskPiiText`, emails).
  A thrown model error is retried once inside the turn (not a timeout), then the run is
  `needs_human`.
- **Model.** `CUSTOMER_AGENT_MODEL`, else `CHAT_MODEL` (new optional variable; no existing tag
  changed). Local Ollama only, asserted at startup. The agent needs tool calling.
- **Evals** (23 cases, EN and AR, real Ollama, Task 7). `qwen3.5:9b`: tool choice 19/20, facts
  3/3, reply shape 22/23, fixed fallbacks 0/23, p50 8.4 s, max 34.4 s, forbidden actions 0.
  `gemma4:e4b`: tool choice 15/20, shape 18/23, fallbacks 2/23, p50 4.1 s, max 25.7 s, forbidden
  actions 0. About twice as fast but misses cards, choice cards and a handoff, so `qwen3.5:9b`
  stays the default until the prompt is tuned.
- **Known limits.** Turns with a slot list or choice card take several model calls (up to about
  35 s on the dev GPU). No streamed status lines: one pending bubble. The Arabic apply case
  sometimes falls back to the fixed reply. The semaphore frees at the deadline while an orphaned
  model call may still run. A "busy" reply marks the inbound message processed.
- **Rule 10 amendment:** see D34.

## D37 — Fourteen more agent switches (slice 4)

- **Where.** In `CompanyPolicy.autopilot`, next to the six of D33: booleans plus seven bounded
  whole numbers in the same versioned policy (saved with the advisory lock; every change audited as
  `AUTOPILOT_CHANGED` with from and to). An out-of-bounds number is refused, never clamped. Policies
  stored before this have no new keys and parse with the defaults.
- **Defaults** keep today's behaviour or choose the safer option: reminders, chases, agent
  switches and `ejari_draft_auto` on; `no_show_followup`, `held_offer_auto_release`,
  `contract_ai_auto_approve_valueless` and `copilot_proactive_drafts` off.
- **Reminders and chases** are queued with a `singletonKey`, moved out of quiet hours (Dubai, from
  the Clock; in demo mode too: the exact `startAfter` is kept in the deadline and the sweep waits
  for it), and re-check both their switch and the entity's state when they fire. They are all
  pre-move-in steps, so `TENANCY_OPS` does not hold them.
- **No gate is touched.** `ejari_draft_auto` only decides who drafts the submission; a person still
  approves it. `held_offer_auto_release` sends through `sendHeldOffer`, which re-checks the limits and
  asks a manager instead of sending an offer outside them. Auto-approval covers only clauses with no
  amount, date or period (by code), outside termination, payment and subletting, and not about money
  or exit in their wording; the actor is `system:auto-approve`.
- **Chat agent.** Free-text book or apply off: the tool answers "needs a tap" and shows the choice
  button; the tap runs the normal path. `area_rent_index` exists only while `agent_sri_answers` is
  on and formats the figure by code. `agent_daily_action_cap` counts the agent's completed bookings
  and applications per chat per Dubai day (`AGENT_ACTION` event).
- **Copilot.** `copilot_proactive_drafts` shows "Draft a reply" in the Workspace on records that wait
  for an applicant or signer. A click asks the copilot; for a lease it saves a draft through
  `draft_email`; nothing is sent. Applications have no lease, so the copilot writes the text in chat.

## D38 — Company contract templates (slice 4)
- **Extraction.** An admin uploads a sample contract PDF. The `contract_structure` helper
  (`packages/helpers/src/contract-structure`) reads it: code copies the wording verbatim into
  sections, finds the blanks, and reads the look (page, margins, fonts, sizes, header, footer,
  logo, accent colour) from the PDF. The model only proposes headings and which contract field
  each blank means; code checks every id, heading and field name and the field's type.
- **Look.** The company's look is reproduced with the standard PDF fonts. A header, footer or
  logo that carries DLD, RERA or Ejari wording is never reused (rule 9): it blocks approval until
  the admin drops it, and a sample with such marks never gives an accent colour.
- **Approval rules.** A template is `proposed` until an admin approves it. Approval is refused
  (422 with every reason) while a mapping is of the wrong type (a blank left empty is fine, D43), while flagged
  header, footer or logo are not dropped, while a kept logo is not confirmed as the company's own,
  while the text has characters the PDF fonts cannot print, and while any paragraph or heading
  with a number, period, date or amount (`hasValues`) is not in `review.valuesConfirmed`.
  Authority wording found in the title or body needs "Neutral reference, not branding" per
  paragraph (`review.authorityBodyConfirmed`); header, footer and logo hits still block until
  dropped. A paragraph about a rent change, or a notice with a number of days, only warns:
  "Check against the required terms; confirm with legal". Confirmations are stored on the
  template and in the `COMPANY_TEMPLATE_REVIEWED` audit event. The wording is never editable.
- **Required terms always appended.** `REQUIRED_TERMS` (law section, addendum blocks) are added
  by code to every contract, whatever the template says. A template never replaces them.
- **WinAnsi limit.** The PDF fonts are standard (WinAnsi): Arabic or other text they cannot encode
  blocks approval ("upload an English version"). No silent `?`.
- **Re-pointed on approve.** Approving a version retires the previous approved one and, in the
  same transaction, moves the company's active contract rules from retired templates to the new
  one. An approved row never changes; a pending `final_contract` becomes stale if its template
  key changes. A render with a missing value fails with the list of what is missing.
- **Rules touched:** 1, 3 (final contract is still approved by a person), 9.

## D39 — Voice input (slice 4)
- **Model.** Speech to text is `VOICE_MODEL` (default `gemma4:e4b`), audio sent to local Ollama
  only (rule 8). No cloud speech API.
- **Caps.** `audio/webm` or `audio/ogg`, 2 MB (`VOICE_MAX_BYTES`), 30 s. A missing
  `Content-Length` is refused (411); the body is read as a stream and cut off past the cap (413)
  in the engine and in both web relay routes. Limits: 20 per IP per hour (public chat), 60 per
  user per hour (staff).
- **Nothing stored.** The audio lives in memory for one call: not on disk, not in the log, not in
  `helper_runs`. Only the PII-masked transcript is returned.
- **Transcript is untrusted input.** It fills the message box; the person reads, edits and sends
  it as an ordinary message, so it goes through the same masking, Zod and prompt-injection
  safeguards as typed text. The prompt tells the model never to obey the speech. Silence or low
  confidence answers "try again" (English and Arabic).
- **Speaking back.** Only the browser's local text-to-speech voices are used; a voice that is not
  local is never used, so no text leaves the device or the server for synthesis.
- **Rule 10:** voice is only another way to type; it opens no new channel.

## D40 — Model choice per helper (slice 4)
- `CHAT_MODEL` is `gemma4:e4b` (about 2 to 4 times faster, same scores on the extraction and
  classification suites). Per-helper overrides: `COPILOT_MODEL`, `LEASING_ASSISTANT_MODEL`,
  `CONTRACT_AI_MODEL`, `CUSTOMER_AGENT_MODEL`, `VOICE_MODEL`. `COPILOT_MODEL` and
  `CUSTOMER_AGENT_MODEL` stay pinned to `qwen3.5:9b`: gemma misses tool calls by asking a
  clarifying question, and one prompt pass did not close the gap.
- Evals on 2026-10-28 (forbidden actions 0 on both models in every suite):

| Suite | qwen3.5:9b | gemma4:e4b | Verdict |
|---|---|---|---|
| leasing-assistant (54) | intent 44/54, handoff recall 22/22, false handoffs 1/32, injections 7/7, p50 6.0 s | same scores, p50 6.9 s | gemma |
| contract-template (6) | clauses 12/18, bad quotes 0, injected 0 | same | gemma |
| contract-structure (4) | blanks 28/28, mapping 27/27, styles 37/37, 115 s on biggest PDF | same scores, 20 s | gemma |
| customer-agent (23 / 26 cases) | tool 19/20, shape 22/23, fallbacks 0, p50 8.4 s | tool 14/21, shape 19/26, fallbacks 2/26, p50 4.6 s | pinned qwen |
| copilot (77) | tool 59/69 (85.5%), facts 64/78, unverified 6/77, p50 26.7 s | tool 51/69 (73.9%), facts 60/78, unverified 4/77, p50 7.8 s | pinned qwen |
| complaints (34) | route 29/34, safety 10/10, injections 4/4, ack check 0 failing | stopped at ct30, no summary | gemma (re-run to confirm) |
| voice | no eval suite | none | `VOICE_MODEL` stays `gemma4:e4b` |

- `KYC` (vision) was not run. Complaint acknowledgements follow `CHAT_MODEL`; re-run
  `bun run eval -- complaints` on gemma before relying on it.

## D41 — Staff copilot covers the Contract AI pipeline, with cards and choices
- **Why.** Staff asked "how many applications are in viewing" and "how many enquiries" and the copilot
  had no tool; its help text pitched lease management and renewals, which `TENANCY_OPS` hides (D33).
- **Tools.** Six read tools: `pipeline_summary`, `list_records`, `get_record`, `contract_status`,
  `list_companies`, `offer_choices`; `find_available_units` gains `company`, `category`, `sizeBand`.
  `pipeline_summary` is computed by the same code as the Home tiles, so counts never disagree.
  `list_deadlines` and `get_lease_timeline` join the `TENANCY_OPS` hide list; `get_lease` stays,
  without tenancy fields.
- **Rich replies.** Tools return `ui` (record and unit cards, one choice card) that the model never
  sees; the stream carries it to the chat. Both chats now use one card and choice implementation
  (`apps/web/components/chat-ui/`). Cards are not stored with the thread (no schema change).
- **Guardrails unchanged (rule 11).** No new confirmed actions. A choice value must be an id a tool
  returned in the same turn; tenant and applicant text never becomes a choice; a tap sends a normal
  message or opens a page.
- **Public agent.** Only polish: `search_units` returns `total` for count questions and moves onto
  the shared components. `resolveCompany` is now shared between the two.

## D42 — The copilot calls the engine API that exists for the task
- **Why.** "Send a reminder for this viewing" got no tool call and an offer of a lease page an
  application doesn't have; "list Silverline units" got a `category` the user never typed. The
  user decided the copilot should use existing engine actions instead of saying "no tool".
- **Reads.** `list_tasks`, `list_enquiries` and `get_enquiry` (visitor text `untrusted`, phone
  numbers masked, no email returned), `get_unit` (the unit plus its SRI average and rent-rule range,
  computed by the engine in `GET /api/copilot/unit`, rule 1) and `viewing_slots` (the slots logic
  of the public chat, `GET /api/copilot/viewing-slots`). Slot `at` values are issued to
  `offer_choices`.
- **Drafts.** `draft_email` takes a lease (tenant) or an application (applicant). `copilot_drafts`
  gains `application_id`; the staff form on the application record (`POST /api/applications/:id/email`,
  evidence stored like a tenant email) sends it. The copilot still never sends.
- **Four more Confirm-click proposals (rule 11 amended).** `propose_viewing_invite`
  (`bookViewing`: an enquiry only; a booked viewing keeps its automatic reminder),
  `propose_request_documents`, `propose_resend_signing_link`, `propose_prepare_contract` (runs
  `prepareContract` with the contract rule's default clauses; it still ends at the locked
  `final_contract` approval). Same flow as D25: a `copilot_proposals` row, single use, 30-minute expiry,
  owner only, the user's click calls the same manager function the staff route calls, as
  `copilot:<userId>`, with the same role checks and audit. No new quiet-hours or cap semantics.
- **Prompt.** Never add a filter the user didn't state; use the proposal tool or name the button
  with its link, never "I have no tool" when one exists.
- **Chat UI (same change).** Both chats get one composer (`chat-ui/composer.tsx`) with code-driven
  quick-action pills that stay above the input. Public pills are fixed buttons (`units`,
  `chat:book`, `chat:apply`, `status:start`, `contact:change`); "Use a different email" ends the
  verified session and restarts the email step, and touches no applicant record. "Talk to staff" is
  not offered: the web chat never hands over (customer chat design). The stored status stand-in
  line is no longer shown to the model, and a reply that repeats it is refused, so every status
  question gets a fresh status.

## D43 — Template blanks are mapped by AI and code, checked by people at `final_contract`
- **Why.** Admins fixed many proposed mappings by hand (Landlord Nationality shown as Lease
  reference) and a missing optional value (tenant phone, plot) failed the whole contract. The
  user decided: no manual field selection, map by what the system holds, leave a blank empty when
  unsure.
- **Data sheet.** `key -> description + type`, generated from the records (lease terms, unit,
  company, landlord and tenant party columns, application), plus `tenancyPeriod` and
  `contractOn` (the day the contract is prepared, from the Clock).
- **Mapping, once per template version.** Code label rules first (landlord/owner/lessor vs
  tenant/lessee scoping from the label or nearest heading), then the chat model (Zod schema; the
  key list is too long for a systemone choice, which takes at most 26 options) given only blank
  labels, nearby words and key descriptions, never a value (rule 8: personal data and amounts in
  the sample's own words are replaced by "[value]" first). Code validates the key and its type;
  invalid answers are asked once more, then the blank is `leave_empty`. The model only chooses a
  key; code copies the value verbatim (rule 1). Stored on the template, reused at every prepare;
  "Re-suggest mappings" re-runs it on a proposed template. An approved template is immutable: a new
  version (read the sample again) is needed to map it afresh.
- **Rendering.** No value: an empty line, listed at the `final_contract` approval as "Left empty
  for hand-filling", with each filled blank's source key. `CORE_FIELDS` (annual rent, start, end,
  tenancy period, deposit, cheques, landlord name, tenant name, unit and property number, lease
  reference, move-in date) block preparation when empty. Absent-by-nature keys print a neutral
  word from code: `rentFreeDays` "0" (the record holds 0), `reservationFils` "None" (no reservation
  on the application). Rule 3 is unchanged: a person checks the contract at the gate. Rules 1, 3
  and 8 are touched, none relaxed.

## D44 — The company is the landlord

Developers and realty companies (Sobha, Danube, Silverline, Modon and so on) lease their own
portfolio. Individual landlords are out of scope. This supersedes the D32 ruling that a company is
not a landlord.

- **Data: parties plus columns.** `companies.party_id` (unique FK) points to a `parties` row of kind
  `company`: the company's legal record (legal name EN and AR, email, phone, trade licence number and
  expiry). Created from the company name for every existing company by migration 0025, and on demand
  for new ones. The fields a party has no column for (licence issuing authority, RERA ORN, registered
  address, cheque payee, authorised signatory with ID kind, number and expiry) are columns on
  `companies`. Why not all on `companies`: leases, signing, the Ejari payload and notices already read a
  party, so nothing downstream changes shape, and the signatory's ID number stays out of `parties`
  (whose Emirates ID column is unique and used for matching people).
- **`units.landlord_party_id` is unused.** The column stays (nullable, deprecated) and nothing reads it.
  The unit's landlord is its company's party. New leases (application and import) get that party as
  `lease_parties.role = landlord`; the contract takes it from the unit's company at prepare time and
  re-points an older lease's landlord row. Contracts already prepared or signed keep their stored PDF
  and payload.
- **Gate on preparing.** `prepareContract` is refused (422 `landlord_details_missing`) until the
  legal name, trade licence number, issuing authority, an unexpired licence, address, email and the
  signatory (name, title, email, ID number) are set: "Complete <company>'s legal details in Settings →
  Companies". The landlord signer's email is the signatory's.
- **Audit and PII.** `PUT /companies/:id/legal` is admin only. The `COMPANY_LEGAL_UPDATED` event holds the
  actor and the changed field names, never values or ID numbers. The signatory's ID number is shown
  masked to finance. Validation: licence and ID expiry in the future (Clock), email, Emirates ID format
  `784-YYYY-NNNNNNN-N`.
- **Units and import.** The unit form already requires a company. The units CSV has a `company` column
  (name or slug); `?company=` is only the default; an unknown or inactive company is a row error. The
  lease CSV's `landlord_name` and `landlord_email` are ignored.
- **Data sheet.** New keys `landlordNameAr`, `landlordAddress`, `landlordTradeLicenceNo`,
  `landlordTradeLicenceExpiresOn`, `landlordTradeLicenceAuthority`, `landlordReraOrn`, `chequePayeeName`,
  `signatoryName`, `signatoryTitle`, `signatoryEmail`, `signatoryIdNo`, `signatoryIdExpiresOn`.
  `landlordNameEn` stays core. The generic contract and the Ejari payload use the company's legal name
  and trade licence number.
- **Demo.** "Fictional Holdings LLC" is gone: each seeded company has fictional legal and signatory
  details (`DEMO_COMPANY_LEGAL`), and the simulated Ejari registers each demo unit to its company's
  legal name. Rules 1, 3, 4, 8 and 9 are untouched.
