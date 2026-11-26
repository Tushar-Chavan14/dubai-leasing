"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "../button";
import { Pill } from "../pill";
import { StageStepper, type StepperStage } from "./stage-stepper";

export type RecordActionData =
  | { type: "prompt"; key: string; label: string; prompt: string; blocked?: string }
  | { type: "link"; key: string; label: string; href: string };

export interface RecordCardProps {
  ref: string;
  name: string;
  unit: string;
  /** The stage pill's text, already labelled by the module. */
  stageLabel: string;
  /** The tracker, with the states already computed. */
  stages: readonly StepperStage[];
  /** Relabels a tracker step for display. */
  stageLabels?: Record<string, string> | undefined;
  nextStep: string;
  /** The page of the record. */
  href: string;
  /** Quick actions chosen in code from the record's state. */
  actions?: RecordActionData[] | undefined;
  /** Shown under the next step (module-specific extras). */
  extra?: ReactNode;
  /** Text of the fallback link when there are no actions. */
  openLabel?: string;
}

/**
 * A record as a chat card: the stage tracker, what is next and quick actions. A `prompt` action only sends its text
 * into the chat so the copilot proposes or drafts (the Confirm card then decides); it never runs anything itself.
 */
export function RecordCard({
  card,
  disabled = false,
  onSend,
}: {
  card: RecordCardProps;
  disabled?: boolean;
  onSend?: (text: string) => void;
}) {
  const actions = card.actions?.length
    ? card.actions
    : ([
        { type: "link", key: "open", label: card.openLabel ?? "Open in the Workspace", href: card.href },
      ] as RecordActionData[]);
  return (
    <article className="grid w-[min(300px,86%)] flex-none snap-start gap-2.5 rounded-card border border-line bg-page p-3.5 font-sans text-sm text-ink">
      <div className="flex items-start justify-between gap-2">
        <b className="text-[15px] leading-snug font-semibold tracking-tight">{card.name}</b>
        <Pill tone="waiting" className="flex-none">
          {card.stageLabel}
        </Pill>
      </div>
      <span className="text-muted">
        <span className="font-mono text-xs">{card.ref}</span> · {card.unit}
      </span>
      <StageStepper stages={card.stages} labels={card.stageLabels} />
      <p className="m-0">{card.nextStep}</p>
      {card.extra}
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
