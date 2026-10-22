"use client";

import { useActionState, useState } from "react";
import { IconCheck, IconWarning } from "../../../../lib/icons";
import { viewingTime } from "../../../../lib/format";
import {
  type AppActionState,
  bookViewing,
  recordReservation,
  recordViewingOutcome,
  rejectApplicant,
  requestDocuments,
} from "../actions";

function Result({ s }: { s: AppActionState }) {
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

/** What a leasing officer can do at each step. Approvals happen in the inbox, not here. */
export function ApplicationActions(p: {
  id: string;
  state: string;
  accepted: boolean;
  reservation: string | null;
  today: string;
  viewingAt: string | null;
}) {
  const [bookS, book, booking] = useActionState<AppActionState, FormData>(bookViewing, {});
  const [cameS, came, recordingCame] = useActionState<AppActionState, FormData>(recordViewingOutcome, {});
  const [noShowS, noShow, recordingNoShow] = useActionState<AppActionState, FormData>(recordViewingOutcome, {});
  const [docsS, docs, sendingDocs] = useActionState<AppActionState, FormData>(requestDocuments, {});
  const [resS, reserve, reserving] = useActionState<AppActionState, FormData>(recordReservation, {});
  const [rejS, reject, rejecting] = useActionState<AppActionState, FormData>(rejectApplicant, {});
  const [rejectOpen, setRejectOpen] = useState(false);
  const open = ["ENQUIRY", "VIEWING", "SCREENING", "OFFER"].includes(p.state);
  if (!open) return null;
  return (
    <section className="panel panel-pad stack" aria-labelledby="next-h">
      <h2 id="next-h" className="section-title" style={{ margin: 0 }}>
        Next step
      </h2>
      {p.state === "ENQUIRY" && (
        <form action={book} className="stack">
          <input type="hidden" name="id" value={p.id} />
          <p style={{ margin: 0 }}>
            Book a viewing. The applicant gets an invitation with the time, the address and a page to view the property
            online.
          </p>
          <label className="field">
            <span className="field-label">Viewing date &amp; time (Dubai)</span>
            <input
              name="viewingAt"
              type="datetime-local"
              required
              min={p.today ? `${p.today}T00:00` : undefined}
              step={900}
            />
          </label>
          <div>
            <button className="btn primary" disabled={booking}>
              {booking ? "Booking…" : "Book viewing"}
            </button>
          </div>
          <Result s={bookS} />
        </form>
      )}
      {p.state === "VIEWING" && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            {p.viewingAt ? (
              <>
                Viewing booked for <b>{viewingTime(p.viewingAt)}</b> (Dubai). Record what happened.
              </>
            ) : (
              "Viewing booked. Record what happened."
            )}
          </p>
          <form action={came} className="stack">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="outcome" value="attended" />
            <div>
              <button className="btn primary" disabled={recordingCame}>
                {recordingCame ? "Sending…" : "Showed up — send document link"}
              </button>
            </div>
            <Result s={cameS} />
          </form>
          <form action={noShow} className="stack inline-form">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="outcome" value="no_show" />
            <label className="field">
              <span className="field-label">
                Note <em>(optional, kept in the audit trail)</em>
              </span>
              <textarea name="note" rows={2} maxLength={500} />
            </label>
            <div>
              <button className="btn small danger" disabled={recordingNoShow}>
                {recordingNoShow ? "Closing…" : "No-show — close application"}
              </button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              Only once the viewing time has passed. The applicant must apply again.
            </p>
            <Result s={noShowS} />
          </form>
        </div>
      )}
      {p.state === "SCREENING" && (
        <form action={docs} className="stack">
          <input type="hidden" name="id" value={p.id} />
          <p style={{ margin: 0 }}>
            Waiting for documents or for the check. If the applicant needs a new link (lost email, new documents), send
            one.
          </p>
          <div>
            <button className="btn" disabled={sendingDocs}>
              {sendingDocs ? "Sending…" : "Send a new upload link"}
            </button>
          </div>
          <Result s={docsS} />
        </form>
      )}
      {p.state === "OFFER" &&
        (p.accepted ? (
          <form action={reserve} className="stack">
            <input type="hidden" name="id" value={p.id} />
            <p style={{ margin: 0 }}>
              The applicant accepted. Record the reservation of <b>{p.reservation}</b> once it&apos;s received; the
              lease is then created for the contract.
            </p>
            <div className="grid-fields">
              <label className="field span-3">
                <span className="field-label">Paid on</span>
                <input name="paidOn" type="date" required max={p.today} defaultValue={p.today} />
              </label>
              <label className="field span-3">
                <span className="field-label">Payment reference</span>
                <input name="reference" required minLength={2} maxLength={80} placeholder="Receipt or transfer no." />
              </label>
            </div>
            <div>
              <button className="btn primary" disabled={reserving}>
                {reserving ? "Recording…" : "Record reservation"}
              </button>
            </div>
            <Result s={resS} />
          </form>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            The offer is with the applicant. Counter-offers inside company limits go back to them automatically;
            anything outside goes to a leasing manager&apos;s inbox.
          </p>
        ))}
      <div>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => setRejectOpen(!rejectOpen)}
          aria-expanded={rejectOpen}
        >
          Close this application
        </button>
      </div>
      {rejectOpen && (
        <form action={reject} className="stack inline-form">
          <input type="hidden" name="id" value={p.id} />
          <label className="field">
            <span className="field-label">Reason (kept in the audit trail)</span>
            <textarea name="reason" rows={2} required minLength={3} maxLength={500} />
          </label>
          <div>
            <button className="btn small danger" disabled={rejecting}>
              {rejecting ? "Closing…" : p.state === "SCREENING" ? "Reject at checks" : "Withdraw application"}
            </button>
          </div>
          <Result s={rejS} />
        </form>
      )}
    </section>
  );
}
