import { RecordStepper } from "@platform/ui/stepper";
import type { StepView } from "../lib/contracts";

/**
 * The deal type's own steps (design §4.3 item 1). The engine says which are done and which is current; a finished deal
 * has no current step and a cancelled one keeps what it reached, so each state is passed outright.
 */
export function DealStepper({ steps }: { steps: StepView[] }) {
  if (!steps.length) return null;
  const labels = Object.fromEntries(steps.map((s) => [s.key, s.label]));
  const states = Object.fromEntries(
    steps.map((s) => [s.key, s.status === "done" ? "done" : s.status === "current" ? "now" : "todo"] as const),
  );
  return (
    <RecordStepper
      stages={steps.map((s) => s.key)}
      current={steps.find((s) => s.status === "current")?.key ?? ""}
      labels={labels}
      states={states}
    />
  );
}
