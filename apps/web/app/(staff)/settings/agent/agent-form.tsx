"use client";

import { useActionState } from "react";
import { CheckIcon as IconCheck, LockSimpleIcon as IconLock, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { Banner, HINT, LABEL } from "../../../../components/ui/form";
import { Block, SaveBar, SET_INPUT, SWITCH } from "../../../../components/ui/settings";
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
    <div className="grid max-w-[220px] gap-1.5">
      <label className={LABEL} htmlFor={`n-${id}`}>
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
        className={SET_INPUT}
      />
      <span className={HINT} id={`h-${id}`}>
        {spec.min} to {spec.max}, {spec.unit}
      </span>
      {error && (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

const NUMBERS = "flex flex-wrap gap-x-6 gap-y-3 pb-3.5 pl-0";

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
    <form action={action} className="grid gap-7">
      <fieldset disabled={!canEdit} className="m-0 grid min-w-0 gap-6 border-0 p-0">
        <legend className="sr-only">The agent may do this by itself</legend>
        {groups.map((group) => {
          const inGroup = steps.filter((st) => st.group === group);
          const limits = group === "Limits" ? limitNumbers : [];
          if (inGroup.length === 0 && limits.length === 0) return null;
          return (
            <Block key={group} id={`g-${group}`} title={group}>
              {inGroup.length > 0 && (
                <ul className="m-0 list-none p-0">
                  {inGroup.map((st) => (
                    <li key={st.id} className="border-b border-line last:border-b-0">
                      <label className="flex cursor-pointer items-start gap-4 py-3.5 has-[:disabled]:cursor-default">
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <b className="text-sm font-semibold text-ink">{st.label}</b>
                          <span className="text-[13px] leading-snug text-muted">Off means: {st.offMeans}</span>
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          name={st.id}
                          defaultChecked={values[st.id] === true}
                          className={SWITCH}
                        />
                      </label>
                      {st.numbers && st.numbers.length > 0 && (
                        <div className={NUMBERS}>
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
                <div className={NUMBERS}>
                  {limits.map((k) => (
                    <NumberField key={k} id={k} spec={numbers[k]!} value={Number(values[k])} error={s.fields?.[k]} />
                  ))}
                </div>
              )}
            </Block>
          );
        })}
      </fieldset>
      {s.ok && (
        <Banner tone="good" role="status">
          <IconCheck size={16} className="mt-0.5 shrink-0" />
          {s.ok}
        </Banner>
      )}
      {s.error && (
        <Banner tone="bad" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {s.error}
        </Banner>
      )}
      {canEdit ? (
        <SaveBar note="Switched-off steps wait for an officer. Saving creates a new policy version.">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </SaveBar>
      ) : (
        <p className="m-0 text-[13px] text-muted">Only admins can change these.</p>
      )}
      <Block
        id="locked-h"
        title="Always a person"
        lede="Never by law and by design. These cannot be switched on, for anyone."
      >
        <ul className="m-0 list-none p-0">
          {locked.map((l) => (
            <li key={l.label} className="flex items-start gap-4 border-b border-line py-3.5 last:border-b-0">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <b className="text-sm font-semibold text-ink">{l.label}</b>
                <span className="text-[13px] leading-snug text-muted">{l.reason}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-raised px-2.5 py-1 text-xs font-semibold text-ink">
                <IconLock size={14} aria-hidden />
                Always a person
              </span>
            </li>
          ))}
        </ul>
      </Block>
    </form>
  );
}
