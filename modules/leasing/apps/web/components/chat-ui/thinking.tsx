"use client";

import { CaretDownIcon, CheckIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { stepLabel } from "../../lib/copilot/step-labels";
import type { ToolStep } from "../copilot/use-chat";

/** A dot that pulses while the agent thinks (a soft ring grows and fades behind it). Still with reduced motion. */
function PulseDot({ reduce }: { reduce: boolean | null }) {
  return (
    <span aria-hidden="true" className="relative inline-grid size-4 place-items-center">
      {!reduce && (
        <span className="absolute size-2.5 animate-[think-ring_1.4s_ease-out_infinite] rounded-full bg-ink/40" />
      )}
      <span className={`size-2 rounded-full bg-ink ${reduce ? "" : "animate-[think-dot_1.4s_ease-in-out_infinite]"}`} />
    </span>
  );
}

/**
 * The agent's steps for one answer: one row per tool call. Open and counting while it works; once
 * the answer starts it folds to "Worked for Ns, K steps" and can be reopened.
 * `startedAt` is a `performance.now()` reading taken when the message appeared (a client timer,
 * not engine time).
 */
export function Thinking({
  tools,
  streaming,
  startedAt,
  answerStarted,
  labels,
}: {
  tools: ToolStep[];
  streaming: boolean;
  startedAt: number;
  answerStarted: boolean;
  /** Overrides the English wording while working (the public chat passes Arabic). */
  labels?: { working: string; seconds: (n: number) => string };
}) {
  const reduce = useReducedMotion();
  const working = streaming && !answerStarted;
  const [wasLive, setWasLive] = useState(working);
  if (working && !wasLive) setWasLive(true);

  const [secs, setSecs] = useState(() => (working ? Math.floor((performance.now() - startedAt) / 1000) : 0));
  const [open, setOpen] = useState(working);

  useEffect(() => {
    if (!working) return;
    const tick = () => setSecs(Math.max(0, Math.floor((performance.now() - startedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      tick();
    };
  }, [working, startedAt]);

  // Fold when the answer starts; the user can reopen it.
  const [prevWorking, setPrevWorking] = useState(working);
  if (prevWorking !== working) {
    setPrevWorking(working);
    if (!working) {
      setOpen(false);
    }
  }

  if (!working && tools.length === 0) return null;

  const k = tools.length;
  const stepsText = `${k} ${k === 1 ? "step" : "steps"}`;
  const title = working ? (labels?.working ?? "Working") : wasLive ? `Worked for ${secs}s, ${stepsText}` : stepsText;
  const canToggle = k > 0;
  const showList = k > 0 && open;

  return (
    <div
      className="overflow-hidden rounded-xl border border-line bg-page font-sans text-ink transition-colors duration-300 data-[state=running]:bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ds-accent)_30%,transparent),transparent_140%)]"
      data-state={working ? "running" : "done"}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-[9px] text-left font-sans text-[13px] text-ink disabled:cursor-default"
        aria-expanded={canToggle ? open : undefined}
        disabled={!canToggle}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" className="inline-grid size-4 place-items-center">
          <SparkleIcon size={15} className={working && !reduce ? "animate-[spin_2.4s_linear_infinite]" : ""} />
        </span>
        <span
          className={`font-medium ${
            working && !reduce
              ? "animate-[shimmer_1.6s_linear_infinite] bg-[linear-gradient(90deg,var(--ds-muted)_0%,var(--ds-ink)_40%,var(--ds-muted)_80%)] bg-[length:200%_100%] bg-clip-text text-transparent"
              : ""
          }`}
        >
          {title}
        </span>
        {working ? (
          <span
            className="ml-auto font-mono text-xs text-muted"
            aria-label={labels?.seconds(secs) ?? `${secs} seconds`}
          >
            {secs}s
          </span>
        ) : canToggle ? (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted">
            {open ? "Hide steps" : "Show steps"}
            <CaretDownIcon
              size={12}
              aria-hidden="true"
              className={`transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
            />
          </span>
        ) : null}
      </button>
      {showList && (
        <ol
          className="m-0 grid list-none gap-[7px] py-0 pb-2.5 pl-[34px] pr-3 text-[12.5px] text-ink"
          aria-label="What the agent looked at"
        >
          <AnimatePresence initial={false}>
            {tools.map((t, i) => {
              const { label, source } = stepLabel(t.name, t.args);
              return (
                <motion.li
                  key={t.id}
                  className="flex items-start gap-2"
                  data-status={t.status}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut", delay: Math.min(i, 6) * 0.04 }
                  }
                >
                  <span
                    className={`mt-px flex size-4 flex-none items-center justify-center rounded-full ${t.status === "ok" ? "bg-accent text-on-accent" : ""}`}
                    aria-hidden="true"
                  >
                    {t.status === "ok" ? (
                      <CheckIcon size={10} weight="bold" />
                    ) : t.status === "failed" ? (
                      <WarningIcon size={14} weight="bold" className="text-warning" />
                    ) : (
                      <span
                        className={`size-3.5 rounded-full border-2 border-ink border-t-transparent ${reduce ? "" : "animate-spin"}`}
                      />
                    )}
                  </span>
                  <span className={t.status === "failed" ? "text-warning" : ""}>
                    {label}
                    {t.status === "failed" && " (didn't work)"}
                    {source && <span className="ml-1.5 font-mono text-[11.5px] text-muted">{source}</span>}
                    <span className="sr-only">
                      {t.status === "ok" ? ", done" : t.status === "failed" ? ", failed" : ", in progress"}
                    </span>
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </div>
  );
}

/**
 * Shown when the agent takes back what it started writing (it decided to look something up first, or the
 * engine sent the draft back) and is writing the answer again: a pulsing dot with "Thinking…".
 */
export function Rethinking({ label = "Thinking…" }: { label?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-2 py-1 font-sans text-[13px] text-muted" role="status">
      <PulseDot reduce={reduce} />
      <span>{label}</span>
    </div>
  );
}
