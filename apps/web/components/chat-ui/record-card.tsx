"use client";

import Link from "next/link";
import { buttonClass } from "../ui/button";
import { Pill } from "../ui/pill";
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
    <article className="grid w-[min(300px,86%)] flex-none snap-start gap-2.5 rounded-card border border-line bg-page p-3.5 font-sans text-sm text-ink">
      <div className="flex items-start justify-between gap-2">
        <b className="text-[15px] leading-snug font-semibold tracking-tight">{card.name}</b>
        <Pill tone="waiting" className="flex-none">
          {card.stage === "Ejari" && card.registration ? card.registration : card.stage}
        </Pill>
      </div>
      <span className="text-muted">
        <span className="font-mono text-xs">{card.ref}</span> · {card.unit}
      </span>
      <StageStepper stages={stagesForStaffStage(card.stage)} registration={card.registration} />
      <p className="m-0">{card.nextStep}</p>
      <div className="mt-0.5 flex flex-wrap gap-2">
        {actions.map((a) =>
          a.type === "link" ? (
            <Link key={a.key} href={a.href} className={buttonClass("primary", "sm")}>
              {a.label}
            </Link>
          ) : (
            <button
              key={a.key}
              type="button"
              className={buttonClass("ghost", "sm")}
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
    </article>
  );
}
