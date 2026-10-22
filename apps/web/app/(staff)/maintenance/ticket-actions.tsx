"use client";

import { useActionState } from "react";
import { type TenancyActionState, updateTicket } from "../leases/[id]/tenancy-actions";

/** Move a ticket along: in progress, done or cancelled, with a note. */
export function TicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const [state, act, busy] = useActionState<TenancyActionState, FormData>(updateTicket, {});
  return (
    <form action={act} className="btn-row" style={{ marginTop: 8 }}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <select name="status" defaultValue={status === "open" ? "in_progress" : "done"} aria-label="New status">
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <input name="notes" placeholder="Note (optional)" maxLength={2000} aria-label="Note" />
      <button type="submit" className="btn small" disabled={busy}>
        Update
      </button>
      {state.error && <span className="muted">{state.error}</span>}
    </form>
  );
}
