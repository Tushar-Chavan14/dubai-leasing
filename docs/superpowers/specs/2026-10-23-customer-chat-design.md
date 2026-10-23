# Customer chat ("auto-pilot") — design

Status: approved direction, 2026-10-23. Questions are closed. The product owner reviews the
plan.

## Why

Prospects from marketing campaigns need a web front door. Existing customers need one place
to ask "where is my application or lease?" without searching their email for the right link.
`/chat` is a **logged-in, fully automatic** chat for customers. **No officer takes part in it.**
It reuses what already works: availability and slot code, the Leasing Assistant (D24),
`createApplication`, the KYC upload path and the portal read models. The model reads and
classifies. Code drives the flow and produces every value.

## What the customer can do

1. **Sign up or log in** with email + a 6-digit one-time code. No passwords.
2. **Enquire, as many times as they like.** The chat asks for area (locality) and property
   type (bedrooms, optionally furnished). It shows matching properties as cards. The customer
   picks one, picks a viewing slot, and the viewing is booked, with the usual invitation email.
   Name, email and phone come from the account. They can enquire about and book other
   properties afterwards. They can't book a second open application on the same unit, which
   is the existing rule.
3. **Ask about their existing applications and leases:** stage, unit, key dates, next rent
   cheque, the documents still requested. Answers are cards built by code from records.
4. **Upload documents** (Emirates ID, passport, visa, trade licence) when an application is
   waiting for them (`SCREENING` with an open `kyc_upload` link), and submit them for checking.
5. **Ask general questions** ("how does renting work?", "what's included in this unit?").
   These are answered by the Leasing Assistant's existing question path, with its value check
   and no prices from the model.

## Non-goals

- Officer handoff, staff replies in the chat, or a staff inbox for web chats. When the
  Telegram flow would hand off (complaint, legal threat, injection, low confidence, "talk to a
  person"), the web chat sends a fixed reply instead. It explains what the chat can help with
  and, for problems in a home, says to use "Report an issue" from the My tenancy email. No
  task is created, and the conversation stays on autopilot.
- In-chat contract signing, renewal reply, vacate notice, deposit accept/dispute, payment
  reply, issue reports, inspection booking. Those stay on the portal pages, reached from
  emails.
- Real staff login, passwords, Google or UAE Pass, SMS codes.
- Changing Telegram behaviour.
- A new apartment/villa unit attribute. "Property type" here means bedrooms + furnished,
  which are existing columns.
- Websockets or push.

## Anti-goals

- A model producing rent, dates, amounts or any legal value (rule 1).
- A customer seeing someone else's application or lease. Login revealing whether an email is
  known.
- Customer sessions working on staff routes, or the reverse.
- Uploaded documents reaching any model from the chat path, or PII in logs or stored chat text
  (rule 8).

## Decisions (D30, to add to `docs/decisions.md`)

- **Customer accounts.** Table `customer_accounts`: id, email (unique, lowercased),
  full_name, phone (+E.164, nullable), role (`customer`), session_version, created_at,
  last_login_at.
- **Login codes.** Table `customer_login_codes`: hashed (sha256 + server pepper), valid 10
  min, 5 wrong tries kill the code, at most 5 codes per email per hour. A new code voids older
  ones. The answer is always "if the address is valid we've sent a code".
  Clock-based expiry. Sent through the mail adapter (template `login_code`, entity kind
  `customer_account`). The adapter already stores only a body hash.
- **Session.** HMAC token `{aid, aud:"customer", sv, exp}` signed with `SESSION_SECRET`.
  `requireUser` rejects any token with `aud` and `requireCustomer` requires it. 30 days.
  httpOnly cookie `leasing_customer`, separate from the staff `leasing_session`.
- **Records.** An account sees the applications and leases of every party whose `email`
  equals the account email (lowercased), matched at query time. Applications match
  `applications.party_id`. Leases match `lease_parties` with role `tenant`. If nothing
  matches, the chat behaves as for a prospect and never says "no records for this email".
- **Conversations.** `conversations.channel` gains `web`. One web conversation per account:
  `external_chat_id` = account id, new nullable `customer_account_id` FK. Status is always
  `bot`. The flow goes back to `idle` after each booking.
- **Actor.** `customer:<accountId>` (actors are plain strings, as with
  `enquirer:<conversationId>`).
- **Applications** from the chat use `source: "web_chat"` and reuse or create the party the
  way `createApplication` already does.
- **Uploads.** The engine finds the application's open `kyc_upload` link and calls the
  existing `addApplicationDocument`, `removeApplicationDocument` and `receiveInbound`
  (`DOCS_UPLOADED`) with it. This is one code path with the portal. `inbound_events.channel`
  gains `customer_chat`.
- **Rule 10 amendment (AGENTS.md):** the customer chat (logged-in customers, autopilot) may
  take enquiries and book viewings, show customers their own applications and leases, and
  take KYC document uploads. Everything outbound still goes by email.

## Shape

```
apps/web /chat ──server actions──▶ engine /api/customer/*  (requireCustomer)
                                     ├─ auth: code, verify, profile, logout, me
                                     ├─ chat: POST message → handleWebChat → reply {text, buttons, cards, records, upload}
                                     ├─ GET messages (history)
                                     └─ documents: POST/DELETE (multipart) → addApplicationDocument(link)
handleWebChat = the enquiry engine (enquiries.ts) with channel "web":
  contact/name steps skipped (account), handoff → fixed autopilot reply,
  new intents/buttons for "my records" and "upload documents" (code, no model for buttons)
```

The reply structure gains optional `cards` (units), `records` (application/lease summaries)
and `upload` (application id + which documents are already uploaded). Telegram ignores the
new fields.

## Done when

- Slice 1: login, profile, logout, enquiry → cards → slot → booking, repeat enquiries. Tests
  cover auth abuse cases, token isolation and the end-to-end booking. Leasing Assistant evals
  still pass.
- Slice 2: records cards, document upload + submit, general questions. Tests cover ownership
  (account A can't see or upload for B), the upload path matching the portal, and the
  non-SCREENING refusal. Eval cases for "my status" / "upload" intents in EN/AR, including
  an injection case.
- D30, AGENTS.md rule 10, architecture §8 / §8a, the `dubai-leasing` skill and the roadmap
  are updated. `compliance-reviewer` has run on each slice's diff. typecheck, lint and tests
  are green.
