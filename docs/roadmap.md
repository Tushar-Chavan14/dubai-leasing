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
