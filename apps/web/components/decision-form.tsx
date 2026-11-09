"use client";

import { ActionForm } from "./ui/action-form";
import { useActionState, useState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { type DecisionState, decide } from "../app/(staff)/work/actions";
import { INPUT } from "./ui/form";

// The form lives on the tinted gate panel (#dbe6cf in both themes): black pills with light text, text in the on-accent ink.
const APPROVE =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-full border border-transparent bg-on-accent px-4 font-sans text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-accent";
const OUTLINE =
  "inline-flex h-9 cursor-pointer items-center justify-center rounded-full border border-on-accent/40 bg-transparent px-4 font-sans text-sm font-semibold text-on-accent hover:border-on-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-accent";

const DONE: Record<string, string> = {
  approved: "Approved. The decision is in the audit trail.",
  edited: "Approved with your edit. The decision is in the audit trail.",
  rejected: "Rejected. The note is in the audit trail.",
};

export function DecisionForm({
  id,
  canEditRent,
  canEditNote = false,
  currentRentAed,
}: {
  id: string;
  canEditRent: boolean;
  /** A gate whose only editable field is the note (not the rent). */
  canEditNote?: boolean;
  currentRentAed: string | null;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decide, {});
  const [editing, setEditing] = useState(false);

  if (state.ok) {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold" role="status">
        <IconCheck size={16} />
        {DONE[state.ok]}
      </div>
    );
  }
  return (
    <ActionForm state={state} action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="editField" value={canEditRent ? "rent" : "note"} />
      {state.error && (
        <div
          className="flex items-start gap-2 rounded-xl border border-danger bg-page px-3.5 py-2.5 text-sm text-danger"
          role="alert"
        >
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>{state.error}</strong>
            {state.reasons && state.reasons.length > 0 && (
              <ul className="m-0 mt-1 pl-4">
                {state.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {canEditRent && editing && (
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold">Renewal rent per year</span>
          <span className="flex items-center gap-2">
            <b className="text-sm">AED</b>
            <input
              name="proposedRentAed"
              defaultValue={currentRentAed ?? ""}
              inputMode="decimal"
              autoFocus
              className={INPUT}
            />
          </span>
          <span className="text-xs opacity-75">
            Checked against the rulebook's rent cap and notice deadline before it's accepted.
          </span>
        </label>
      )}
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold">
          Note{" "}
          <em className="font-normal not-italic opacity-75">
            ({editing && canEditNote ? "required for an edit" : "required to reject"})
          </em>
        </span>
        <textarea name="note" rows={2} placeholder="Why you decided this way" className={INPUT} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button type="submit" name="decision" value="edit" className={APPROVE} disabled={pending}>
              {canEditRent ? "Approve with this rent" : "Approve with this note"}
            </button>
            <button type="button" className={OUTLINE} onClick={() => setEditing(false)}>
              Cancel edit
            </button>
          </>
        ) : (
          <>
            <button type="submit" name="decision" value="approve" className={APPROVE} disabled={pending}>
              Approve
            </button>
            {(canEditRent || canEditNote) && (
              <button type="button" className={OUTLINE} onClick={() => setEditing(true)}>
                {canEditRent ? "Change rent" : "Edit note"}
              </button>
            )}
            <button type="submit" name="decision" value="reject" className={OUTLINE} disabled={pending}>
              Reject
            </button>
          </>
        )}
      </div>
    </ActionForm>
  );
}
