"use client";

import { CopyIcon as IconCopy } from "@phosphor-icons/react";
import { type Emirate, EMIRATE_LABELS } from "@leasing/core";
import { useActionState, useState } from "react";
import type { RuleResult } from "../lib/portfolio";
import { buttonClass, iconButtonClass } from "@platform/ui/button";

/**
 * "Copy to emirate" for a rule row (D68): the same rule as a new rule for another emirate. `""` in `options` means
 * all emirates (contract rules only). The engine checks the emirate, the template and overlapping rules.
 */
export function CopyToEmirate({
  action,
  id,
  label,
  options,
}: {
  action: (prev: RuleResult, formData: FormData) => Promise<RuleResult>;
  id: string;
  label: string;
  options: (Emirate | "")[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: RuleResult, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, {});
  if (options.length === 0) return null;
  if (!open)
    return (
      <button
        type="button"
        className={iconButtonClass("ghost")}
        aria-label={label}
        title="Copy to another emirate"
        onClick={() => setOpen(true)}
      >
        <IconCopy size={16} />
      </button>
    );
  return (
    <form action={formAction} className="grid gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center gap-1.5">
        <select
          name="emirate"
          aria-label="Copy to"
          className="h-8 rounded-md border border-line bg-page px-2 text-[13px]"
        >
          {options.map((e) => (
            <option key={e || "any"} value={e}>
              {e ? EMIRATE_LABELS[e] : "All emirates"}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("primary", "sm")} disabled={pending}>
          {pending ? "Copying…" : "Copy"}
        </button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {state.error && (
        <span className="block max-w-64 text-xs font-semibold text-danger" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
