"use client";

import { ActionForm } from "@platform/ui/action-form";
import { type ReactNode, useActionState, useState } from "react";
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
import { buttonClass } from "@platform/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";
import { DateTimeFields } from "@platform/ui/date-time-picker";
import { Section } from "@platform/ui/record";

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
  /** The site visit time has passed (demo clock), so a no-show can be recorded. */
  viewingPassed?: boolean;
  /** The record's next step in words, for states without their own form. */
  nextStep?: string | undefined;
  /** A waiting task's own buttons (e.g. Send offer), shown first in the card. */
  pendingAction?: ReactNode;
  /** The current offer, as a foldable sub-card inside Next step. */
  offer?: ReactNode;
}) {
  const [bookS, book, booking] = useActionState<AppActionState, FormData>(bookViewing, {});
  const [cameS, came, recordingCame] = useActionState<AppActionState, FormData>(recordViewingOutcome, {});
  const [noShowS, noShow, recordingNoShow] = useActionState<AppActionState, FormData>(recordViewingOutcome, {});
  const [docsS, docs, sendingDocs] = useActionState<AppActionState, FormData>(requestDocuments, {});
  const [resS, reserve, reserving] = useActionState<AppActionState, FormData>(recordReservation, {});
  const [rejS, reject, rejecting] = useActionState<AppActionState, FormData>(rejectApplicant, {});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [visitAt, setVisitAt] = useState("");
  const open = ["ENQUIRY", "VIEWING", "SCREENING", "OFFER"].includes(p.state);
  // Other states have no form of their own, but the card still says what is next (and holds any waiting task).
  if (!open)
    return p.nextStep || p.pendingAction ? (
      <Section id="next-h" title="Next step" highlight>
        {p.nextStep && <p className="m-0 text-sm">{p.nextStep}</p>}
        {p.pendingAction}
        {p.offer}
      </Section>
    ) : null;
  return (
    <Section id="next-h" title="Next step" highlight>
      {p.pendingAction}
      {p.state === "ENQUIRY" && (
        <ActionForm state={bookS} action={book} className="grid gap-3">
          <input type="hidden" name="id" value={p.id} />
          <p className="m-0 text-sm">
            Book a site visit. The applicant gets an invitation with the time, the address and a page to view the
            property online.
          </p>
          <div className="flex flex-wrap items-end gap-2.5">
            <DateTimeFields name="viewingAt" min={p.today} onChange={setVisitAt} />
            <button
              className={`${buttonClass("primary", "sm")} h-10 flex-none`}
              disabled={booking || !visitAt}
              title={visitAt ? undefined : "Choose a date and a time first"}
            >
              {booking ? "Booking…" : "Book site visit"}
            </button>
          </div>
          <Result s={bookS} />
        </ActionForm>
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
          {/* Two outcomes, side by side. No-show unlocks once the visit time has passed. */}
          {!noShowOpen && (
            <div className="flex flex-wrap items-center gap-2">
              <ActionForm state={cameS} action={came} className="contents">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="outcome" value="attended" />
                <button className={buttonClass("primary", "sm")} disabled={recordingCame}>
                  {recordingCame ? "Sending…" : "Showed up — send document link"}
                </button>
              </ActionForm>
              <button
                type="button"
                className={buttonClass("danger", "sm")}
                disabled={!p.viewingPassed}
                title={p.viewingPassed ? undefined : "Available once the site visit time has passed"}
                onClick={() => setNoShowOpen(true)}
              >
                No-show
              </button>
            </div>
          )}
          <Result s={cameS} />
          {noShowOpen && (
            <ActionForm
              state={noShowS}
              action={noShow}
              className="grid gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3.5"
            >
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="outcome" value="no_show" />
              <label className={FIELD}>
                <span className={LABEL}>
                  Note <em className="font-normal not-italic">(optional, kept in the audit trail)</em>
                </span>
                <textarea name="note" rows={2} maxLength={500} autoFocus className={INPUT} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className={buttonClass("danger", "sm")} disabled={recordingNoShow}>
                  {recordingNoShow ? "Closing…" : "Record no-show and close"}
                </button>
                <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setNoShowOpen(false)}>
                  Cancel
                </button>
              </div>
              <p className="m-0 text-[12.5px] text-muted">The application closes; the applicant must apply again.</p>
              <Result s={noShowS} />
            </ActionForm>
          )}
        </div>
      )}
      {p.state === "SCREENING" && (
        <ActionForm state={docsS} action={docs} className="grid gap-3">
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
        </ActionForm>
      )}
      {p.state === "OFFER" &&
        (p.accepted ? (
          <ActionForm state={resS} action={reserve} className="grid gap-3">
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
          </ActionForm>
        ) : p.pendingAction ? null : (
          <p className="m-0 text-sm text-muted">
            The offer is with the applicant. Counter-offers inside company limits go back to them automatically;
            anything outside goes to a leasing manager&apos;s inbox.
          </p>
        ))}
      {p.offer}
      {/* Ending the application is a side exit, not the next step: a quiet footer line, away from the main action. */}
      {/* At the site visit, No-show is the way out: no second exit. */}
      {!rejectOpen && p.state !== "VIEWING" && (
        <p className="m-0 mt-1 border-t border-line pt-3 text-[13px] text-muted">
          Not going ahead?{" "}
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            aria-expanded={false}
            aria-controls="close-app"
            className="cursor-pointer border-0 bg-transparent p-0 font-sans text-[13px] font-semibold text-danger underline-offset-2 hover:underline"
          >
            Close this application
          </button>
        </p>
      )}
      {rejectOpen && (
        <ActionForm
          id="close-app"
          state={rejS}
          action={reject}
          className="grid gap-3 rounded-xl border border-danger/30 bg-danger/5 p-3.5"
        >
          <input type="hidden" name="id" value={p.id} />
          <label className={FIELD}>
            <span className={LABEL}>Reason (kept in the audit trail)</span>
            <textarea name="reason" rows={2} required minLength={3} maxLength={500} className={INPUT} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass("danger", "sm")} disabled={rejecting}>
              {rejecting ? "Closing…" : p.state === "SCREENING" ? "Reject at checks" : "Withdraw application"}
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setRejectOpen(false)}>
              Cancel
            </button>
          </div>
          <Result s={rejS} />
        </ActionForm>
      )}
    </Section>
  );
}
