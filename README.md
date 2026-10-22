# Leasing agents

Automates the Dubai residential leasing lifecycle, from an empty unit to tenant move-out, with
local AI helpers and human approval for every legal or money step. A staff copilot lets
leasing staff ask about leases and deadlines, get drafts and propose approvals in chat.

## Start here

1. Read `docs/specs.md`, then `docs/architecture.md`.
2. Install: Bun, PostgreSQL (local install), Ollama. No Docker needed.
3. Create the databases (local Postgres 16+, no Docker):
   ```bash
   createuser -P leasing
   createdb -O leasing leasing         # app database
   createdb -O leasing leasing_test    # test database: tests DROP and recreate its tables
   ```
4. `cp .env.example .env` and set `DATABASE_URL`, `TEST_DATABASE_URL` (must name a `*test*`
   database), model tags, Telegram bot token and SMTP details.
   - **Mail:** `MAIL_TRANSPORT=ethereal` needs nothing else (test inbox; preview links are
     public, fictional data only). For real SMTP, e.g. Gmail: `SMTP_HOST=smtp.gmail.com`,
     `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASS` (an app password),
     `MAIL_FROM`.
   - **`MAIL_DEMO_RECIPIENT`** (required with `DEMO_MODE=true` and real SMTP): the inbox that
     receives every demo email. The engine won't start without it.
   - `DOCUMENTS_DIR` (default `./data/documents`): generated notice PDFs. Must not overlap
     `UPLOADS_DIR`.
   - **Telegram enquiry bot:** `TELEGRAM_BOT_TOKEN` (from @BotFather) and `CHANNEL_SECRET`
     (`openssl rand -hex 32`; the engine and the bot read the same value). Without the token the
     bot stays off; without the secret the engine's bot route is off. Polling needs nothing else;
     webhook mode also needs `TELEGRAM_WEBHOOK_URL` (HTTPS, ending in `/telegram/webhook`) and
     `TELEGRAM_WEBHOOK_SECRET`. Enquiries appear in the staff app under **Enquiries**.
5. `ollama pull tev1` and pull your chat and vision models.
6. Run it:
   ```bash
   bun install
   bun run db:migrate
   bun run demo:seed      # or demo:reset to start over (wipes everything); demo:rewind returns the clock to today and keeps data
   bun run dev            # engine :4000, staff app :3000, Ejari mock :4100
   ```
   Open http://localhost:3000, pick a demo user (the manager can approve renewal notices), and
   use **Demo clock** to fast-forward: +10 days opens the renewal window on `MRN-1204`, +31 more
   puts its renewal notice in the inbox. Approve it, then +20 days sends it (T−100): the email
   has the PDF and links to the tenant portal (`/t/…`), where the tenant acknowledges and
   replies. On the lease page, "Renew lease" applies the new term and rent.
   Units → **Add unit** registers a unit with its DLD, Makani and DEWA numbers, layout, asking
   rent and photos. Photos are stored under `MEDIA_DIR` (default `./data/media`).
   **New tenant (phase 2a):** Applicants → open Priya's application on `JVC-0412` → **Start
   screening**. The upload link arrives by email (demo inbox); upload
   `packages/helpers/src/kyc/evals/specimens/priya-eid-front.png` and `priya-eid-back.png`, then
   **Send for checking**. The vision model reads them (about a minute on a 4 GB GPU), the checks
   pass and the offer email arrives. Answer it (accept, or counter with more cheques), then record
   the reservation on the application: the lease is created in CONTRACT. Try
   `priya-eid-front-expired.png` to see a KYC review that can't be approved.
   **Contract and Ejari (phase 2b):** run the simulated registry too (`bun run dev` starts it on
   :4100; its page lists every registration and request). Open the lease on `MRN-1608` (seeded in
   CONTRACT; Priya's lease gets the same after her reservation) → **Prepare the contract** → in
   the inbox, a second user approves **Final contract** (fields with their sources, PDF). Both
   signing emails arrive in the demo inbox: open each link, type the name and sign. The lease
   moves to REGISTRATION and **Submit to Ejari** appears in the inbox. Approve it: the simulated
   registry rejects `LENA TESTOVA` (it holds "Lena Testova"), the registration helper corrects the
   case once from the verified name, and attempt 2 is issued: the lease moves to MOVE_IN with the
   simulated certificate. `MOCK_EJARI_FAILURE_RATE` (0–1) makes the registry answer "temporarily
   unavailable" for that share of requests, to show retries.
   **Copilot:** the **Ask** button (Ctrl+J) opens a chat about the page you're on; **Copilot**
   in the menu keeps your past conversations. It reads only: it answers from the engine
   (quoting the rules version) and can't approve, send or change anything. It runs on
   `COPILOT_MODEL` (empty = `CHAT_MODEL`), which must support tool calling. Values it states
   without a tool result behind them are highlighted as unverified.
7. Checks: `bun run typecheck`, `bun run lint`, `bun test`. Model evals (Ollama running):
   `bun run eval -- reply`, `kyc`, `contract-review`, `ejari-field` and `copilot` (the copilot
   eval drops and reseeds `TEST_DATABASE_URL`).

Importing existing leases and units: see `docs/import.md`.

## Files for coding agents

| File | Purpose |
|---|---|
| `CLAUDE.md` | Claude Code entry point (imports `AGENTS.md`) |
| `AGENTS.md` | Rules, repo map, commands for any coding agent |
| `.claude/skills/dubai-leasing/` | Domain knowledge skill |
| `.claude/skills/new-helper/` | Procedure for adding a helper |
| `.claude/skills/new-copilot-tool/` | Procedure for adding a staff copilot tool |
| `.claude/agents/compliance-reviewer.md` | Subagent that reviews legal-sensitive diffs |
| `.claude/settings.json` | Allowed commands; blocks reading `.env` and uploads |
| `docs/decisions.md` | Decisions already made |
| `docs/roadmap.md` | Phased task list |
| `docs/source/leasing-guide.txt` | Original business guide |

Rulebook values and notice templates need review by a Dubai property lawyer before real use.
Ejari is simulated in this build.


# System Roles and Permissions Matrix

All four roles sign in at `/login` and share the same primary navigation menu: **Overview, Inbox, Applications, Leases, Units, Tasks, SRI, Rules, Copilot, and Import**. Pages do not block users by role; instead, the backend engine refuses unauthorized actions, and UI buttons are dynamically hidden based on the user's role.

---

## 👥 Role Permissions Overview

| Feature / Action | Leasing Officer | Leasing Manager | Finance | Admin |
| :--- | :---: | :---: | :---: | :---: |
| **View everything** (Leases, units, applications, approvals, tasks, SRI, rules) | ✓ | ✓ | ✓ | ✓ |
| **Applications:** Create (sends viewing invite), book viewing, showed up / no-show, resend upload link, record reservation, close | ✓ | ✓ | — | — |
| **View applicant ID images & contract PDFs** *(Each view is logged)* | ✓ | ✓ | — | — |
| **Leases:** Record tenant replies, renew, SRI override, prepare/resend contract, propose Ejari | ✓ | ✓ | — | — |
| **Units:** Create, edit, photos, publish/withdraw, request price approval | ✓ | ✓ | — | ✓ |
| **Import leases and units** | — | ✓ | — | ✓ |
| **Edit the SRI table** | — | ✓ | — | ✓ |
| **Rules:** Create, edit, delete, and publish drafts | — | — | — | ✓ |
| **Demo fast-forward** | ✓ | ✓ | — | ✓ |
| **Copilot** *(Read-only tools, operates with user's own permissions)* | ✓ | ✓ | ✓ | ✓ |

---

## 🔐 Approvals & Decisions Matrix

> ⚠️ **Strict Constraint:** Nobody can approve their own proposal.

### 🏢 Leasing Officer
* Final contract
* Ejari submission
* KYC review
* Ejari rejected twice
* Safety complaint

### 📈 Leasing Manager
* *All items the Leasing Officer can decide, plus:*
* Price out of range
* Offer out of limits
* Renewal notice *(Cannot approve a renewal notice based on an SRI value they entered themselves)*
* Formal reminder
* Vacate notice

### 💰 Finance
* Refunds only *(Note: Currently, nothing raises a refund approval in the system, meaning Finance can only view data at this stage)*

### ⚙️ Admin
* Configures the system but **approves nothing**.

---

## ⚠️ Known Gaps & System Scope

* **Missing Screens:** The Admin role currently lacks screens for company policy configuration and user management.
* **UI Leaks:** Pages like `/import` and `/units/new` are accessible to Finance, though saving data is strictly refused by the backend.
* **Security Exception:** The endpoint `/demo/sweep` currently has no role check validation.
* **Tenant Portal:** The tenant portal (`/t/<token>/…`) operates independently of system roles. Each emailed link is tokenized to grant isolated access to exactly one application or lease.
