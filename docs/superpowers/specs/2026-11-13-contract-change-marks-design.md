# Marking changes on the contract PDF (design)

Date: 2026-11-13. Decision to record: D71 (amends D67, D22's "preparer can't approve" for this flow, and the D67
`contract_change` guard on numbers).

## Intent and why

Today a signer who wants a change picks one clause from a dropdown (only the addendum's clauses) or "something else"
and writes a note; the `contract_change` helper (D67) may only remove a clause, add an approved clause or reword the
Additional terms, and refuses any number or period. Template clauses (4.1 … 4.13) can't be picked, and "24 → 48 hours"
can't be drafted. The officer handles it in the Workspace.

The user wants it to feel like paper and pencil: the signer selects the words they don't like **on the contract
itself**, writes what they want there, marks as many places as they like, and sends them together. The contract AI
rewrites each marked passage itself (numbers included) unless that breaks a rule. The officer only approves, in one
clean modal; when a mark breaks a rule the officer may write the change and hand it back to the contract AI.

## Goals

1. On the signing page (`apps/web/app/t/[token]/sign`), the contract pages are selectable. Selecting words opens a
   note box at the mark; the mark gets a number and joins a "Your changes (N)" list (beside the page on desktop, below
   it on a phone, note as a bottom sheet on a phone). Marks can be edited or removed before sending. "Send N changes"
   sends one change request with all marks. The fixed reminder stays: rent, cheques, deposit and dates are set in the
   offer.
2. Each mark stores the exact highlighted words, the page, and the contract paragraph it sits in (template paragraph
   key such as `s8:4` with its printed number and heading, an addendum clause id, or "additional terms").
3. Both signers (tenant and the landlord's signatory) get the same tool, as today's request form (D67).
4. On send, the contract AI rewrites each marked passage from the signer's note. Code checks each rewrite; a passing
   one is shown ready to approve, a failing one is not rewritten and says which rule.
5. The officer opens the request in a **modal** from the lease page and the approval inbox (not the Workspace detail
   view). Per mark: the highlighted words, the signer's note, current wording vs the AI's wording side by side, the
   checks. A mark that breaks a rule offers "Keep as it is (tell the signer why)" or "Write my own change": the
   officer's words go to the contract AI, which applies them, and code checks them the same way.
6. "Approve changes" creates the new contract version and **is** its `final_contract` approval (the user's choice):
   the officer views the new PDF in the modal and approves in one step, even when it contains the officer's own
   wording. Signing links then go out as after any approval. "Decline all" works as today (note to the signer, fresh
   links). Per-mark keep/approve is allowed: kept marks are listed in the email to the signer with the reason.

## Rules a rewrite must pass (code, never the model)

- **Numbers only from the note.** Every number, period or amount in the new wording must appear in that mark's
  note (signer's or officer's). Reuse `inventedValues` / `valueTokens` (`packages/helpers/src/contract-template/values.ts`)
  against the note, not the old wording.
- **Rulebook values are fixed.** The new wording must pass `legalPeriodProblems` (D70,
  `packages/helpers/src/contract-structure/legal-wording.ts`) against the lease's pinned rulebook, and a passage that
  states a rulebook value (rent-increase notice, repossession notice, days after a formal reminder) can't change that
  value.
- **Offer terms are fixed.** No change to rent, cheques, deposit, dates or anything printed from a record blank: the
  rewrite must keep every `{{bN}}` token of the paragraph exactly once (as D64's `checkRewrite`), and a mark that
  covers only a blank's value is refused ("set in the offer").
- **No new money or permission clause.** Reuse D64's word lists: no added money word, permission word ("may sublet",
  "allowed") or negation flip that widens the tenant's or landlord's rights beyond the note.
- **Emirate and sample checks** (D70 `emirate_wording`, `sample_values`) run on the new version as on any prepare.
- **Untrusted text.** Notes are data, never instructions (existing nonce wrapping, `asData`).

The same rules apply to the officer's own wording (it goes through the contract AI and the same checks); if the
officer's wording still breaks a rule, the modal shows why and nothing is applied.

## How it fits what exists (decided)

- **Data.** Extend `contract_change_requests` (D67, migration 0041) with a `marks` jsonb list
  (`{n, page, quote, paragraphKey|clauseRef|"additional_terms", note, rewrite?, checks[], decision?}`) instead of a
  new table; a request has 1–20 marks (policy `contractChanges` keeps its per-signer open limit and character limit,
  applied per note). New migration.
- **Applying a rewrite.** Template paragraphs reuse D64's mechanism (`contracts.template_rewrites`: key, before,
  after) so the renderer and the approval diff already understand it; standard-contract and addendum marks use D67's
  existing paths (clause removal, approved clause, Additional terms).
- **Selectable pages.** The signing viewer shows page images (`apps/engine/src/pdf-pages.ts`,
  `contract-viewer.tsx`). Add a text layer per page from the same PDF (unpdf `getTextContent`: strings with
  positions), served next to the image and laid over it transparently so a selection gives page, quote and
  rectangles. The engine maps the quote to a paragraph by searching the contract version's printed paragraphs
  (rendered text per paragraph key, kept at prepare time) — a quote that spans two paragraphs is split into two
  marks.
- **The AI.** Extend the `contract_change` helper (or the contract agent's rewrite step) to take marks and return
  one rewrite per mark; local model only (rule 8), Zod-validated, retry once then that mark is "needs officer"
  (rule 6).
- **Approval.** `final_contract` for a version made from approved marks is recorded as approved by the officer who
  clicked "Approve changes" (actor = user id, with the marks and checks in `lease_events`, rule 4). The usual
  re-check of records and PDF hash still runs.
- **Copilot.** `contract_status` reports the marks (words untrusted) and their state; it never approves (rule 11).

## Settled details (from the builder check; "my call" = decided by the designer, not the user)

- **Who approves.** Anyone who may approve `final_contract` today (leasing officer, leasing manager) may click
  "Approve changes", including for wording they wrote themselves (the user's choice). It is a dedicated route that
  creates the version and records the `final_contract` approval with that user as actor, in one transaction, after
  the same re-check of records and PDF hash. The compliance review must accept this as the user's amendment to D22.
- **Anchoring (my call).** New column `contracts.paragraph_texts` (jsonb: key → printed text, page) written at
  prepare. Older versions have none: a mark there is anchored by page only, gets no AI rewrite and is shown to the
  officer as "paragraph not identified". Matching: normalise whitespace and hyphenation across line and page breaks;
  a repeated phrase is resolved by the page; a quote inside a blank's printed value (rent, a date, a name) is refused
  at once in the note box ("set in the offer or the records").
- **One rewrite engine (my call).** The D67 number guard is replaced by the rules above for every mark. Template
  paragraphs and the Additional terms are rewritable. The standard contract's fixed body and the "Additional terms
  required by law" are not reworded: a mark there gets an Additional terms clause proposal instead.
- **Paragraph level (my call).** A rewrite replaces the whole paragraph (D64 shape). Several marks in one paragraph
  become one rewrite covering all of them; a kept mark's quote must still be present in the new wording.
- **Keep (my call).** "Keep" resolves a mark. If every mark is kept, no version is made: it acts as today's decline
  (each kept mark's reason in the signer's email, fresh links, signing resumes).
- **The old form (my call).** The dropdown form is replaced by marks. Existing open requests show in the modal as
  one mark with no quote and are decided the same way; `contract_status` reads both.
- **No text on a page (my call).** Contracts are generated with text, so this should not happen; if a page has no
  text layer, the signing page shows the old note form for "something else in the contract".

## Non-goals

- Changing rent, cheques, deposit, dates, notice periods set by law, or parties' identity through marks.
- Free drawing, handwriting or comments on images; marks are on text only.
- Marking after a version is fully signed or approved (unchanged from D67).
- Editing approved company clause wording globally (a mark changes only this contract).

## Anti-goals (failure even if it works)

- A rewrite with a number or period the signer never wrote, or a legal value changed.
- Signing continuing while marks are open (D67's pause stays).
- The officer having to leave the modal to finish the job, or the tenant losing marks on a phone refresh (keep
  unsent marks in the browser's local storage per signing token).

## Left to the builder

- Exact text-layer technique (positioned spans vs a canvas-measured layer) and how selection works on touch screens.
- Prompt wording and the helper's schema; how marks are batched in one model call vs one call per mark.
- Modal layout details beyond the mockups in `.superpowers/brainstorm/` (tenant-marks.html, officer-modal.html).
