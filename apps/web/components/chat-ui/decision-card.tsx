"use client";

import { ActionForm } from "../ui/action-form";
import Link from "next/link";
import { useActionState } from "react";
import { recordReservation, recordViewingOutcome } from "../../app/(staff)/applications/actions";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import {
  recordRegistrationNoCertificate,
  recordRegistrationRejected,
} from "../../app/(staff)/leases/[id]/registration-actions";
import { DecisionForm } from "../decision-form";
import { CardError, CardNote, CardShell, Facts } from "./card-shell";
import { Button } from "../ui/button";
import { FIELD, INPUT, LABEL } from "../ui/form";
import { cardStatus, registrationRecordSpec, registrationRejectedSpec } from "./decision-card-helpers";

/**
 * A decision the user asked the copilot for (D48). The copilot only puts it on screen; the buttons run the same routes
 * as the inbox (approve, or reject with a note) and the application page (site visit outcome, reservation payment), as
 * the signed-in user,
 * with the engine's role checks.
 */
export type DecisionCardData =
  | {
      kind: "decision";
      decision: "approval";
      approvalId: string;
      title: string;
      gateLabel: string;
      ref: string | null;
      href: string;
      blocked?: string;
    }
  | {
      kind: "decision";
      decision: "site_visit";
      applicationId: string;
      ref: string;
      name: string;
      unit: string;
      href: string;
      blocked?: string;
    }
  | {
      kind: "decision";
      decision: "reservation";
      applicationId: string;
      ref: string;
      name: string;
      unit: string;
      amount: string;
      paidOn: string;
      today: string;
      reference: string;
      href: string;
      blocked?: string;
    }
  | {
      kind: "decision";
      decision: "registration";
      leaseId: string;
      ref: string;
      unit: string;
      systemName: string;
      portalName: string;
      submissionId: string;
      reference: string;
      issuedOn: string;
      today: string;
      feePaidAed: string;
      href: string;
      blocked?: string;
    }
  | {
      kind: "decision";
      decision: "registration_rejected";
      leaseId: string;
      ref: string;
      unit: string;
      systemName: string;
      portalName: string;
      submissionId: string;
      reasons: string;
      href: string;
      blocked?: string;
    };

type State = { ok?: string; error?: string };

function Recorded({ text }: { text: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-line bg-accent px-3.5 py-2.5 text-sm text-on-accent"
      role="status"
    >
      <IconCheck size={16} />
      {text}
    </div>
  );
}

function SiteVisit({ id }: { id: string }) {
  const [state, action, pending] = useActionState<State, FormData>(
    recordViewingOutcome as (s: State, f: FormData) => Promise<State>,
    {},
  );
  if (state.ok) return <Recorded text={state.ok} />;
  return (
    <ActionForm state={state} action={action} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      {state.error && <CardError>{state.error}</CardError>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="outcome" value="attended" variant="primary" size="sm" disabled={pending}>
          Came to the visit
        </Button>
        <Button type="submit" name="outcome" value="no_show" variant="ghost" size="sm" disabled={pending}>
          Didn&rsquo;t come
        </Button>
      </div>
      <span className="text-xs text-muted">
        Came: the document upload link is emailed. Didn&rsquo;t come: the application closes (only after the booked
        time).
      </span>
    </ActionForm>
  );
}

/** The application page's reservation form; the copilot only prefills the date and reference the user gave. */
function Reservation({ card }: { card: Extract<DecisionCardData, { decision: "reservation" }> }) {
  const [state, action, pending] = useActionState<State, FormData>(
    recordReservation as (s: State, f: FormData) => Promise<State>,
    {},
  );
  if (state.ok) return <Recorded text={state.ok} />;
  return (
    <ActionForm state={state} action={action} className="grid gap-2.5">
      <input type="hidden" name="id" value={card.applicationId} />
      {state.error && <CardError>{state.error}</CardError>}
      <label className={FIELD}>
        <span className={LABEL}>Paid on</span>
        <input className={INPUT} name="paidOn" type="date" required max={card.today} defaultValue={card.paidOn} />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>Payment reference</span>
        <input
          className={INPUT}
          name="reference"
          required
          minLength={2}
          maxLength={80}
          defaultValue={card.reference}
          placeholder="Receipt or transfer no."
        />
      </label>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Recording…" : "Record reservation"}
        </Button>
      </div>
      <span className="text-xs text-muted">
        Check the date and reference. Recording creates the lease for the contract.
      </span>
    </ActionForm>
  );
}

type RegState = { ok?: boolean; message?: string };

/** The lease page's record-registration form without the file; the copilot only prefills what the user typed. */
function RegistrationRecord({ card }: { card: Extract<DecisionCardData, { decision: "registration" }> }) {
  const [state, action, pending] = useActionState<RegState, FormData>(recordRegistrationNoCertificate, {});
  if (state.ok) return <Recorded text={state.message ?? "Registration recorded."} />;
  const spec = registrationRecordSpec(card);
  return (
    <form action={action} className="grid gap-2.5">
      <input type="hidden" name="leaseId" value={spec.hidden.leaseId} />
      <input type="hidden" name="submissionId" value={spec.hidden.submissionId} />
      {state.message && <CardError>{state.message}</CardError>}
      <label className={FIELD}>
        <span className={LABEL}>{spec.reference.label}</span>
        <input
          className={INPUT}
          name="reference"
          required={spec.reference.required}
          maxLength={spec.reference.maxLength}
          defaultValue={spec.reference.defaultValue}
          placeholder="As shown in the portal"
        />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>Registered on</span>
        <input
          className={INPUT}
          name="issuedOn"
          type="date"
          required={spec.issuedOn.required}
          max={spec.issuedOn.max}
          defaultValue={spec.issuedOn.defaultValue}
        />
      </label>
      <label className={FIELD}>
        <span className={LABEL}>{spec.fee.label}</span>
        <input className={INPUT} name="feePaidAed" inputMode="decimal" defaultValue={spec.fee.defaultValue} />
      </label>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Recording…" : "Record registration"}
        </Button>
      </div>
      <span className="text-xs text-muted">
        Check the reference against the portal. Upload the certificate on the lease page.
      </span>
    </form>
  );
}

function RegistrationRejected({ card }: { card: Extract<DecisionCardData, { decision: "registration_rejected" }> }) {
  const [state, action, pending] = useActionState<RegState, FormData>(recordRegistrationRejected, {});
  if (state.ok) return <Recorded text={state.message ?? "Rejection recorded."} />;
  const spec = registrationRejectedSpec(card);
  return (
    <form action={action} className="grid gap-2.5">
      <input type="hidden" name="leaseId" value={spec.hidden.leaseId} />
      <input type="hidden" name="submissionId" value={spec.hidden.submissionId} />
      {state.message && <CardError>{state.message}</CardError>}
      <label className={FIELD}>
        <span className={LABEL}>{spec.reasons.label}</span>
        <textarea
          className={INPUT}
          name="reasons"
          required={spec.reasons.required}
          maxLength={spec.reasons.maxLength}
          rows={3}
          defaultValue={spec.reasons.defaultValue}
          placeholder="The portal's reasons"
        />
      </label>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Recording…" : "Record rejection"}
        </Button>
      </div>
    </form>
  );
}

export function DecisionCardView({ card }: { card: DecisionCardData }) {
  return (
    <CardShell
      title={
        card.decision === "approval"
          ? card.gateLabel
          : card.decision === "reservation"
            ? "Reservation"
            : card.decision === "registration"
              ? `${card.systemName} registration`
              : card.decision === "registration_rejected"
                ? `${card.systemName} rejected`
                : "Site visit"
      }
      status={cardStatus(card.blocked).label}
      tone={cardStatus(card.blocked).tone}
    >
      <Facts>
        {card.decision === "approval" ? (
          <>
            <dt>Approval</dt>
            <dd>{card.title}</dd>
          </>
        ) : card.decision === "registration" || card.decision === "registration_rejected" ? (
          <>
            <dt>Lease</dt>
            <dd>{card.unit}</dd>
            <dt>Portal</dt>
            <dd>{card.portalName}</dd>
          </>
        ) : (
          <>
            <dt>Applicant</dt>
            <dd>
              {card.name} · {card.unit}
            </dd>
            {card.decision === "reservation" && (
              <>
                <dt>Amount</dt>
                <dd className="tabular-nums">{card.amount}</dd>
              </>
            )}
          </>
        )}
        {card.ref && (
          <>
            <dt>Record</dt>
            <dd className="font-mono text-xs">{card.ref}</dd>
          </>
        )}
      </Facts>
      {card.blocked ? (
        <CardNote>
          <IconWarning size={13} className="mr-1 inline" aria-hidden /> {card.blocked}
        </CardNote>
      ) : card.decision === "approval" ? (
        <DecisionForm id={card.approvalId} canEditRent={false} currentRentAed={null} />
      ) : card.decision === "reservation" ? (
        <Reservation card={card} />
      ) : card.decision === "registration" ? (
        <RegistrationRecord card={card} />
      ) : card.decision === "registration_rejected" ? (
        <RegistrationRejected card={card} />
      ) : (
        <SiteVisit id={card.applicationId} />
      )}
      <CardNote>
        <Link className="text-ink! underline underline-offset-2 hover:no-underline" href={card.href}>
          {card.decision === "approval"
            ? "Open the full approval"
            : card.decision === "registration" || card.decision === "registration_rejected"
              ? "Open the lease (upload the certificate there)"
              : "Open the application"}
        </Link>
      </CardNote>
    </CardShell>
  );
}
