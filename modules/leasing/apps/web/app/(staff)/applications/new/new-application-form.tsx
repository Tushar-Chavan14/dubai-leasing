"use client";

import { ActionForm } from "@platform/ui/action-form";
import { useActionState, useState } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { type AppActionState, createApplication } from "../actions";
import { buttonClass } from "@platform/ui/button";
import { DateTimeFields } from "@platform/ui/date-time-picker";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";

export function NewApplicationForm({
  units,
  defaultUnit,
  today,
}: {
  units: { id: string; label: string }[];
  defaultUnit: string;
  /** Today in Dubai (from the engine clock), the earliest day a viewing can be booked. */
  today: string;
}) {
  const [state, action, pending] = useActionState<AppActionState, FormData>(createApplication, {});
  // The site visit is required: the button waits until both its day and time are chosen.
  const [visitAt, setVisitAt] = useState("");
  return (
    <ActionForm state={state} action={action} className="grid max-w-[720px] gap-4 @container">
      <fieldset aria-label="Applicant type" className="m-0 flex w-fit gap-1 rounded-full bg-raised p-[3px] border-0">
        {(
          [
            ["individual", "Individual"],
            ["company", "Company"],
          ] as const
        ).map(([v, label]) => (
          <label
            key={v}
            className="cursor-pointer rounded-full px-4 py-1.5 font-sans text-[13px] text-muted has-[:checked]:bg-page has-[:checked]:font-semibold has-[:checked]:text-ink has-[:checked]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink"
          >
            <input type="radio" name="kind" value={v} defaultChecked={v === "individual"} className="sr-only" />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <label className={FIELD}>
        <span className={LABEL}>Unit</span>
        <select className={INPUT} name="unitId" defaultValue={defaultUnit} required>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 @[480px]:grid-cols-2">
        <label className={FIELD}>
          <span className={LABEL}>Name (as the applicant gave it)</span>
          <input className={INPUT} name="nameEn" required minLength={2} maxLength={120} autoComplete="off" />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Email</span>
          <input className={INPUT} name="email" type="email" required autoComplete="off" />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>
            Phone <em className="font-normal not-italic">(optional)</em>
          </span>
          <input className={INPUT} name="phone" inputMode="tel" maxLength={40} autoComplete="off" />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>
            Preferred move-in <em className="font-normal not-italic">(optional)</em>
          </span>
          <input className={INPUT} name="requestedMoveInOn" type="date" />
        </label>
        <div className="@[480px]:col-span-2">
          <DateTimeFields name="viewingAt" min={today} onChange={setVisitAt} />
        </div>
      </div>
      {state.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>{state.error}</strong>
            {state.reasons?.length ? (
              <ul>
                {state.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </Banner>
      )}
      <div className="mt-4">
        <button
          type="submit"
          className={buttonClass("primary", "sm")}
          disabled={pending || !visitAt}
          title={visitAt ? undefined : "Choose the site visit day and time first"}
        >
          {pending ? "Creating…" : "Create and send site visit invitation"}
        </button>
      </div>
    </ActionForm>
  );
}
