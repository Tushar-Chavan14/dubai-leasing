# SPA C35: Buyer portal

Needs approval (database schema; more than three packages): approved by the user with the rulings below.

## Goal
A buyer or seller opens an emailed link, uploads the documents asked of them, sends them for checking, and later reads where the deal stands (step, next thing to do, their documents, the plan, transfer day, "you sign 2 of 3"). The portal acts only through the existing upload and KYC runs and opens no gate.

## Spec refs
design §7.1, §7.3, §7.6; specs (party portal); S24, S41, S49, S52, S54, S56, S60, S61; architecture §8.

## Rulings (user)
- Two purposes, one person, one deal. `documents` acts (upload, "Send my documents") and is used up on send; a new request or a staff resend issues a new link and kills the old one. `view` only reads, lives as long as the deal, dies on resend or when the deal is cancelled or completed. Offer and sign links are unchanged.
- Links go by email only. `requestDocuments` emails each party a `documents` link through `sendSpaMail` (template `documents_request`, one row per party and milestone). Transfer booked, Registered and instalment mail carry a `view` link. Reminders carry no link (S54). A failed mail is shown to staff and never silently retried.
- Upload: `POST /public/portal/:token/documents` (multipart). The party id comes from the token, never the form. The kind must be a document field of that party's effective KYC config. Reuses the upload core with actor `party:<partyId>` and event `PARTY_DOCUMENT_UPLOADED` carrying the link id, never the token. Reads queue as for staff; helper modes still apply. 429 over 30 uploads an hour per link. Only a PDF or image up to 10 MB, with a plain reason.
- "Send my documents" marks the link used and calls `enqueueKycRun` for that party (company: the company check). No gate is opened by the portal.
- What a party sees: `GET /public/portal/:token/status`: party words for the step, one next-step card, own documents with the party-safe reason of a failed check, plan, instalments from `payment_plan_rows` and confirmed payments, transfer day, "you sign 2 of 3" with no names. A compliance hold reads "Under review".
- Guard: every response string passes `partyBanned` and `maskPiiText`; a hit becomes "Your agent can help with that."
- Policy: `documentLinkDays` (default 14, 1 to 60, "confirm with the business"); older stored policies parse to 14.
- Out of scope: party bank-letter upload and plan acknowledgement (the signed agreement is the acceptance).

## Schema
- Migration 0059 `portal_links` (id, deal_id FK, party_id FK, purpose CHECK documents|view, token_hash unique SHA-256, expires_at null for view, used_at, superseded_at, created_by, created_at); partial unique index (deal_id, party_id, purpose) where superseded_at and used_at are null.
- Migration 0060 (custom): trigger, only `used_at` and `superseded_at` change, once each; no delete, no truncate.

## Review focus
1. Token scope: documents link cannot read the plan, view link cannot upload, neither reaches another deal or party; unknown and wrong-purpose tokens give one identical body.
2. No AML, screening, sanction, PEP, EDD, risk or flag word anywhere; no other party's name or document; ID numbers masked.
3. Resend kills the old link; a used documents link says "already used"; the view link stops on cancel or completion.
4. Wrong kind, non-PDF/image or oversized file refused with a plain reason; a party cannot pass a partyId.
5. "Send my documents" twice queues one KYC run; the portal opens no gate.

## Tasks
- [x] Policy `documentLinkDays` (core) and test.
- [x] Migrations 0059, 0060 and DB test (`portal-links.test.ts`).
- [x] Mail templates `documents_request`, `transfer_booked`, `registered`; instalment reminder takes an optional view link.
- [x] `manager/portal.ts`: issue, resolve, guard, documents page, status, upload, send; `storeDealDocument` split out of `uploadDocument`; `resolvePartyToken` gains kind `portal`.
- [x] Wiring: `requestDocuments` mails links, `resendDocumentsLink`, instalment mail, transfer-date mail, registered mail; events classified.
- [x] Routes: `GET`/`POST /public/portal/:token/documents`, `POST .../documents/send`, `GET .../status`, `POST /api/deals/:id/parties/:partyId/documents-link`.
- [x] Web: `/b/<token>/documents` (+ upload route, send action), `/b/<token>/status`, party chat box, `/b/<token>/assistant` route.
- [x] Tests (engine `portal.test.ts`, registry mail, DB, helpers mail, web), docs (S67, design §7.3, architecture §8, task, roadmap), compliance review.
