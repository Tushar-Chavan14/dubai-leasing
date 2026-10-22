"use client";

import { useActionState, useState } from "react";
import { type LeaseActionState, recordResponse, recordSri, renewLease } from "../app/(staff)/leases/[id]/actions";
import { IconCheck, IconWarning } from "../lib/icons";

function Result({ s }: { s: LeaseActionState }) {
  if (s.ok)
    return (
      <div className="alert" data-tone="good" role="status">
        <IconCheck size={16} />
        {s.ok}
      </div>
    );
  if (s.error)
    return (
      <div className="alert" data-tone="bad" role="alert">
        <IconWarning size={16} />
        <div>
          <strong>{s.error}</strong>
          {s.reasons?.length ? (
            <ul>
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  return null;
}

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

  return (
    <div className="renewal-forms">
      {readyToRenew && (
        <form action={renew} className="stack">
          <input type="hidden" name="leaseId" value={leaseId} />
          <p style={{ margin: 0 }}>The tenant accepted. Renewing applies the new term and rent from the notice.</p>
          <div>
            <button type="submit" className="btn primary" disabled={renewing}>
              {renewing ? "Renewing…" : "Renew lease"}
            </button>
          </div>
          <Result s={renewState} />
        </form>
      )}

      <div className="btn-row">
        {canRecord && (!replied || !acknowledged) && (
          <button
            type="button"
            className="btn small"
            onClick={() => setOpen(open === "respond" ? null : "respond")}
            aria-expanded={open === "respond"}
          >
            Record a tenant response
          </button>
        )}
        <button
          type="button"
          className="btn small ghost"
          onClick={() => setOpen(open === "sri" ? null : "sri")}
          aria-expanded={open === "sri"}
        >
          Record an SRI value
        </button>
      </div>

      {open === "respond" && (
        <form action={respond} className="stack inline-form">
          <input type="hidden" name="leaseId" value={leaseId} />
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            For answers given by phone or in person. It goes through the same steps as a portal reply and is marked as
            recorded by you.
          </p>
          <label className="field">
            <span className="field-label">The tenant</span>
            <select name="kind" defaultValue={acknowledged ? "renew" : "ack"} required>
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
          <label className="field">
            <span className="field-label">
              What they said <em>(optional)</em>
            </span>
            <textarea name="comment" rows={2} maxLength={2000} />
          </label>
          <div>
            <button type="submit" className="btn primary small" disabled={responding}>
              Record
            </button>
          </div>
          <Result s={respState} />
        </form>
      )}

      {open === "sri" && (
        <form action={saveSri} className="stack inline-form">
          <input type="hidden" name="leaseId" value={leaseId} />
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            The Smart Rental Index average for this unit, e.g. from the DLD calculator. A pending notice is re-drafted
            at the new legal cap. Approved notices are not changed.
          </p>
          <div className="grid-fields">
            <label className="field span-2">
              <span className="field-label">SRI average per year</span>
              <span className="affix">
                <b>AED</b>
                <input name="sriAed" inputMode="decimal" required placeholder="100,000" />
              </span>
            </label>
            <label className="field span-4">
              <span className="field-label">Where it comes from</span>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={300}
                placeholder="DLD Smart Rental Index, checked 31 Jan"
              />
            </label>
          </div>
          <div>
            <button type="submit" className="btn primary small" disabled={saving}>
              Save SRI value
            </button>
          </div>
          <Result s={sriState} />
        </form>
      )}
    </div>
  );
}
