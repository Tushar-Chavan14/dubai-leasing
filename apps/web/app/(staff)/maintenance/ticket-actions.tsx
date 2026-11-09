"use client";

import { ActionForm } from "../../../components/ui/action-form";
import { useActionState } from "react";
import { buttonClass } from "../../../components/ui/button";
import { SET_INPUT, SET_SELECT } from "../../../components/ui/settings";
import { type TenancyActionState, updateTicket } from "../leases/[id]/tenancy-actions";

/** Move a ticket along: in progress, done or cancelled, with a note. */
export function TicketActions({ ticketId, status }: { ticketId: string; status: string }) {
  const [state, act, busy] = useActionState<TenancyActionState, FormData>(updateTicket, {});
  return (
    <ActionForm state={state} action={act} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <select
        name="status"
        defaultValue={status === "open" ? "in_progress" : "done"}
        aria-label="New status"
        className={`${SET_SELECT} w-auto!`}
      >
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <input
        name="notes"
        placeholder="Note (optional)"
        maxLength={2000}
        aria-label="Note"
        className={`${SET_INPUT} w-auto! min-w-48 flex-1`}
      />
      <button type="submit" className={buttonClass("ghost", "sm")} disabled={busy}>
        Update
      </button>
      {state.error && <span className="text-[12.5px] text-danger">{state.error}</span>}
    </ActionForm>
  );
}
