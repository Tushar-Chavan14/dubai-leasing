"use client";

import Link from "next/link";
import { StageStepper } from "./stage-stepper";
import { stagesForStaffStage } from "./stages.ts";

export type RecordActionData =
  | { type: "prompt"; key: string; label: string; prompt: string; blocked?: string }
  | { type: "link"; key: string; label: string; href: string };

export interface RecordCardData {
  ref: string;
  name: string;
  unit: string;
  stage: string;
  nextStep: string;
  /** The Workspace page of the record. */
  href: string;
  /** Quick actions chosen in code from the record's state. */
  actions?: RecordActionData[];
}

/**
 * An application or lease as the staff copilot shows it: the stage tracker, what is next and quick
 * actions. A `prompt` action only sends its text into the chat so the copilot proposes or drafts
 * (the Confirm card then decides); it never runs anything itself (AGENTS.md rule 11).
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
  const actions = card.actions?.length
    ? card.actions
    : ([{ type: "link", key: "open", label: "Open in the Workspace", href: card.href }] as RecordActionData[]);
  return (
    <article className="cc-card cp-record">
      <div className="cc-card-body">
        <span className="cc-card-type">{card.stage}</span>
        <b>{card.name}</b>
        <span className="muted">
          <span className="ref">{card.ref}</span> · {card.unit}
        </span>
        <StageStepper stages={stagesForStaffStage(card.stage)} />
        <span>{card.nextStep}</span>
        <div className="btn-row">
          {actions.map((a) =>
            a.type === "link" ? (
              <Link key={a.key} href={a.href} className="btn small primary">
                {a.label}
              </Link>
            ) : (
              <button
                key={a.key}
                type="button"
                className="btn small"
                disabled={disabled || !onSend || !!a.blocked}
                title={a.blocked}
                aria-description={a.blocked}
                onClick={() => onSend?.(a.prompt)}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      </div>
    </article>
  );
}
