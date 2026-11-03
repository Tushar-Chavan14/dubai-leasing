"use client";

import type { UnitCard } from "@leasing/core";
import { DecisionCardView, type DecisionCardData } from "./decision-card";
import { RecordCardView, type RecordCardData } from "./record-card";
import { UnitCardView } from "./unit-card";

/** The cards under a staff copilot answer (the engine streams them; see packages/copilot ui.ts). */
export type CopilotCardData =
  | ({ kind: "record" } & RecordCardData)
  | { kind: "unit"; card: UnitCard; href: string }
  | DecisionCardData;

export interface CopilotChoicesData {
  question: string;
  options: { label: string; value: string; say: string; href?: string }[];
}

export function CardRow({
  cards,
  onSend,
  disabled = false,
}: {
  cards: CopilotCardData[];
  /** Sends a quick action's prompt into the chat. */
  onSend?: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="cc-cards">
      {cards.map((c) =>
        c.kind === "record" ? (
          <RecordCardView key={`r-${c.ref}`} card={c} disabled={disabled} {...(onSend ? { onSend } : {})} />
        ) : c.kind === "decision" ? (
          <DecisionCardView key={`d-${c.decision === "approval" ? c.approvalId : c.applicationId}`} card={c} />
        ) : (
          <UnitCardView key={`u-${c.card.unitId}`} card={c.card} detailsHref={c.href} disabled={false} />
        ),
      )}
    </div>
  );
}
