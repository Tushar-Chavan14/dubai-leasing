"use client";

import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { WarningIcon as IconWarning } from "@phosphor-icons/react";
import { type FieldErrors, splitReasons } from "../../lib/field-errors";
import { type InvalidField, useActionForm } from "../../lib/use-action-form";
import { ALERT } from "./settings";

/**
 * A `<form>` for a `useActionState` dispatcher. `<form action={dispatch}>` clears the fields after every action, even
 * a failed one; this form clears them only when the action succeeded (`state` has no `error`), so a failed save keeps
 * what was typed. After a failed save the first invalid field gets focus.
 */
export function ActionForm({
  action,
  state,
  fieldErrors,
  children,
  onChange,
  ...rest
}: Omit<ComponentProps<"form">, "action" | "onSubmit" | "ref"> & {
  action: (formData: FormData) => void;
  /** The action state: the form is cleared after an answer without `error`, like a plain `<form action>`. */
  state?: { error?: unknown; reasons?: string[] | undefined } | null | undefined;
  /** The action state's field errors, so focus moves to the first one after a failed save. */
  fieldErrors?: FieldErrors | undefined;
  children: ReactNode;
}) {
  const { formProps, pending } = useActionForm(action, { serverErrors: fieldErrors });
  const wasPending = useRef(false);
  useEffect(() => {
    const form = formProps.ref.current;
    if (wasPending.current && !pending && form) {
      if (!state?.error) form.reset();
      else markFields(form, { ...splitReasons(state.reasons ?? []).fieldErrors, ...fieldErrors });
    }
    wasPending.current = pending;
  }, [pending, state, fieldErrors, formProps.ref]);
  return (
    <form
      {...rest}
      {...formProps}
      onChange={(e) => {
        formProps.onChange(e);
        onChange?.(e);
      }}
    >
      {children}
    </form>
  );
}

type Validatable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const MARK = "data-engine-error";

/**
 * Marks the inputs an engine error names (`viewingAt: must be in the future`) for forms that don't render field errors
 * themselves: red border (`aria-invalid`), the message as the browser's own validation bubble, focus on the first.
 * Any edit in the form clears the marks, so a fix in another field (a cross-field rule) doesn't block the next submit.
 */
function markFields(form: HTMLFormElement, errors: FieldErrors) {
  let first: Validatable | null = null;
  for (const [name, message] of Object.entries(errors)) {
    // Server actions put reasons in sentence case ("ViewingAt: …"); the input is `viewingAt`.
    const el = [name, name.charAt(0).toLowerCase() + name.slice(1)]
      .map((n) => form.querySelector<Validatable>(`[name="${CSS.escape(n)}"]:not([type=hidden])`))
      .find((x) => x);
    if (!el || !("setCustomValidity" in el)) continue;
    // A field the form already marks itself (React-rendered errors) is left alone.
    if (el.getAttribute("aria-invalid") === "true" && !el.hasAttribute(MARK)) continue;
    el.setCustomValidity(message);
    el.setAttribute("aria-invalid", "true");
    el.setAttribute(MARK, "");
    first ??= el;
  }
  if (!first) return;
  first.scrollIntoView({ block: "center", behavior: "smooth" });
  first.focus({ preventScroll: true });
  first.reportValidity();
  const clear = () => {
    for (const el of form.querySelectorAll<Validatable>(`[${MARK}]`)) {
      el.setCustomValidity("");
      el.removeAttribute("aria-invalid");
      el.removeAttribute(MARK);
    }
    form.removeEventListener("input", clear);
    form.removeEventListener("change", clear);
  };
  form.addEventListener("input", clear);
  form.addEventListener("change", clear);
}

/**
 * The error banner of a form. With field errors it names each invalid field (a button that jumps to it) instead of a
 * generic "Some fields need attention"; reasons that belong to no field are listed after.
 */
export function FormAlert({
  error,
  reasons,
  invalid,
  onPick,
}: {
  error?: string | undefined;
  reasons?: string[] | undefined;
  invalid: InvalidField[];
  onPick: (name: string) => void;
}) {
  const extra = reasons ?? [];
  if (!invalid.length && !error && !extra.length) return null;
  const title = invalid.length
    ? invalid.length === 1
      ? "1 field needs attention:"
      : `${invalid.length} fields need attention:`
    : (error ?? "This couldn't be saved.");
  return (
    <div className={ALERT.bad} role="alert">
      <IconWarning size={16} />
      <div className="min-w-0">
        <strong className="font-semibold">{title}</strong>
        {invalid.length || extra.length ? (
          <ul>
            {invalid.map((f) => (
              <li key={f.name}>
                <button
                  type="button"
                  onClick={() => onPick(f.name)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-left font-sans text-sm text-danger underline underline-offset-2"
                >
                  {f.label}
                </button>
                : {f.message}
              </li>
            ))}
            {extra.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
