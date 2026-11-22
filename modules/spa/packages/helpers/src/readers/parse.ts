import { parseDocDate } from "@platform/readers/kyc/index";

/**
 * Strict parsers for what the reader copied off a document (C20, S52). The model only copies text; code turns it into
 * money, dates and percentages, and anything doubtful is `null` (unreadable), never a guess. No floats anywhere.
 */

/** "AED 1,250,000.50", "Dhs. 85,000", "85,000 AED" → fils. Properly grouped digits, at most two decimals, above zero. */
const MONEY =
  /^(?:(?:AED|DHS?\.?|DIRHAMS?)\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?:\s*(?:AED|DHS?\.?|DIRHAMS?))?$/i;

export function parseMoneyFils(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = MONEY.exec(raw.trim());
  if (!m) return null;
  const whole = BigInt(m[1]!.replaceAll(",", ""));
  const fraction = BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  const value = whole * 100n + fraction;
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

/** "25%", "33.33 %", "50 percent" → basis points. A bare number is ambiguous, so it is unreadable. */
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?\s*(?:%|per\s?cent)$/i;

export function parseBps(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = PERCENT.exec(raw.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

/** Dates as printed (DD/MM/YYYY in UAE order, ISO, or "19 NOV 2026"). */
export function parseDate(raw: string | null | undefined): string | null {
  return parseDocDate(raw);
}

const OUTSTANDING = /\b(outstanding|due|unpaid|pending|arrears?|not\s+cleared|not\s+paid|owing)\b/i;
const CLEARED = /\b(cleared|paid\s+in\s+full|settled|no\s+(?:dues|outstanding|arrears)|nil|none)\b/i;

/** Service charges as printed: outstanding wins over cleared; anything unclear is null. */
export function parseClearance(raw: string | null | undefined): boolean | null {
  if (!raw) return null;
  // "No dues outstanding" is cleared: remove the negated phrase before looking for what is still owed.
  const rest = raw.replace(/\bno\s+(?:dues|outstanding|arrears)(?:\s+(?:dues|outstanding|arrears))?\b/gi, " ");
  if (OUTSTANDING.test(rest)) return false;
  return CLEARED.test(raw) ? true : null;
}

/**
 * Whether the page shown is the whole document. One uploaded file is one image, so only "1 of 1" is complete; "2 of 3"
 * means pages are missing; text that isn't "n of m" is unknown (and counts against the document).
 */
export function parsePageOf(raw: string | null | undefined): "complete" | "missing" | "unknown" {
  if (!raw) return "unknown";
  const m = /(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})/i.exec(raw);
  if (!m) return "unknown";
  const [n, total] = [Number(m[1]), Number(m[2])];
  if (total < 1 || n < 1 || n > total) return "unknown";
  return total === 1 ? "complete" : "missing";
}

const IBAN_IN_TEXT = /\bAE[0-9]{2}(?:[\s-]?[0-9]){19}\b/gi;

/**
 * An AE IBAN as printed (`AE07 0331 2345 6789 0123 456`, any spacing, case or a leading label) → `AE` plus 21 digits.
 * Strict (S55): exactly one account in the text, the right length and a good mod-97 check; anything else is `null`.
 * Integer arithmetic only, in chunks (no big numbers).
 */
export function parseIban(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const found = raw.match(IBAN_IN_TEXT);
  if (found?.length !== 1) return null;
  const iban = found[0]!.replace(/[\s-]/g, "").toUpperCase();
  if (!/^AE[0-9]{21}$/.test(iban)) return null;
  // Move the first four characters to the end; letters become 10..35; the remainder mod 97 must be 1.
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let rest = 0;
  for (const ch of moved) {
    const digits = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1 ? iban : null;
}

/** `AE07...3456`: enough to tell two accounts apart in a log or an event, never the whole number. */
export const maskIban = (iban: string): string => `${iban.slice(0, 4)}...${iban.slice(-4)}`;
