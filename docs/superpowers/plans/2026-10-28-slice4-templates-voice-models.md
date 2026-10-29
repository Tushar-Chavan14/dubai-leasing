# Slice 4: Company contract templates, voice, more agent switches, gemma4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Contracts come out in each company's own structure, wording and look (taken from its uploaded sample, approved by an admin) if no sample provided use the genric template. Visitors and staff can talk to the chat. Admins get 14 more agent switches. All chat models move to `gemma4:e4b` after an eval comparison.

**Spec:** this plan plus the user's decisions of 2026-10-28; the redesign spec `docs/superpowers/specs/2026-10-27-contract-ai-redesign-design.md`; D32 to D36.

## User decisions
- **Contract template:** sections and wording from the sample, and the contract should also look like the sample.
- **Model:** all chat models move to gemma4:e4b, with the evals compared.
- **Voice:** gemma4:e4b audio input through Ollama. Verified: Ollama 0.40.5 reports `gemma4:e4b` capabilities `completion, vision, audio, tools, thinking`.
- **Switches:** add all 14 suggested switches.

## Global Constraints
- Rule 1: no model sets a money value, date or period. Every blank in a company template is filled only from contract fields that an admin mapped.
- Rule 3: `final_contract`, `ejari_submission` and every other gate are unchanged. No new switch can bypass them.
- Rule 6: Zod, then retry once, then `needs_human`.
- Rule 8: audio and documents go only to local models (`assertLocalModel`). Audio is never stored or logged; only the transcript, PII-masked, is kept.
- Rule 9: no DLD logos, colours or screen copies. A company template may carry the company's own logo, never DLD branding.
- Rule 10: voice is just another way to type into the same chat; outbound still goes by email.
- No commits. No `next build` while dev runs. Agents can't read `.env`. Say so whenever `.env.example` model tags change.

## Review Focus
1. **Template blanks:** a blank that is mapped to no field, or to the wrong field type, must block template approval. A contract can never render with an unfilled or unmapped blank.
2. **Look extraction:** a sample with DLD marks must not have those marks reused (logo detection plus an admin confirmation that the logo belongs to the company).
3. **Voice:** oversized or long audio (cap 30 s and 2 MB), a non-audio upload, silence, a prompt injection spoken aloud, and rate limits per IP and per user.
4. **Switches:** every new switch defaults to today's behaviour or to the safer option, and none of them touches a locked gate.
5. **Model switch:** an eval regression on any helper beyond an agreed threshold keeps that helper on qwen, through a per-helper model setting.

---

### Task 1: 14 more agent permission switches
- `CompanyPolicy.autopilot` gains:
  - `agent_free_text_book` (on)
  - `agent_free_text_apply` (on)
  - `viewing_reminder` (on)
  - `no_show_followup` (off)
  - `kyc_chase` (on, 48 h)
  - `ejari_draft_auto` (on; draft only)
  - `sign_reminder` (on, N=3 days)
  - `held_offer_auto_release` (off, N=24 h, in-limits only)
  - `agent_sri_answers` (on)
  - `agent_suggest_alternatives` (on)
  - `contract_ai_auto_approve_valueless` (off)
  - `copilot_proactive_drafts` (off)
  - `quiet_hours` (on, 22:00 to 08:00 Dubai)
  - `agent_daily_action_cap` (5)
  Numeric settings get bounded Zod fields.
- The engine reads each switch at its step. Reminders and chases become pg-boss jobs with `singletonKey`s, respect quiet hours, and are dropped from the schedule when `TENANCY_OPS` doesn't apply (pre-move-in steps only).
  - `held_offer_auto_release` re-runs the offer limits check and the held-offer rules.
  - `contract_ai_auto_approve_valueless` approves only `hasValues=false` clauses outside the termination, payment and subletting categories, and records the actor as `system:auto-approve`.
- The Settings → Agent UI groups the switches as Chat agent / Reminders / Offers and contracts / Copilot / Limits, with numeric inputs where needed.
- Tests: one test per switch in both states.

### Task 2: Company contract template extraction
- New helper `packages/helpers/src/contract-structure/` (follow the `new-helper` skill). It works from the sample PDF:
  - **Structure:** ordered sections with headings, a numbering style (1., 1.1, Article I, …), and the fixed wording per section.
  - **Blanks:** a run of underscores or dots, a "[ ]" or "<<>>" marker, or a known label followed by an empty space. Each blank gets a label and a proposed field mapping (`tenantNameEn`, `annualRentFils`, `startOn`, …), chosen from the contract field list by the model and validated by code.
  - **Look:** taken from the PDF itself with unpdf (and pdf-lib where needed). It covers:
    - page size and margins;
    - font family class (serif or sans, mapped to an embedded standard font);
    - heading sizes and weights;
    - header and footer text;
    - the main accent colour of headings and rules;
    - logo image from page 1 (the largest image near the top).
  - The same safeguards as `contract-template`: nonce delimiters, a quote guard that drops wording not in the text, caps, a timeout, and fail closed.
- Storage: table `company_contract_templates`:
  - columns: `id`, `companyId`, `sampleDocumentId`, `status` (`proposed` / `approved` / `retired`), `sections` (jsonb), `blanks` (jsonb with field mappings), `style` (jsonb), `logoDocumentId`, `version`, `approvedBy`, `approvedAt`;
  - approved templates are immutable, and a new upload creates a new version.
- Tests: blank detection, mapping validation (field type compatibility), quote guard, style extraction from a generated PDF.

### Task 3: Template review, approval and rendering
- Settings → Contracts → "Company template":
  - a preview of the extracted sections;
  - a list of blanks with a field dropdown each (all required);
  - style swatches;
  - a logo with the checkbox "This is our company's logo (not DLD or a government mark)";
  - Approve and Retire.
  - Approval is blocked while any blank is unmapped or mapped to a field of the wrong type.
- The contract rule may reference an approved template (`templateId`). `prepareContract` renders the contract in the company template. That means:
  - the template's sections and wording;
  - blanks filled only from contract fields, with numbers and dates formatted by code;
  - the standard required terms that the template lacks, appended in an "Additional terms required by law" section (Ejari registration, signatures);
  - company clauses from slice 3;
  - the style applied (fonts, sizes, colours, header, footer, logo).
  - The signature record page stays ours.
- `final_contract` approval shows the rendered PDF and lists the template version. The Ejari payload is unchanged.
- Tests:
  - rendering with every blank filled;
  - a missing field blocks the render;
  - an unmapped blank can't be approved;
  - snapshot the PDF text layer;
  - the Ejari payload is unchanged.

### Task 4: Voice input and spoken replies
- Engine: `POST /api/voice/transcribe`, two variants:
  - staff: session auth;
  - public: through `/channel/web/voice`, secret-gated, using the same visitor cookie relay.
- Audio rules: `audio/webm` or `audio/ogg`, at most 2 MB and 30 s.
- `llm.audio(model, bytes, prompt)` in `packages/llm` sends the audio to Ollama with `assertLocalModel`; the model is `VOICE_MODEL`, default `gemma4:e4b`.
- The output is Zod `{ text, language: "en"|"ar"|"other", confidence }`; if empty or low-confidence the reply is "I didn't catch that. Please try again." (+AR).
- The transcript then goes into the normal chat path: the customer agent for public, the copilot for staff. It is treated as untrusted text like any typed message.
- Audio is held in memory only and never written to disk, logs or `helper_runs`. Only the masked transcript is kept.
- Rate limits: 20 per IP per hour for the public route, 60 per user per hour for staff.
- Web, in `/customer/chat` and the staff copilot (Home and the side panel):
  - a mic button records with MediaRecorder (press to talk, or tap to start and stop), shows a level meter and a 30 s countdown;
  - the transcript lands in the input field for the user to send or edit; an "auto-send voice" option is stored per browser;
  - a "Read replies aloud" toggle uses `speechSynthesis` with local voices only (`voice.localService === true`); if none exist, the toggle is hidden;
  - mic permission is requested on first use, with clear denied and error states. Keyboard-accessible, with `aria-live` status.
- Tests:
  - the engine route (size and type caps, rate limit, transcript path, nothing stored), with FakeLlm audio;
  - the web recorder state machine, as a unit test.
- Evals: 6 short fictional recorded clips, 3 EN and 3 AR, generated or recorded fixtures in the repo with no real voices of real people. The scores are word accuracy and intent result.

### Task 5: Move all chat models to gemma4:e4b, with a comparison
- Add per-helper model settings, each defaulting to `CHAT_MODEL`:
  - `COPILOT_MODEL`
  - `LEASING_ASSISTANT_MODEL`
  - `CONTRACT_AI_MODEL`
  - `CUSTOMER_AGENT_MODEL` (already exists)
  - `VOICE_MODEL`
  This lets one helper stay on qwen if gemma regresses.
- Run every eval suite on qwen3.5:9b (baseline) and on gemma4:e4b: leasing-assistant, copilot, customer-agent, contract-template, contract-structure, kyc (if chat-based), complaint triage and voice.
- Tune the prompts for gemma where it misses: the customer agent's cards and choice cards, the copilot's tool choice. Re-run once.
- Write a comparison table into `docs/roadmap.md` and recommend a model per helper.
- Change `.env.example` so `CHAT_MODEL=gemma4:e4b`. Any helper whose gemma score falls more than 10 points below qwen (or with any forbidden action) stays pinned to qwen through its own setting.
- The user changes `.env` themselves, since agents can't read or edit it. Say so in the summary.
- Tests: none beyond config parsing. Evals only.

### Task 6: Docs, compliance review, verification
- D37 (company templates), D38 (voice), D39 (agent switches extension), D40 (model choice per helper); AGENTS.md rule 10 gets a voice note; architecture §5, §6 (models) and §8; the dubai-leasing skill; the roadmap.
- Run the `compliance-reviewer` subagent on the slice diff and fix what it finds.
- `bun run typecheck && bun run lint && bun test` must pass. The summary names the new settings and the `.env.example` model change.
