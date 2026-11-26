"use client";

import { StageStepper as PlatformStageStepper } from "@platform/ui/chat/stage-stepper";
import type { StepperStage } from "./stages.ts";

/** The Viewing → Documents → Offer → Contract → Ejari tracker, shared by the public status card and the staff record card. */
/** `registration` relabels the last stage for the unit's emirate (Tawtheeq, Attestation, …). */
export function StageStepper({
  stages,
  registration,
}: {
  stages: readonly StepperStage[];
  registration?: string | undefined;
}) {
  return <PlatformStageStepper stages={stages} labels={registration ? { Ejari: registration } : undefined} />;
}
