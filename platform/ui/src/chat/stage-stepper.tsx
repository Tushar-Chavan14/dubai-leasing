"use client";

import { CheckIcon } from "@phosphor-icons/react";

export interface StepperStage {
  name: string;
  state: "done" | "current" | "todo";
}

const STATE = {
  done: "border-transparent bg-raised text-ink",
  current: "border-transparent bg-accent font-semibold text-on-accent",
  todo: "border-line text-muted",
} as const;

/**
 * A stage tracker of pills: done, current and to-do steps. The module computes the states from its own machine;
 * `labels` relabels a step for display (e.g. the registration step for the unit's emirate).
 */
export function StageStepper({
  stages,
  labels,
}: {
  stages: readonly StepperStage[];
  labels?: Record<string, string> | undefined;
}) {
  return (
    <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" role="list">
      {stages.map((s) => (
        <li
          key={s.name}
          data-state={s.state}
          {...(s.state === "current" ? { "aria-current": "step" } : {})}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] leading-snug ${STATE[s.state]}`}
        >
          {s.state === "done" && <CheckIcon size={11} weight="bold" aria-hidden="true" />}
          {labels?.[s.name] ?? s.name}
          <span className="sr-only">
            {s.state === "done" ? " (done)" : s.state === "current" ? " (current)" : " (to do)"}
          </span>
        </li>
      ))}
    </ol>
  );
}
