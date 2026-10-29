"use client";

import { useActionState } from "react";
import { IconCheck, IconKey, IconWarning } from "../../../../lib/icons";
import { type AgentState, saveAgent } from "./actions";

interface Step {
  id: string;
  group: string;
  label: string;
  offMeans: string;
  numbers?: string[] | undefined;
}
interface NumberSpec {
  label: string;
  unit: string;
  min: number;
  max: number;
}

/** A bounded whole number. The label sits above the input and the bounds are shown under it. */
function NumberField({
  id,
  spec,
  value,
  error,
}: {
  id: string;
  spec: NumberSpec;
  value: number;
  error?: string | undefined;
}) {
  return (
    <div className="field agent-number">
      <label className="field-label" htmlFor={`n-${id}`}>
        {spec.label}
      </label>
      <input
        id={`n-${id}`}
        name={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={spec.min}
        max={spec.max}
        defaultValue={value}
        required
        aria-describedby={`h-${id}`}
        aria-invalid={error ? true : undefined}
      />
      <span className="hint" id={`h-${id}`}>
        {spec.min} to {spec.max}, {spec.unit}
      </span>
      {error && (
        <span className="err" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function AgentForm({
  groups,
  steps,
  numbers,
  limitNumbers,
  locked,
  values,
  canEdit,
}: {
  groups: string[];
  steps: Step[];
  numbers: Record<string, NumberSpec>;
  limitNumbers: string[];
  locked: { label: string; reason: string }[];
  values: Record<string, boolean | number>;
  canEdit: boolean;
}) {
  const [s, action, pending] = useActionState<AgentState, FormData>(saveAgent, {});
  return (
    <form action={action} className="stack">
      <fieldset className="agent-steps" disabled={!canEdit}>
        <legend className="field-label">The agent may do this by itself</legend>
        <div className="stack">
          {groups.map((group) => {
            const inGroup = steps.filter((st) => st.group === group);
            const limits = group === "Limits" ? limitNumbers : [];
            if (inGroup.length === 0 && limits.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`g-${group}`}>
                <h2 id={`g-${group}`} className="field-label agent-group">
                  {group}
                </h2>
                {inGroup.length > 0 && (
                  <ul>
                    {inGroup.map((st) => (
                      <li key={st.id}>
                        <label className="agent-row">
                          <span className="agent-copy">
                            <b>{st.label}</b>
                            <span className="muted">Off means: {st.offMeans}</span>
                          </span>
                          <input type="checkbox" role="switch" name={st.id} defaultChecked={values[st.id] === true} />
                        </label>
                        {st.numbers && st.numbers.length > 0 && (
                          <div className="agent-numbers">
                            {st.numbers.map((k) => (
                              <NumberField
                                key={k}
                                id={k}
                                spec={numbers[k]!}
                                value={Number(values[k])}
                                error={s.fields?.[k]}
                              />
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {limits.length > 0 && (
                  <div className="agent-numbers agent-limits">
                    {limits.map((k) => (
                      <NumberField key={k} id={k} spec={numbers[k]!} value={Number(values[k])} error={s.fields?.[k]} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </fieldset>
      {canEdit ? (
        <div>
          <button type="submit" className="btn primary" disabled={pending}>
            Save
          </button>
        </div>
      ) : (
        <p className="muted settings-note">Only admins can change these.</p>
      )}
      {s.ok && (
        <div className="alert" data-tone="good" role="status">
          <IconCheck size={16} />
          {s.ok}
        </div>
      )}
      {s.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          {s.error}
        </div>
      )}
      <section aria-labelledby="locked-h">
        <h2 id="locked-h" className="field-label">
          Always a person
        </h2>
        <ul className="agent-locked">
          {locked.map((l) => (
            <li key={l.label}>
              <IconKey size={16} />
              <span>
                <b>{l.label}</b>
                <span className="muted">{l.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </form>
  );
}
