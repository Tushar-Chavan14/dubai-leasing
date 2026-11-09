"use client";

import { ActionForm } from "./ui/action-form";
import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import { useActionState } from "react";
import {
  type LeaseActionState,
  prepareContract,
  reprepareContract,
  proposeEjari,
  resendSignLink,
} from "../app/(staff)/leases/[id]/actions";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { buttonClass } from "./ui/button";
import { Banner, FIELD, INPUT, LABEL as FIELD_LABEL } from "./ui/form";

const CHOICE =
  "flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-ink";

function Result({ s }: { s: LeaseActionState }) {
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

/** Prepare (or re-issue) the contract: standard clauses and optional extra terms. */
export function PrepareContractForm({
  leaseId,
  clauses,
  freeText,
  label,
  companyClauses = [],
}: {
  leaseId: string;
  clauses: string[];
  freeText: string | null;
  label: string;
  companyClauses?: { ref: string; title: string; text: string; hasValues: boolean }[];
}) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(prepareContract, {});
  return (
    <ActionForm state={state} action={action} className="grid gap-3">
      <input type="hidden" name="leaseId" value={leaseId} />
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className={`${FIELD_LABEL} mb-1.5 p-0`}>Standard clauses</legend>
        {(Object.keys(CONTRACT_CLAUSES) as ContractClauseId[]).map((c) => (
          <label key={c} className={CHOICE}>
            <input type="checkbox" name="clause" value={c} defaultChecked={clauses.includes(c)} />
            <span className="grid gap-0.5">
              <b className="font-semibold">{CONTRACT_CLAUSES[c].title}</b>
              <small className="text-[12.5px] text-muted">{CONTRACT_CLAUSES[c].text}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {companyClauses.length > 0 && (
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
          <legend className={`${FIELD_LABEL} mb-1.5 p-0`}>Company clauses</legend>
          {companyClauses.map((c) => (
            <label key={c.ref} className={CHOICE}>
              <input type="checkbox" name="clause" value={c.ref} defaultChecked={clauses.includes(c.ref)} />
              <span className="grid gap-0.5">
                <b className="font-semibold">{c.title}</b>
                <small className="text-[12.5px] text-muted">{c.text}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className={FIELD}>
        <span className={FIELD_LABEL}>
          Extra terms{" "}
          <em className="font-normal not-italic">
            (optional; checked by the review model for conflicts, never rewritten)
          </em>
        </span>
        <textarea className={INPUT} name="freeText" rows={3} maxLength={4000} defaultValue={freeText ?? ""} />
      </label>
      <Result s={state} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          {pending ? "Preparing…" : label}
        </button>
      </div>
    </ActionForm>
  );
}

export function ResendSignLinkButton({ leaseId, signerId }: { leaseId: string; signerId: string }) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(resendSignLink, {});
  return (
    <ActionForm state={state} action={action} className="grid gap-1.5">
      <input type="hidden" name="leaseId" value={leaseId} />
      <input type="hidden" name="signerId" value={signerId} />
      <button type="submit" className={buttonClass("ghost", "sm")} disabled={pending}>
        {pending ? "Sending…" : "Send a new link"}
      </button>
      <Result s={state} />
    </ActionForm>
  );
}

export function ProposeEjariButton({ leaseId }: { leaseId: string }) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(proposeEjari, {});
  return (
    <ActionForm state={state} action={action} className="grid gap-2">
      <input type="hidden" name="leaseId" value={leaseId} />
      <div>
        <button type="submit" className={buttonClass("ghost", "sm")} disabled={pending}>
          {pending ? "Proposing…" : "Propose the submission again"}
        </button>
      </div>
      <Result s={state} />
    </ActionForm>
  );
}

const LABEL = {
  failed: "Preparation failed: try again",
  rejected: "Contract not approved: prepare a new version",
  not_prepared: "Prepare the contract now",
  rules_changed: "Rules changed: prepare again",
} as const;
const HINT = {
  failed: "The contract agent couldn\u2019t prepare this contract. Fix what the task says, then try again.",
  rejected: "The last version was not approved. A new version is prepared from the current rules and template.",
  not_prepared: "The contract is normally prepared automatically right after the offer is accepted.",
  rules_changed:
    "The company\u2019s contract rules, clauses or template changed after this contract was prepared. The pending approval (or the unsigned signing links) is cancelled and the new version waits for approval.",
} as const;

/**
 * Shown only when the engine says a hand preparation is needed: the automatic one failed (prepares with the rule's
 * clauses) or the contract config changed after the pending contract was prepared (re-renders it).
 */
export function ReprepareContractButton({
  leaseId,
  reason,
  clauses,
}: {
  leaseId: string;
  reason: "failed" | "rejected" | "not_prepared" | "rules_changed";
  clauses: string[];
}) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(
    reason === "rules_changed" ? reprepareContract : prepareContract,
    {},
  );
  return (
    <ActionForm state={state} action={action} className="grid gap-1.5">
      <input type="hidden" name="leaseId" value={leaseId} />
      {reason !== "rules_changed" && clauses.map((c) => <input key={c} type="hidden" name="clause" value={c} />)}
      <button type="submit" className={buttonClass("ghost", "sm")} disabled={pending}>
        {pending ? "Preparing…" : LABEL[reason]}
      </button>
      <small className="text-[12.5px] text-muted">{HINT[reason]}</small>
      <Result s={state} />
    </ActionForm>
  );
}
