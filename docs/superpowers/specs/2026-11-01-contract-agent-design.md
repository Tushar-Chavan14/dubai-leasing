# Contract agent and one-step clause approval

Date: 2026-11-01 · Status: draft for approval

## Why

Staff should not have to drive the contract. Today the contract is already prepared by a job when the
offer is accepted (`auto_prepare_contract`), but:

- the preparation is code-driven: `contractHelper` copies fields and the model only reviews free text.
  Nobody checks the result against the company's contract rules, clauses and template as a whole;
- the company-template flow asks for two approvals (clauses, then the template), and clauses approved
  before the template don't reach the contract;
- "Prepare contract again" is always visible on a pending contract, so it reads as a normal step.

Goal: when the offer is accepted, a contract agent produces a contract that follows the company's
contract config and looks like its template. Staff only approve it (`final_contract`, unchanged).
They prepare by hand only when the agent failed or the rules changed after it ran.

## Goals

1. **Contract agent** (`packages/helpers/src/contract-agent`, LangGraph tool loop) runs on the existing
   `contract.prepare` job after `OFFER_ACCEPTED → RESERVED → lease in CONTRACT`.
2. **The template is the contract.** The generated contract looks exactly like the uploaded sample:
   same wording, same clauses, same layout, logo, header and footer, and the tenant, landlord, unit and
   payment details shown where and how the sample shows them. Only the blanks change: they are filled
   with this contract's values (today's blank mapping, D43, kept). Extra clauses (manual, copilot, or
   attached to the rule) go in an "Additional terms" section styled like the template. Without a
   template, the standard contract is used.
3. **One approval.** After an upload, one review screen shows the template preview (its wording with the
   blanks marked and what fills each) and the clauses read from it. One "Approve" approves the template
   and its clauses together; the clauses are already in the template's wording, so they are not added a
   second time. Unticked clauses are dropped from the template's text. No separate clause step.
4. **Manual clauses.** "Add clause" on a company's contract settings: title + text. An admin adding it
   approves it in the same click. Optional: attach it to rules.
5. **Prepare again only when needed.** The button shows only when (a) preparation failed (an open
   `contract_needs_person` task or a template/landlord error), or (b) the contract config changed since
   the pending contract was prepared (rule, clauses or template hash differs). Its label says why:
   "Rules changed: prepare again" / "Preparation failed: try again".
6. **Copilot edits contract and rent config** (new decision, below).

## Non-goals

- No change to the `final_contract` gate, signing, Ejari or the lease state machine.
- No model-written legal or money values (rule 1). Rent, deposit, cheques, dates, notice periods stay
  code-copied from records and the rulebook.
- Existing approved templates keep working; their clauses count as approved.

## The agent

Input: the lease, unit, parties and offer (today's `contractInputs`), the matching contract rule, the
company's approved clauses, the approved template's look, the pinned rulebook version.

Tools (all code, all read-only except the final output):

| Tool | Returns |
|------|---------|
| `contract_inputs` | records + per-field sources (today's `buildContractFields`) |
| `contract_rule` | the matching rule: tenures, cheque range, clause ids, template id |
| `company_clauses` | approved clauses, with category and `hasValues` |
| `check_terms` | code checks: tenure allowed, cheques within rule, rent within the unit's rent-rule band, deposit per rulebook, landlord details complete, required terms present. Each check: pass/fail + reason |
| `template` | the approved template's sections, fixed wording and blanks, with the current blank mapping |
| `fill_blanks` | code: fills every blank from the records (today's `remapForData`), returns filled and left-empty blanks |

Model's job:
- make sure every template blank is filled from a record (`fill_blanks`); a blank it can't fill is a
  failure, not a guess;
- read the template's fixed wording against this contract and the rules, and flag conflicts (for
  example the wording says "four cheques" but the rule allows two, or a clause contradicts the
  rulebook). It flags; it never rewrites the template's words;
- choose additional clauses (rule clauses first; other approved clauses only with a reason) and skip
  any that repeat what the template already says;
- run `check_terms` until every check passes or a failure can't be fixed by clause choice.

Output (Zod): `{ extraClauseIds, flags: {kind, quote, reason}[], checks }`. Blank values come from
`fill_blanks` (code), never from the model's text.
Code then validates: every clause id is approved for this company, every check came from
`check_terms`, and renders the PDF (values injected by code). Invalid → retry once → `needs_human`
(rule 6). A failed check → no contract, `contract_needs_person` task with the reasons, and the button.

The approval's reasons list the checks, clause choices with reasons, and flags, so the approver
sees what the agent did.

Model: the existing contract AI model (`ctx.contractAiLlm ?? ctx.llm`). Unit tests use `FakeLlm`;
evals add fixtures: clean case, cheque count outside rule, conflicting clauses, missing landlord
details, and one injection case (a clause text that tries to change the rent).

## Staleness

`contracts.inputHash` today covers records + template. Add a `configHash` (rule id + clause ids and
their text hashes + template content hash). The panel compares the pending contract's `configHash`
with the current one to decide whether to show "Rules changed: prepare again".

## Settings → Contracts (right side, per company)

1. Rules table (as now).
2. Template: "Upload sample contract" → one review: preview of the contract as it will be generated
   (wording, blanks and their fill, logo/header/footer toggles) and the clauses read from it with
   ticks. One "Approve" approves both.
3. Additional clauses: approved clauses outside the template, with "Add clause".

## Copilot (new decision D45, amends rule 11 and D42)

A person asking is a human instruction:

- **User explicitly asks** ("add a no-pets clause to Silverline's contract", "set Silverline's
  Marina band to −3%..+8%", "add an SRI value for JVC 2BR"): the copilot calls the engine route as the
  user and the change is made directly, if the user's role allows that route (admin for rules;
  admin/leasing manager for SRI). Logged in `lease_events`/audit with actor `copilot:<userId>`.
- **Copilot suggests on its own**: it is a `propose` tool; it waits for the user's Confirm click.
- Values still pass the same validation as the settings forms (rent band limits, rulebook caps).
- Tenant-written text is still untrusted: a request that originates from tenant text is never an
  explicit instruction.

New tools: `add_contract_clause`, `save_rent_rule`, `save_contract_rule`, `save_sri_value` (each with
an explicit and a propose mode), role tests and eval cases including an injection case.

"Ask AI to …" buttons on settings pages open the copilot with a prefilled request (for example "Ask AI
to add a clause", "Ask AI to set a rent band", "Ask AI to add an SRI value").

## Docs to update in the same change

`docs/architecture.md` (helper list, contract flow), `docs/decisions.md` (D45, amend D43), AGENTS.md
rule 11, the `dubai-leasing` skill. Compliance-reviewer subagent runs on the diff.

## Calls I made (check these)

- The template's own clauses live in its wording; approving the template approves them. Extra clauses
  go in an "Additional terms" section.
- Admin-written manual clauses are approved on save (no second step).
- Explicit copilot requests change config directly; suggestions need Confirm.
- The agent never edits values; a failed rule check stops preparation rather than "fixing" numbers.

## Later (separate designs)

- Configurable document-upload form (fields, type, required, placeholder; name check against the
  "full name as per documents" field).
- "Agentic" feel across the app.
- Voice with whisper.cpp `base`.
