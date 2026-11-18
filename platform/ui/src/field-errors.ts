import type { z } from "zod";

/** "Field name → message" for a form. Keys are the input `name`s. */
export type FieldErrors = Record<string, string>;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** `legal.email` and `items.2.label` → the input name: the last segment that isn't an array index. */
function fieldOf(path: readonly PropertyKey[]): string | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i];
    if (typeof p === "string" && !/^\d+$/.test(p)) return p;
  }
  return null;
}

/**
 * Engine reasons into field errors. The engine sends Zod issues as "path: message" (`legal.email: invalid email`) and
 * cross-field checks the same way. A path through a list (`fields.3.label`) names a row, not an input, so it stays a
 * general reason with its path, like anything else without a field.
 */
export function splitReasons(reasons: readonly string[]): { fieldErrors: FieldErrors; reasons: string[] } {
  const fieldErrors: FieldErrors = {};
  const rest: string[] = [];
  for (const reason of reasons) {
    const m = /^([A-Za-z][\w]*(?:\.[\w]+)*): (.+)$/s.exec(reason);
    const path = m?.[1]?.split(".") ?? [];
    const field = path.some((p) => /^\d+$/.test(p)) ? null : fieldOf(path);
    if (field && m?.[2]) fieldErrors[field] ??= cap(m[2]);
    else rest.push(cap(reason));
  }
  return { fieldErrors, reasons: rest };
}

/** A failed client-side Zod parse into field errors, first message per field. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const field = fieldOf(issue.path);
    if (field) out[field] ??= cap(issue.message);
  }
  return out;
}

export const hasFieldErrors = (e: FieldErrors | null | undefined): e is FieldErrors => !!e && Object.keys(e).length > 0;
