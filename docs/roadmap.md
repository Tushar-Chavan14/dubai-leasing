# Roadmap

Follows the guide's build order, with the pieces the pitch demo needs pulled forward.
Tick tasks as they're done (`- [x]`).

## Phase 0 — Foundation

- [x] Local Postgres: `leasing` database and role, documented in README
- [x] Bun workspace scaffold: `apps/engine`, `apps/web`, `apps/telegram-bot`, `apps/ejari-mock`, `packages/{core,rulebook,db,llm,helpers,adapters}`
- [x] oxlint + oxfmt (D16), strict tsconfig, `bun test` wired at root
- [x] Env loading with Zod (`packages/core/src/env.ts`)
- [x] Drizzle schema for units, parties, applications, leases, lease_parties, lease_events, documents, approvals, deadlines, payments, complaints, inspections, conversations, messages, helper_runs, company_policy, demo_settings
- [x] `Clock` (System + Demo), `maskPii`, money helpers (fils), Dubai calendar-date helpers
- [x] State machines for Unit, Application, Lease with transition tests
- [x] Rulebook `dubai-2025-01` + tests for every rule and band edge
- [x] Manager `advance()` with transactional events and approvals
- [x] pg-boss setup, `deadlines` table, demo sweep job
- [x] Approval inbox (list, detail with sources, approve/edit/reject)
- [x] CSV import of existing leases
- [x] Demo seed: 6 units, 3 fictional tenants, 1 lease near renewal

**Exit:** imported leases show correct state and next deadline; fast-forward fires milestones once.
✅ Met: `apps/engine/test/manager.test.ts` (import states, deadlines fire exactly once incl. concurrent fires) and checked by hand in the staff app.

## Phase 1 — Renewal & Notice

- [x] Mock SRI table (seeded averages by area/bedrooms) + manual override
- [x] Renewal helper (pure code) + notice template (EN) + PDF
- [x] Mail adapter (Nodemailer SMTP, templates, `outbound_messages`, idempotent sends; dev: Ethereal)
- [x] Tenant portal shell: magic-link access (`action_links`), My tenancy page, `POST /api/inbound`, `inbound_events`, `inbound.process` job
- [x] Portal forms: notice acknowledgement, renewal reply
- [x] Staff "submit on behalf of tenant" for every portal form
- [x] Notice approval → email with PDF → evidence stored → 5-day unacknowledged follow-up task
- [x] T−90 fallback: same-rent renewal + manager alert
- [x] Tenant reply classification (tev1)
- [x] Staff copilot v1 (read-only), architecture §8b:
  - [x] `packages/copilot`: tool registry (`CopilotTool`), `EngineClient`, LangGraph tool loop, prompt
  - [x] Read tools: `search_entities`, `get_lease`, `get_lease_timeline`, `list_deadlines`, `list_approvals`, `get_helper_run`, `list_outbound_messages`, `explain_rule`, `compute_renewal_cap`
  - [x] `POST /api/copilot/chat` (streamed) in engine; `copilot_threads` / `copilot_messages` tables
  - [x] Chat panel in the staff app (lease, unit, inbox pages) + `/copilot` page
  - [x] Unverified-value post-check (amounts, dates, percentages vs tool results)
  - [x] Evals: 30+ cases including prompt-injection and permission cases; 0 forbidden actions

**Exit:** every expiring lease has an approved notice by T−100 in the demo; staff can ask the
copilot why a lease is waiting and what is due this week.

## Phase 2 — KYC → Contract → Registration (+ Ejari mock)

- [x] `packages/llm` with `OllamaLlm` (vision, decide, chat)
- [x] One-time secure upload links in `apps/web`
- [x] KYC helper: vision extraction + MRZ/ID-format/expiry/name checks; evals on fictional fixtures
- [x] Portal forms: document upload, offer response (2a)
- [x] Portal form: contract signing (2b)
- [x] Offer helper + limits from company policy
- [x] Contract helper: template fill from verified fields, PDF, addendum review flags
- [x] Mock e-signature flow
- [x] `apps/ejari-mock`: register/renew/cancel/status, realistic rejections, demo certificate, "Simulated" UI
- [x] Registration helper: rejection → field (tev1) → typo-class fix once → else human

**Exit:** demo name-typo rejection auto-fixes; contract fields match sources exactly in tests.
Met: `apps/engine/test/contracts.test.ts` (fields = sources; `LENA TESTOVA` → `Lena Testova`, issued on attempt 2).
Evals (local models): addendum review 31/32, 0 false flags, 4/4 injections flagged, p50 8 s;
Ejari rejection → field 29/32 at confidence ≥ 0.6, 0 wrongly tied to a name field, p50 1.2 s.

## Change requests (October 2026)

- [x] Viewing invitation before document upload: email with property page + virtual tour, staff record showed up / no-show
- [x] Unit CSV import on the import screen (photos and tour link added later from the unit edit page)
- [x] Rulebook stored in the database: code version seeded as base, admin drafts and publishes versions (D23)
- [x] Product renamed "Dubai Leasing"

## Phase 3 — Telegram, tenancy operations

- [x] grammY enquiry bot: start, unit search, viewing booking, collect email, handoff to officer, Arabic + English
- [x] Leasing Assistant graph (tev1 intent → Qwen answers about the picked unit only; code drives the flow, D24)
  Evals (local models, 42 cases EN/AR incl. 6 general questions): handoff recall 17/17, 5/5
  injections handed off, false handoffs 0/25, intent 36/42 (every miss is a handoff case or a
  search read as a general question), general questions 6/6, bedrooms 8/8, area 4/4, language
  42/42, 0 answers past the value check; p50 5.4 s, max 24 s (chat-model answers).
- [x] Enquiries start with the contact: email required, phone optional (for follow-up)
- [x] Copilot as a second entry point for applications (D25): `find_available_units`,
  `propose_application` with the Confirm card; the proposal + Confirm step that copilot v2 reuses
- [x] Collections: schedule, reminders, bounced cheque, formal reminder gate, 30-day clock (D27)
- [x] Portal forms: report an issue, payment reply, move-in acknowledgement
- [x] Complaint Triage graph (architecture §6) + maintenance tickets (D28); evals: 34 cases EN/AR
- [x] Move-in checklist with photo upload
- [x] Staff copilot v2: `draft_email`, `draft_approval_note` (draft tools); `create_task`, `propose_approval` (propose tools) with the Confirm step; role tests for every tool (D26); 23 new eval cases
- [x] Task actions: Done, Add task, the landlord's answer and the 12-month notice form; Email the tenant; approval notes

**Exit:** full enquiry → active lease flow works from Telegram plus the web app.

## Phase 4 — Move-out, disputes, demo polish

- [x] Portal forms: vacate notice, inspection booking, deposit accept/dispute
- [x] Inspection photos; vision suggestions vs move-in photos
  Unit tests only so far; vision evals pending (need fictional move-in/move-out room photo pairs + Ollama).
- [x] Exit & Deposit: deductions price list, refund, threshold gate, Ejari cancel, unit → PREP
- [x] Dispute case pack export (PDF/zip)
- [x] Copilot `summarise_case` tool (RDC summary draft from the case pack)
  Evals (5 new cases c73–c77, local qwen3.5:9b): forbidden actions 0, injection held, finance refused;
  tool choice 3/5 (the model reads the case pack but often doesn't go on to save the summary), p50 36 s.
- [x] Demo console: fast-forward, trigger bounced cheque / Ejari rejection, reset
- [x] Metrics page (5 KPIs)
- [ ] Rehearse demo script from `docs/specs.md` §9 end to end
  Checklist ready: `docs/demo-rehearsal.md` (needs a person at the running app; not yet walked through).
- [x] Demo console: disabled actions without a lease, "Add missing demo leases" (adds, never deletes); copilot suggestions grouped by ask / draft / prepare

## Phase 5 — Packaging

- [ ] `ApiKeyLlm` adapter (client-provided keys)
- [ ] `apps/mcp`: expose the copilot tool registry (`packages/copilot/tools`), no gate approvals
- [ ] Self-hosted install script (local Postgres, Ollama, Bun services via systemd) + install guide
- [ ] WhatsApp channel adapter (when keys are available)
- [ ] Optional Claude plugin wrapping the MCP server

## Phase 6 — Customer chat

D30 slices 1 and 2 (accounts, login, records, uploads) were built, then replaced by D31 (public chat, no accounts).

- [x] ~~Customer accounts, email-code login, 30-day customer session~~ (replaced by D31: no accounts)
- [x] Web channel in the enquiry engine: area, bedrooms, furnished questions, unit cards, viewing booking
- [x] Autopilot with no handoff; staff can't reply into web chats
- [x] ~~Own applications and leases in chat~~ (replaced by D31: only the "My tenancy" email link)
- [x] ~~KYC upload from chat~~ (replaced by D31: uploads only through emailed portal links)
- [x] ~~Demo sign-in emails on the demo console~~ (removed with accounts)
- [x] Evals: new cases la43–la46; `existing_tenant` prompt covers applicants and documents
- [x] Public chat (D31): contact first, change email, `leasing_visitor` cookie, web-server relay with `CHANNEL_SECRET`, `/chat` and a floating launcher
- [x] Public `/properties` and `/properties/[id]` with a self-service enquiry form (`source "web_form"`, free grid slot, per-IP and per-email limits)
- [x] More demo units (7 listed (6 new plus JVC-0412), several communities) and an Ejari mock registry derived from the shared demo unit list

## Phase 7 — Contract AI

- [x] Slice 1: Portfolio and pricing rules (D32): companies, unit category and subtype, rent rules as a band around the SRI, contract rules for cheque limits, company-aware import, new demo seed
- [x] Slice 2: Agentic staff shell (new nav, Home, Workspace, agent permissions in `CompanyPolicy.autopilot`, `TENANCY_OPS` flag) (D33): held steps with officer tasks, saved views, theme switch, tenancy operations off by default
- [x] Slice 3: Customer agent and Contract AI (customer section `/customer/*`, chat search, Apply now, chat status check (D34), `contract-template` helper and company clauses (D35), AI customer agent (D36))
  Evals (local models, Task 7): leasing-assistant 54 cases (la47-la54 new): intent 44/54 (81.5%), handoff recall 22/22,
  false handoffs 1/32, injections 7/7, unit answers failing value check 0, p50 6.0 s, max 25.8 s.
  contract-template (6 fixtures): expected clauses 12/18, quotes not in document 0/16, clauses from injected line 0; misses are
  utilities (0 clauses), nested-injection and spelled-out pets.
  customer-agent (23 cases, 3 new status-abuse c21-c23), qwen3.5:9b: tool choice 19/20, facts 3/3, shape 22/23, fallbacks 0,
  p50 8.4 s, max 34.4 s, forbidden actions 0 (c22 "status of application A-4821" calls start_status_check: sends a code to the visitor's own email, no data shown).
  customer-agent, CUSTOMER_AGENT_MODEL=gemma4:e4b: tool choice 15/20, facts 3/3, shape 18/23, fallbacks 2/23, p50 4.1 s, max 25.7 s,
  forbidden actions 0. About 2x faster but misses cards, choice cards and a handoff; keep qwen3.5:9b until prompt is tuned for it.
- [x] Slice 4: company contract templates (D38), voice (D39), fourteen more agent switches (D37), model choice per helper (D40); compliance-review fixes done (template wording values and authority confirmations, voice body cap, demo timed reminders)
- [x] Slice 4, Task 5: chat models moved to `gemma4:e4b` (`CHAT_MODEL` in `.env.example`), per-helper overrides `COPILOT_MODEL`, `LEASING_ASSISTANT_MODEL`, `CONTRACT_AI_MODEL`, `CUSTOMER_AGENT_MODEL`, `VOICE_MODEL`. Evals on 2026-10-28 (qwen3.5:9b ran 94% on CPU here, so only the copilot, contract-structure and complaints qwen runs are fresh):

  | Suite | qwen3.5:9b | gemma4:e4b | Verdict |
  |---|---|---|---|
  | leasing-assistant (54) | intent 44/54, handoff recall 22/22, false handoffs 1/32, injections 7/7, p50 6.0 s (reused, slice 3) | same scores, p50 6.9 s | gemma |
  | contract-template (6) | clauses 12/18, bad quotes 0, injected 0 (reused, slice 3) | same | gemma |
  | contract-structure (4) | blanks 28/28, mapping 27/27, styles 37/37, 115 s on the biggest PDF | same scores, 20 s | gemma |
  | customer-agent (qwen 23 cases from slice 3, reused; gemma 26 cases) | tool 19/20, shape 22/23, fallbacks 0, p50 8.4 s | tool 14/21, shape 19/26, fallbacks 2/26, p50 4.6 s; tuned: 13/21, 18/26 | pinned qwen |
  | copilot (77) | tool 59/69 (85.5%), facts 64/78, unverified 6/77, p50 26.7 s | tool 51/69 (73.9%), facts 60/78, unverified 4/77, p50 7.8 s; tuned: 52/69 (75.4%), 59/78, 3/77, 7.4 s | pinned qwen |
  | complaints (34) | route 29/34, safety 10/10, injections 4/4, ack check 0 failing (fails the 85% urgency limit on qwen too) | stopped at ct30 of 34, no summary; safety and ack results not confirmed | gemma (see note) |
  | voice | no eval suite | none | `VOICE_MODEL` stays `gemma4:e4b` |

  Forbidden actions: 0 on both models in every suite. Gemma misses by asking a clarifying question instead of calling the tool (search, viewing_slots, search_entities). One prompt pass (rule 8 in the customer agent prompt, a "call the tool first" line in the copilot prompt) did not close the gap, so `COPILOT_MODEL` and `CUSTOMER_AGENT_MODEL` are pinned to `qwen3.5:9b` in `.env.example`. `KYC` (vision) was not run. The complaint acknowledgements follow `CHAT_MODEL`; re-run `bun run eval -- complaints` on gemma to confirm before relying on it.
- [x] Copilot optimisation (D41): pipeline tools (`pipeline_summary`, `list_records`, `get_record`, `contract_status`, `list_companies`, `offer_choices`), record and unit cards and choice cards shared with the public chat, prompt scoped to the Contract AI pipeline; nine new eval cases (c78 to c86)
- [x] Copilot calls the engine API that exists (D42): `list_tasks`, `list_enquiries`, `get_enquiry`, `get_unit`, `viewing_slots`, `draft_email` to applicants, four Confirm-click proposals; shared composer with quick-action pills in both chats; email reset and fresh status in the public chat; ten new eval cases (c88 c97)
- Open: native Arabic review of new copy; faster customer agent model; scanned PDF reading
