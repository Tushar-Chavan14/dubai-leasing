"use client";

import { useActionState } from "react";
import { IconCheck, IconWarning } from "../../../../lib/icons";
import { type PortalState, signContract } from "../actions";

/** Typed name + consent. The name must be the one on the contract (case and spacing don't matter). */
export function SignForm({ token, name }: { token: string; name: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(signContract, {});
  if (state.ref) {
    return (
      <section className="panel panel-pad" role="status">
        <p className="row-done" style={{ margin: 0 }}>
          <IconCheck size={16} /> Signed. Reference <span className="ref">{state.ref}</span>. We&apos;ll email you the
          signed copy once everyone has signed.
        </p>
      </section>
    );
  }
  return (
    <form action={action} className="panel panel-pad stack">
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span className="field-label">Type your full name to sign</span>
        <input name="typedName" autoComplete="name" required minLength={2} maxLength={160} placeholder={name} />
        <small className="muted">As written on the contract: {name}</small>
      </label>
      <label className="choice">
        <input type="checkbox" name="consent" required />
        <span>
          <b>I have read the contract and agree to sign it electronically.</b>
          <small>Your name, the time, and this device&apos;s address are recorded with your signature.</small>
        </span>
      </label>
      {state.error && (
        <p className="alert" data-tone="bad" role="alert" style={{ margin: 0 }}>
          <IconWarning size={15} /> {state.error}
        </p>
      )}
      <div className="btn-row">
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? "Signing…" : "Sign the contract"}
        </button>
      </div>
    </form>
  );
}
