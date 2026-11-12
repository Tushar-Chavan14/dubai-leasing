"use client";

import { CheckIcon } from "@phosphor-icons/react";
import type { StepperStage } from "./stages.ts";

const STATE = {
  done: "border-transparent bg-raised text-ink",
  current: "border-transparent bg-accent font-semibold text-on-accent",
  todo: "border-line text-muted",
} as const;

/** The Viewing → Documents → Offer → Contract → Ejari tracker, shared by the public status card and the staff record card. */
/** `registration` relabels the last stage for the unit's emirate (Tawtheeq, Attestation, …). */
export function StageStepper({
  stages,
  registration,
}: {
  stages: readonly StepperStage[];
  registration?: string | undefined;
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
          {s.name === "Ejari" && registration ? registration : s.name}
          <span className="sr-only">
            {s.state === "done" ? " (done)" : s.state === "current" ? " (current)" : " (to do)"}
          </span>
        </li>
      ))}
    </ol>
  );
}
