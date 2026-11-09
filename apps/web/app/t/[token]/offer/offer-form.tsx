"use client";

import { type ReactNode, useActionState, useState } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Banner } from "../../../../components/ui/form";
import { Choice, Cta, Done, FORM, Note, P_INPUT, PField, PRIMARY } from "../../../../components/ui/portal";
import { type PortalState, respondOffer } from "../actions";

/** What the tenant chose: the offer as it stands, a counter-proposal, or a decline. */
type Mode = "accept" | "counter" | "decline";
const OPTIONS: { value: Mode; title: string; help: string }[] = [
  {
    value: "accept",
    title: "Accept",
    help: "Take the unit on these terms. Next, the leasing team arranges the reservation payment.",
  },
  { value: "counter", title: "Ask for changes", help: "Change the rent, number of cheques or move-in date." },
  { value: "decline", title: "Decline", help: "You don't want the unit." },
];
const SUBMIT: Record<Mode, string> = {
  accept: "Accept offer",
  counter: "Send my proposal",
  decline: "Decline the offer",
};

export function OfferForm(p: {
  token: string;
  revision: number;
  rentAed: number;
  cheques: number;
  moveInOn: string;
  /** False once the link is spent. The thank-you still shows after the tenant's own answer. */
  canRespond: boolean;
  /** Shown instead of the form when the offer can't be answered and nothing was just sent. */
  closed: ReactNode;
}) {
  const [state, action, pending] = useActionState<PortalState, FormData>(respondOffer, {});
  // No default: the tenant must pick one before the submit button enables.
  const [mode, setMode] = useState<Mode | "">("");
  if (state.ref) {
    return (
      <Done title="Thank you, we've received your answer">
        <p className="m-0">
          Reference <span className="font-mono text-[13px]">{state.ref}</span>.
        </p>
        <p className="m-0">We&apos;ll email you the next step.</p>
      </Done>
    );
  }
  if (!p.canRespond) return <>{p.closed}</>;
  return (
    <form action={action} className={FORM}>
      <input type="hidden" name="token" value={p.token} />
      <input type="hidden" name="revision" value={p.revision} />
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold">Your answer</legend>
        {OPTIONS.map((o) => (
          <Choice
            key={o.value}
            name="choice"
            value={o.value}
            required
            checked={mode === o.value}
            onChange={() => setMode(o.value)}
            title={o.title}
            help={o.help}
          />
        ))}
      </fieldset>
      {mode === "counter" && (
        <div className="grid gap-3.5 rounded-card border border-line bg-raised p-4">
          <p className="m-0 text-[15px] font-semibold">Ask for changes</p>
          <PField label="Annual rent you propose (AED)">
            <input
              name="rentAed"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={p.rentAed.toLocaleString("en-US")}
              className={P_INPUT}
            />
          </PField>
          <PField label="Cheques">
            <select name="cheques" defaultValue="" className={P_INPUT}>
              <option value="">Keep {p.cheques}</option>
              {[1, 2, 3, 4, 6, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </PField>
          <PField label="Move-in date">
            <input name="moveInOn" type="date" autoComplete="off" className={P_INPUT} />
          </PField>
        </div>
      )}
      {mode === "decline" && <Note>Tell us why below if you like.</Note>}
      <PField label="Anything you'd like to add?" optional>
        <textarea name="comment" rows={2} maxLength={2000} className={`${P_INPUT} resize-y`} />
      </PField>
      {state.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </Banner>
      )}
      <Cta>
        <button type="submit" className={PRIMARY} disabled={!mode || pending}>
          {pending ? "Sending…" : mode ? SUBMIT[mode] : "Choose an answer"}
        </button>
      </Cta>
    </form>
  );
}
