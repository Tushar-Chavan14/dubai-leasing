/** Money is integer fils (AED × 100). Never floats. */
export type Fils = number & { readonly __fils: unique symbol };

export function fils(value: number): Fils {
  if (!Number.isSafeInteger(value)) throw new Error(`fils must be a safe integer, got ${value}`);
  return value as Fils;
}

const AED_PATTERN = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Parses "85,000", "85000.5" or "85000.50" AED into fils without float arithmetic. */
export function parseAed(input: string): Fils {
  const m = AED_PATTERN.exec(input.trim().replace(/^AED\s*/i, ""));
  if (!m) throw new Error(`invalid AED amount: ${input}`);
  const whole = Number((m[2] ?? "0").replaceAll(",", ""));
  const fraction = Number((m[3] ?? "").padEnd(2, "0") || "0");
  const value = whole * 100 + fraction;
  return fils(m[1] ? -value : value);
}

export function aed(whole: number): Fils {
  if (!Number.isSafeInteger(whole)) throw new Error(`aed() takes whole dirhams, got ${whole}`);
  return fils(whole * 100);
}

/** "AED 85,000.00" */
export function formatAed(amount: Fils | number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}AED ${whole}.${fraction}`;
}

/** `amount × percent / 100`, rounded down to a whole fil. `percent` must be an integer. */
export function percentOfFloor(amount: Fils | number, percent: number): Fils {
  if (!Number.isInteger(percent)) throw new Error("percent must be an integer");
  return fils(Math.floor((amount * percent) / 100));
}

export function sumFils(values: readonly (Fils | number)[]): Fils {
  return fils(values.reduce<number>((a, b) => a + b, 0));
}

/** Splits a total into `parts` instalments; the remainder goes to the first instalments. */
export function splitFils(total: Fils | number, parts: number): Fils[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error("parts must be a positive integer");
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => fils(base + (i < rest ? 1 : 0)));
}
