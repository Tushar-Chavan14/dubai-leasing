"use client";

import type { UnitCard } from "@leasing/core";
import { DecisionCardView, type DecisionCardData } from "./decision-card";
import { RecordCardView, type RecordCardData } from "./record-card";
import { CARD_RAIL, UnitCardView } from "./unit-card";

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
  // Two tools in one answer can return the same record; show each card once.
  const seen = new Set<string>();
  const unique = cards.filter((c) => {
    const key = cardKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className={`${CARD_RAIL} mt-2.5`}>
      {unique.map((c) =>
        c.kind === "record" ? (
          <RecordCardView key={cardKey(c)} card={c} disabled={disabled} {...(onSend ? { onSend } : {})} />
        ) : c.kind === "decision" ? (
          <DecisionCardView key={cardKey(c)} card={c} />
        ) : (
          <UnitCardView key={cardKey(c)} card={c.card} detailsHref={c.href} disabled={false} />
        ),
      )}
    </div>
  );
}

function cardKey(c: CopilotCardData): string {
  if (c.kind === "record") return `r-${c.ref}`;
  if (c.kind === "decision")
    return `d-${c.decision}-${c.decision === "approval" ? c.approvalId : "leaseId" in c ? c.leaseId : c.applicationId}`;
  return `u-${c.card.unitId}`;
}
