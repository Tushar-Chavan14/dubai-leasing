"use client";

import { ActionForm } from "../../../../components/ui/action-form";
import { useActionState } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Banner } from "../../../../components/ui/form";
import { Choice, Cta, Done, FORM, P_INPUT, PField, PRIMARY } from "../../../../components/ui/portal";
import { type PortalState, signContract } from "../actions";

/** Typed name + consent. The name must be the one on the contract (case and spacing don't matter). */
export function SignForm({ token, name }: { token: string; name: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(signContract, {});
  if (state.ref) {
    return (
      <Done title="Signed. Thank you">
        <p className="m-0">
          Reference <span className="font-mono text-[13px]">{state.ref}</span>.
        </p>
        <p className="m-0">We&apos;ll email you the signed copy once everyone has signed.</p>
      </Done>
    );
  }
  return (
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <PField label="Type your full name to sign" hint={`As written on the contract: ${name}`}>
        <input
          name="typedName"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          maxLength={160}
          placeholder={name}
          className={P_INPUT}
        />
      </PField>
      <Choice
        type="checkbox"
        name="consent"
        required
        title="I have read the contract and agree to sign it electronically."
        help="Your name, the time, and this device's address are recorded with your signature."
      />
      {state.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </Banner>
      )}
      <Cta>
        <button className={PRIMARY} type="submit" disabled={pending}>
          {pending ? "Signing…" : "Sign contract"}
        </button>
      </Cta>
    </ActionForm>
  );
}
