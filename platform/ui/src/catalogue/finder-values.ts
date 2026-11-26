/** The named fields of a finder form as plain strings; a missing field is "". */
export function finderValues(form: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, String(form.get(n) ?? "")]));
}
