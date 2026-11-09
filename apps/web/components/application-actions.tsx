"use client";

import { useActionState, useState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { viewingTime } from "../lib/format";
import {
  type AppActionState,
  bookViewing,
  recordReservation,
  recordViewingOutcome,
  rejectApplicant,
  requestDocuments,
} from "../app/(staff)/applications/actions";
import { buttonClass } from "./ui/button";
import { Banner, FIELD, INPUT, LABEL } from "./ui/form";
import { Section } from "./ui/record";

function Result({ s }: { s: AppActionState }) {
  if (s.ok)
    return (
      <Banner tone="good" role="status">
        <IconCheck size={16} className="mt-0.5 shrink-0" />
        {s.ok}
      </Banner>
    );
  if (s.error)
    return (
      <Banner tone="bad" role="alert">
        <IconWarning size={16} className="mt-0.5 shrink-0" />
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
      </Banner>
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
    <Section id="next-h" title="Next step">
      {p.state === "ENQUIRY" && (
        <form action={book} className="grid gap-3">
          <input type="hidden" name="id" value={p.id} />
          <p className="m-0 text-sm">
            Book a site visit. The applicant gets an invitation with the time, the address and a page to view the
            property online.
          </p>
          <label className={FIELD}>
            <span className={LABEL}>Site visit date &amp; time (Dubai)</span>
            <input
              className={INPUT}
              name="viewingAt"
              type="datetime-local"
              required
              min={p.today ? `${p.today}T00:00` : undefined}
              step={900}
            />
          </label>
          <div>
            <button className={buttonClass("primary", "sm")} disabled={booking}>
              {booking ? "Booking…" : "Book site visit"}
            </button>
          </div>
          <Result s={bookS} />
        </form>
      )}
      {p.state === "VIEWING" && (
        <div className="grid gap-3">
          <p className="m-0 text-sm">
            {p.viewingAt ? (
              <>
                Site visit booked for <b>{viewingTime(p.viewingAt)}</b> (Dubai). Record what happened.
              </>
            ) : (
              "Site visit booked. Record what happened."
            )}
          </p>
          <form action={came} className="grid gap-3">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="outcome" value="attended" />
            <div>
              <button className={buttonClass("primary", "sm")} disabled={recordingCame}>
                {recordingCame ? "Sending…" : "Showed up — send document link"}
              </button>
            </div>
            <Result s={cameS} />
          </form>
          <form action={noShow} className="grid gap-3 rounded-xl border border-line p-3.5">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="outcome" value="no_show" />
            <label className={FIELD}>
              <span className={LABEL}>
                Note <em className="font-normal not-italic">(optional, kept in the audit trail)</em>
              </span>
              <textarea name="note" rows={2} maxLength={500} className={INPUT} />
            </label>
            <div>
              <button className={buttonClass("danger", "sm")} disabled={recordingNoShow}>
                {recordingNoShow ? "Closing…" : "No-show — close application"}
              </button>
            </div>
            <p className="m-0 text-[12.5px] text-muted">
              Only once the site visit time has passed. The applicant must apply again.
            </p>
            <Result s={noShowS} />
          </form>
        </div>
      )}
      {p.state === "SCREENING" && (
        <form action={docs} className="grid gap-3">
          <input type="hidden" name="id" value={p.id} />
          <p className="m-0 text-sm">
            Waiting for documents or for the check. If the applicant needs a new link (lost email, new documents), send
            one.
          </p>
          <div>
            <button className={buttonClass("ghost", "sm")} disabled={sendingDocs}>
              {sendingDocs ? "Sending…" : "Send a new upload link"}
            </button>
          </div>
          <Result s={docsS} />
        </form>
      )}
      {p.state === "OFFER" &&
        (p.accepted ? (
          <form action={reserve} className="grid gap-3">
            <input type="hidden" name="id" value={p.id} />
            <p className="m-0 text-sm">
              The applicant accepted. Record the reservation of <b>{p.reservation}</b> once it&apos;s received; the
              lease is then created for the contract.
            </p>
            <div className="grid gap-3 @[480px]:grid-cols-2">
              <label className={FIELD}>
                <span className={LABEL}>Paid on</span>
                <input className={INPUT} name="paidOn" type="date" required max={p.today} defaultValue={p.today} />
              </label>
              <label className={FIELD}>
                <span className={LABEL}>Payment reference</span>
                <input
                  className={INPUT}
                  name="reference"
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="Receipt or transfer no."
                />
              </label>
            </div>
            <div>
              <button className={buttonClass("primary", "sm")} disabled={reserving}>
                {reserving ? "Recording…" : "Record reservation"}
              </button>
            </div>
            <Result s={resS} />
          </form>
        ) : (
          <p className="m-0 text-sm text-muted">
            The offer is with the applicant. Counter-offers inside company limits go back to them automatically;
            anything outside goes to a leasing manager&apos;s inbox.
          </p>
        ))}
      <div>
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          onClick={() => setRejectOpen(!rejectOpen)}
          aria-expanded={rejectOpen}
        >
          Close this application
        </button>
      </div>
      {rejectOpen && (
        <form action={reject} className="grid gap-3 rounded-xl border border-line p-3.5">
          <input type="hidden" name="id" value={p.id} />
          <label className={FIELD}>
            <span className={LABEL}>Reason (kept in the audit trail)</span>
            <textarea name="reason" rows={2} required minLength={3} maxLength={500} className={INPUT} />
          </label>
          <div>
            <button className={buttonClass("danger", "sm")} disabled={rejecting}>
              {rejecting ? "Closing…" : p.state === "SCREENING" ? "Reject at checks" : "Withdraw application"}
            </button>
          </div>
          <Result s={rejS} />
        </form>
      )}
    </Section>
  );
}
