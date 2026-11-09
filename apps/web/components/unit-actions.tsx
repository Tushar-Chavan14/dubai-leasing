"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "./ui/button";
import { Banner } from "./ui/form";
import { type ActionResult, requestPriceApprovalAction, unitEventAction } from "../app/(staff)/units/actions";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";

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

  if (!canEdit) return <p className="m-0 text-sm text-muted">Your role can view units but not change them.</p>;
  return (
    <div className="grid gap-4">
      {state.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
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
        </Banner>
      )}
      {actions.map((a) => {
        const meta = LABELS[a.event] ?? { label: a.event, primary: false, help: "" };
        return (
          <form key={a.event} action={run} className="grid gap-1.5">
            <input type="hidden" name="id" value={unitId} />
            <input type="hidden" name="event" value={a.event} />
            <Button
              type="submit"
              variant={meta.primary ? "primary" : "ghost"}
              size="sm"
              className="w-full"
              disabled={!a.allowed || pending}
            >
              {meta.label}
            </Button>
            {a.allowed ? (
              <p className="m-0 text-[12.5px] text-muted">{meta.help}</p>
            ) : (
              <ul className="m-0 list-none p-0 text-[12.5px] text-muted">
                {a.reasons.map((r) => (
                  <li key={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</li>
                ))}
              </ul>
            )}
          </form>
        );
      })}
      {needsPriceApproval && (
        <div className="grid gap-1.5">
          {pendingPriceApprovalId || priceState.id ? (
            <Banner tone="warn">
              <IconWarning size={16} className="mt-0.5 shrink-0" />
              <span>
                Asking rent is waiting for a leasing manager.{" "}
                <Link
                  className="font-semibold underline"
                  href={`/work?approval=${pendingPriceApprovalId ?? priceState.id}`}
                >
                  View the approval
                </Link>
              </span>
            </Banner>
          ) : (
            <form action={askPrice} className="grid gap-1.5">
              <input type="hidden" name="id" value={unitId} />
              <Button type="submit" variant="ghost" size="sm" className="w-full" disabled={asking}>
                Ask a manager to approve this rent
              </Button>
              {priceState.error && <p className="m-0 text-[12.5px] text-danger">{priceState.error}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
