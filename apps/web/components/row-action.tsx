"use client";

import { useActionState } from "react";
import type { RuleResult } from "../lib/portfolio";

/** A one-button form for a table row. Shows the engine's error under the button; optional confirm. */
export function RowAction({
  action,
  fields,
  label,
  danger,
  confirmText,
}: {
  action: (prev: RuleResult, formData: FormData) => Promise<RuleResult>;
  fields: Record<string, string>;
  label: string;
  danger?: boolean;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className={`btn small${danger ? " danger" : ""}`} disabled={pending}>
        {label}
      </button>
      {state.error && (
        <span className="err" role="alert" style={{ display: "block", marginTop: 4, whiteSpace: "normal" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
