"use client";

import Link from "next/link";
import { useActionState } from "react";
import { type ActionResult, requestPriceApprovalAction, unitEventAction } from "../app/(staff)/units/actions";
import { IconWarning } from "../lib/icons";

const LABELS: Record<string, { label: string; primary: boolean; help: string }> = {
  MARK_READY: { label: "Mark ready", primary: true, help: "Checklist complete and price settled." },
  PUBLISH: { label: "Publish listing", primary: true, help: "Shown to applicants on the enquiry channel." },
  WITHDRAW: { label: "Back to preparation", primary: false, help: "Takes the unit off the market." },
};

interface Props {
  unitId: string;
  actions: { event: string; allowed: boolean; reasons: string[] }[];
  canEdit: boolean;
  needsPriceApproval: boolean;
  pendingPriceApprovalId: string | null;
}

/** State changes go through the engine's Manager; disabled buttons say why. */
export function UnitActions({ unitId, actions, canEdit, needsPriceApproval, pendingPriceApprovalId }: Props) {
  const [state, run, pending] = useActionState<ActionResult, FormData>(unitEventAction, {});
  const [priceState, askPrice, asking] = useActionState<ActionResult, FormData>(requestPriceApprovalAction, {});

  if (!canEdit) return <p className="muted">Your role can view units but not change them.</p>;
  return (
    <div>
      {state.error && (
        <div className="alert" data-tone="bad" role="alert" style={{ marginBottom: 12 }}>
          <IconWarning size={16} />
          <div>
            <strong>{state.error}</strong>
            {state.reasons?.length ? (
              <ul>
                {state.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      )}
      {actions.map((a) => {
        const meta = LABELS[a.event] ?? { label: a.event, primary: false, help: "" };
        return (
          <form key={a.event} action={run} className="action-block">
            <input type="hidden" name="id" value={unitId} />
            <input type="hidden" name="event" value={a.event} />
            <button
              type="submit"
              className={`btn block${meta.primary ? " primary" : ""}`}
              disabled={!a.allowed || pending}
            >
              {meta.label}
            </button>
            {a.allowed ? (
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {meta.help}
              </p>
            ) : (
              <ul className="why">
                {a.reasons.map((r) => (
                  <li key={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</li>
                ))}
              </ul>
            )}
          </form>
        );
      })}
      {needsPriceApproval && (
        <div className="action-block" style={{ marginTop: 14 }}>
          {pendingPriceApprovalId || priceState.id ? (
            <div className="alert" data-tone="warn">
              <IconWarning size={16} />
              <span>
                Asking rent is waiting for a leasing manager.{" "}
                <Link className="link" href={`/work?approval=${pendingPriceApprovalId ?? priceState.id}`}>
                  View the approval
                </Link>
              </span>
            </div>
          ) : (
            <form action={askPrice}>
              <input type="hidden" name="id" value={unitId} />
              <button type="submit" className="btn block" disabled={asking}>
                Ask a manager to approve this rent
              </button>
              {priceState.error && (
                <p className="err" style={{ color: "var(--bad)", fontSize: 13, marginTop: 6 }}>
                  {priceState.error}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
