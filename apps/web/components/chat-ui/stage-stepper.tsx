"use client";

import type { StepperStage } from "./stages.ts";

/** The Viewing → Documents → Offer → Contract → Ejari tracker, shared by the public status card and the staff record card. */
export function StageStepper({ stages }: { stages: readonly StepperStage[] }) {
  return (
    <ol className="cc-stages" role="list">
      {stages.map((s) => (
        <li key={s.name} data-state={s.state} {...(s.state === "current" ? { "aria-current": "step" } : {})}>
          {s.name}
          <span className="sr-only">
            {s.state === "done" ? " (done)" : s.state === "current" ? " (current)" : " (to do)"}
          </span>
        </li>
      ))}
    </ol>
  );
}
