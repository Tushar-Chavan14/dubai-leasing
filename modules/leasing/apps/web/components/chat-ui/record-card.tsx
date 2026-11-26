"use client";

import { RecordCard, type RecordActionData } from "@platform/ui/chat/record-card";
import { stageLabel } from "../../lib/stage-label";
import { stagesForStaffStage } from "./stages.ts";

export type { RecordActionData };

export interface RecordCardData {
  ref: string;
  name: string;
  unit: string;
  stage: string;
  /** Label of the registration stage for the unit's emirate. */
  registration?: string;
  nextStep: string;
  /** The Workspace page of the record. */
  href: string;
  /** Quick actions chosen in code from the record's state. */
  actions?: RecordActionData[];
}

/**
 * An application or lease as the staff copilot shows it: the stage tracker, what is next and quick
 * actions. Maps the leasing record to the shared `RecordCard`; a `prompt` action only sends its text into the chat
 * (AGENTS.md rule 11).
 */
export function RecordCardView({
  card,
  disabled = false,
  onSend,
}: {
  card: RecordCardData;
  disabled?: boolean;
  onSend?: (text: string) => void;
}) {
  return (
    <RecordCard
      card={{
        ref: card.ref,
        name: card.name,
        unit: card.unit,
        stageLabel: card.stage === "Ejari" && card.registration ? card.registration : stageLabel(card.stage),
        stages: stagesForStaffStage(card.stage),
        stageLabels: card.registration ? { Ejari: card.registration } : undefined,
        nextStep: card.nextStep,
        href: card.href,
        actions: card.actions,
      }}
      disabled={disabled}
      {...(onSend && { onSend })}
    />
  );
}
