/**
 * Emirates ID number: `784-YYYY-NNNNNNN-C`, where C is a Luhn check digit over the first 14 digits.
 */
const FORMAT = /^784-\d{4}-\d{7}-\d$/;

export function normaliseEmiratesId(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^784\d{12}$/.test(digits)) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
}

export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEmiratesId(raw: string): boolean {
  const id = normaliseEmiratesId(raw);
  if (!id || !FORMAT.test(id)) return false;
  const digits = id.replaceAll("-", "");
  return luhnCheckDigit(digits.slice(0, 14)) === Number(digits[14]);
}
