"use client";

import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { useActionState, useState } from "react";
import { ActionForm } from "../../../../components/ui/action-form";
import { Banner } from "../../../../components/ui/form";
import { Cta, Done, FORM, GHOST, P_INPUT, PField, Section, SMALL_GHOST } from "../../../../components/ui/portal";
import { dateTime } from "../../../../lib/format";
import type { SignPortalView } from "../../../../lib/portal";
import { type PortalState, requestChange, withdrawChange } from "../actions";

const STATUS: Record<SignPortalView["changeRequests"][number]["status"], string> = {
  open: "Received. The leasing team is reviewing it.",
  analysed: "Received. The leasing team is reviewing it.",
  reissued: "Accepted. A revised contract will be emailed to you to sign.",
  declined: "Not accepted. The contract stays as it is.",
  withdrawn: "Withdrawn by you.",
  superseded: "Closed: the contract was replaced by a newer version.",
};

/** D67: the signer's own requests and what happened to each. */
export function ChangeRequestList({ token, items }: { token: string; items: SignPortalView["changeRequests"] }) {
  if (!items.length) return null;
  return (
    <Section title="Your change requests">
      <ul className="m-0 grid list-none gap-3 p-0">
        {items.map((r) => (
          <li key={r.id} className="grid gap-1.5 rounded-xl border border-line bg-page px-3.5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
              <span className="font-mono">{r.ref}</span>
              <span>{dateTime(r.createdAt)}</span>
            </div>
            <p className="m-0 whitespace-pre-wrap text-[15px]">{r.text}</p>
            <p className="m-0 text-[13px] font-semibold">{STATUS[r.status]}</p>
            {r.decisionNote && <p className="m-0 text-[13px] text-muted">Our answer: {r.decisionNote}</p>}
            {(r.status === "open" || r.status === "analysed") && <WithdrawButton token={token} id={r.id} />}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function WithdrawButton({ token, id }: { token: string; id: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(withdrawChange, {});
  return (
    <ActionForm state={state} action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="requestId" value={id} />
      <button type="submit" className={SMALL_GHOST} disabled={pending}>
        {pending ? "Withdrawing…" : "Withdraw request"}
      </button>
      {state.error && <span className="text-[13px] text-danger">{state.error}</span>}
    </ActionForm>
  );
}

/**
 * D67: "Request a change". Optional clause picker plus the signer's words. Sending pauses signing for both parties
 * until the leasing team re-issues the contract or answers.
 */
export function ChangeRequestForm({
  token,
  clauses,
  maxChars,
}: {
  token: string;
  clauses: { ref: string; title: string }[];
  maxChars: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<PortalState, FormData>(requestChange, {});
  if (state.ref) {
    return (
      <Done title="Request sent">
        <p className="m-0">
          Reference <span className="font-mono text-[13px]">{state.ref}</span>. Signing is paused for everyone while the
          leasing team reviews it. We&apos;ll email you their answer.
        </p>
      </Done>
    );
  }
  if (!open) {
    return (
      <Cta>
        <button type="button" className={GHOST} onClick={() => setOpen(true)}>
          Request a change
        </button>
      </Cta>
    );
  }
  return (
    <Section title="Request a change">
      <ActionForm state={state} action={action} className={FORM}>
        <input type="hidden" name="token" value={token} />
        <PField label="What is it about?">
          <select name="target" defaultValue="other" className={P_INPUT}>
            <option value="other">Something else in the contract</option>
            {clauses.map((c) => (
              <option key={c.ref} value={c.ref}>
                Clause: {c.title}
              </option>
            ))}
            <option value="free_text">The additional terms</option>
          </select>
        </PField>
        <PField
          label="What would you like changed?"
          hint="Say it in your own words. Rent, cheques, deposit and dates are agreed in the offer and changed by the leasing team."
        >
          <textarea name="text" required minLength={5} maxLength={maxChars} rows={5} className={P_INPUT} />
        </PField>
        <p className="m-0 text-[13px] text-muted">
          Sending this pauses signing for both parties until the leasing team answers. Nothing changes in the contract
          until they send you a revised version to sign.
        </p>
        {state.error && (
          <Banner tone="bad" role="alert">
            <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </Banner>
        )}
        <Cta>
          <button type="submit" className={GHOST} disabled={pending}>
            {pending ? "Sending…" : "Send request"}
          </button>
        </Cta>
      </ActionForm>
    </Section>
  );
}
