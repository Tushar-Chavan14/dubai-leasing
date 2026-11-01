"use client";

import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import { useActionState } from "react";
import {
  type LeaseActionState,
  prepareContract,
  reprepareContract,
  proposeEjari,
  resendSignLink,
} from "../app/(staff)/leases/[id]/actions";
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
    <form action={action} className="stack">
      <input type="hidden" name="leaseId" value={leaseId} />
      <fieldset className="choice-list">
        <legend className="field-label">Standard clauses</legend>
        {(Object.keys(CONTRACT_CLAUSES) as ContractClauseId[]).map((c) => (
          <label key={c} className="choice">
            <input type="checkbox" name="clause" value={c} defaultChecked={clauses.includes(c)} />
            <span>
              <b>{CONTRACT_CLAUSES[c].title}</b>
              <small>{CONTRACT_CLAUSES[c].text}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {companyClauses.length > 0 && (
        <fieldset className="choice-list">
          <legend className="field-label">Company clauses</legend>
          {companyClauses.map((c) => (
            <label key={c.ref} className="choice">
              <input type="checkbox" name="clause" value={c.ref} defaultChecked={clauses.includes(c.ref)} />
              <span>
                <b>{c.title}</b>
                <small>{c.text}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        <span className="field-label">
          Extra terms <em>(optional; checked by the review model for conflicts, never rewritten)</em>
        </span>
        <textarea name="freeText" rows={3} maxLength={4000} defaultValue={freeText ?? ""} />
      </label>
      <Result s={state} />
      <div className="btn-row">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Preparing…" : label}
        </button>
      </div>
    </form>
  );
}

export function ResendSignLinkButton({ leaseId, signerId }: { leaseId: string; signerId: string }) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(resendSignLink, {});
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="leaseId" value={leaseId} />
      <input type="hidden" name="signerId" value={signerId} />
      <button type="submit" className="btn small" disabled={pending}>
        {pending ? "Sending…" : "Send a new link"}
      </button>
      <Result s={state} />
    </form>
  );
}

export function ProposeEjariButton({ leaseId }: { leaseId: string }) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(proposeEjari, {});
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="leaseId" value={leaseId} />
      <div>
        <button type="submit" className="btn small" disabled={pending}>
          {pending ? "Proposing…" : "Propose the submission again"}
        </button>
      </div>
      <Result s={state} />
    </form>
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
    <form action={action} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="leaseId" value={leaseId} />
      {reason !== "rules_changed" && clauses.map((c) => <input key={c} type="hidden" name="clause" value={c} />)}
      <button type="submit" className="btn small" disabled={pending}>
        {pending ? "Preparing…" : LABEL[reason]}
      </button>
      <small className="muted">{HINT[reason]}</small>
      <Result s={state} />
    </form>
  );
}
