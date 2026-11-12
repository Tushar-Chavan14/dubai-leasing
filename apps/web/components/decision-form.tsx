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

/** Banner names of the fields the engine can flag in a decision. */
const FIELD_LABEL: Record<string, string> = {
  annualRentFils: "Annual rent",
  cheques: "Cheques",
  moveInOn: "Move-in",
  proposedRentFils: "Renewal rent",
  note: "Note",
};

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
  editOffer,
}: {
  id: string;
  canEditRent: boolean;
  /** A gate whose only editable field is the note (not the rent). */
  canEditNote?: boolean;
  currentRentAed: string | null;
  /**
   * An offer outside limits (D51): the manager may counter with rent, cheques and move-in. The engine
   * recomputes deposit, reservation, term and expiry from them.
   */
  editOffer?: { rentAed: string; cheques: number; moveInOn: string; today: string } | undefined;
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
    <ActionForm state={state} fieldErrors={state.fieldErrors} action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="editField" value={editOffer ? "offer" : canEditRent ? "rent" : "note"} />
      {state.error && (
        <div
          className="flex items-start gap-2 rounded-xl border border-danger bg-page px-3.5 py-2.5 text-sm text-danger"
          role="alert"
        >
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>{state.error}</strong>
            {(state.reasons?.length || Object.keys(state.fieldErrors ?? {}).length) > 0 && (
              <ul className="m-0 mt-1 pl-4">
                {Object.entries(state.fieldErrors ?? {}).map(([k, v]) => (
                  <li key={k}>
                    {FIELD_LABEL[k] ?? k}: {v}
                  </li>
                ))}
                {(state.reasons ?? []).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {editOffer && editing && (
        <div className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold">Annual rent</span>
            <span className="flex items-center gap-2">
              <b className="text-sm">AED</b>
              <input
                name="annualRentFils"
                defaultValue={editOffer.rentAed}
                inputMode="decimal"
                autoFocus
                className={INPUT}
              />
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold">Cheques</span>
              <input
                name="cheques"
                type="number"
                min={1}
                max={12}
                step={1}
                defaultValue={editOffer.cheques}
                className={INPUT}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold">Move-in</span>
              <input
                name="moveInOn"
                type="date"
                min={editOffer.today || undefined}
                defaultValue={editOffer.moveInOn}
                className={INPUT}
              />
            </label>
          </div>
          <span className="text-xs opacity-75">
            Deposit, reservation, the 12-month term and a new answer-by date are worked out from these. The applicant
            gets the revised offer by email.
          </span>
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
              {editOffer
                ? "Approve with these terms"
                : canEditRent
                  ? "Approve with this rent"
                  : "Approve with this note"}
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
            {(canEditRent || canEditNote || editOffer) && (
              <button type="button" className={OUTLINE} onClick={() => setEditing(true)}>
                {editOffer ? "Change terms" : canEditRent ? "Change rent" : "Edit note"}
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
