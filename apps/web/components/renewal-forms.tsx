"use client";

import { useActionState, useState } from "react";
import { type LeaseActionState, recordResponse, recordSri, renewLease } from "../app/(staff)/leases/[id]/actions";
import { buttonClass } from "./ui/button";
import { FIELD, LABEL } from "./ui/form";
import { Result } from "./ui/result";
import { SET_INPUT, SET_SELECT, SET_TEXTAREA } from "./ui/settings";
import { FORM_ROW, NOTE } from "./ui/tenancy";

/** Staff actions on a renewal: record what the tenant said, renew, or record an SRI value. */
export function RenewalForms({
  leaseId,
  canRecord,
  replied,
  acknowledged,
  readyToRenew,
}: {
  leaseId: string;
  canRecord: boolean;
  replied: boolean;
  acknowledged: boolean;
  readyToRenew: boolean;
}) {
  const [respState, respond, responding] = useActionState<LeaseActionState, FormData>(recordResponse, {});
  const [renewState, renew, renewing] = useActionState<LeaseActionState, FormData>(renewLease, {});
  const [sriState, saveSri, saving] = useActionState<LeaseActionState, FormData>(recordSri, {});
  const [open, setOpen] = useState<"respond" | "sri" | null>(null);

  const BOX = "grid gap-3 rounded-xl border border-line p-3.5";
  return (
    <div className="grid gap-3">
      {readyToRenew && (
        <form action={renew} className={`${BOX} bg-raised`}>
          <input type="hidden" name="leaseId" value={leaseId} />
          <p className="m-0 text-sm">The tenant accepted. Renewing applies the new term and rent from the notice.</p>
          <div>
            <button type="submit" className={buttonClass("primary", "sm")} disabled={renewing}>
              {renewing ? "Renewing…" : "Renew lease"}
            </button>
          </div>
          <Result s={renewState} />
        </form>
      )}

      <div className={FORM_ROW}>
        {canRecord && (!replied || !acknowledged) && (
          <button
            type="button"
            className={buttonClass("ghost", "sm")}
            onClick={() => setOpen(open === "respond" ? null : "respond")}
            aria-expanded={open === "respond"}
          >
            Record a tenant response
          </button>
        )}
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          onClick={() => setOpen(open === "sri" ? null : "sri")}
          aria-expanded={open === "sri"}
        >
          Record an SRI value
        </button>
      </div>

      {open === "respond" && (
        <form action={respond} className={BOX}>
          <input type="hidden" name="leaseId" value={leaseId} />
          <p className={NOTE}>
            For answers given by phone or in person. It goes through the same steps as a portal reply and is marked as
            recorded by you.
          </p>
          <label className={FIELD}>
            <span className={LABEL}>The tenant</span>
            <select name="kind" defaultValue={acknowledged ? "renew" : "ack"} required className={SET_SELECT}>
              {!acknowledged && <option value="ack">Confirmed they received the notice</option>}
              {!replied && (
                <>
                  <option value="renew">Wants to renew</option>
                  <option value="vacate">Will move out at the end</option>
                  <option value="discuss">Wants to discuss</option>
                </>
              )}
            </select>
          </label>
          <label className={FIELD}>
            <span className={LABEL}>
              What they said <span className="font-normal">(optional)</span>
            </span>
            <textarea name="comment" rows={2} maxLength={2000} className={SET_TEXTAREA} />
          </label>
          <div>
            <button type="submit" className={buttonClass("primary", "sm")} disabled={responding}>
              Record
            </button>
          </div>
          <Result s={respState} />
        </form>
      )}

      {open === "sri" && (
        <form action={saveSri} className={BOX}>
          <input type="hidden" name="leaseId" value={leaseId} />
          <p className={NOTE}>
            The Smart Rental Index average for this unit, e.g. from the DLD calculator. A pending notice is re-drafted
            at the new legal cap. Approved notices are not changed.
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,4fr)]">
            <label className={FIELD}>
              <span className={LABEL}>SRI average per year</span>
              <span className="flex items-center gap-2">
                <b className="text-xs font-semibold text-muted">AED</b>
                <input name="sriAed" inputMode="decimal" required placeholder="100,000" className={SET_INPUT} />
              </span>
            </label>
            <label className={FIELD}>
              <span className={LABEL}>Where it comes from</span>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={300}
                placeholder="DLD Smart Rental Index, checked 31 Jan"
                className={SET_INPUT}
              />
            </label>
          </div>
          <div>
            <button type="submit" className={buttonClass("primary", "sm")} disabled={saving}>
              Save SRI value
            </button>
          </div>
          <Result s={sriState} />
        </form>
      )}
    </div>
  );
}
