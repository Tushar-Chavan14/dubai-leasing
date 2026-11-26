/**
 * Masks Emirates ID, passport, phone and IBAN numbers so they can be logged or shown to a model.
 * Keeps the last 2–4 characters so a person can still tell records apart.
 */

// 784-1990-1234567-1, with or without dashes/spaces.
const EMIRATES_ID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g;
// UAE and international phone numbers: +971 50 123 4567, 00971501234567, 050-123-4567.
const PHONE = /(?<![\w-])(?:\+|00)\d{1,3}[\s-]?\d{1,3}(?:[\s-]?\d{2,4}){2,3}\b|\b0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
// Passport numbers: 1–2 letters followed by 6–8 digits (e.g. N1234567, AB1234567).
const PASSPORT = /\b[A-Z]{1,2}\d{6,8}\b/g;
// IBANs (deposit refunds): AE07 0331 2345 6789 0123 456, with or without spaces.
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g;

function maskKeepingTail(match: string, keep: number): string {
  let seen = 0;
  const chars = match.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i] as string;
    if (/[A-Za-z0-9]/.test(c)) {
      seen++;
      if (seen > keep) chars[i] = "*";
    }
  }
  return chars.join("");
}

export function maskPiiText(text: string): string {
  return text
    .replace(IBAN, (m) => maskKeepingTail(m, 4))
    .replace(EMIRATES_ID, (m) => maskKeepingTail(m, 3))
    .replace(PHONE, (m) => maskKeepingTail(m, 2))
    .replace(PASSPORT, (m) => maskKeepingTail(m, 3));
}

const SENSITIVE_KEYS = /(emirates_?id|passport|phone|mobile|visa_?no|id_?number|id_?no$|trade_?licence_?no|iban)/i;

/** Masks PII in a string, or deeply in an object/array. Fields with sensitive names are fully masked. */
export function maskPii<T>(value: T): T {
  if (typeof value === "string") return maskPiiText(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskPii(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        SENSITIVE_KEYS.test(k) && (typeof v === "string" || typeof v === "number")
          ? maskKeepingTail(String(v), 2)
          : maskPii(v);
    }
    return out as T;
  }
  return value;
}
