"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { type FieldErrors, hasFieldErrors } from "./field-errors";

export interface InvalidField {
  name: string;
  label: string;
  message: string;
}

/** The input an error names: by `name`, or by `data-field` for controlled inputs without one. */
function fieldEl(form: HTMLFormElement, name: string): HTMLElement | null {
  const n = CSS.escape(name);
  return form.querySelector<HTMLElement>(`[name="${n}"], [data-field="${n}"]`);
}

/**
 * The name of a field in the error banner: `data-label` (for labels that need their section, "Signatory email"), its
 * wrapping `<label>`'s first span, or a `<label for>`.
 */
function labelOf(form: HTMLFormElement, el: HTMLElement, name: string): string {
  const wrap = el.closest("label");
  const text =
    el.getAttribute("data-label") ??
    wrap?.querySelector("span")?.textContent ??
    (el.id ? form.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null) ??
    el.getAttribute("aria-label");
  return text?.trim() || name;
}

/**
 * Submits a form to a `useActionState` dispatcher without React's automatic form reset, so a failed save keeps what
 * the user typed. Optionally validates in the browser first (`validate` returns field errors or null). After every
 * failed attempt it focuses the first field marked `aria-invalid` and lists the invalid fields with their labels.
 */
export function useActionForm(
  dispatch: (formData: FormData) => void,
  opts: { validate?: (formData: FormData) => FieldErrors | null; serverErrors?: FieldErrors | undefined } = {},
) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [clientErrors, setClientErrors] = useState<FieldErrors | null>(null);
  /** Fields edited since the last attempt: their old error is hidden. */
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  /** The errors of the latest failed attempt (browser check or server answer); a new object for each attempt. */
  const [attempt, setAttempt] = useState<{ errors: FieldErrors } | null>(null);
  const [invalid, setInvalid] = useState<InvalidField[]>([]);
  const { validate, serverErrors } = opts;

  // A server answer with field errors is a new attempt (adjusting state during render, not in an effect).
  const [seenServer, setSeenServer] = useState(serverErrors);
  if (serverErrors !== seenServer) {
    setSeenServer(serverErrors);
    setEdited(new Set());
    if (hasFieldErrors(serverErrors)) setAttempt({ errors: serverErrors });
    else setInvalid([]);
  }

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      const errs = validate?.(data) ?? null;
      setEdited(new Set());
      if (hasFieldErrors(errs)) {
        setClientErrors(errs);
        setAttempt({ errors: errs });
        return;
      }
      setClientErrors(null);
      startTransition(() => dispatch(data));
    },
    [dispatch, validate],
  );

  const all = clientErrors ?? serverErrors ?? {};
  const fieldErrors: FieldErrors = Object.fromEntries(Object.entries(all).filter(([k]) => !edited.has(k)));

  // After each failed attempt: read the labels from the DOM, list the fields, focus the first.
  useEffect(() => {
    const form = ref.current;
    if (!form || !attempt) return;
    const found: InvalidField[] = Object.entries(attempt.errors).map(([name, message]) => {
      const el = fieldEl(form, name);
      // A field the form doesn't show is still listed, under its name, so no error is silently dropped.
      return { name, label: el ? labelOf(form, el, name) : name, message };
    });
    // Document order, so the list reads top to bottom like the form.
    const els = Array.from(form.querySelectorAll<HTMLElement>("[name], [data-field]"));
    const order = (n: string) => {
      const i = els.findIndex((x) => (x.getAttribute("name") || x.getAttribute("data-field")) === n);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    found.sort((x, y) => order(x.name) - order(y.name));
    setInvalid(found);
    const first = found[0] && fieldEl(form, found[0].name);
    if (first) {
      first.scrollIntoView({ block: "center", behavior: "smooth" });
      first.focus({ preventScroll: true });
    }
  }, [attempt]);

  const onChange = useCallback((e: FormEvent<HTMLFormElement>) => {
    const t = e.target as HTMLInputElement;
    const name = t.name || t.dataset.field;
    if (name) setEdited((s) => (s.has(name) ? s : new Set(s).add(name)));
  }, []);

  /** Moves focus to a field listed in the error banner. */
  const focusField = useCallback((name: string) => {
    const el = ref.current ? fieldEl(ref.current, name) : null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }, []);

  return {
    formProps: { ref, onSubmit, onChange },
    pending,
    /** Errors to show next to the fields: the browser check's, else the server's, minus fields edited since. */
    fieldErrors,
    /** Invalid fields of the last attempt, in form order, with their labels (for the error banner). */
    invalid: invalid.filter((f) => !edited.has(f.name)),
    /** True while the browser check has failed (the server was not called). */
    clientFailed: hasFieldErrors(clientErrors),
    focusField,
    /**
     * Props for `FormAlert` from the action state: while fields are marked, the banner lists them instead of the
     * generic message; after a failed browser check the old server answer is hidden.
     */
    alertProps: (state: { error?: string | undefined; reasons?: string[] | undefined }) => ({
      error: clientErrors || hasFieldErrors(serverErrors) ? undefined : state.error,
      reasons: clientErrors ? undefined : state.reasons,
      invalid: invalid.filter((f) => !edited.has(f.name)),
      onPick: focusField,
    }),
  };
}
