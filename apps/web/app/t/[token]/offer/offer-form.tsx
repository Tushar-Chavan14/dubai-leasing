"use client";

import { useActionState, useState } from "react";
import { IconCheck, IconWarning } from "../../../../lib/icons";
import { type PortalState, respondOffer } from "../actions";

const CHOICES = [
  {
    value: "accept",
    label: "Accept",
    help: "Take the unit on these terms. Next, the leasing team arranges the reservation payment.",
  },
  { value: "counter", label: "Propose different terms", help: "Change the rent, number of cheques or move-in date." },
  { value: "decline", label: "Decline", help: "You don't want the unit." },
] as const;

export function OfferForm(p: { token: string; revision: number; rentAed: number; cheques: number; moveInOn: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(respondOffer, {});
  const [choice, setChoice] = useState<string>("");
  if (state.ref) {
    return (
      <section className="panel panel-pad" role="status">
        <p className="row-done" style={{ margin: 0 }}>
          <IconCheck size={16} /> Thank you, we&apos;ve received your answer. Reference{" "}
          <span className="ref">{state.ref}</span>. We&apos;ll email you the next step.
        </p>
      </section>
    );
  }
  return (
    <form action={action} className="panel panel-pad stack">
      <input type="hidden" name="token" value={p.token} />
      <input type="hidden" name="revision" value={p.revision} />
      <fieldset className="choice-list">
        <legend className="field-label">Your answer</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="choice">
            <input
              type="radio"
              name="choice"
              value={c.value}
              required
              checked={choice === c.value}
              onChange={() => setChoice(c.value)}
            />
            <span>
              <b>{c.label}</b>
              <small>{c.help}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {choice === "counter" && (
        <div className="grid-fields">
          <label className="field span-2">
            <span className="field-label">Annual rent you propose (AED)</span>
            <input name="rentAed" inputMode="decimal" placeholder={p.rentAed.toLocaleString("en-US")} />
          </label>
          <label className="field span-2">
            <span className="field-label">Cheques</span>
            <select name="cheques" defaultValue="">
              <option value="">Keep {p.cheques}</option>
              {[1, 2, 3, 4, 6, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            <span className="field-label">Move-in date</span>
            <input name="moveInOn" type="date" />
          </label>
        </div>
      )}
      <label className="field">
        <span className="field-label">
          Anything you&apos;d like to add? <em>(optional)</em>
        </span>
        <textarea name="comment" rows={3} maxLength={2000} />
      </label>
      {state.error && (
        <p className="alert" data-tone="bad" role="alert">
          <IconWarning size={15} /> {state.error}
        </p>
      )}
      <div>
        <button type="submit" className="btn primary" disabled={!choice || pending}>
          {pending
            ? "Sending…"
            : choice === "accept"
              ? "Accept the offer"
              : choice === "decline"
                ? "Decline the offer"
                : "Send my answer"}
        </button>
      </div>
    </form>
  );
}
