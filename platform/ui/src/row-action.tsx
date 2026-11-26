"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { buttonClass, iconButtonClass } from "./button";

/** What a row action returns: `error` is shown under the button. Any result with these optional fields fits. */
export interface RowResult {
  ok?: boolean;
  error?: string | undefined;
  reasons?: string[];
}

/** A one-button form for a table row. Shows the engine's error under the button; optional confirm. */
export function RowAction<R extends RowResult>({
  action,
  fields,
  label,
  danger,
  confirmText,
  icon,
}: {
  action: (prev: R, formData: FormData) => Promise<R>;
  fields: Record<string, string>;
  label: string;
  danger?: boolean;
  confirmText?: string;
  /** Show this icon instead of the label; the label stays as the accessible name. */
  icon?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {} as Awaited<R>);
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
