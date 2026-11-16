"use client";

import { CONTRACT_CLAUSES, type ContractClauseId } from "@leasing/core";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { useActionState, useState } from "react";
import { declineChange, type LeaseActionState, reissueChange } from "../app/(staff)/leases/[id]/actions";
import { ActionForm } from "./ui/action-form";
import { buttonClass } from "./ui/button";
import { Banner, FIELD, INPUT, LABEL } from "./ui/form";

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

/**
 * D67: what staff can do with an open change request. Re-issue with the AI's draft (it still waits at the
 * `final_contract` gate), edit the draft first, or decline with a note emailed to the signer.
 */
export function ChangeRequestActions({
  leaseId,
  requestId,
  proposal,
  companyClauses,
}: {
  leaseId: string;
  requestId: string;
  proposal: { clauses: string[]; freeText: string | null } | null;
  companyClauses: { ref: string; title: string; text: string }[];
}) {
  const [mode, setMode] = useState<"none" | "edit" | "decline">("none");
  const [reissue, reissueAction, reissuing] = useActionState<LeaseActionState, FormData>(reissueChange, {});
  if (reissue.ok) return <Result s={reissue} />;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {proposal && (
          <ActionForm state={reissue} action={reissueAction}>
            <input type="hidden" name="leaseId" value={leaseId} />
            <input type="hidden" name="requestId" value={requestId} />
            <button type="submit" className={buttonClass("primary", "sm")} disabled={reissuing}>
              {reissuing ? "Preparing…" : "Re-issue with this change"}
            </button>
          </ActionForm>
        )}
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          aria-expanded={mode === "edit"}
          onClick={() => setMode(mode === "edit" ? "none" : "edit")}
        >
          {proposal ? "Edit, then re-issue" : "Change the clauses and re-issue"}
        </button>
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          aria-expanded={mode === "decline"}
          onClick={() => setMode(mode === "decline" ? "none" : "decline")}
        >
          Decline
        </button>
      </div>
      <Result s={reissue} />
      {mode === "edit" && (
        <EditReissueForm
          leaseId={leaseId}
          requestId={requestId}
          clauses={proposal?.clauses ?? []}
          freeText={proposal?.freeText ?? null}
          companyClauses={companyClauses}
        />
      )}
      {mode === "decline" && <DeclineForm leaseId={leaseId} requestId={requestId} />}
    </div>
  );
}

function EditReissueForm({
  leaseId,
  requestId,
  clauses,
  freeText,
  companyClauses,
}: {
  leaseId: string;
  requestId: string;
  clauses: string[];
  freeText: string | null;
  companyClauses: { ref: string; title: string; text: string }[];
}) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(reissueChange, {});
  return (
    <ActionForm state={state} action={action} className="grid gap-3 rounded-xl border border-line p-3.5">
      <input type="hidden" name="leaseId" value={leaseId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="edited" value="1" />
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className={`${LABEL} mb-1.5 p-0`}>Standard clauses</legend>
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
          <legend className={`${LABEL} mb-1.5 p-0`}>Company clauses</legend>
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
        <span className={LABEL}>Additional terms</span>
        <textarea className={INPUT} name="freeText" rows={4} maxLength={4000} defaultValue={freeText ?? ""} />
      </label>
      <Result s={state} />
      <div>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          {pending ? "Preparing…" : "Re-issue with my changes"}
        </button>
      </div>
    </ActionForm>
  );
}

function DeclineForm({ leaseId, requestId }: { leaseId: string; requestId: string }) {
  const [state, action, pending] = useActionState<LeaseActionState, FormData>(declineChange, {});
  if (state.ok) return <Result s={state} />;
  return (
    <ActionForm state={state} action={action} className="grid gap-3 rounded-xl border border-line p-3.5">
      <input type="hidden" name="leaseId" value={leaseId} />
      <input type="hidden" name="requestId" value={requestId} />
      <label className={FIELD}>
        <span className={LABEL}>Note to the signer (emailed with a fresh signing link)</span>
        <textarea className={INPUT} name="note" rows={3} minLength={5} maxLength={1000} required />
      </label>
      <Result s={state} />
      <div>
        <button type="submit" className={buttonClass("ghost", "sm")} disabled={pending}>
          {pending ? "Declining…" : "Decline and email the note"}
        </button>
      </div>
    </ActionForm>
  );
}
