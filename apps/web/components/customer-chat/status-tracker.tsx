"use client";

import type { ChannelButton, ChatStatus } from "@leasing/core";
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
    <div className="cc-status">
      {status.apps.map((a) => (
        <section key={`${a.kind}:${a.ref}`} className="cc-status-item" aria-label={`${a.unitCode}, ${a.ref}`}>
          <header>
            <b>{a.unitCode}</b>
            <span className="muted">{a.ref}</span>
          </header>
          <StageStepper stages={a.stages} />
          <p className="cc-status-next" dir="auto">
            {a.nextStep}
          </p>
          {a.offer && (
            <p className="cc-status-offer">
              <span className="muted">Offer</span> {a.offer.annualRent} a year, {a.offer.cheques}{" "}
              {a.offer.cheques === 1 ? "cheque" : "cheques"}
            </p>
          )}
          {a.actions.length > 0 && (
            <div className="btn-row">
              {a.actions.map((b) => (
                <button
                  key={b.data}
                  type="button"
                  className="btn small"
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
