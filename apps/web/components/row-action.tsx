"use client";

import { useActionState } from "react";
import type { RuleResult } from "../lib/portfolio";
import type { ReactNode } from "react";
import { buttonClass, iconButtonClass } from "./ui/button";

/** A one-button form for a table row. Shows the engine's error under the button; optional confirm. */
export function RowAction({
  action,
  fields,
  label,
  danger,
  confirmText,
  icon,
}: {
  action: (prev: RuleResult, formData: FormData) => Promise<RuleResult>;
  fields: Record<string, string>;
  label: string;
  danger?: boolean;
  confirmText?: string;
  /** Show this icon instead of the label; the label stays as the accessible name. */
  icon?: ReactNode;
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
      {icon ? (
        <button
          type="submit"
          className={iconButtonClass(danger ? "danger" : "ghost")}
          disabled={pending}
          aria-label={label}
          title={label}
        >
          {icon}
        </button>
      ) : (
        <button type="submit" className={buttonClass(danger ? "danger" : "ghost", "sm")} disabled={pending}>
          {label}
        </button>
      )}
      {state.error && (
        <span className="mt-1 block text-xs font-semibold text-danger" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
