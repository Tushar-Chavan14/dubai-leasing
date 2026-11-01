# Voice (whisper.cpp) and per-company document form + KYC rules: implementation plan

> Native execution, one final review. Spec: `docs/superpowers/specs/2026-11-01-pending-three-design.md` (B, A).

## Global constraints
- AGENTS.md rules. Audio and documents stay local (rule 8): `VOICE_URL` must be loopback.
- KYC never auto-rejects; a failed rule is a flag → `review`. No nationality-type rules.
- Money in fils; time from Clock; Zod at every boundary. No commits.

## Review focus
1. whisper-server down or returning junk → "try again", never a crash or a stored clip.
2. A form edited after an applicant opened the link → the submission is checked against the version they answered.
3. A company with no form rows → starter form, never an empty upload page.
4. AI custom check text from an admin reaching the model → flags only, can't verify.
5. Old applications (no `form_answers`) → name check falls back to the application name.

## Task B1 — whisper transcriber
- `apps/engine/src/whisper.ts`: `whisperTranscriber(url): Transcriber` posting multipart `file` + `response_format=verbose_json`
  to `${url}/inference`; returns `{ text, language: "en"|"ar"|"other", confidence }` with confidence =
  1 − max segment `no_speech_prob` (1 when no segments and text non-empty). Loopback check at construction.
- `EngineContext.transcriber?: Transcriber`; `transcribeVoice` uses it (same masking, caps, retry once, Arabic
  message); absent → `{ ok: false, message: "Voice input isn't set up." }`.
- Env: `VOICE_URL` (optional URL) replaces `VOICE_MODEL`; `.env.example` and docs updated (model tag change noted).
- Tests: `apps/engine/test/voice.test.ts` rewritten on a fake transcriber; `whisper.test.ts` parses a verbose_json
  sample, refuses a non-loopback URL, maps a fetch error to a thrown error.

## Task A1 — schema and defaults
- Tables `document_form_fields` and `kyc_rules` (company_id, version, active rows) + `applications.form_answers`
  jsonb (`{ version, answers: Record<key, string>, nameAsPerDocuments?: string }`).
- `packages/core/src/kyc-config.ts`: Zod `FormField`, `KycBaseRules`, `KycCompanyRule`, `STARTER_FORM`,
  `DEFAULT_BASE_RULES` (from policy numbers).
- Manager `apps/engine/src/manager/kyc-config.ts`: `companyKycConfig(tx, companyId)` (starter when none),
  `saveDocumentForm`, `saveKycRules` (admin, new version, event `KYC_CONFIG_SAVED`).

## Task A2 — KYC helper takes the config
- `KycContext` gains `rules: { base, company }` and `answers`; `applicant.nameEn` = name as per documents
  when answered. Each base check gated by its switch; strictness `exact | lenient`. Company rules evaluated in
  code; `ai_check` rules sent to the chat model with document fields as data, result Zod-parsed, can only add a
  flag. Tests per rule branch.

## Task A3 — engine + portal
- Portal: `GET /api/portal/:token/form` (config for the application's company); `DOCS_UPLOADED` body accepts
  `answers` validated against that version (required fields, types, options).
- `runKyc` passes config + answers; run payload records the config version.
- Upload page renders the configured fields (text inputs + document slots) instead of the hard-coded sets.

## Task A4 — settings UI
- Settings → Documents & KYC (company split): form field list editor (add, edit, remove, reorder, type, required,
  applies-to, document kind, name-as-per-documents marker) and KYC rules (base switches/values, company rules
  list with type-specific inputs).

## Task A5 — docs and review
- `docs/decisions.md` D46, architecture KYC section, dubai-leasing skill; compliance-reviewer + final review.
