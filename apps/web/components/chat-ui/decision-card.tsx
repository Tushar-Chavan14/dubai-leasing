"use client";

import Link from "next/link";
import { useActionState } from "react";
import { recordViewingOutcome } from "../../app/(staff)/applications/actions";
import { IconCheck, IconWarning } from "../../lib/icons";
import { DecisionForm } from "../decision-form";

/**
 * A decision the user asked the copilot for (D48). The copilot only puts it on screen; the buttons run the same routes
 * as the inbox (approve, or reject with a note) and the application page (site visit outcome), as the signed-in user,
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
    };

function SiteVisit({ id }: { id: string }) {
  type State = { ok?: string; error?: string };
  const [state, action, pending] = useActionState<State, FormData>(
    recordViewingOutcome as (s: State, f: FormData) => Promise<State>,
    {},
  );
  if (state.ok) {
    return (
      <div className="alert" data-tone="good" role="status">
        <IconCheck size={16} />
        {state.ok}
      </div>
    );
  }
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="id" value={id} />
      {state.error && (
        <p className="cp-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="btn-row">
        <button type="submit" name="outcome" value="attended" className="btn primary small" disabled={pending}>
          Came to the visit
        </button>
        <button type="submit" name="outcome" value="no_show" className="btn danger small" disabled={pending}>
          Didn&rsquo;t come
        </button>
      </div>
      <span className="hint">
        Came: the document upload link is emailed. Didn&rsquo;t come: the application closes (only after the booked
        time).
      </span>
    </form>
  );
}

export function DecisionCardView({ card }: { card: DecisionCardData }) {
  return (
    <div className="cp-proposal" data-status={card.blocked ? "cancelled" : "pending"}>
      <div className="cp-proposal-head">
        <strong>{card.decision === "approval" ? card.gateLabel : "Site visit"}</strong>
        <span className="status" data-tone={card.blocked ? "quiet" : "warn"}>
          {card.blocked ? "Not yours to decide" : "Your decision"}
        </span>
      </div>
      <dl>
        {card.decision === "approval" ? (
          <>
            <dt>Approval</dt>
            <dd>{card.title}</dd>
          </>
        ) : (
          <>
            <dt>Applicant</dt>
            <dd>
              {card.name} · {card.unit}
            </dd>
          </>
        )}
        {card.ref && (
          <>
            <dt>Record</dt>
            <dd className="ref">{card.ref}</dd>
          </>
        )}
      </dl>
      {card.blocked ? (
        <p className="cp-proposal-note">
          <IconWarning size={13} /> {card.blocked}
        </p>
      ) : card.decision === "approval" ? (
        <DecisionForm id={card.approvalId} canEditRent={false} currentRentAed={null} />
      ) : (
        <SiteVisit id={card.applicationId} />
      )}
      <p className="cp-proposal-note">
        <Link className="link" href={card.href}>
          {card.decision === "approval" ? "Open the full approval" : "Open the application"}
        </Link>
      </p>
    </div>
  );
}
