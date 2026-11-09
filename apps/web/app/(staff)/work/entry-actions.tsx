"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { buttonClass } from "../../../components/ui/button";
import { INPUT } from "../../../components/ui/form";
import type { LogAction } from "../../../lib/types";
import { type DecisionState, decide, type EntryActionState, runEntryAction } from "./actions";

const LABEL: Partial<Record<LogAction, string>> = {
  send_offer: "Send offer",
  prepare_contract: "Prepare contract",
  retry_kyc: "Retry document check",
  done: "Mark done",
};

function Errors({ error, reasons }: { error?: string | undefined; reasons?: string[] | undefined }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-1.5 text-[12.5px] text-danger" role="alert">
      <IconWarning size={14} className="mt-0.5 shrink-0" />
      <div>
        <strong>{error}</strong>
        {reasons && reasons.length > 0 && (
          <ul className="m-0 mt-1 pl-4">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Inline buttons under a pending log entry. They call the same routes as the full forms. */
export function EntryActions({
  actions,
  source,
  entryId,
  recordId,
  editHref,
}: {
  actions: LogAction[];
  source: "event" | "approval" | "email" | "task";
  entryId: string;
  recordId: string;
  /** Where "Edit" goes: the detail pane shows the full decision form. */
  editHref: string;
}) {
  const [decision, decideAction, deciding] = useActionState<DecisionState, FormData>(decide, {});
  const [other, otherAction, running] = useActionState<EntryActionState, FormData>(runEntryAction, {});
  const [rejecting, setRejecting] = useState(false);
  const [asking, setAsking] = useState<null | "reservation">(null);

  if (decision.ok) {
    return (
      <p className="m-0 text-[12.5px] font-semibold text-ink" role="status">
        {decision.ok === "rejected" ? "Rejected." : "Approved."} It is in the audit trail.
      </p>
    );
  }
  if (other.ok) {
    return (
      <p className="m-0 text-[12.5px] font-semibold text-ink" role="status">
        {other.ok}
      </p>
    );
  }
  const has = (a: LogAction) => actions.includes(a);
  const isApproval = source === "approval";

  return (
    <div className="grid gap-2">
      {isApproval && (
        <form action={decideAction} className="grid gap-2">
          <input type="hidden" name="id" value={entryId} />
          {rejecting && (
            <label>
              <span className="sr-only">Why you are rejecting</span>
              <input name="note" placeholder="Why? It goes into the audit trail" autoFocus className={INPUT} />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!rejecting && has("approve") && (
              <button
                type="submit"
                name="decision"
                value="approve"
                className={buttonClass("primary", "sm")}
                disabled={deciding}
              >
                Approve
              </button>
            )}
            {!rejecting && has("edit") && (
              <Link href={editHref} className={buttonClass("ghost", "sm")}>
                Edit
              </Link>
            )}
            {has("reject") &&
              (rejecting ? (
                <>
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className={buttonClass("danger", "sm")}
                    disabled={deciding}
                  >
                    Confirm reject
                  </button>
                  <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setRejecting(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className={buttonClass("danger", "sm")} onClick={() => setRejecting(true)}>
                  Reject
                </button>
              ))}
          </div>
        </form>
      )}

      {!isApproval && (
        <form action={otherAction} className="grid gap-2">
          <input type="hidden" name="recordId" value={recordId} />
          <input type="hidden" name="entryId" value={entryId} />
          {asking === "reservation" && (
            <div className="flex flex-wrap gap-2">
              <label>
                <span className="sr-only">Paid on</span>
                <input type="date" name="paidOn" required className={INPUT} />
              </label>
              <label>
                <span className="sr-only">Payment reference</span>
                <input name="reference" placeholder="Reference" minLength={2} required className={INPUT} />
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {(["send_offer", "prepare_contract", "retry_kyc"] as const).map(
              (a) =>
                has(a) && (
                  <button
                    key={a}
                    type="submit"
                    name="op"
                    value={a}
                    className={buttonClass("primary", "sm")}
                    disabled={running}
                  >
                    {LABEL[a]}
                  </button>
                ),
            )}
            {has("record_viewing_outcome") && (
              <>
                <button
                  type="submit"
                  name="op"
                  value="viewing_attended"
                  className={buttonClass("primary", "sm")}
                  disabled={running}
                >
                  Attended
                </button>
                <button
                  type="submit"
                  name="op"
                  value="viewing_no_show"
                  className={buttonClass("ghost", "sm")}
                  disabled={running}
                >
                  No-show
                </button>
              </>
            )}
            {has("record_reservation") &&
              (asking === "reservation" ? (
                <>
                  <button
                    type="submit"
                    name="op"
                    value="reservation"
                    className={buttonClass("primary", "sm")}
                    disabled={running}
                  >
                    Record reservation
                  </button>
                  <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" className={buttonClass("primary", "sm")} onClick={() => setAsking("reservation")}>
                  Record reservation
                </button>
              ))}
            {has("done") && (
              <button type="submit" name="op" value="done" className={buttonClass("ghost", "sm")} disabled={running}>
                {LABEL.done}
              </button>
            )}
          </div>
        </form>
      )}
      <Errors error={decision.error} reasons={decision.reasons} />
      <Errors error={other.error} reasons={other.reasons} />
    </div>
  );
}
