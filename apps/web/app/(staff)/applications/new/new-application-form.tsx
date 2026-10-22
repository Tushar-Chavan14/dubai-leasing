"use client";

import { useActionState } from "react";
import { IconWarning } from "../../../../lib/icons";
import { type AppActionState, createApplication } from "../actions";

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
  return (
    <form action={action} className="panel panel-pad stack" style={{ maxWidth: 720 }}>
      <label className="field">
        <span className="field-label">Unit</span>
        <select name="unitId" defaultValue={defaultUnit} required>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="segmented" aria-label="Applicant type">
        <label>
          <input type="radio" name="kind" value="individual" defaultChecked />
          <span>Individual</span>
        </label>
        <label>
          <input type="radio" name="kind" value="company" />
          <span>Company</span>
        </label>
      </fieldset>
      <div className="grid-fields">
        <label className="field span-3">
          <span className="field-label">Name (as the applicant gave it)</span>
          <input name="nameEn" required minLength={2} maxLength={120} autoComplete="off" />
        </label>
        <label className="field span-3">
          <span className="field-label">Email</span>
          <input name="email" type="email" required autoComplete="off" />
        </label>
        <label className="field span-3">
          <span className="field-label">
            Phone <em>(optional)</em>
          </span>
          <input name="phone" inputMode="tel" maxLength={40} autoComplete="off" />
        </label>
        <label className="field span-3">
          <span className="field-label">
            Preferred move-in <em>(optional)</em>
          </span>
          <input name="requestedMoveInOn" type="date" />
        </label>
        <label className="field span-3">
          <span className="field-label">Viewing date &amp; time (Dubai)</span>
          <input
            name="viewingAt"
            type="datetime-local"
            required
            min={today ? `${today}T00:00` : undefined}
            step={900}
          />
        </label>
      </div>
      {state.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
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
        </div>
      )}
      <div>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Creating…" : "Create and send viewing invitation"}
        </button>
      </div>
    </form>
  );
}
