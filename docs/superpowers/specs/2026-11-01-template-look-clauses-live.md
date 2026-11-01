# Company template = look; clause wording = live company clauses (D47)

Date: 2026-11-01 · Status: approved by the user ("yes" to Option 2)

## What changes

1. **Link.** Each clause read from a sample is linked to the template paragraph it came from:
   `company_clauses.template_paragraph_key` (new, migration 0029) + `in_template_id` = the template it is linked to
   (set at link time, also for proposed clauses; re-linked when the same sample is read again).
   - Linked clause text := the paragraph's verbatim wording, with each blank token `{{bN}}` written as `[<blank label>]`.
   - Linking runs when both jobs (clauses and structure) have finished, in whichever order
     (`linkSampleClauses(tx, companyId, sampleDocumentId)`), and once at engine start for existing templates
     (`backfillTemplateClauseLinks`). Uses `paragraphForQuote`; one clause per paragraph.
   - A clause whose paragraph holds sample values (fixedValues) or is a sample note is rejected automatically.
2. **Render.** `templateContractBlocks` takes `paragraphs?: Record<key, string | null>` overrides:
   string → print it (tokens filled), null → skip. Engine (`renderCompanyContract`) builds them from the clauses with
   `in_template_id = template.id`: approved and (rule clause ids absent [preview] or includes `cc:<id>`) → the clause
   text with `[label]` mapped back to that paragraph's tokens; otherwise null. Linked clauses never repeat under
   Additional terms. Prepare passes the matching rule's `clauseIds`.
3. **Auto review (no per-line ticks).** `autoReview(template)`: drop header/footer/logo with DLD/RERA/Ejari marks or
   sample values; drop sample notes and paragraphs with sample values; returns the review + plain "What we changed"
   lines. Blockers left: text the PDF fonts can't print. One optional tick `review.checked` ("I checked the amounts,
   dates and DLD/RERA references, and the logo is the company's own") is required only when kept wording or clauses
   have values/authority words or a logo is kept. Mapping problems never block (blank prints empty).
4. **One approval.** `POST /api/companies/:id/sample/approve { ruleClauseIds, checked }`: approves every proposed
   clause from the latest sample (edits already saved), adds the ticked ones to the sample's rule (new rule version),
   and approves the proposed template if there is one (re-pointing rules as today). Works for clauses alone when the
   template failed.
5. **Clauses stay editable.** Edit (`PATCH /company-clauses/:id`) works on proposed and approved clauses, linked ones
   included (edit changes the contract paragraph). Remove: proposed → rejected; approved → removed (+ out of rules;
   its paragraph is then skipped). Rule membership: `PUT /company-clauses/:id/rules { ruleIds }`.
6. **UI (Settings → Contracts).** Sample review: Clauses (approve all, edit each, "Add to this rule") + Fields
   (read-only: blank label → record field, or "printed empty") + "What we changed" + Approve all. After approval:
   one Clauses list (From template tag, Edit, Remove, rule ticks), template card (version in use, Preview, Fields,
   Retire). The per-paragraph confirm/drop toggles and the Wording-to-confirm section go.

## Unchanged

`final_contract` gate, required terms appended, config hash (covers clause text and rule clause ids → "Prepare
again"), WinAnsi check, contract agent may only add clauses (linked ones excluded from its addendum).
