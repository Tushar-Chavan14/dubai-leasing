"use client";

import { useActionState, useState } from "react";
import { IconCheck, IconWarning } from "../../../lib/icons";
import { acknowledge, type PortalState, reply } from "./actions";

function Done({ state, what }: { state: PortalState; what: string }) {
  return (
    <div className="alert" data-tone="good" role="status">
      <IconCheck size={16} />
      <span>
        {state.duplicate ? `We already have your ${what}.` : `Thank you, we've received your ${what}.`} Your reference
        is <b className="ref">{state.ref}</b>.
      </span>
    </div>
  );
}

export function AcknowledgeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(acknowledge, {});
  if (state.ref) return <Done state={state} what="confirmation" />;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          {state.error}
        </div>
      )}
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Sending…" : "I confirm I received the notice"}
      </button>
    </form>
  );
}

const CHOICES = [
  { value: "renew", label: "Renew", help: "Accept the renewal on the terms in the notice." },
  { value: "vacate", label: "Move out", help: "Leave when the tenancy ends. We'll arrange the inspection." },
  { value: "discuss", label: "Discuss", help: "Talk to us about the rent or terms first." },
] as const;

export function ReplyForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(reply, {});
  const [choice, setChoice] = useState<string>("");
  const [confirmVacate, setConfirmVacate] = useState(false);
  if (state.ref) return <Done state={state} what="reply" />;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          {state.error}
        </div>
      )}
      <fieldset className="choice-list">
        <legend className="field-label">What would you like to do?</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="choice">
            <input
              type="radio"
              name="choice"
              value={c.value}
              checked={choice === c.value}
              onChange={() => setChoice(c.value)}
              required
            />
            <span>
              <b>{c.label}</b>
              <small>{c.help}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span className="field-label">
          Anything you&apos;d like to add? <em>(optional, English or Arabic)</em>
        </span>
        <textarea name="comment" rows={3} maxLength={2000} />
      </label>
      {choice === "vacate" && (
        <label className="check">
          <input
            type="checkbox"
            name="confirmVacate"
            checked={confirmVacate}
            onChange={(e) => setConfirmVacate(e.target.checked)}
            required
          />
          <span>I won&apos;t renew. I understand my tenancy ends on its end date and I&apos;ll move out then.</span>
        </label>
      )}
      <button
        type="submit"
        className="btn primary"
        disabled={pending || !choice || (choice === "vacate" && !confirmVacate)}
      >
        {pending ? "Sending…" : choice === "vacate" ? "Confirm I'm moving out" : "Send my reply"}
      </button>
    </form>
  );
}
