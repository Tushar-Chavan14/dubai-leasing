# Contract AI: agentic redesign, companies and pricing rules

Date: 2026-10-27. Status: draft for approval. Source: the product owner's three-screen sketch
(admin chat home, application log, configuration) and the pitch feedback below.

## 1. Why

In pitches the product read as a "digital SaaS app": 13 nav items, and many clicks in the
offer, document-check and contract steps. The new pitch is **Contract AI**: an agent runs
enquiry → application → offer → contract → Ejari registration, and people only step in where
the law or money needs them. The product now ends at a registered Ejari certificate. Move-in →
move-out is set aside (kept working behind a flag, not deleted).

**Success:** a demo walks from a visitor's first chat message to a downloadable Ejari
certificate, with a staff user making only the decisions the law requires (contract approval,
Ejari approval, the reservation payment), each one click from the screen they're already on.

**Anti-goals:** the agent never approves a gate; no new path sends tenant documents to a cloud
model; no "AI toggle" that switches off a legally required approval (AGENTS.md rule 3).

## 2. Decisions taken in this session

| Topic | Decision |
|---|---|
| Agent permission toggles | Soft steps only. Legal and money gates are shown locked with the reason. |
| Visitor status in chat | Email code in chat → read-only status for that session. New D32 amends D31. |
| Rent margins | Both: % band against the SRI **and** an optional AED floor/ceiling per rule. |
| Property type | `category` (residential, commercial, retail) + optional `subtype` (apartment, villa, townhouse, penthouse, office, shop, showroom, warehouse). |
| Scope cut | `TENANCY_OPS=false` flag hides move-in → move-out. Code and tests stay. |
| Sample contract upload | A local model reads it and proposes clauses. An admin reviews every clause. |
| Company vs landlord | Separate. A unit has a `company_id` (portfolio owner of the rules) and its own landlord party. |
| Staff shell | Four nav items: **Home, Workspace, Units, Settings**. Units stays top level. |

## 3. Data model (one migration per slice)

**`companies`** (new): `id`, `name`, `slug` (unique), `kind` (`developer` \| `realty` \|
`owner`), `trade_licence_no`, `email`, `active`, timestamps. Fictional names only in demo data.

**`units`** (changed): `company_id` (not null, FK), `category` replaces `kind` (adds
`retail`), `subtype` (nullable), `emirate` (default `dubai`), `country` (default `AE`).
`community` stays as the area/location. Migration for real installs: create a "Default
company", attach every unit, `category` = old `kind`.

**`sri_averages`** (changed): adds `category`; `bedrooms` becomes nullable (null for
commercial/retail); adds `avg_annual_rent_per_sqft_fils` for commercial/retail. Unique key
becomes `(community, category, bedrooms, effective_from)`. *My call:* commercial and retail
SRI is per sqft, because bedroom counts don't apply.

**`rent_rules`** (new, versioned like policy): `company_id`, `category`, `subtype?`,
`emirate`, `community?`, `min_pct_vs_sri`, `max_pct_vs_sri` (signed basis points, for example
−500 … +1000), `min_rent_fils?`, `max_rent_fils?`, `active`, `created_by`, timestamps. The
most specific active rule wins: community > subtype > category.

**`contract_rules`** (new): `company_id`, `category`, `subtype?`, `tenures`
(`annual` \| `short_term`, array), `min_cheques`, `max_cheques`, `clause_ids` (array),
`sample_document_id?`, `active`. **`company_clauses`** (new, slice 3): `company_id`, `title`,
`text_en`, `has_values` (boolean), `status` (`proposed` \| `approved` \| `rejected`),
`source_document_id`, `helper_run_id`, `approved_by`.

**Agent permissions:** an `autopilot` object added to the versioned `CompanyPolicy` (so every
change is a new policy version with author and date, which already gives an audit trail). No new
table.

## 4. Pricing (replaces `askingRentRangeFils`)

A new pure function `allowedAskingRange(unit, sri, rule)` in `packages/core` (company policy,
not law, so it doesn't go in the rulebook) returns `{min, max, basis}`:

- SRI band = SRI × (1 + min%) … SRI × (1 + max%). Commercial/retail: per-sqft rate × `area_sqft`.
- Intersect with the AED floor/ceiling when set.
- No SRI row → AED bounds only. No rule or no bounds → `null`, and setting a price always opens
  `price_out_of_range` for a manager (fail closed).
- Integer fils, rounding toward the narrower range. One test per branch.

`price_out_of_range` keeps its name and approver; its reason text cites the rule, the SRI row
and the computed band as `sources`. Offer limits: cheque range and tenure come from the matching
`contract_rule` when one exists, otherwise from `CompanyPolicy` as today.

## 5. Agent permissions (Settings → Agent)

Toggles (stored in `CompanyPolicy.autopilot`; defaults keep today's behaviour):

| Step | Default | Off means |
|---|---|---|
| Book viewings from chat without staff | on | Chat collects a request; staff pick the slot |
| Let applicants apply without a viewing (`ENQUIRY → SCREENING`) | off | Viewing first, as today |
| Verify KYC automatically when nothing is flagged | on | Every KYC goes to `kyc_review` |
| Send offer revision 1 automatically | on | Officer confirms before it's emailed |
| Send counter-offers within limits automatically | on | Officer confirms each one |
| Prepare the contract as soon as the reservation is recorded | on | Officer starts it |

**Locked (shown, not toggleable, with the reason):** final contract, Ejari submission, offer or
price outside limits, flagged KYC, recording a reservation payment. Being honest about it: most
toggles can only make the flow *more* manual, because the engine already automates every soft
step. The clicks the pitch complained about come from the screens, so most of the gain comes
from slices 2 and 3.

## 6. Screens

### Design read

Two audiences, two dial sets, one token system (D18: vanilla CSS tokens, Instrument Sans,
Bricolage display, Geist Mono for references, leaf green as the only accent, saffron only for
deadlines, brick only for errors; light and dark). No component library, no Tailwind. The
taste skill rules on copy, colour, shape and anti-slop apply everywhere. Its landing-page
layout rules apply only to the public screens (it treats admin panels as out of scope).

- Staff: *redesign (overhaul the information architecture, keep the brand), leasing operators,
  calm and agent-first, product UI.* Variance 4, motion 3 (state transitions only), density 5.
- Public: *consumer property search led by chat.* Variance 6, motion 4, density 3.

"Agentic" in practice: the input box is the main control; every log entry says **who** acted
(Agent, You, Applicant, System) in one plain sentence; anything waiting on a person is the
loudest thing on screen; there are no forms where the agent can propose a value instead.

### Public: chat + listings (anonymous)

Split screen: **chat on the left (about 40%), listings on the right**, kept in sync (the
chat's filters drive the grid; clicking a card puts that unit in the chat). Mobile: chat
full-screen with a "Show 12 homes" pill that opens the grid.

Flow, driven by code with the model reading free text (the D24 pattern): email first (exists) →
chips for emirate → area → category → bedrooms (residential) or size (commercial/retail) →
budget (optional) → unit cards → **Book viewing** or **Apply now** (if the toggle allows) →
creates the application through the normal route. Country is fixed to UAE for now, with Dubai
the only active emirate (the chip shows others as "coming soon"; *my call*, since the rulebook
only covers Dubai).

**Status (D32):** "Check my applications" → 6-digit email code → the chat shows each
application as a compact stage tracker (Viewing → Documents → Offer → Contract → Ejari) with
the next step. Action buttons *email* the relevant portal link (upload documents, open offer,
sign contract, download Ejari certificate). Nothing opens or uploads inside the chat, so rule 10
holds: outbound goes by email and documents go only through emailed links. Session-only, with a
code limit per email and per IP.

### Staff Home (`/`): copilot + quick actions

Top: five quick-action tiles with live counts. Each opens the Workspace pre-filtered:
**Viewings today · Offers out · Awaiting signature · Ejari pending · Waiting for you**
(approvals this user can decide). Centre: the copilot ("What should we move forward today?")
with suggestion chips taken from those counts. Below: a short "Agent did today" feed (the last 8
helper/system events). The current `/copilot` page and side panel merge into this.

### Staff Workspace (`/work`): list → activity log → detail

- **Left pane:** search; saved views ("folders": a name + filter, stored per user); the list of
  applications and leases, grouped by stage, each row showing the next step and who owns it.
- **Centre pane:** the selected record's **activity log**: `lease_events` for the application
  and its lease, approvals, outbound emails and tasks, merged by time. Pending human steps sit
  pinned at the top with inline actions (Approve / Reject / Edit for gates the user can decide;
  Record viewing outcome; Record reservation). Same routes and permissions as today.
- **Right pane (collapsible):** details of the selected log entry: the proposal and its
  `sources`, contract preview, KYC field read-outs, email evidence, Ejari certificate.

`/inbox`, `/applications/[id]`, `/leases/[id]` and `/conversations` redirect into Workspace
views. The approval inbox becomes the "Waiting for you" view.

### Staff Settings (`/settings`)

Tabs: **Companies** (list, add/edit, portfolio count) · **Rent rules** (category tabs as in the
sketch; rows of company / type / area / SRI band / AED bounds; "Add rule"; "View rent index"
opens the SRI table) · **Contracts** (contract rules + upload a sample contract → clause review)
· **Agent** (toggles from §5) · **Rulebook** (existing `/rules`) · **Import** (existing, now
company-aware) · **Demo** (existing console, demo mode only).

### Units (`/units`)

Stays top-level. Adds company, category and subtype filters; the price box shows the computed
band and which rule and SRI row it came from.

## 7. Scope cut (`TENANCY_OPS`, default `false`)

When off: the nav and Workspace hide maintenance, tasks for tenancy work, metrics, collections,
renewals, move-out and disputes; the engine doesn't schedule rent-reminder, renewal or move-out
jobs; tenant portal routes `move-in`, `payment`, `report`, `vacate`, `inspection` and `deposit`
return 404; the copilot registry drops tools for those steps. The lease state machine is
unchanged; the demo ends at ACTIVE with the Ejari certificate. Tests keep running with the flag
on, plus new tests for flag off.

## 8. Import and seed

**Import:** the page asks "Import into which company?" first; that company applies to every row.
New optional columns: `category`, `subtype`, `emirate`. An unknown `subtype` is a row error.
`docs/import.md` updated.

**Seed (replaces the current demo units):** `DEMO_PROPERTIES` in
`packages/core/src/demo-units.ts` is rebuilt around 3 fictional companies (one developer, one
realty firm, one private owner-landlord), about 14 units across residential (apartments,
villas, townhouses), commercial (offices) and retail (shops), in 5 Dubai communities. Also
seeded: SRI rows for every community × category/bedrooms, one or two rent rules and one contract
rule per company, landlord parties, and applications at each stage (viewing booked, documents in,
offer out, reserved, contract awaiting signature, Ejari pending, registered) so the Workspace
isn't empty. The Ejari mock registry keeps deriving from `DEMO_PROPERTIES`. `demo:reset` is the
way in; no data migration for demo data.

## 9. Slices

### Slice 1: Portfolio and pricing rules (backend + Settings)

- Migration: `companies`, unit columns, `sri_averages` changes, `rent_rules`, `contract_rules`.
- `allowedAskingRange` + tests; `units.ts` price check switches to it; offer helper reads cheque
  and tenure limits from `contract_rules`.
- Engine API: companies, rent rules, contract rules (CRUD; admin only; versioned writes logged).
- Import: company picker + new columns. New seed (§8).
- Settings screen in the new style: Companies, Rent rules, Contracts (fields only, no upload
  yet), Rulebook/Import/Demo moved in as tabs.
- Docs: D32 (companies, rent bands, contract rules), architecture §3/§10, `docs/import.md`,
  dubai-leasing skill. Compliance review (pricing gate, offer limits).

### Slice 2: Agentic staff shell

- Nav → Home, Workspace, Units, Settings. Redirects from the old routes.
- Home: quick-action tiles + copilot + "Agent did today".
- Workspace: three panes, merged activity log endpoint (`GET /api/records/:kind/:id/log`),
  inline gate actions, saved views (small `saved_views` table).
- `CompanyPolicy.autopilot` + Settings → Agent tab; engine reads each toggle at the matching
  step; locked gates are listed from `approvalGates`.
- `TENANCY_OPS` flag across engine, web, portal and copilot registry.
- Docs: D33 (agent permissions, scope cut), specs scope, roadmap. Compliance review (toggles must
  not reach any rule-3 gate; copilot registry filtering).

### Slice 3: Customer agent and Contract AI

- Public split screen chat + listings; guided chips (emirate, area, category, size/bedrooms,
  budget); "Apply now" when allowed.
- D32/D34 chat status: email code, session-scoped status tracker, "email me the link" actions;
  AGENTS.md rule 10 amendment.
- `contract-template` helper (follow the `new-helper` skill): sample PDF → text (text layer;
  scanned pages through the local vision model only) → local chat model proposes clauses (Zod,
  retry once, else `needs_human`) → admin reviews each one → approved clauses become company
  clauses usable in contract rules. Clauses that mention amounts, dates or periods are marked
  `has_values` and need an explicit admin confirmation; numeric terms always come from rule
  fields, never from the extraction.
- Contract helper preselects the addendum from the matching contract rule; `Addendum.clauses`
  accepts company clause ids.
- Evals: chat search cases (EN/AR), status-code abuse cases, template extraction fixtures
  (fictional contracts), one injection case per new tool or prompt.
- Compliance review (contract addendum, Ejari payload unaffected, PII in chat status).

## 10. Left to the builder

- Exact copy, icons from the existing `lib/icons`, the stage-tracker visual, and log entry
  wording (plain sentences, no em dashes in UI copy).
- Whether the activity log endpoint is one SQL union or merged in code.
- Fictional company and community names (must not match real Dubai developers; the sketch's
  "Modon" is a real company and isn't used).
- PDF text extraction library (must run locally; check licence; pinned version noted in the
  summary).

## 11. Open risks

- Commercial and retail leases: the Dubai rulebook today assumes residential. Rent-increase caps
  (Decree 43/2013) also apply to commercial in Dubai, but the dubai-leasing skill must confirm
  before retail units can reach Ejari in the demo.
- D32 reintroduces email codes that D31 removed; keep it read-only and session-scoped so it
  doesn't turn back into accounts.
- Slice 2 touches most web pages; per memory, don't run `next build` while the dev server runs.
