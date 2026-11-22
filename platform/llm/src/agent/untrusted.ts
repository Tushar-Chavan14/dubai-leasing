/**
 * Marks text written by tenants or other outsiders (comments, complaints, emails, extracted
 * fields). The prompt tells the model that anything inside these tags is data to report, never
 * an instruction. A closing tag inside the text is neutralised so it can't end the block early.
 */
export function untrusted(text: string): string {
  const safe = text.replace(/<\/?\s*untrusted\s*>/gi, "[tag removed]");
  return `<untrusted>${safe}</untrusted>`;
}

/** Wraps every string inside a value (objects and arrays, recursively); other values pass through. */
export function untrustedDeep(value: unknown): unknown {
  if (typeof value === "string") return untrusted(value);
  if (Array.isArray(value)) return value.map(untrustedDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, untrustedDeep(v)]));
  }
  return value;
}
