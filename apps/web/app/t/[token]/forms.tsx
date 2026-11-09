"use client";

import { ActionForm } from "../../../components/ui/action-form";
import { useActionState, useState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Banner } from "../../../components/ui/form";
import { Choice, Cta, Done, P_INPUT, PField, PFieldset, PRIMARY } from "../../../components/ui/portal";
import { acknowledge, type PortalState, reply } from "./actions";

function Result({ state, what, pinned }: { state: PortalState; what: string; pinned?: boolean }) {
  const text = state.duplicate ? `We already have your ${what}.` : `Thank you, we've received your ${what}.`;
  if (pinned) {
    return (
      <Done title={text}>
        <p className="m-0">
          Your reference is <b className="font-mono text-[13px]">{state.ref}</b>.
        </p>
      </Done>
    );
  }
  return (
    <Banner tone="good" role="status">
      <IconCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        {text} Your reference is <b className="font-mono text-[13px]">{state.ref}</b>.
      </span>
    </Banner>
  );
}

function ErrorLine({ text }: { text?: string | undefined }) {
  return text ? (
    <Banner tone="bad" role="alert">
      <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </Banner>
  ) : null;
}

/** `pinned`: the form is the whole page, so its button sits in the pinned bar. */
export function AcknowledgeForm({ token, pinned }: { token: string; pinned?: boolean }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(acknowledge, {});
  if (state.ref) return <Result state={state} what="confirmation" pinned={!!pinned} />;
  return (
    <ActionForm state={state} action={action} className={pinned ? "flex flex-1 flex-col gap-4" : "grid gap-3"}>
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      <Cta inline={!pinned}>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Sending…" : "I confirm I received the notice"}
        </button>
      </Cta>
    </ActionForm>
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
  if (state.ref) return <Result state={state} what="reply" />;
  return (
    <ActionForm state={state} action={action} className="grid gap-3.5">
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      <PFieldset legend="What would you like to do?">
        {CHOICES.map((c) => (
          <Choice
            key={c.value}
            name="choice"
            value={c.value}
            checked={choice === c.value}
            onChange={() => setChoice(c.value)}
            required
            title={c.label}
            help={c.help}
          />
        ))}
      </PFieldset>
      <PField label="Anything you'd like to add?" optional hint="English or Arabic.">
        <textarea name="comment" rows={3} maxLength={2000} className={`${P_INPUT} resize-y`} />
      </PField>
      {choice === "vacate" && (
        <Choice
          type="checkbox"
          name="confirmVacate"
          checked={confirmVacate}
          onChange={(e) => setConfirmVacate(e.target.checked)}
          required
          title="I won't renew. I understand my tenancy ends on its end date and I'll move out then."
        />
      )}
      <Cta inline>
        <button
          type="submit"
          className={PRIMARY}
          disabled={pending || !choice || (choice === "vacate" && !confirmVacate)}
        >
          {pending ? "Sending…" : choice === "vacate" ? "Confirm I'm moving out" : "Send my reply"}
        </button>
      </Cta>
    </ActionForm>
  );
}
