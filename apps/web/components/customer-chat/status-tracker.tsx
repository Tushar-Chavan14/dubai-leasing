"use client";

import type { ChannelButton, ChatStatus } from "@leasing/core";
import { buttonClass } from "../ui/button";
import { StageStepper } from "../chat-ui/stage-stepper";

/** The verified visitor's applications and leases (decision D34): five stage pills, the next step, the offer as given, re-send buttons. */
export function StatusTracker({
  status,
  disabled,
  onPress,
}: {
  status: ChatStatus;
  disabled: boolean;
  onPress: (b: ChannelButton) => void;
}) {
  return (
    <div className="grid w-full max-w-[560px] gap-3">
      {status.apps.map((a) => (
        <section
          key={`${a.kind}:${a.ref}`}
          className="grid gap-3 rounded-card border border-line bg-page p-4"
          aria-label={`${a.unitCode}, ${a.ref}`}
        >
          <header className="flex items-baseline justify-between gap-3">
            <b className="text-[15px] font-semibold tracking-tight">{a.unitCode}</b>
            <span className="font-mono text-xs text-muted">{a.ref}</span>
          </header>
          <StageStepper stages={a.stages} />
          <p className="m-0 rounded-xl bg-accent px-3.5 py-2.5 text-sm text-on-accent" dir="auto">
            {a.nextStep}
          </p>
          {a.offer && (
            <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-3 text-sm tabular-nums">
              <span className="text-muted">Offer</span>
              <span>
                {a.offer.annualRent} a year, {a.offer.cheques} {a.offer.cheques === 1 ? "cheque" : "cheques"}
              </span>
            </p>
          )}
          {a.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {a.actions.map((b) => (
                <button
                  key={b.data}
                  type="button"
                  className={buttonClass("ghost", "sm")}
                  dir="auto"
                  disabled={disabled || b.disabled}
                  onClick={() => onPress(b)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
