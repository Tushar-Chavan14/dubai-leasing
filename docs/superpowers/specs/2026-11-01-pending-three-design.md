# Document form and KYC rules, voice with whisper.cpp

Date: 2026-11-01 · Status: draft for approval

## A. Document form and KYC rules, per company

**Why.** The upload link's fields are hard-coded (`apps/web/app/t/[token]/documents/upload-documents.tsx`), the KYC
checks are fixed in code (`packages/helpers/src/kyc/checks.ts`) with two global numbers in company policy
(`kycMinValidityDays`, `kycMinConfidence`), and the name check uses the name typed when the application was made
(line 282), which is often a nickname.

**Settings → Documents & KYC**, companies on the left, two sections on the right.

### 1. Document form (fully configurable)
- Every field is added, edited, reordered or removed from the configuration; the applicant's link renders exactly
  the company's list. No hard-coded fields remain in the form.
- Field: label, key, placeholder, help text, type (`text`, `email`, `phone`, `date`, `number`, `select`,
  `document`), required or optional, options (`select`), applies to (`individual`, `company`, both).
- A `document` field names its document kind (Emirates ID front/back, passport page, visa, trade licence, or
  `other`). KYC reads the ID kinds; `other` is stored for staff only.
- One text field can be marked **"Name as per documents"**. KYC compares the documents with that answer; if the
  form has none, it falls back to the application name. New companies get a starter form (name as per documents,
  Emirates ID front and back, passport, visa; trade licence for companies), which the admin can change freely.
- Answers are stored on the application (`applications.form_answers` jsonb, with the form version answered).

### 2. KYC rules
- **Base rules** (every company starts with them, each can be switched off or given a different value):
  | Rule | Setting |
  |------|---------|
  | IDs valid after lease start | days (today: 30) |
  | Read confidence | minimum (today: 0.8) |
  | Required documents complete | on/off (uses the form's required document fields) |
  | Emirates ID number format | on/off |
  | Passport machine-readable zone matches | on/off |
  | Visa number format | on/off |
  | Names consistent across documents | on/off |
  | Applicant matches name as per documents | on/off, strictness (exact / allow middle names and order) |
  | ID numbers consistent across documents | on/off |
- **Company rules** (added on top), structured so code checks them:
  - *Form answer matches a document field*: e.g. "Date of birth" answer = date of birth on the Emirates ID.
  - *Form answer present / in a list*: e.g. "Employer" required for individuals.
  - *Document required for*: e.g. trade licence required when applies-to is company.
  - *Minimum age* from the ID's date of birth.
  - *Custom check (AI, review only)*: plain-English instruction the local model checks against the read
    document fields. It can only send the application to a person's review with its reason; it never rejects or
    verifies on its own.
- Every failed rule is a KYC flag with the rule's name, so the result is `review` (a person decides, as today).
  Auto-verify (`auto_kyc_verify`) still needs every enabled rule to pass. Nothing rejects an applicant
  automatically. Rules about nationality, religion or similar personal traits are not offered.
- The KYC run records the rule set version it used (audit, rule 4).

**Data.** `document_form_fields` and `kyc_rules` tables per company, versioned (an edit makes new rows; old
applications keep what they answered and were checked against). Admin only; audited. The two policy numbers move
into the base rules (policy values are the defaults for existing companies).

**Copilot.** No tool in this round.

## B. Voice with whisper.cpp `base`

**Why.** `VOICE_MODEL=gemma4:e4b` sends audio to an Ollama chat model, which does not transcribe audio reliably.

**What.**
- Run `whisper-server` from whisper.cpp locally with `ggml-base.bin` (about 150 MB):
  `whisper-server -m models/ggml-base.bin --host 127.0.0.1 --port 8178 --convert` (`--convert` uses ffmpeg to
  accept the browser's webm/ogg).
- `.env`: `VOICE_URL=http://127.0.0.1:8178` replaces `VOICE_MODEL`. Loopback only (rule 8), checked at start-up like
  the other local models. No `VOICE_URL` → the microphone button is hidden.
- `transcribeVoice` posts the clip to `/inference` (`response_format=json`, language auto) and keeps today's
  behaviour: 30 s / 2 MB caps, nothing written to disk, PII-masked transcript the user reviews before sending,
  Arabic/English "try again" message. Confidence comes from whisper's no-speech probability.
- `docs/` gets setup steps (build, model download, ffmpeg).

## C. Agentic flow

Deferred at the user's request (UI plus configuration changes, to be designed later).

## Calls I made (check these)

- Document form and KYC rules are per company (matches Contracts and Rent rules).
- A failed rule (base or company) sends the application to review; nothing auto-rejects.
- The AI custom check can only flag for review.
- Nationality-type rules are not offered (discrimination risk).
- Voice uses whisper-server over HTTP rather than a native binding (no build step inside Bun).

## Order

B (voice, small) → A (document form and KYC rules). C later.
