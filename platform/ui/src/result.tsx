"use client";

import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import { ALERT } from "./settings";

/** Outcome of a server action: a green banner for success, a red one for an error with its reasons. */
export function Result({ s }: { s: { ok?: string; error?: string; reasons?: string[] } }) {
  if (s.ok)
    return (
      <div className={ALERT.good} role="status">
        <IconCheck size={16} />
        {s.ok}
      </div>
    );
  if (s.error)
    return (
      <div className={ALERT.bad} role="alert">
        <IconWarning size={16} />
        <div>
          <strong>{s.error}</strong>
          {s.reasons?.length ? (
            <ul>
              {s.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  return null;
}
