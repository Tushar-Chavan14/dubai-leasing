import type { CalendarDate } from "./dates.ts";

/**
 * Passport machine-readable zone, ICAO 9303 TD3 (two lines of 44 characters). The check digits
 * make the MRZ the most reliable source on a passport: fields read from a valid MRZ win over
 * fields read from the printed page (KYC helper). Pure code, no model.
 */
export interface Td3 {
  documentType: string;
  issuingState: string;
  surname: string;
  givenNames: string;
  /** "SURNAME GIVEN NAMES", as printed in the MRZ (Latin letters only). */
  fullName: string;
  passportNo: string;
  nationality: string;
  birthDate: CalendarDate;
  sex: "M" | "F" | "X";
  expiresOn: CalendarDate;
  personalNo: string;
}

export type Td3Result = { ok: true; data: Td3 } | { ok: false; errors: string[]; partial?: Partial<Td3> };

const WEIGHTS = [7, 3, 1];
const charValue = (c: string) => {
  if (c === "<") return 0;
  if (/[0-9]/.test(c)) return Number(c);
  if (/[A-Z]/.test(c)) return c.charCodeAt(0) - 55;
  return -1;
};

/** ICAO check digit over a field. */
export function mrzCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const v = charValue(field[i]!);
    if (v < 0) return -1;
    sum += v * WEIGHTS[i % 3]!;
  }
  return sum % 10;
}

const clean = (s: string) => s.replace(/<+$/g, "").replace(/</g, " ").trim();

/**
 * YYMMDD → calendar date. Birth dates use a pivot (a two-digit year after `pivotYear`'s last two
 * digits is last century); expiry dates are always this century.
 */
function mrzDate(yymmdd: string, kind: "birth" | "expiry", pivotYear: number): CalendarDate | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1) return null;
  const century = kind === "expiry" ? 2000 : yy > pivotYear % 100 ? 1900 : 2000;
  const y = century + yy;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1]!;
  if (dd > days) return null;
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` as CalendarDate;
}

/**
 * Parses and checks a TD3 MRZ. `lines` may contain spaces or OCR noise around the two lines;
 * only `A–Z`, `0–9` and `<` are kept. `pivotYear` is the current year (from the Clock).
 */
export function parseTd3(lines: string[], pivotYear: number): Td3Result {
  const rows = repairTd3Lengths(
    lines.map((l) => l.toUpperCase().replace(/[^A-Z0-9<]/g, "")).filter((l) => l.length > 0),
  );
  const [l1, l2] = rows;
  const errors: string[] = [];
  if (rows.length !== 2 || l1?.length !== 44 || l2?.length !== 44) {
    return { ok: false, errors: ["the MRZ must be two lines of 44 characters"] };
  }
  if (l1[0] !== "P") errors.push("the MRZ is not a passport (TD3) MRZ");
  const [surnameRaw, givenRaw = ""] = l1.slice(5).split("<<");
  const surname = clean(surnameRaw ?? "");
  const givenNames = clean(givenRaw);

  const passportField = l2.slice(0, 9);
  const birthField = l2.slice(13, 19);
  const expiryField = l2.slice(21, 27);
  const personalField = l2.slice(28, 42);
  const checks: [string, string, string][] = [
    ["passport number", passportField, l2[9]!],
    ["date of birth", birthField, l2[19]!],
    ["expiry date", expiryField, l2[27]!],
  ];
  for (const [label, field, digit] of checks) {
    if (String(mrzCheckDigit(field)) !== digit) errors.push(`${label} check digit does not match`);
  }
  // The personal number check digit may be "<" when the field is empty.
  const personalDigit = l2[42]!;
  if (
    !(personalDigit === "<" && /^<+$/.test(personalField)) &&
    String(mrzCheckDigit(personalField)) !== personalDigit
  ) {
    errors.push("personal number check digit does not match");
  }
  const composite = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
  if (String(mrzCheckDigit(composite)) !== l2[43]) errors.push("composite check digit does not match");

  const birthDate = mrzDate(birthField, "birth", pivotYear);
  const expiresOn = mrzDate(expiryField, "expiry", pivotYear);
  if (!birthDate) errors.push("date of birth is not a valid date");
  if (!expiresOn) errors.push("expiry date is not a valid date");
  const sex = l2[20] === "M" || l2[20] === "F" ? l2[20] : "X";
  const partial: Partial<Td3> = {
    documentType: clean(l1.slice(0, 2)),
    issuingState: clean(l1.slice(2, 5)),
    surname,
    givenNames,
    fullName: [surname, givenNames].filter(Boolean).join(" "),
    passportNo: clean(passportField),
    nationality: clean(l2.slice(10, 13)),
    sex,
    personalNo: clean(personalField),
    ...(birthDate ? { birthDate } : {}),
    ...(expiresOn ? { expiresOn } : {}),
  };
  if (errors.length) return { ok: false, errors, partial };
  return { ok: true, data: partial as Td3 };
}

/**
 * OCR (and vision models) often miscount runs of `<` fillers. Only filler runs are adjusted:
 * line 1 is padded or trimmed at its end; line 2's personal-number field (between the expiry
 * check digit and the last two check digits) is padded or trimmed with `<`. The check digits
 * still guard every number and date. The name in line 1 has no check digit, so the KYC helper
 * also compares it with the printed name and flags any real difference.
 */
export function repairTd3Lengths(rows: string[]): string[] {
  if (rows.length !== 2) return rows;
  let [l1, l2] = rows as [string, string];
  if (l1.length !== 44) l1 = l1.replace(/<+$/, "").padEnd(44, "<").slice(0, 44);
  if (l2.length !== 44 && l2.length >= 30) {
    const head = l2.slice(0, 28);
    const tail = l2.slice(-2);
    const core = l2.slice(28, -2).replace(/<+$/, "");
    if (core.length <= 14) l2 = head + core.padEnd(14, "<") + tail;
  }
  return [l1, l2];
}

const field = (s: string, len: number) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "<")
    .padEnd(len, "<")
    .slice(0, len);
const yymmdd = (d: string) => d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);

/** Builds a valid TD3 MRZ (fictional specimens and tests). */
export function makeTd3(p: {
  issuingState: string;
  surname: string;
  givenNames: string;
  passportNo: string;
  nationality: string;
  birthDate: string;
  sex: "M" | "F" | "X";
  expiresOn: string;
  personalNo?: string;
}): [string, string] {
  const names = `${p.surname.toUpperCase().replace(/[^A-Z]+/g, "<")}<<${p.givenNames.toUpperCase().replace(/[^A-Z]+/g, "<")}`;
  const l1 = `P<${field(p.issuingState, 3)}${names}`.padEnd(44, "<").slice(0, 44);
  const passport = field(p.passportNo, 9);
  const birth = yymmdd(p.birthDate);
  const expiry = yymmdd(p.expiresOn);
  const personal = field(p.personalNo ?? "", 14);
  const personalDigit = /^<+$/.test(personal) ? "<" : String(mrzCheckDigit(personal));
  const body =
    passport +
    mrzCheckDigit(passport) +
    field(p.nationality, 3) +
    birth +
    mrzCheckDigit(birth) +
    (p.sex === "X" ? "<" : p.sex) +
    expiry +
    mrzCheckDigit(expiry) +
    personal +
    personalDigit;
  const composite = body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43);
  return [l1, body + mrzCheckDigit(composite)];
}
