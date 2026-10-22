"use client";

import { useActionState, useState } from "react";
import { IconCheck, IconWarning } from "../../../../lib/icons";
import { type DecisionState, decide } from "./actions";

const DONE: Record<string, string> = {
  approved: "Approved. The decision is in the audit trail.",
  edited: "Approved with your edit. The decision is in the audit trail.",
  rejected: "Rejected. The note is in the audit trail.",
};

export function DecisionForm({
  id,
  canEditRent,
  currentRentAed,
}: {
  id: string;
  canEditRent: boolean;
  currentRentAed: string | null;
}) {
  const [state, action, pending] = useActionState<DecisionState, FormData>(decide, {});
  const [editing, setEditing] = useState(false);

  if (state.ok) {
    return (
      <div className="alert" data-tone="good" role="status">
        <IconCheck size={16} />
        {DONE[state.ok]}
      </div>
    );
  }
  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
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
      {canEditRent && editing && (
        <label className="field">
          <span className="field-label">Renewal rent per year</span>
          <span className="affix">
            <b>AED</b>
            <input name="proposedRentAed" defaultValue={currentRentAed ?? ""} inputMode="decimal" autoFocus />
          </span>
          <span className="hint">
            Checked against the rulebook's rent cap and notice deadline before it's accepted.
          </span>
        </label>
      )}
      <label className="field">
        <span className="field-label">
          Note <em>(required to reject)</em>
        </span>
        <textarea name="note" rows={3} placeholder="Why you decided this way" />
      </label>
      <div className="btn-row">
        {editing ? (
          <>
            <button type="submit" name="decision" value="edit" className="btn primary" disabled={pending}>
              Approve with this rent
            </button>
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              Cancel edit
            </button>
          </>
        ) : (
          <>
            <button type="submit" name="decision" value="approve" className="btn primary" disabled={pending}>
              Approve
            </button>
            {canEditRent && (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Change rent
              </button>
            )}
            <button type="submit" name="decision" value="reject" className="btn danger" disabled={pending}>
              Reject
            </button>
          </>
        )}
      </div>
    </form>
  );
}
