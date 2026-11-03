"use client";

import { useActionState, useRef, useState } from "react";
import { IconPlus, IconWarning } from "../../../../lib/icons";
import { subtypeLabel } from "../../../../lib/portfolio";
import type { CompanyClauseView, CompanyRow, ContractRuleRow } from "../../../../lib/types";
import { addClause, editClause, removeClause, setClauseRulesAction } from "./actions";

function AddClauseForm({
  company,
  rules,
  onDone,
}: {
  company: CompanyRow;
  rules: ContractRuleRow[];
  onDone: () => void;
}) {
  // Controlled: a "confirm the amounts" answer resets the form, which must not throw away what was typed.
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof addClause>>, formData: FormData) => {
      const r = await addClause(prev, formData);
      if (r.ok) onDone();
      return r;
    },
    {},
  );
  return (
    <form action={action} className="rule-form" noValidate>
      {state.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          <div>
            <strong>{state.error}</strong>
            {state.reasons && state.reasons.length > 0 && (
              <ul>
                {state.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <input type="hidden" name="companyId" value={company.id} />
      <div className="grid-fields">
        <label className="field span-6">
          <span className="field-label">Title</span>
          <input
            name="title"
            maxLength={120}
            required
            placeholder="For example: Pets"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field span-6">
          <span className="field-label">Clause text</span>
          <textarea
            name="text"
            rows={4}
            maxLength={1200}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className="hint">
            Saved as approved. It goes under Additional terms in this company&apos;s contracts.
          </span>
        </label>
        {rules.length > 0 && (
          <fieldset className="field span-6">
            <legend className="field-label">
              Add to rules <em>(optional)</em>
            </legend>
            <div className="check-row">
              {rules.map((r) => (
                <label key={r.id}>
                  <input type="checkbox" name="ruleIds" value={r.id} />
                  {subtypeLabel(r.subtype)} · {r.category}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {state.needsConfirm && (
          <label className="field span-6 check-row">
            <input type="checkbox" name="confirmValues" />
            The clause includes amounts or dates. I checked them.
          </label>
        )}
      </div>
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save clause"}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Clause wording with each `[field]` (filled from the records) shown as a chip. */
export function ClauseText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^[\]]{1,80}\])/).map((part, i) =>
        /^\[[^[\]]+\]$/.test(part) ? (
          <span key={i} className="tpl-blank" data-state="ok">
            {part.slice(1, -1)}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

const ruleName = (r: ContractRuleRow) => `${subtypeLabel(r.subtype)} · ${r.category}`;

/** Which active rules include an approved clause; each tick saves at once (a new rule version). */
function RuleTicks({ c, rules }: { c: CompanyClauseView; rules: ContractRuleRow[] }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, act, pending] = useActionState(setClauseRulesAction, {});
  return (
    <form ref={form} action={act} className="check-row clause-rules">
      <input type="hidden" name="clauseId" value={c.id} />
      <span className="muted">In rules:</span>
      {rules.map((r) => (
        <label key={r.id}>
          <input
            type="checkbox"
            name="ruleIds"
            value={r.id}
            defaultChecked={c.ruleIds?.includes(r.id)}
            key={String(c.ruleIds?.includes(r.id))}
            disabled={pending}
            onChange={() => form.current?.requestSubmit()}
          />
          {ruleName(r)}
        </label>
      ))}
      {state.error && (
        <span className="err" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

/**
 * One clause: admins can edit its wording or remove it at any time. On the sample review (`approveFormId`) it has the
 * "Add to this rule" tick of the Approve all form; once approved (`rules`), the rules that include it.
 */
export function ClauseItem({
  c,
  canEdit,
  approveFormId,
  ruleLabel,
  rules,
}: {
  c: CompanyClauseView;
  canEdit: boolean;
  approveFormId?: string;
  ruleLabel?: string;
  rules?: ContractRuleRow[];
}) {
  const [editing, setEditing] = useState(false);
  // Controlled: a "confirm the amounts" answer resets the form, which must not throw away the edit.
  const [title, setTitle] = useState(c.title);
  const [text, setText] = useState(c.text);
  const [state, save, saving] = useActionState(
    async (prev: Awaited<ReturnType<typeof editClause>>, formData: FormData) => {
      const r = await editClause(prev, formData);
      if (r.ok) setEditing(false);
      return r;
    },
    {},
  );
  const [removeState, remove, removing] = useActionState(removeClause, {});
  if (editing) {
    return (
      <li className="clause-item">
        <form action={save} className="rule-form" noValidate>
          {state.error && (
            <div className="alert" data-tone="bad" role="alert">
              <IconWarning size={16} />
              <div>
                <strong>{state.error}</strong>
              </div>
            </div>
          )}
          <input type="hidden" name="clauseId" value={c.id} />
          <div className="grid-fields">
            <label className="field span-6">
              <span className="field-label">Title</span>
              <input name="title" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field span-6">
              <span className="field-label">Clause text</span>
              <textarea
                name="text"
                rows={4}
                maxLength={1200}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <span className="hint">
                Contracts prepared from now on use the new wording. Signed contracts don&apos;t change.
                {c.fromTemplate &&
                  " Words in [brackets] are filled from the records: use any name from the template's Fields list, like [Community]."}
              </span>
            </label>
            {state.needsConfirm && (
              <label className="field span-6 check-row">
                <input type="checkbox" name="confirmValues" />
                The clause includes amounts or dates. I checked them.
              </label>
            )}
          </div>
          <div className="btn-row">
            <button type="submit" className="btn primary small" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="clause-item">
      <div className="stack" style={{ gap: 6 }}>
        <div>
          <b>{c.title}.</b> <ClauseText text={c.text} />{" "}
          {c.fromTemplate && (
            <span className="status" data-tone="quiet">
              From template
            </span>
          )}
          {c.locked && (
            <span className="status" data-tone="quiet">
              In template wording
            </span>
          )}
        </div>
        {approveFormId && (
          <label className="check-row">
            <input type="checkbox" name="ruleClauseIds" value={c.id} form={approveFormId} defaultChecked />
            {ruleLabel ? `Add to the ${ruleLabel} rule and the rules using this template` : "Add to the contract rules"}
          </label>
        )}
        {rules && rules.length > 0 && canEdit && !c.locked && <RuleTicks c={c} rules={rules} />}
      </div>
      {canEdit && !c.locked && (
        <form
          action={remove}
          className="btn-row"
          onSubmit={(e) => {
            if (
              !window.confirm(
                c.status === "proposed"
                  ? `Leave out "${c.title}"? It won't be approved.`
                  : `Remove "${c.title}"? It also leaves this company's contract rules.`,
              )
            )
              e.preventDefault();
          }}
        >
          <input type="hidden" name="clauseId" value={c.id} />
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="submit" className="btn small danger" disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </button>
          {removeState.error && (
            <span className="err" role="alert">
              {removeState.error}
            </span>
          )}
        </form>
      )}
    </li>
  );
}

/**
 * A company's approved clauses (D47): those from the template print in its paragraphs, the others under Additional
 * terms. Each can be edited, removed and ticked into rules; "Add clause" for admins.
 */
export function ClauseList({
  company,
  clauses,
  rules,
  canEdit,
}: {
  company: CompanyRow;
  clauses: CompanyClauseView[];
  rules: ContractRuleRow[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="panel panel-pad">
      <div className="co-body-head">
        <h3 className="section-title">Clauses</h3>
        {canEdit && !adding && (
          <button type="button" className="btn small" onClick={() => setAdding(true)}>
            <IconPlus size={14} />
            Add clause
          </button>
        )}
      </div>
      <p className="muted tpl-note">
        Clauses tagged From template print in the template&rsquo;s own place; the others go under Additional terms. A
        clause prints only in the rules it is ticked in.
      </p>
      {adding && <AddClauseForm company={company} rules={rules} onDone={() => setAdding(false)} />}
      {clauses.length === 0 ? (
        <p className="muted">No clauses yet. Upload a sample contract on a rule, or add one.</p>
      ) : (
        <ul className="clause-items">
          {clauses.map((c) => (
            <ClauseItem key={c.id} c={c} canEdit={canEdit} rules={rules} />
          ))}
        </ul>
      )}
    </section>
  );
}
