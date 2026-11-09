"use client";

import { ActionForm } from "../../../../components/ui/action-form";
import { useActionState, useRef, useState } from "react";
import { PlusIcon as IconPlus, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { subtypeLabel } from "../../../../lib/portfolio";
import type { CompanyClauseView, CompanyRow, ContractRuleRow } from "../../../../lib/types";
import { addClause, editClause, removeClause, setClauseRulesAction } from "./actions";
import { FIELD, HINT, LABEL } from "../../../../components/ui/form";
import { ALERT, BTN, CHECK_ROW, GRID6, SPAN, SET_INPUT, SET_TEXTAREA } from "../../../../components/ui/settings";

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
    <ActionForm state={state} action={action} className="grid gap-4" noValidate>
      {state.error && (
        <div className={ALERT.bad} role="alert">
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
      <div className={GRID6}>
        <label className={`${FIELD} ${SPAN[6]}`}>
          <span className={LABEL}>Title</span>
          <input
            className={SET_INPUT}
            name="title"
            maxLength={120}
            required
            placeholder="For example: Pets"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className={`${FIELD} ${SPAN[6]}`}>
          <span className={LABEL}>Clause text</span>
          <textarea
            className={SET_TEXTAREA}
            name="text"
            rows={4}
            maxLength={1200}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span className={HINT}>
            Saved as approved. It goes under Additional terms in this company&apos;s contracts.
          </span>
        </label>
        {rules.length > 0 && (
          <fieldset className={`${FIELD} ${SPAN[6]} m-0 min-w-0 border-0 p-0`}>
            <legend className={`${LABEL} p-0`}>
              Add to rules <em>(optional)</em>
            </legend>
            <div className={CHECK_ROW}>
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
          <label className={`${CHECK_ROW} ${SPAN[6]}`}>
            <input type="checkbox" name="confirmValues" />
            The clause includes amounts or dates. I checked them.
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN.primary} disabled={pending}>
          {pending ? "Saving…" : "Save clause"}
        </button>
        <button type="button" className={BTN.ghost} onClick={onDone}>
          Cancel
        </button>
      </div>
    </ActionForm>
  );
}

/** Clause wording with each `[field]` (filled from the records) shown as a chip. */
export function ClauseText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^[\]]{1,80}\])/).map((part, i) =>
        /^\[[^[\]]+\]$/.test(part) ? (
          <span key={i} className="mx-0.5 inline-block rounded bg-accent px-1.5 text-[12.5px] leading-5 text-on-accent">
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
    <form ref={form} action={act} className={CHECK_ROW}>
      <input type="hidden" name="clauseId" value={c.id} />
      <span className="text-muted">In rules:</span>
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
        <span className="text-xs text-danger" role="alert">
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
      <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 [&>div]:min-w-[300px] [&>div]:flex-1 [&>form:only-child]:flex-[1_1_100%]">
        <ActionForm state={state} action={save} className="grid gap-4" noValidate>
          {state.error && (
            <div className={ALERT.bad} role="alert">
              <IconWarning size={16} />
              <div>
                <strong>{state.error}</strong>
              </div>
            </div>
          )}
          <input type="hidden" name="clauseId" value={c.id} />
          <div className={GRID6}>
            <label className={`${FIELD} ${SPAN[6]}`}>
              <span className={LABEL}>Title</span>
              <input
                className={SET_INPUT}
                name="title"
                maxLength={120}
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className={`${FIELD} ${SPAN[6]}`}>
              <span className={LABEL}>Clause text</span>
              <textarea
                className={SET_TEXTAREA}
                name="text"
                rows={4}
                maxLength={1200}
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <span className={HINT}>
                Contracts prepared from now on use the new wording. Signed contracts don&apos;t change.
                {c.fromTemplate &&
                  " Words in [brackets] are filled from the records: use any name from the template's Fields list, like [Community]."}
              </span>
            </label>
            {state.needsConfirm && (
              <label className={`${CHECK_ROW} ${SPAN[6]}`}>
                <input type="checkbox" name="confirmValues" />
                The clause includes amounts or dates. I checked them.
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN.primary} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className={BTN.ghost} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </ActionForm>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 [&>div]:min-w-[300px] [&>div]:flex-1 [&>form:only-child]:flex-[1_1_100%]">
      <div className="grid gap-1.5">
        <div>
          <b>{c.title}.</b> <ClauseText text={c.text} />{" "}
          {c.fromTemplate && (
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${"border border-line text-muted"}`}
            >
              From template
            </span>
          )}
          {c.locked && (
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${"border border-line text-muted"}`}
            >
              In template wording
            </span>
          )}
        </div>
        {approveFormId && (
          <label className={CHECK_ROW}>
            <input type="checkbox" name="ruleClauseIds" value={c.id} form={approveFormId} defaultChecked />
            {ruleLabel ? `Add to the ${ruleLabel} rule and the rules using this template` : "Add to the contract rules"}
          </label>
        )}
        {rules && rules.length > 0 && canEdit && !c.locked && <RuleTicks c={c} rules={rules} />}
      </div>
      {canEdit && !c.locked && (
        <form
          action={remove}
          className="flex flex-wrap items-center gap-2"
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
          <button type="button" className={BTN.ghost} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="submit" className={BTN.danger} disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </button>
          {removeState.error && (
            <span className="text-xs text-danger" role="alert">
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
    <section className="grid gap-3.5 rounded-card border border-line bg-page p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">Clauses</h3>
        {canEdit && !adding && (
          <button type="button" className={BTN.ghost} onClick={() => setAdding(true)}>
            <IconPlus size={14} />
            Add clause
          </button>
        )}
      </div>
      <p className="m-0 text-[12.5px] text-muted">
        Clauses tagged From template print in the template&rsquo;s own place; the others go under Additional terms. A
        clause prints only in the rules it is ticked in.
      </p>
      {clauses.some((c) => c.fromTemplate) && (
        <p className="m-0 text-[12.5px] text-muted">
          Words in [brackets] are filled from the records (shown highlighted, like <ClauseText text="[Community]" />
          ). In a From template clause, use any name from the template&rsquo;s Fields list.
        </p>
      )}
      {adding && <AddClauseForm company={company} rules={rules} onDone={() => setAdding(false)} />}
      {clauses.length === 0 ? (
        <p className="m-0 text-muted">No clauses yet. Upload a sample contract on a rule, or add one.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {clauses.map((c) => (
            <ClauseItem key={c.id} c={c} canEdit={canEdit} rules={rules} />
          ))}
        </ul>
      )}
    </section>
  );
}
